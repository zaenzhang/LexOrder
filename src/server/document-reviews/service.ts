import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { approvalTransaction, canApproveItem } from "@/lib/approvals/service";
import { matterAssociationFilter } from "@/lib/permissions";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { auditTx } from "@/server/audit";
import { checkReviewIssueSchema, createReviewIssueSchema, respondReviewIssueSchema,
  type DocumentReviewView, type ReviewDocumentOption, type ReviewEventView, type ReviewIssueView } from "./contracts";
import type { z } from "zod";

type Db = Prisma.TransactionClient;
const documentSelect = { id: true, name: true, version: true, familyId: true, matterId: true, intakeId: true,
  uploadedById: true, deletedAt: true, status: true, matter: { select: { status: true, deletedAt: true } } } satisfies Prisma.DocumentSelect;
type ReviewDocument = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
const issueInclude = { createdBy: { select: { name: true } }, events: { orderBy: { version: "asc" },
  include: { actor: { select: { name: true } } } } } satisfies Prisma.DocumentReviewIssueInclude;

function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function documentOption(document: ReviewDocument): ReviewDocumentOption { return { id: document.id, name: document.name, version: document.version }; }

async function readableDocument(db: Db, userId: string, documentId: string) {
  const document = await db.document.findUnique({ where: { id: documentId }, select: documentSelect });
  if (!document || document.deletedAt || document.matter?.deletedAt || !await canReadDocument(userId, document, db)) return null;
  return document;
}

async function reviewAccess(db: Db, userId: string, documentId: string, mutation = false) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("当前账号不可用");
  const role = await resolveRoleUser(userId, user.role, db);
  if (!role.enabled) throw new ActionError("当前岗位不可用");
  const document = await readableDocument(db, userId, documentId);
  if (!document) throw new ActionError("该文书不存在或无权读取");
  const writable = document.matter?.status !== "ARCHIVED";
  if (mutation && !writable) throw new ActionError("案件已归档，不能修改复核记录");
  const associated = document.matterId ? Boolean(await db.matter.count({ where: { id: document.matterId, deletedAt: null,
    ...(user.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(userId)) } })) : document.uploadedById === userId;
  const approver = await canApproveItem(userId, "DOCUMENT_APPROVE", document.id, db);
  return { document,
    canCreate: writable && (approver || (associated && hasCustomPermission(role, "matters.write"))),
    canRespond: writable && associated && hasCustomPermission(role, "documents.write"),
    canCheck: writable && approver,
  };
}

