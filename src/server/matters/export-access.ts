import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { matterAssociationFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import type { WorkspaceActor } from "@/lib/runtime/actor";

export class MatterExportAccessError extends ActionError {}
const COMPLETE_PACKAGE_PERMISSIONS = ["matters.export", "matters.read", "documents.download", "finance.read"] as const;

/** Complete packages contain private materials and financial data, beyond overview access. */
export async function assertMatterExportAccess(actor: WorkspaceActor, matterId: string, kind: "LIVE" | "ARCHIVE" = "LIVE"): Promise<void> {
  if (actor.runtimeMode === "SERVER") {
    const identity = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
    if (!identity?.active) throw new MatterExportAccessError("当前账号不可用");
    const role = await resolveRoleUser(actor.id, identity.role);
    if (!role.enabled) throw new MatterExportAccessError("当前岗位不可用");
    actor = { ...actor, ...role };
  }
  if (!COMPLETE_PACKAGE_PERMISSIONS.every(key => hasCustomPermission(actor, key))) {
    throw new MatterExportAccessError("导出完整案卷需要案件导出、案件查看、材料下载和财务查看权限");
  }
  if (kind === "ARCHIVE" && !hasCustomPermission(actor, "archive.read")) throw new MatterExportAccessError("导出归档材料需要当前归档查看权限");

  // Only the Server partner role retains its existing firm-wide export authority.
  // Team visibility, borrowing and managerAuthorized never replace an actual matter association.
  const firmWide = actor.runtimeMode === "SERVER" && actor.role === "PRINCIPAL_LAWYER";
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...(kind === "ARCHIVE" ? { status: "ARCHIVED" } : {}), ...(firmWide ? {} : matterAssociationFilter(actor.id)) },
    select: { id: true }
  });
  if (!matter) throw new MatterExportAccessError("案件不存在或无权导出完整案卷");
}

export const exportDocumentAccessSelect = {
  id: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true
} as const satisfies Prisma.DocumentSelect;

type ExportDocument = Prisma.DocumentGetPayload<{ select: typeof exportDocumentAccessSelect }>;

/** A complete package fails as a whole if any included material is no longer readable. */
export async function assertExportDocumentAccess(userId: string, documents: ExportDocument[]): Promise<void> {
  for (const document of documents) {
    try { await assertDocumentDerivationAccess(userId, document.id, { purpose: "EXPORT" }); }
    catch (error) {
      if (!(error instanceof ActionError)) throw error;
      throw new MatterExportAccessError("部分材料已不可读取，无法导出完整案卷，请刷新后重试");
    }
  }
}
