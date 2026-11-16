"use server";
import {assertIntakeDocumentChange,intakeWorkflowReady} from "@/server/intakes/workflow";
import type {RoleUser} from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";

import { notifyRoleApprovers } from "@/server/notifications/approval";
import { approvalTransaction, approvalAudit, assertApprovalItem, approvalContextFor, requireApprovalRoute } from "@/lib/approvals/service";
import { selfConfirmEligible } from "@/lib/approvals/self-confirm";
import { isPersonalMode } from "@/lib/runtime/mode";


import { revalidatePath } from "next/cache";
import { verifyCheckoutToken } from "@/lib/desktop/checkout-token";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertDocumentWritable } from "@/lib/archive/guard";
import { matterVisibilityFilter, matterAssociationFilter, assertCanHandleMatter } from "@/lib/permissions";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { extractDocumentTextLayer, ocrStatusFor } from "@/lib/documents/text-extraction";
import { revalidateMatter } from "@/server/matters/route";
import { ingestMaterial, withdrawMaterial } from "./material-ingest";
import { ActionError } from "@/lib/action-error";
import { assertDocumentDerivationAccess } from "./derivation-access";
import { canReadDocument } from "@/lib/approvals/documents";

const documentCategorySchema = z.enum([
  "EVIDENCE",
  "PLEADING",
  "PROCEDURE",
  "JUDGMENT",
  "CONTRACT",
  "OTHER"
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * 上传材料。前端通过 Server Action 传 FormData，含 file（File）、metadata。
 * 加密分支：encrypted=true 时把文件用 AES-256-GCM 加密后写盘。
 */
async function documentMutation<T>(user:RoleUser&{id:string},subject:{intakeId:string|null;matterId:string|null;id?:string},write:(db:Prisma.TransactionClient)=>Promise<T>){
 return approvalTransaction(async db=>{
   const identity = await db.user.findUnique({ where: { id: user.id }, select: { active: true, role: true } });
   if (!identity?.active) throw new ActionError("当前账号不可用");
   const role = await resolveRoleUser(user.id, identity.role, db);
   if (!role.enabled || !hasCustomPermission(role, "documents.write")) throw new ActionError("当前岗位无权修改文书");
   if (subject.matterId) {
     const matter = await db.matter.findFirst({ where: { id: subject.matterId, deletedAt: null,
       ...(role.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(user.id)) }, select: { status: true } });
     if (!matter) throw new ActionError("案件不存在或无权办理");
     if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，文书不可修改");
   }
   if(subject.intakeId){
   if(!subject.matterId)await assertIntakeDocumentChange(db,user.id,subject.intakeId!,subject.id);
   else if(subject.id){const [used]=await db.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM "IntakeRevision" WHERE "intakeId"=${subject.intakeId} AND snapshot->'documents' @> ${JSON.stringify([{id:subject.id}])}::jsonb`;if(Number(used.count))throw new ActionError('已送审材料原件须保留，请另传补充材料');}
   }
   return write(db);
 });
}

export async function uploadDocument(formData: FormData) {
  const session = await requireSession("documents.write");

  const matterIdRaw = formData.get("matterId");
  const intakeIdRaw = formData.get("intakeId");
  const procedureId = formData.get("procedureId");
  const folderIdRaw = formData.get("folderId");
  const name = formData.get("name");
  const category = formData.get("category");
  const encrypted = formData.get("encrypted") === "true";
  const tagsRaw = formData.get("tags");
  const archiveChecklistItemIdRaw = formData.get("archiveChecklistItemId");
  const stageIdRaw = formData.get("stageId");
  const sourcePartyRaw = formData.get("sourceParty");
  const sourceOriginRaw = formData.get("sourceOrigin");
  const SOURCE_ORIGINS = ["CLIENT_PROVIDED", "COURT_SERVED", "AI_EXTRACTED", "SELF_COLLECTED", "TEAM_PRODUCED"] as const;
  const sourceOrigin =
    typeof sourceOriginRaw === "string" && (SOURCE_ORIGINS as readonly string[]).includes(sourceOriginRaw)
      ? (sourceOriginRaw as (typeof SOURCE_ORIGINS)[number])
      : null;
  const file = formData.get("file");

  if (!(file instanceof File)) throw new ActionError("缺少文件");

  const matterId = typeof matterIdRaw === "string" && matterIdRaw ? matterIdRaw : null;
  const intakeId = typeof intakeIdRaw === "string" && intakeIdRaw ? intakeIdRaw : null;
  if (!matterId && !intakeId) throw new ActionError("matterId 或 intakeId 至少需要一个");

  if (typeof name !== "string" || !name.trim()) throw new ActionError("材料名称必填");
  const parsedCategory = documentCategorySchema.parse(category || "OTHER");
  const tags =
    typeof tagsRaw === "string" && tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  const validated = validateUploadedFile(file, { purpose: "document", maxBytes: MAX_FILE_SIZE });

  const folderId = typeof folderIdRaw === "string" && folderIdRaw ? folderIdRaw : null;
  const stageId = typeof stageIdRaw === "string" && stageIdRaw ? stageIdRaw : null;

  // 校验归属对象存在
  let folderName: string | null = null;
  if (matterId) {
    const matter = await prisma.matter.findUnique({
      where: { id: matterId, deletedAt: null },
      select: { id: true, status: true }
    });
    if (!matter) throw new ActionError("案件不存在");
    // 上传属案件写入，统一走经办断言：合伙人全所、其余（含 managerAuthorized）须本案经办，
    // 管理权只放大「可见」不放大写入（AGENTS 业务管理权决议）。
    await assertCanHandleMatter(session.user, matterId);

    if (folderId) {
      const folder = await prisma.documentFolder.findUnique({
        where: { id: folderId },
        select: { matterId: true, name: true }
      });
      if (!folder || folder.matterId !== matterId) {
        throw new ActionError("目标卷宗与案件不匹配");
      }
      folderName = folder.name;
    }

    // v0.48: 归属环节必须属于本案件（且与 procedureId 一致时才可信）
    if (stageId) {
      const stage = await prisma.matterStage.findUnique({
        where: { id: stageId },
        select: { procedureId: true, procedure: { select: { matterId: true } } }
      });
      if (!stage || stage.procedure.matterId !== matterId) {
        throw new ActionError("归属环节与案件不匹配");
      }
      if (typeof procedureId === "string" && procedureId && stage.procedureId !== procedureId) {
        throw new ActionError("归属环节与程序不匹配");
      }
    }

    // 归档后仅允许补传到 ARCHIVE 卷宗（结案 / 归档），由 guard 判定
    await assertDocumentWritable(matterId, { kind: "upload", folderName });
  }
  if (intakeId) {
    const intake = await prisma.intake.findUnique({
      where: { id: intakeId },
      select: { id: true, status: true, createdById: true, ownerUserId: true, coUserIds: true }
    });
    if (!intake) throw new ActionError("收案记录不存在");
    if(!matterId&&await intakeWorkflowReady(prisma)) await approvalTransaction(db=>assertIntakeDocumentChange(db,session.user.id,intakeId));
    if (intake.status === "DECLINED") throw new ActionError("已拒绝的收案不可上传材料");
    const uid = session.user.id;
    if (
      session.user.role !== "PRINCIPAL_LAWYER" &&
      intake.createdById !== uid &&
      intake.ownerUserId !== uid &&
      !intake.coUserIds.includes(uid)
    ) {
      throw new ActionError("无权向该收案上传材料");
    }
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const hash = sha256(raw);

  const enc = encrypted ? encryptBuffer(raw) : null;
  const requestKey = formData.get("requestKey");
  const created = await ingestMaterial({
    userId: session.user.id,
    requestKey: typeof requestKey === "string" && requestKey ? requestKey : undefined,
    bytes: enc ? enc.ciphertext : raw,
    document: {
      matterId, intakeId,
      procedureId: typeof procedureId === "string" && procedureId ? procedureId : null,
      stageId: matterId ? stageId : null, folderId, name: name.trim(), category: parsedCategory,
      sourceOrigin,
      sourceParty: typeof sourcePartyRaw === "string" && sourcePartyRaw.trim() ? sourcePartyRaw.trim() : null,
      mimeType: validated.mimeType, size: file.size, sha256: hash, encrypted,
      algorithm: enc?.algorithm ?? null, iv: enc ? enc.iv.toString("base64") : null,
      authTag: enc ? enc.authTag.toString("base64") : null, tags,
      archiveChecklistItemId: typeof archiveChecklistItemIdRaw === "string" && archiveChecklistItemIdRaw ? archiveChecklistItemIdRaw : null,
      uploadedById: session.user.id
    }
  });
  // Intake uses its existing text path until its separate source ownership contract is implemented.
  if (!matterId) await extractIntakeText(created.id, raw, validated.mimeType);

  if (matterId) await revalidateMatter(matterId);
  if (intakeId) revalidatePath(`/intakes/${intakeId}`);
  return { ok: true, id: created.id };
}

export async function deleteDocument(id: string) {
  const session = await requireSession("documents.write");
  const doc = await withdrawMaterial(session.user.id, id, false);
  if (!doc) return { ok: false };
  if (doc.matterId) await revalidateMatter(doc.matterId);
  if (doc.intakeId) revalidatePath(`/intakes/${doc.intakeId}`);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function hardDeleteDocument(id: string) {
  const session = await requireSession("documents.write");
  const doc = await withdrawMaterial(session.user.id, id, true);
  if (!doc) return { ok: false };
  if (doc.matterId) await revalidateMatter(doc.matterId);
  if (doc.intakeId) revalidatePath(`/intakes/${doc.intakeId}`);
  revalidatePath("/approvals");
  return { ok: true, queued: true };
}

async function extractIntakeText(id: string, raw: Buffer, mimeType: string) {
  try {
    const layer = await extractDocumentTextLayer(raw, mimeType);
    await prisma.document.updateMany({ where: { id, deletedAt: null, parseGeneration: 0 }, data: {
      textContent: layer.text.slice(0, 500_000), pageCount: layer.pageCount, textSource: layer.source,
      ocrStatus: layer.text.length > 500_000 ? "PARTIAL" : "READY"
    } });
  } catch (error) {
    await prisma.document.updateMany({ where: { id, deletedAt: null, parseGeneration: 0 }, data: { ocrStatus: ocrStatusFor(error) } });
  }
}

const docListQuerySchema = z.object({
  search: z.string().optional(),
  category: documentCategorySchema.optional(),
  matterId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export async function listAllDocuments(input: Partial<z.infer<typeof docListQuerySchema>> = {}) {
  const session = await requireSession("documents.read");
  const query = docListQuerySchema.parse(input);

  const visFilter = session.user.role === "FINANCE" ? matterAssociationFilter(session.user.id) : matterVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    matter: { deletedAt: null, ...visFilter },
    ...(query.category ? { category: query.category } : {}),
    ...(query.matterId ? { matterId: query.matterId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { tags: { has: query.search } }
          ]
        }
      : {})
  };

  const rows = await prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      uploadedBy: { select: { id: true, name: true } }
    }
  });
  const readable = await Promise.all(rows.map(row => canReadDocument(session.user.id, row)));
  return rows.filter((_, index) => readable[index]);
}

// ============ v0.10: 文书审批流程 ============

export async function submitDocumentForReview(id: string) {
  const session = await requireSession("documents.write");
  const doc = await prisma.document.findUnique({ where: { id, deletedAt: null } });
  if (!doc) throw new ActionError("材料不存在");
  if (doc.matterId) {
    await assertCanHandleMatter(session.user, doc.matterId);
    await assertDocumentWritable(doc.matterId, { kind: "modify" });
  }
  if (doc.uploadedById !== session.user.id) throw new ActionError("仅上传人可提交此材料审核");

  // v1.x 4.3：自确认分支——命中清单的低影响文书送审由上传人自我确认，
  // 不进审批队列、不通知审批人；审计动作区分（DOCUMENT_SELF_CONFIRM）。
  const docContext = await approvalContextFor("DOCUMENT_APPROVE", id);
  if (doc.matterId) {
    const matterRow = await prisma.matter.findUnique({ where: { id: doc.matterId }, select: { category: true } });
    if (matterRow) docContext.category = matterRow.category;
  }
  if (!isPersonalMode() && await selfConfirmEligible(docContext, prisma)) {
    if (doc.status !== "DRAFT") throw new ActionError("只有草稿状态的材料才能提交审核");
    await documentMutation(session.user, doc, async db => {
      await assertDocumentDerivationAccess(session.user.id, id, { purpose: "SUBMIT", db });
      await db.document.update({
        where: { id, status: "DRAFT", updatedAt: doc.updatedAt },
        data: {
          status: "APPROVED",
          reviewedById: session.user.id,
          reviewedAt: new Date(),
          approvedById: session.user.id,
          approvedAt: new Date()
        }
      });
      await approvalAudit(db, session.user.id, "DOCUMENT_SELF_CONFIRM", id, {
        matterId: doc.matterId,
        name: doc.name,
        note: "命中自确认清单，申请人自我确认即生效"
      });
    });
    if (doc.matterId) await revalidateMatter(doc.matterId);
    revalidatePath("/approvals");
    return { ok: true, selfConfirmed: true };
  }

  await requireApprovalRoute(docContext);
  if (doc.status !== "DRAFT") throw new ActionError("只有草稿状态的材料才能提交审核");

  await documentMutation(session.user, doc, async db => {
    await assertDocumentDerivationAccess(session.user.id, id, { purpose: "SUBMIT", db });
    await db.document.update({
      where: { id, status: "DRAFT", updatedAt: doc.updatedAt },
      data: { status: "PENDING_REVIEW" },
    });
    await approvalAudit(db, session.user.id, "DOCUMENT_SUBMIT_REVIEW", id, {
      matterId: doc.matterId, name: doc.name, attachmentIds: [id],
    });
  });

  await notifyRoleApprovers({ roles: ["PRINCIPAL_LAWYER"], excludeUserId: session.user.id, title: "新的文书待审批", content: doc.name, href: "/approvals", refType: "Document", refId: id });
  if (doc.matterId) await revalidateMatter(doc.matterId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function approveDocument(id: string, note?: string) {
  const session = await requireSession("approval");
  const doc = await prisma.document.findUnique({ where: { id, deletedAt: null } });
  if (!doc) throw new ActionError("材料不存在");
  if (doc.status !== "PENDING_REVIEW") throw new ActionError("材料不在待审核状态");

  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "DOCUMENT_APPROVE", id, tx);
    await assertDocumentDerivationAccess(session.user.id, id, { purpose: "READ", db: tx });
  await tx.document.update({
    where: { id, status: "PENDING_REVIEW", updatedAt: doc.updatedAt },
    data: {
      status: "APPROVED",
      approvedById: session.user.id,
      approvedAt: new Date(),
    },
  });
    await approvalAudit(tx, session.user.id, "DOCUMENT_APPROVE", id, { note: note?.trim().slice(0, 500) ?? "", attachmentIds: [id] });
  });


  if (doc.matterId) await revalidateMatter(doc.matterId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function rejectDocument(id: string, reason?: string) {
  const session = await requireSession("approval");
  const doc = await prisma.document.findUnique({ where: { id, deletedAt: null } });
  if (!doc) throw new ActionError("材料不存在");
  if (doc.status !== "PENDING_REVIEW") throw new ActionError("材料不在待审核状态");

  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "DOCUMENT_APPROVE", id, tx);
  await tx.document.update({
    where: { id, status: "PENDING_REVIEW", updatedAt: doc.updatedAt },
    data: {
      status: "DRAFT",
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });
    await approvalAudit(tx, session.user.id, "DOCUMENT_REJECT", id, { reason: reason?.trim() ?? "", attachmentIds: [id] });
  });


  if (doc.matterId) await revalidateMatter(doc.matterId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function fileDocument(id: string) {
  const session = await requireSession("documents.write");
  const doc = await prisma.document.findUnique({ where: { id, deletedAt: null } });
  if (!doc) throw new ActionError("材料不存在");
  if (doc.matterId)
    // 材料归档属材料操作（P1-1）：合伙人全所口径，其余岗位（含管理权）须经办。
    await assertCanHandleMatter(session.user, doc.matterId);
  if (doc.status !== "APPROVED") throw new ActionError("只有已审批的材料才能归档");

  if (doc.matterId) await assertDocumentWritable(doc.matterId, { kind: "modify" });
  await documentMutation(session.user, doc, async roleDb => {
    await assertDocumentDerivationAccess(session.user.id, id, { purpose: "SUBMIT", db: roleDb });
    await roleDb.document.update({ where: { id, status: "APPROVED", updatedAt: doc.updatedAt }, data: { status: "FILED" } });
    await approvalAudit(roleDb, session.user.id, "DOCUMENT_FILE", id, { matterId: doc.matterId, name: doc.name });
  });

  if (doc.matterId) await revalidateMatter(doc.matterId);
  revalidatePath("/approvals");
  return { ok: true };
}


/**
 * v1.x 版本链闭合（P0-2 欠账）：为既有材料上传新版本。
 * 新行继承归属（案件/收案/程序/环节/卷宗/分类），familyId 沿用族首，
 * version+1、isLatest=true；旧版本置 isLatest=false 但永不删除（历史可溯）。
 * 归档守卫沿用（归档案件不可更新版本）。
 */
export async function uploadNewVersion(input: {
  documentId: string;
  file: File;
  category?: string;
  /** 受控回传（桌面连接器）：取件令牌，校验归属与基线 */
  checkoutToken?: string;
  requestKey?: string;
}): Promise<{ ok: true; id: string; version: number }> {
  const session = await requireSession("documents.write");
  // 2026-09-19 审计修复：此前新版本不经任何类型/大小校验、落库 MIME 取客户端值。
  const validated = validateUploadedFile(input.file, { purpose: "document", maxBytes: MAX_FILE_SIZE });
  const prior = await prisma.document.findUnique({ where: { id: input.documentId } });
  if (!prior || prior.deletedAt) throw new ActionError("原材料不存在");
  // The final transaction checks the head. A committed request may be replayed
  // after its response was lost even though its prior version is no longer latest.

  if (prior.matterId) {
    // 替换材料内容属材料操作（P1-1）：合伙人全所口径，其余岗位（含管理权）须经办，
    // 与上传入口的分流口径统一——管理权只放大可见不放大写入。
    await assertCanHandleMatter(session.user, prior.matterId);
    await assertDocumentWritable(prior.matterId, { kind: "modify" });
  }

  // 受控回传冲突拦截（DESKTOP-CONNECTOR-PLAN §二）：取件后他人已传新版
  // → 拒绝直传，提示基于新版另存；法律文本不自动合并。
  let checkout: { jti: string; baselineVersion: number } | null = null;
  if (input.checkoutToken) {
    const payload = verifyCheckoutToken(input.checkoutToken);
    if (!payload) throw new ActionError("取件令牌无效或已过期，请重新取件");
    if (payload.docId !== input.documentId) throw new ActionError("令牌与材料不匹配");
    if (payload.userId !== session.user.id) throw new ActionError("令牌不属于当前账号");
    if (payload.baselineVersion !== prior.version) {
      throw new ActionError(`文件已被他人更新为第 ${prior.version} 版（取件基线为第 ${payload.baselineVersion} 版）。请重新取件基于最新版另存副本，勿直接覆盖。`);
    }
    checkout = { jti: payload.jti, baselineVersion: payload.baselineVersion };
  }

  const raw = Buffer.from(await input.file.arrayBuffer());
  const hash = sha256(raw);
  // 加密策略随原材料：首传加密的文件其新版本必须同样加密，
  // 此前写死 false 会让「传新版本」把已加密材料静默替换成明文落盘。
  const encrypted = prior.encrypted;
  const enc = encrypted ? encryptBuffer(raw) : null;
  const created = await ingestMaterial({
    userId: session.user.id, priorDocumentId: prior.id, requestKey: input.requestKey, checkout,
    bytes: enc ? enc.ciphertext : raw,
    document: {
      matterId: prior.matterId, intakeId: prior.intakeId, procedureId: prior.procedureId,
      stageId: prior.stageId, folderId: prior.folderId, name: input.file.name || prior.name,
      category: input.category ? documentCategorySchema.parse(input.category) : prior.category,
      sourceParty: prior.sourceParty, sourceOrigin: prior.sourceOrigin,
      mimeType: validated.mimeType, size: input.file.size, sha256: hash, encrypted,
      algorithm: enc?.algorithm ?? null, iv: enc ? enc.iv.toString("base64") : null,
      authTag: enc ? enc.authTag.toString("base64") : null, tags: prior.tags,
      archiveChecklistItemId: prior.archiveChecklistItemId, uploadedById: session.user.id
    }
  });
  if (!prior.matterId) await extractIntakeText(created.id, raw, validated.mimeType);

  if (prior.matterId) await revalidateMatter(prior.matterId);
  if (prior.intakeId) revalidatePath(`/intakes/${prior.intakeId}`);
  return { ok: true, id: created.id, version: created.version };
}
