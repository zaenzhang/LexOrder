import type { Prisma } from "@prisma/client";
import { documentDerivationReadable } from "@/server/documents/derivation-access";
import { resolveRoleUser } from "@/lib/roles/service";
import {financeLedgerReady} from "@/server/finance/ledger-storage";
import { hasCustomPermission,scopeFor } from "@/lib/roles/catalog";
import { isManager } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canApproveItem, canExecuteInvoice } from "./service";
import { hasHandledApproval } from "./history-access";
export type DocumentReadSubject = { id: string; uploadedById: string; matterId: string | null; intakeId: string | null; deletedAt?: Date | null };
export type DocumentReadGrant = "BUSINESS" | "DOCUMENT_APPROVAL";
export type DocumentReadPurpose = "READ" | "EXPORT" | "SUBMIT";

/** The original object grant is chosen before checking derived inputs. */
export async function documentReadGrant(userId: string, doc: DocumentReadSubject, db: Prisma.TransactionClient = prisma, purpose: DocumentReadPurpose = "READ"): Promise<DocumentReadGrant | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user?.active || doc.deletedAt) return null;
  const access = await resolveRoleUser(userId, user.role, db);
  if (!access.enabled) return null;
  // Select the actual submitted-document grant up front; it only grants reading.
  // A person may hold both this grant and a separate matter role.
  if (purpose === "READ") {
    const review = await db.document.findUnique({ where: { id: doc.id }, select: { status: true, approvedById: true, reviewedById: true } });
    if (doc.uploadedById === userId && review && (review.status !== "DRAFT" || await db.auditLog.findFirst({ where: { userId, action: "DOCUMENT_SUBMIT_REVIEW", targetType: "Document", targetId: doc.id }, select: { id: true } }))) return "DOCUMENT_APPROVAL";
    if (review?.status === "PENDING_REVIEW" && await canApproveItem(userId, "DOCUMENT_APPROVE", doc.id, db)) return "DOCUMENT_APPROVAL";
    if (review?.approvedById === userId || review?.reviewedById === userId || await hasHandledApproval(userId, "DOCUMENT_APPROVE", doc.id, undefined, db)) return "DOCUMENT_APPROVAL";
  }
  if(scopeFor(access,'finance.correct')==='ALL'&&await financeLedgerReady(db)){
    const [basis]=await db.$queryRaw<{n:bigint}[]>`SELECT COUNT(*) AS n FROM "BillingAttachment" a JOIN "Billing" b ON b.id=a."billingId" WHERE a."documentId"=${doc.id} AND b.status IN ('DRAFT','ACTIVE')`;
    if(Number(basis.n))return "BUSINESS";
    const [adjustment]=await db.$queryRaw<{n:bigint}[]>`SELECT COUNT(*) AS n FROM "InvoiceAdjustment" WHERE "documentId"=${doc.id}`;
    if(Number(adjustment.n))return "BUSINESS";
  }
  const canReadBusiness = hasCustomPermission(access, "documents.download") && hasCustomPermission(access, "matters.read");
  // 仅合伙人岗位直通全所材料；managerAuthorized 按契约只开放「可见」，附件下载不随管理权放大（AGENTS 业务管理权决议）
  if (isManager(access.role)) return "BUSINESS";
  const seal = await db.sealRequest.findFirst({ where: { OR: [{ draftDocId: doc.id }, { stampedDocId: doc.id }] }, select: { id: true, requestedById: true, approvedById: true, stampedById: true, status: true } });
  if (seal) {
    const allowed = seal.requestedById === userId || seal.approvedById === userId || seal.stampedById === userId
      || (seal.status === "PENDING" && await canApproveItem(userId, "SEAL_APPROVE", seal.id, db))
      || (seal.status === "APPROVED" && await canApproveItem(userId, "SEAL_STAMP", seal.id, db))
      || await hasHandledApproval(userId, "SEAL_APPROVE", seal.id, doc.id, db);
    return allowed ? "BUSINESS" : null;
  }
  // 上传者通道只覆盖无归属材料：挂在案件/收案上的材料须经 :29 起的归属分支——
  // 否则被移出案件的成员凭历史上传关系仍可长期下载该案材料（内置角色同样适用）
  if (canReadBusiness && doc.uploadedById === userId && !doc.matterId && !doc.intakeId) return "BUSINESS";
  if (canReadBusiness && doc.matterId && await db.matter.count({ where: { id: doc.matterId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] } })) return "BUSINESS";
  if (doc.intakeId) {
    const intake = await db.intake.findUnique({ where: { id: doc.intakeId }, select: { createdById: true, ownerUserId: true, coUserIds: true, status: true } });
    if (intake?.createdById === userId) return "BUSINESS";
    if (canReadBusiness && intake && (intake.createdById === userId || intake.ownerUserId === userId || intake.coUserIds.includes(userId))) return "BUSINESS";
    if (intake?.status === "PENDING_CONFIRMATION" && await canApproveItem(userId, "INTAKE_APPROVE", doc.intakeId, db)) return "BUSINESS";
    if (await hasHandledApproval(userId, "INTAKE_APPROVE", doc.intakeId, doc.id, db)) return "BUSINESS";
  }
  const invoices = await db.invoiceRequest.findMany({ where: { OR: [{ evidenceDocIds: { has: doc.id } }, { contractScanId: doc.id }, { invoiceFileId: doc.id }] }, select: { id: true, requestedById: true, processedById: true, status: true } });
  for (const invoice of invoices) if (invoice.requestedById === userId || invoice.processedById === userId || ((invoice.status === "PENDING" && await canApproveItem(userId, "INVOICE_APPROVE", invoice.id, db)) || (invoice.status === "APPROVED" && await canExecuteInvoice(userId, invoice.id, db))) || await hasHandledApproval(userId, "INVOICE_APPROVE", invoice.id, doc.id, db)) return "BUSINESS";
  const archives = await db.archiveRecord.findMany({
    where: {
      OR: [
        { coverDocId: doc.id },
        { catalogDocId: doc.id },
        { checklistJson: { path: ["documentIds"], array_contains: [doc.id] } }
      ]
    },
    select: { id: true, status: true, archivedById: true, reviewedById: true }
  });
  for (const archive of archives) if (archive.archivedById === userId || archive.reviewedById === userId || (archive.status === "PENDING_REVIEW" && await canApproveItem(userId, "ARCHIVE_APPROVE", archive.id, db)) || await hasHandledApproval(userId, "ARCHIVE_APPROVE", archive.id, doc.id, db)) return "BUSINESS";
  return null;
}

export async function canReadDocument(userId: string, doc: DocumentReadSubject, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const grant = await documentReadGrant(userId, doc, db);
  return grant !== null && await documentDerivationReadable(userId, doc, grant, db);
}
