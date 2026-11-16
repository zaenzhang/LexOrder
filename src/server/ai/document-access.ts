/**
 * AI 入口的文档归属断言。
 *
 * AI 审查会把库内文档解密后全文发送外部服务，是比下载更敏感的出口，
 * 资格必须与材料归属一致（2026-09-20 A 批 P1-2 收敛）：
 *   - 合伙人岗位（PRINCIPAL_LAWYER）直通全所材料；
 *   - 案件材料：主办或案件成员；
 *   - 收案材料：创建人 / 主办 / 协办（与上传路径同口径）；
 *   - 无归属材料：仅上传者本人；
 *   - 业务管理权（managerAuthorized）与审批临时阅读资格（用章/开票/文书审批的
 *     当次附件访问）都不取得全文外发资格——管理权只放大「可见」，审批权只覆盖
 *     当次申请附件的下载，不覆盖 AI 全文外发。
 * 每次外发与结果发布均复核当前 documents.write、原材料读取资格和对象归属。
 *
 * 注意：本模块不标 "use server"——断言 helper 一旦进入 action 模块导出就成了可伪造参数的 RPC 端点。
 */
import type { Prisma } from "@prisma/client";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { canReadDocument } from "@/lib/approvals/documents";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";
import { resolveRoleUser } from "@/lib/roles/service";
import { ActionError } from "@/lib/action-error";

type AppSession = Awaited<ReturnType<typeof requireSession>>;

export async function canReviewDocument(
  userId: string,
  doc: { id: string; uploadedById: string | null; matterId: string | null; intakeId: string | null },
  db: Prisma.TransactionClient = prisma
): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user?.active) return false;
  const access = await resolveRoleUser(userId, user.role, db);
  if (!access.enabled || !hasCustomPermission(access, "documents.write")) return false;
  if (!doc.uploadedById || !await canReadDocument(userId, { ...doc, uploadedById: doc.uploadedById }, db)) return false;
  if (isManager(access.role)) return true;
  if (doc.matterId && await db.matter.count({
    where: { id: doc.matterId, deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] }
  })) return true;
  if (doc.intakeId) {
    const intake = await db.intake.findUnique({
      where: { id: doc.intakeId },
      select: { createdById: true, ownerUserId: true, coUserIds: true }
    });
    if (intake && (intake.createdById === userId || intake.ownerUserId === userId || intake.coUserIds.includes(userId))) return true;
  }
  if (doc.uploadedById === userId && !doc.matterId && !doc.intakeId) return true;
  return false;
}

export async function assertCanReviewDocument(
  session: AppSession,
  docRef: { id: string; matterId?: string | null; intakeId?: string | null; sha256?: string | null },
  db: Prisma.TransactionClient = prisma
): Promise<void> {
  const doc = await db.document.findUnique({
    where: { id: docRef.id },
    select: { id: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true, sha256: true }
  });
  if (!doc || doc.deletedAt) throw new ActionError("材料不存在");
  if (doc.matterId !== (docRef.matterId ?? null) || doc.intakeId !== (docRef.intakeId ?? null)) {
    throw new ActionError("材料归属已变化，请刷新后重试");
  }
  if (docRef.sha256 !== undefined && doc.sha256 !== docRef.sha256) throw new ActionError("原材料版本已变化，不能继续审查或发布结果");
  if (!(await canReviewDocument(session.user.id, doc, db))) throw new ActionError("无权审查该材料");
}
