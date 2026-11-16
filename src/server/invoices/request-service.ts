import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { isManager, matterAssociationFilter } from "@/lib/permissions";
import { resolveRoleUser } from "@/lib/roles/service";
import { scopeFor } from "@/lib/roles/catalog";
import { requireApprovalRoute } from "@/lib/approvals/service";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasPersonalCapability } from "@/lib/runtime/capabilities";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { auditTx } from "@/server/audit";

const optionalText = (length: number) => z.string().trim().max(length).nullish().transform(value => value || null);
const requestSchema = z.object({
  requestKey: z.string().uuid("提交标识无效，请重新打开申请").transform(value => value.toLowerCase()),
  matterId: z.string().cuid().nullable(),
  noMatterReason: optionalText(1000),
  amount: z.union([z.string(), z.number()]).transform(String).refine(
    value => /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value) && new Prisma.Decimal(value).gt(0),
    "金额须大于 0，最多十二位整数、两位小数",
  ),
  invoiceType: z.enum(["PLAIN", "SPECIAL"], { error: "请选择开票类型" }),
  invoiceItem: z.enum(["LAWYER_FEE", "CONSULTING_FEE", "AGENCY_FEE", "OTHER"]),
  buyerName: z.string().trim().min(1, "请填写开票抬头").max(200),
  buyerTaxNo: optionalText(80), buyerAddress: optionalText(500), buyerPhone: optionalText(80),
  buyerBank: optionalText(200), buyerBankAccount: optionalText(100),
  evidenceDocIds: z.array(z.string().cuid()).max(200),
  requestNote: optionalText(500),
});
export type InvoiceRequestInput = z.input<typeof requestSchema>;
type Actor = Awaited<ReturnType<typeof requireSession>>["user"];

function normalize(input: InvoiceRequestInput) {
  const value = requestSchema.parse(input);
  const special = value.invoiceType === "SPECIAL";
  if (special) {
    for (const [field, label] of [["buyerTaxNo", "纳税人识别号"], ["buyerAddress", "购方地址"], ["buyerPhone", "购方电话"], ["buyerBank", "开户银行"], ["buyerBankAccount", "银行账号"]] as const) {
      if (!value[field]) throw new ActionError(`增值税专用发票必须填写${label}`);
    }
  }
  return {
    ...value,
    amount: new Prisma.Decimal(value.amount).toFixed(2),
    noMatterReason: value.matterId ? null : value.noMatterReason,
    buyerAddress: special ? value.buyerAddress : null,
    buyerPhone: special ? value.buyerPhone : null,
    buyerBank: special ? value.buyerBank : null,
    buyerBankAccount: special ? value.buyerBankAccount : null,
    evidenceDocIds: [...new Set(value.evidenceDocIds)].sort(),
  };
}
type RequestData = ReturnType<typeof normalize>;

async function currentAccess(db: Prisma.TransactionClient, actor: Actor, matterId: string | null) {
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  await db.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
  if (!user?.active || user.role !== actor.role) throw new ActionError("当前账号或岗位已变化，请刷新后重试");
  const current = await resolveRoleUser(actor.id, user.role, db);
  if (!current.enabled) throw new ActionError("当前岗位已停用，无权查看或提交开票申请");
  if (!matterId) return { current, matter: null };
  await db.$queryRaw`SELECT id FROM "Matter" WHERE id=${matterId} FOR SHARE`;
  const matter = await db.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...matterAssociationFilter(actor.id) },
    select: { id: true, status: true, category: true, internalCode: true, title: true },
  });
  if (!matter) throw new ActionError("案件不存在或无权关联");
  return { current, matter };
}

