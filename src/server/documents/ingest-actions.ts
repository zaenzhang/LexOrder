"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanHandleMatter, matterAssociationFilter } from "@/lib/permissions";
import { revalidateMatter } from "@/server/matters/route";
import { abandonMaterialIngest, resumeMaterialIngest } from "./material-ingest";
import { ActionError } from "@/lib/action-error";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { canReadDocument } from "@/lib/approvals/documents";
import type { MaterialUploadReceipt } from "@/lib/documents/upload-contract";

/** An exact receipt is independent of the newest-20 pending list; absence never cancels an in-flight call. */
export async function getMaterialUploadReceipt(input: { matterId: string; requestKey: string }): Promise<MaterialUploadReceipt> {
  const user = (await requireSession("documents.write")).user;
  const data = z.strictObject({ matterId: z.string().cuid(), requestKey: z.uuid() }).parse(input);
  return prisma.$transaction(async db => {
    const identity = await db.user.findUnique({ where: { id: user.id }, select: { active: true, role: true } });
    if (!identity?.active) throw new ActionError("当前账号不可用");
    const actor = await resolveRoleUser(user.id, identity.role, db);
    if (!actor.enabled || !hasCustomPermission(actor, "documents.write")) throw new ActionError("当前无权核对上传记录");
    const matter = await db.matter.findFirst({ where: { id: data.matterId, deletedAt: null,
      ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(user.id)) }, select: { id: true } });
    if (!matter) throw new ActionError("案件不存在或无权核对上传记录");
    const intent = await db.materialIngestIntent.findFirst({ where: { id: data.requestKey, requestedById: user.id, matterId: data.matterId },
      select: { state: true, errorCode: true, createdAt: true, documentId: true } });
    if (!intent) return { status: "NOT_RESERVED" };
    if (intent.state === "COMMITTED" && intent.documentId) {
      const document = await db.document.findUnique({ where: { id: intent.documentId },
        select: { id: true, name: true, version: true, deletedAt: true, matterId: true, intakeId: true, uploadedById: true } });
      return { status: "COMMITTED", document: document && document.matterId === data.matterId && !document.deletedAt && await canReadDocument(user.id, document, db)
        ? { id: document.id, name: document.name, version: document.version } : null };
    }
    if (intent.errorCode === "UPLOAD_ABANDONED") return { status: "CLOSED" };
    const waiting = intent.state === "PENDING" && Date.now() - intent.createdAt.getTime() < 120_000;
    return { status: "INCOMPLETE", waiting, description: waiting ? "原件正在保存，请稍后核对"
      : ["ORIGINAL_UNAVAILABLE", "STORAGE_WRITE_FAILED"].includes(intent.errorCode ?? "")
        ? "原件保存未完成；可继续核对，或关闭本次上传后重新选择文件" : "上传尚未登记为材料，可继续处理" };
  }, { isolationLevel: "RepeatableRead" });
}

export async function listPendingMaterialUploads(matterId: string) {
  const user = (await requireSession("documents.write")).user;
  const id = z.string().min(1).max(512).parse(matterId);
  await assertCanHandleMatter(user, id);
  const rows = await prisma.materialIngestIntent.findMany({
    where: { matterId: id, requestedById: user.id, state: { not: "COMMITTED" },
      OR: [{ errorCode: null }, { errorCode: { not: "UPLOAD_ABANDONED" } }] },
    orderBy: { createdAt: "desc" }, take: 21,
    select: { id: true, metadata: true, state: true, errorCode: true, createdAt: true },
  });
  return { hasMore: rows.length > 20, items: rows.slice(0, 20).map(row => {
    const metadata = z.object({ document: z.object({ name: z.string() }) }).safeParse(row.metadata);
    const waiting = row.state === "PENDING" && Date.now() - row.createdAt.getTime() < 120_000;
    return { id: row.id, name: metadata.success ? metadata.data.document.name : "未完成材料", waiting,
      description: waiting ? "原件正在保存，请稍后查看" : row.errorCode === "ORIGINAL_UNAVAILABLE" || row.errorCode === "STORAGE_WRITE_FAILED"
        ? "原件保存未完成；可再次尝试恢复，或关闭记录后重新选择文件上传" : "原件尚未登记为材料，可继续处理", };
  }) };
}

export async function continueMaterialUpload(intentId: string) {
  const user = (await requireSession("documents.write")).user;
  const id = z.uuid().parse(intentId);
  const result = await resumeMaterialIngest(id, user.id);
  const intent = await prisma.materialIngestIntent.findUniqueOrThrow({ where: { id }, select: { matterId: true } });
  if (intent.matterId) await revalidateMatter(intent.matterId);
  return result;
}

export async function closeMaterialUpload(intentId: string) {
  const user = (await requireSession("documents.write")).user;
  const result = await abandonMaterialIngest(z.uuid().parse(intentId), user.id);
  if (result.matterId) await revalidateMatter(result.matterId);
}
