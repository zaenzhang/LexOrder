"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { approvalContextFor, approvalRecipients, canApproveItem } from "@/lib/approvals/service";
import { hasHandledApproval } from "@/lib/approvals/history-access";
import { selfConfirmEligible } from "@/lib/approvals/self-confirm";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { isPersonalMode } from "@/lib/runtime/mode";
import { assertMatterWritable } from "@/lib/archive/guard";
import { archiveSnapshotDocumentIds } from "@/lib/archive/snapshot";
import { assertCanHandleMatter, assertCanReadMatter, matterAssociationFilter } from "@/lib/permissions";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { canPreview, officePreviewKind } from "@/lib/storage/mime-ext";
import { listEvidenceItems } from "./actions";
import { readableDocumentOptions } from "./source-links";

/** Read one concrete version; permission-filtered evidence keeps its existing source rules. */
export async function getCaseMaterialDetail(input: { matterId: string; documentId: string }) {
  const value = z.object({ matterId: z.string().cuid(), documentId: z.string().cuid() }).parse(input);
  const session = await requireSession("documents.read");
  await assertCanReadMatter(session.user.id, session.user.role, value.matterId, session.user.rolePermissions);
  const document = await prisma.document.findUnique({
    where: { id: value.documentId },
    select: {
      id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
      name: true, version: true, mimeType: true, pageCount: true, createdAt: true,
      updatedAt: true, familyId: true, isLatest: true, status: true, tags: true,
      reviewReportFor: { select: { documentId: true } },
      folderId: true, folder: { select: { name: true } },
      uploadedBy: { select: { name: true } }, approvedById: true, reviewedById: true,
      matter: { select: { status: true } },
    },
  });
  if (!document || document.deletedAt || document.matterId !== value.matterId || !await canReadDocument(session.user.id, document)) {
    throw new ActionError("材料不存在或当前无权读取");
  }
  const canWriteDocuments = hasCustomPermission(session.user, "documents.write");
  const canWriteEvidence = hasCustomPermission(session.user, "matters.write");
  const [items, writableMatter, family, canDecide, frozenRows] = await Promise.all([
    listEvidenceItems(value.matterId),
    canWriteEvidence || canWriteDocuments ? prisma.matter.findFirst({
      where: { id: value.matterId, deletedAt: null, status: { not: "ARCHIVED" },
        ...(session.user.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) },
      select: { id: true, ownerId: true, members: { where: { userId: session.user.id }, select: { role: true } } },
    }) : null,
    prisma.document.findMany({ where: { familyId: document.familyId, matterId: value.matterId, deletedAt: null },
      orderBy: { version: "desc" }, select: { id: true, name: true, version: true, isLatest: true, status: true,
        uploadedById: true, matterId: true, intakeId: true, deletedAt: true } }),
    document.status === "PENDING_REVIEW" ? canApproveItem(session.user.id, "DOCUMENT_APPROVE", document.id) : false,
    document.intakeId ? prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "IntakeRevision"
      WHERE "intakeId"=${document.intakeId} AND snapshot->'documents' @> ${JSON.stringify([{ id: document.id }])}::jsonb` : [],
  ]);
  const versions = (await Promise.all(family.map(async version => await canReadDocument(session.user.id, version)
    ? { id: version.id, name: version.name, version: version.version, isLatest: version.isLatest, status: version.status } : null)))
    .filter((version): version is NonNullable<typeof version> => version !== null);
  const frozen = Number(frozenRows[0]?.count ?? 0) > 0;
  const associated = Boolean(writableMatter && (writableMatter.ownerId === session.user.id || writableMatter.members.length));
  const lead = Boolean(writableMatter && (writableMatter.ownerId === session.user.id || writableMatter.members.some(member => member.role === "LEAD" || member.role === "CO_LEAD")));
  const canManage = canWriteDocuments && Boolean(writableMatter);
  const fixedReviewReport = Boolean(document.reviewReportFor || document.tags.includes("AI审查"));
  const canMoveFolder = canManage && lead;
  const canRequestReview = canManage && associated && !frozen && document.uploadedById === session.user.id && document.status === "DRAFT";
  const canWithdraw = canManage && !frozen && (document.uploadedById === session.user.id || lead);
  const canReadApproval = canDecide || isSystemAdmin(session.user) || document.uploadedById === session.user.id
    || document.approvedById === session.user.id || document.reviewedById === session.user.id
    || await hasHandledApproval(session.user.id, "DOCUMENT_APPROVE", document.id);
  const [folders, pendingArchives, history, context] = await Promise.all([
    canMoveFolder ? prisma.documentFolder.findMany({ where: { matterId: value.matterId }, orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }) : [],
    canWithdraw ? prisma.archiveRecord.findMany({ where: { matterId: value.matterId, status: "PENDING_REVIEW" }, select: { checklistJson: true } }) : [],
    canReadApproval ? prisma.auditLog.findMany({ where: { targetType: "Document", targetId: document.id,
      action: { in: ["DOCUMENT_SUBMIT_REVIEW", "DOCUMENT_SELF_CONFIRM", "DOCUMENT_APPROVE", "DOCUMENT_REJECT", "DOCUMENT_FILE"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, action: true, createdAt: true, detail: true, user: { select: { name: true } } } }) : [],
    canRequestReview ? approvalContextFor("DOCUMENT_APPROVE", document.id) : null,
  ]);
  const inPendingArchive = pendingArchives.some(record => archiveSnapshotDocumentIds(record.checklistJson).includes(document.id));
  const selfConfirm = Boolean(context && !isPersonalMode() && await selfConfirmEligible(context, prisma));
  const hasReviewRoute = Boolean(context && (selfConfirm || (await approvalRecipients(context)).length));
  const previewable = canPreview(document.mimeType, document.name);
  return {
    document: {
      id: document.id, name: document.name, version: document.version, mimeType: document.mimeType,
      pageCount: document.pageCount, createdAt: document.createdAt,
      updatedAt: document.updatedAt, familyId: document.familyId, isLatest: document.isLatest, status: document.status,
      reviewReport: fixedReviewReport ? { sourceDocumentId: document.reviewReportFor?.documentId ?? null } : null,
      folderId: document.folderId, folderName: document.folder?.name ?? null, uploadedByName: document.uploadedBy.name,
      downloadUrl: `/api/documents/${document.id}/download`,
      previewable,
      originalUrl: officePreviewKind(document.mimeType, document.name)
        ? `/api/documents/${document.id}/preview`
        : `/api/documents/${document.id}/download${previewable ? "?inline=1" : ""}`,
    },
    items: items.filter(item => item.sources.some(source => source.documentId === document.id)),
    canCreateEvidence: canWriteEvidence && Boolean(writableMatter),
    versions,
    currentVersionUnavailable: !versions.some(version => version.isLatest),
    folders,
    actions: {
      // Match the existing modify guard: new versions/submission require a case
      // association; filing explicitly permits the principal's wider scope.
      canUploadVersion: canManage && associated && document.isLatest && !frozen && !fixedReviewReport,
      canMoveFolder, canWithdraw: canWithdraw && !inPendingArchive,
      submitMode: canRequestReview && hasReviewRoute ? selfConfirm ? "self" as const : "review" as const : null,
      canDecide, canFile: canManage && document.status === "APPROVED" && !frozen,
      restriction: document.matter?.status === "ARCHIVED" ? "案件已归档。"
        : frozen ? "此版本已固定于收案送审轮次，须保留原件。" : null,
      submitBlockedReason: canRequestReview && !hasReviewRoute ? "尚无可审批人员，请联系管理员配置审批权限。" : null,
      withdrawBlockedReason: canWithdraw && inPendingArchive ? "此版本已列入待审归档申请，暂不能撤回。" : null,
    },
    approval: {
      history: history.map(record => {
        const detail = record.detail && typeof record.detail === "object" && !Array.isArray(record.detail) ? record.detail : {};
        const note = typeof detail.reason === "string" ? detail.reason : typeof detail.note === "string" ? detail.note : null;
        return { id: record.id, action: record.action, at: record.createdAt, userName: record.user?.name ?? "原记录未保留姓名", note };
      }),
    },
  };
}

/** New evidence uses the same current write authority and concrete source options as editing. */
export async function getEvidenceCreateOptions(matterId: string) {
  const id = z.string().cuid().parse(matterId);
  const session = await requireSession("matters.write");
  await assertCanHandleMatter(session.user, id);
  await assertMatterWritable(id, { allowPrincipal: true });
  return readableDocumentOptions(session.user.id, id);
}