async function createRequirements(db: Prisma.TransactionClient, actor: Actor, data: RequestData, access: Awaited<ReturnType<typeof currentAccess>>, requireEvidence: boolean) {
  if (access.matter?.status === "ARCHIVED") throw new ActionError("案件已归档，禁止新增开票申请");
  if (!data.matterId) {
    if (!hasPersonalCapability(await resolvePersonalActor(db, actor.id), "invoices.process") && !isManager(access.current.role) && access.current.role !== "FINANCE" && !(access.current.role === "CUSTOM" && scopeFor(access.current, "finance.write") === "ALL")) {
      throw new ActionError("无关联案件开票仅财务 / 管理员 / 主任律师可发起");
    }
    if (!data.noMatterReason) throw new ActionError("无关联案件时必须填写原因说明");
  }
  if (requireEvidence && data.matterId && !data.evidenceDocIds.length) throw new ActionError("请选择或上传至少一份开票依据");
  await requireApprovalRoute({ action: "INVOICE_APPROVE", category: access.matter?.category ?? null, requesterId: actor.id }, db);
  if (!data.evidenceDocIds.length) return;
  await db.$queryRaw(Prisma.sql`SELECT id FROM "Document" WHERE id IN (${Prisma.join(data.evidenceDocIds)}) FOR SHARE`);
  const documents = await db.document.findMany({
    where: { id: { in: data.evidenceDocIds }, deletedAt: null, ...(data.matterId ? { matterId: data.matterId } : {}) },
    select: { id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true },
  });
  if (documents.length !== data.evidenceDocIds.length) throw new ActionError(data.matterId ? "开票依据必须为本案有效材料" : "开票依据不存在或已删除");
  for (const document of documents) {
    if (!await canReadDocument(actor.id, document, db)) throw new ActionError("开票依据不存在或无权访问");
  }
}

/** 新附件上传前只核对本次申请资格；真正创建仍完整复核，不提前生成申请或指纹。 */
export async function prepareInvoiceEvidenceUpload(actor: Actor, input: InvoiceRequestInput) {
  const data = normalize(input);
  await prisma.$transaction(async db => {
    const access = await currentAccess(db, actor, data.matterId);
    await createRequirements(db, actor, data, access, false);
  }, { isolationLevel: "ReadCommitted", timeout: 20000 });
}

function isRequestConflict(error: { code: unknown; meta?: unknown }) {
  if (error.code !== "P2002" || !error.meta || typeof error.meta !== "object") return false;
  const meta = error.meta as { modelName?: unknown; target?: unknown };
  if (meta.modelName !== undefined && meta.modelName !== "InvoiceRequest") return false;
  return meta.target === "InvoiceRequest_requestedById_requestKey_key" ||
    (Array.isArray(meta.target) && meta.target.length === 2 && meta.target.includes("requestedById") && meta.target.includes("requestKey"));
}

export async function createInvoiceRequestForActor(actor: Actor, input: InvoiceRequestInput) {
  const { requestKey, ...data } = normalize(input);
  const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  let replayOnly = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async db => {
        const access = await currentAccess(db, actor, data.matterId);
        const existing = await db.invoiceRequest.findUnique({
          where: { requestedById_requestKey: { requestedById: actor.id, requestKey } },
          select: { id: true, status: true, requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new ActionError("此提交已保存且内容不同，请先核对已有申请；另建申请请关闭后重新申请");
          return { id: existing.id, status: existing.status, replayed: true, matter: access.matter };
        }
        if (replayOnly) throw new ActionError("本次提交结果已变化，请先刷新核对已有申请");
        await createRequirements(db, actor, { requestKey, ...data }, access, true);
        const created = await db.invoiceRequest.create({
          data: { ...data, amount: new Prisma.Decimal(data.amount), requestKey, requestHash, title: data.buyerName, requestedById: actor.id },
          select: { id: true, status: true },
        });
        await auditTx(db, { userId: actor.id, action: "INVOICE_REQUEST_CREATE", targetType: "InvoiceRequest", targetId: created.id, detail: { matterId: data.matterId, amount: data.amount, invoiceType: data.invoiceType, evidenceDocIds: data.evidenceDocIds } });
        return { ...created, replayed: false, matter: access.matter };
      }, { isolationLevel: "ReadCommitted", timeout: 20000 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const requestConflict = isRequestConflict(error);
        if ((error.code === "P2034" || requestConflict) && attempt < 2) {
          replayOnly ||= requestConflict;
          continue;
        }
      }
      throw error;
    }
  }
}
