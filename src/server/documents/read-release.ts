import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { approvalTransaction } from "@/lib/approvals/service";
import { auditTx } from "@/server/audit";

type ReadEvent = { action: "DOCUMENT_DOWNLOAD"; watermarked: boolean }
  | { action: "DOCUMENT_PREVIEW"; kind: "docx" | "xlsx" };
type ReadRelease = { ok: true } | { ok: false; status: 401 | 403; error: string };

/**
 * Files and Office conversions are prepared outside the authorization lock.
 * Before releasing their bytes, serialize with revocation and strictly audit the
 * current grant. The transaction commit is the read's authorization boundary.
 */
export async function releaseDocumentRead(userId: string, documentId: string, event: ReadEvent): Promise<ReadRelease> {
  // Take the version BEFORE re-validating the actual request session. Reversing
  // these reads could accept an old token alongside a newly revoked version.
  // Both reads stay outside the transaction so a one-connection pool can proceed.
  const baseline = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  const session = await getSession();
  if (!baseline || !session?.user || session.user.id !== userId) {
    return { ok: false, status: 401, error: "登录状态已变化，请重新登录后打开材料" };
  }
  return approvalTransaction<ReadRelease>(async db => {
    // A revocation during session validation or lock acquisition changes this
    // version; re-read it on the transaction connection before releasing bytes.
    const identity = await db.user.findUnique({ where: { id: userId }, select: { active: true, sessionVersion: true } });
    if (!identity?.active || identity.sessionVersion !== baseline.sessionVersion) {
      return { ok: false, status: 401, error: "登录状态已变化，请重新登录后打开材料" };
    }
    const current = await db.document.findUnique({ where: { id: documentId }, select: {
      id: true, name: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
    } });
    // Preserve the concrete approval-attachment grant; it never implies whole-case rights.
    if (!current || current.deletedAt || !await canReadDocument(session.user.id, current, db)) {
      return { ok: false, status: 403, error: "材料或来源已撤回，或当前已无读取权限，请重新打开" };
    }
    const { action, ...detail } = event;
    await auditTx(db, { userId: session.user.id, action, targetType: "Document", targetId: current.id,
      detail: { matterId: current.matterId, intakeId: current.intakeId, name: current.name, ...detail } });
    return { ok: true };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}