/** Read the bound version and current permissions, including separately authorized issue sources. */
export async function readDocumentReview(userId: string, documentId: string): Promise<DocumentReviewView> {
  return prisma.$transaction(async db => {
    const access = await reviewAccess(db, userId, documentId);
    const rows = await db.documentReviewIssue.findMany({ where: { documentId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: issueInclude });
    const documents = new Map<string, Promise<ReviewDocument | null>>();
    function read(id: string) {
      let promise = documents.get(id);
      if (!promise) { promise = readableDocument(db, userId, id); documents.set(id, promise); }
      return promise;
    }
    const issues: ReviewIssueView[] = await Promise.all(rows.map(async issue => {
      const basis = issue.basisDocumentId ? await read(issue.basisDocumentId) : null;
      const basisUnavailable = Boolean(issue.basisDocumentId && !basis);
      let precedingRevisionId: string | null = null;
      const eventSources = issue.events.map(event => {
        if (event.kind === "RESPONSE") precedingRevisionId = event.revisionDocumentId;
        return { event, revisionId: precedingRevisionId };
      });
      const events: ReviewEventView[] = await Promise.all(eventSources.map(async ({ event, revisionId }) => {
        const revision = revisionId ? await read(revisionId) : null;
        const revisionUnavailable = Boolean(revisionId && !revision);
        return { id: event.id, version: event.version, kind: event.kind, disposition: event.disposition,
          note: basisUnavailable || revisionUnavailable ? null : event.note,
          revisionDocument: event.kind === "RESPONSE" && revision ? documentOption(revision) : null, revisionUnavailable,
          revisionLocation: event.kind === "RESPONSE" && revision ? event.revisionLocation : null, resolved: event.resolved,
          actorName: event.actor.name, createdAt: event.createdAt.toISOString() };
      }));
      return { id: issue.id, version: issue.version, state: issue.state, title: issue.title, location: issue.location,
        basis: basisUnavailable ? null : issue.basis, basisDocument: basis ? documentOption(basis) : null, basisUnavailable,
        authorName: issue.createdBy.name, createdAt: issue.createdAt.toISOString(), events,
        canResolve: access.canCheck && !basisUnavailable && !events.at(-1)?.revisionUnavailable };
    }));
    // Only matter handlers get a source picker. An approval grant never enumerates the rest of the file.
    const sourceRows = access.canRespond && access.document.matterId ? await db.document.findMany({
      where: { matterId: access.document.matterId, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, select: documentSelect,
    }) : [];
    const sourceOptions: ReviewDocumentOption[] = [];
    for (const row of sourceRows.slice(0, 100)) { const permitted = await read(row.id); if (permitted) sourceOptions.push(documentOption(permitted)); }
    const revisionRows = access.canRespond && access.document.familyId ? await db.document.findMany({ where: { deletedAt: null, matterId: access.document.matterId,
      version: { gt: access.document.version }, familyId: access.document.familyId },
      orderBy: { version: "desc" }, select: documentSelect }) : [];
    const revisionOptions: ReviewDocumentOption[] = [];
    for (const row of revisionRows) { const permitted = await read(row.id); if (permitted) revisionOptions.push(documentOption(permitted)); }
    return { document: documentOption(access.document), canCreate: access.canCreate, canRespond: access.canRespond, canCheck: access.canCheck,
      issues, sourceOptions, revisionOptions, sourcesTruncated: sourceRows.length > 100 };
  }, { timeout: 20000 });
}

export async function createDocumentReviewIssue(userId: string, input: z.input<typeof createReviewIssueSchema>) {
  const data = createReviewIssueSchema.parse(input);
  const requestHash = fingerprint(data);
  return approvalTransaction(async db => {
    const access = await reviewAccess(db, userId, data.documentId, true);
    if (!access.canCreate) throw new ActionError("仅本案办理人员或此文书合格审批人可提出复核问题");
    if (data.basisDocumentId) {
      const basis = await readableDocument(db, userId, data.basisDocumentId);
      if (!basis || basis.matterId !== access.document.matterId || (!basis.matterId && basis.id !== access.document.id)) throw new ActionError("依据材料不可读取或不属于当前案件");
    }
    const previous = await db.documentReviewIssue.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.createdById !== userId || previous.requestHash !== requestHash) throw new ActionError("保存标识已用于其他问题，请重新填写");
      return { id: previous.id, documentId: previous.documentId, version: previous.version };
    }
    const issue = await db.documentReviewIssue.create({ data: { ...data, createdById: userId, requestHash } });
    await auditTx(db, { userId, action: "DOCUMENT_REVIEW_ISSUE_CREATE", targetType: "DocumentReviewIssue", targetId: issue.id,
      detail: { documentId: data.documentId, basisDocumentId: data.basisDocumentId } });
    return { id: issue.id, documentId: data.documentId, version: issue.version };
  });
}

async function lockedIssue(db: Db, userId: string, issueId: string) {
  await db.$queryRaw`SELECT id FROM "DocumentReviewIssue" WHERE id = ${issueId} FOR UPDATE`;
  const issue = await db.documentReviewIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new ActionError("复核问题不存在");
  const access = await reviewAccess(db, userId, issue.documentId, true);
  return { issue, access };
}

export async function respondDocumentReviewIssue(userId: string, input: z.input<typeof respondReviewIssueSchema>) {
  const data = respondReviewIssueSchema.parse(input);
  const requestHash = fingerprint(data);
  return approvalTransaction(async db => {
    const { issue, access } = await lockedIssue(db, userId, data.issueId);
    if (!access.canRespond) throw new ActionError("仅有文书维护资格的本案办理人员可回应和关联修订");
    if (issue.basisDocumentId && !await readableDocument(db, userId, issue.basisDocumentId)) throw new ActionError("问题依据已不可读取，不能回应此问题");
    if (data.revisionDocumentId) {
      if (!access.document.familyId) throw new ActionError("此文书缺少明确的版本关系，不能关联修订；可仅保存处理说明");
      const revision = await readableDocument(db, userId, data.revisionDocumentId);
      if (!revision || revision.matterId !== access.document.matterId || revision.familyId !== access.document.familyId || revision.version <= access.document.version) {
        throw new ActionError("请选择此文书实际产生的后续修订版本");
      }
    }
    const previous = await db.documentReviewEvent.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash || previous.kind !== "RESPONSE") throw new ActionError("保存标识已用于其他处理，请重新填写");
      return { id: issue.id, documentId: issue.documentId, version: previous.version };
    }
    if (issue.version !== data.expectedVersion) throw new ActionError("此问题已有新处理，请刷新后核对，当前输入尚未保存");
    if (issue.state === "RESOLVED") throw new ActionError("此问题已处理；新问题请另行提出，保留原复核结论");
    const version = issue.version + 1;
    await db.documentReviewEvent.create({ data: { issueId: issue.id, kind: "RESPONSE", disposition: data.disposition, note: data.note,
      revisionDocumentId: data.revisionDocumentId, revisionLocation: data.revisionLocation, actorId: userId, version, requestId: data.requestId, requestHash } });
    await db.documentReviewIssue.update({ where: { id: issue.id, version: data.expectedVersion }, data: { state: "WAITING_CHECK", version } });
    await auditTx(db, { userId, action: "DOCUMENT_REVIEW_RESPOND", targetType: "DocumentReviewIssue", targetId: issue.id,
      detail: { documentId: issue.documentId, version, disposition: data.disposition, revisionDocumentId: data.revisionDocumentId } });
    return { id: issue.id, documentId: issue.documentId, version };
  });
}

export async function checkDocumentReviewIssue(userId: string, input: z.input<typeof checkReviewIssueSchema>) {
  const data = checkReviewIssueSchema.parse(input);
  const requestHash = fingerprint(data);
  return approvalTransaction(async db => {
    const { issue, access } = await lockedIssue(db, userId, data.issueId);
    if (!access.canCheck) throw new ActionError("仅此文书当前合格审批人可核对问题处理结果");
    const previous = await db.documentReviewEvent.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash || previous.kind !== "CHECK") throw new ActionError("保存标识已用于其他复核，请重新填写");
      return { id: issue.id, documentId: issue.documentId, version: previous.version };
    }
    if (issue.version !== data.expectedVersion || issue.state !== "WAITING_CHECK") throw new ActionError("此问题状态已变化，请重新打开最新处理记录");
    const response = await db.documentReviewEvent.findFirst({ where: { issueId: issue.id, kind: "RESPONSE" }, orderBy: { version: "desc" } });
    if (!response) throw new ActionError("尚无作者回应，不能标记处理完成");
    if (data.resolved) {
      if (issue.basisDocumentId && !await readableDocument(db, userId, issue.basisDocumentId)) throw new ActionError("问题依据不可读取，不能标记已完成原文复核；可保留未解决");
      if (response.revisionDocumentId && !await readableDocument(db, userId, response.revisionDocumentId)) throw new ActionError("修订文书不可读取，请先完成原文书的送审授权，或保留未解决");
    }
    const version = issue.version + 1;
    await db.documentReviewEvent.create({ data: { issueId: issue.id, kind: "CHECK", resolved: data.resolved, note: data.note,
      actorId: userId, version, requestId: data.requestId, requestHash } });
    await db.documentReviewIssue.update({ where: { id: issue.id, version: data.expectedVersion }, data: { state: data.resolved ? "RESOLVED" : "OPEN", version } });
    await auditTx(db, { userId, action: "DOCUMENT_REVIEW_CHECK", targetType: "DocumentReviewIssue", targetId: issue.id,
      detail: { documentId: issue.documentId, version, resolved: data.resolved } });
    return { id: issue.id, documentId: issue.documentId, version };
  });
}
