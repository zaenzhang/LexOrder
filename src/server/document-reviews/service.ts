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
import { readMaterialSources } from "@/server/documents/material-processing";
import { assertSavedReviewPosition, prepareReviewPosition, readReviewPosition, reviewPositionView } from "./positions";
import { checkReviewIssueSchema, createReviewIssueSchema, respondReviewIssueSchema, reviewSourcePageSchema,
  reviewPositionOptionsSchema, reviewPositionPreviewSchema, savedReviewPositionSchema, previousReviewIssueSchema,
  type DocumentReviewView, type ReviewDocumentOption, type ReviewEventView, type ReviewIssueView, type ReviewSourcePage,
  type PreviousReviewIssueSummary, type PreviousReviewIssueView } from "./contracts";
import { decodeReviewSourceCursor, encodeReviewSourceCursor } from "./source-cursor";
import type { z } from "zod";

type Db = Prisma.TransactionClient;
const documentSelect = { id: true, createdAt: true, name: true, version: true, familyId: true, matterId: true, intakeId: true,
  sha256: true, mimeType: true, pageCount: true,
  uploadedById: true, deletedAt: true, status: true, matter: { select: { status: true, deletedAt: true } } } satisfies Prisma.DocumentSelect;
type ReviewDocument = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
const issueInclude = { createdBy: { select: { name: true } }, events: { orderBy: { version: "asc" },
  include: { actor: { select: { name: true } } } } } satisfies Prisma.DocumentReviewIssueInclude;

function fingerprint(value: Record<string, unknown>) {
  // An optional position does not reinterpret the request identity of old text-only records.
  const normalized = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    !(["position", "basisPosition", "revisionPosition"].includes(key) && item == null)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function documentOption(document: ReviewDocument): ReviewDocumentOption {
  return { id: document.id, name: document.name, version: document.version, pageCount: document.pageCount,
    isPdf: document.mimeType?.toLowerCase() === "application/pdf", hasIdentity: Boolean(document.sha256 && /^[a-f0-9]{64}$/.test(document.sha256)) };
}

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

async function sourcePageInTransaction(db: Db, userId: string, access: Awaited<ReturnType<typeof reviewAccess>>,
  data: z.infer<typeof reviewSourcePageSchema>): Promise<ReviewSourcePage> {
  if (!access.canRespond || !access.document.matterId) throw new ActionError("当前资格不能查找本案依据材料");
  const point = decodeReviewSourceCursor(data.cursor, userId, data.documentId, data.query);
  const rows = await db.document.findMany({
    where: { matterId: access.document.matterId, deletedAt: null,
      ...(data.query ? { name: { contains: data.query, mode: "insensitive" } } : {}),
      ...(point ? { OR: [{ createdAt: { lt: new Date(point.at) } }, { createdAt: new Date(point.at), id: { lt: point.id } }] } : {}),
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, select: documentSelect,
  });
  const items: ReviewDocumentOption[] = [];
  let scanned = 0;
  for (const row of rows.slice(0, 100)) {
    if (items.length >= 20) break;
    scanned++;
    if (!row.matter?.deletedAt && await canReadDocument(userId, row, db)) items.push(documentOption(row));
  }
  const selected = data.selectedId ? await readableDocument(db, userId, data.selectedId) : null;
  const last = rows[scanned - 1];
  return { items, nextCursor: last && scanned < rows.length
    ? encodeReviewSourceCursor(userId, data.documentId, data.query, { at: last.createdAt.toISOString(), id: last.id }) : null,
    selected: data.selectedId ? { id: data.selectedId, document: selected?.matterId === access.document.matterId ? documentOption(selected) : null } : null };
}

export async function readDocumentReviewSourcePage(userId: string, input: z.input<typeof reviewSourcePageSchema>): Promise<ReviewSourcePage> {
  const data = reviewSourcePageSchema.parse(input);
  return prisma.$transaction(async db => sourcePageInTransaction(db, userId, await reviewAccess(db, userId, data.documentId), data), { timeout: 20000, isolationLevel: "RepeatableRead" });
}

type ReviewIssueRow = Prisma.DocumentReviewIssueGetPayload<{ include: typeof issueInclude }>;
async function presentIssues(db: Db, userId: string, rows: ReviewIssueRow[], canCheck: boolean): Promise<ReviewIssueView[]> {
    const documents = new Map<string, Promise<ReviewDocument | null>>();
    function read(id: string) {
      let promise = documents.get(id);
      if (!promise) { promise = readableDocument(db, userId, id); documents.set(id, promise); }
      return promise;
    }
    return Promise.all(rows.map(async issue => {
      const subject = await read(issue.documentId);
      const basis = issue.basisDocumentId ? await read(issue.basisDocumentId) : null;
      const basisPosition = reviewPositionView(issue.basisPosition, basis);
      const basisUnavailable = Boolean(issue.basisDocumentId && !basis);
      let precedingResponse: ReviewIssueRow["events"][number] | null = null;
      const eventSources = issue.events.map(event => {
        if (event.kind === "RESPONSE") precedingResponse = event;
        return { event, response: precedingResponse };
      });
      const events: ReviewEventView[] = await Promise.all(eventSources.map(async ({ event, response }) => {
        const revisionId = response?.revisionDocumentId;
        const revision = revisionId ? await read(revisionId) : null;
        const revisionPosition = reviewPositionView(response?.revisionPosition ?? null, revision);
        const revisionUnavailable = Boolean(revisionId && !revision);
        return { id: event.id, version: event.version, kind: event.kind, disposition: event.disposition,
          note: basisUnavailable || revisionUnavailable ? null : event.note,
          revisionDocument: event.kind === "RESPONSE" && revision && !revisionUnavailable ? documentOption(revision) : null, revisionUnavailable,
          revisionLocation: event.kind === "RESPONSE" && !revisionUnavailable ? event.revisionLocation : null,
          revisionPosition: event.kind === "RESPONSE" ? revisionPosition : null, resolved: event.resolved,
          actorName: event.actor.name, createdAt: event.createdAt.toISOString() };
      }));
      return { id: issue.id, version: issue.version, state: issue.state, title: issue.title, location: issue.location,
        position: reviewPositionView(issue.position, subject), basisPosition,
        basis: basisUnavailable ? null : issue.basis, basisDocument: basis && !basisUnavailable ? documentOption(basis) : null, basisUnavailable,
        authorName: issue.createdBy.name, createdAt: issue.createdAt.toISOString(), events,
        canResolve: canCheck && !basisUnavailable && !events.at(-1)?.revisionUnavailable };
    }));
}

async function previousIssueSummaries(db: Db, userId: string, current: ReviewDocument): Promise<PreviousReviewIssueSummary[]> {
  if (!current.matterId || !current.familyId) return [];
  const versions = await db.document.findMany({ where: { matterId: current.matterId, familyId: current.familyId,
    version: { lt: current.version }, deletedAt: null }, select: documentSelect });
  const readable = new Map<string, ReviewDocument>();
  for (const version of versions) if (!version.matter?.deletedAt && await canReadDocument(userId, version, db)) readable.set(version.id, version);
  if (!readable.size) return [];
  const issues = await db.documentReviewIssue.findMany({ where: { documentId: { in: [...readable.keys()] }, state: { in: ["OPEN", "WAITING_CHECK"] } },
    orderBy: [{ document: { version: "desc" } }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, documentId: true, title: true, state: true,
      events: { where: { kind: "RESPONSE" }, orderBy: { version: "desc" }, take: 1, select: { revisionDocumentId: true } } } });
  return issues.map(issue => ({ id: issue.id, document: documentOption(readable.get(issue.documentId)!), title: issue.title,
    state: issue.state as "OPEN" | "WAITING_CHECK", linkedToCurrent: issue.events[0]?.revisionDocumentId === current.id }));
}

/** Read the bound version and current permissions, including separately authorized issue sources. */
export async function readDocumentReview(userId: string, documentId: string): Promise<DocumentReviewView> {
  return prisma.$transaction(async db => {
    const access = await reviewAccess(db, userId, documentId);
    const rows = await db.documentReviewIssue.findMany({ where: { documentId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: issueInclude });
    const issues = await presentIssues(db, userId, rows, access.canCheck);
    // Only matter handlers get a source picker. An approval grant never enumerates the rest of the file.
    const sourcePage = access.canRespond && access.document.matterId
      ? await sourcePageInTransaction(db, userId, access, { documentId, query: "" }) : { items: [], nextCursor: null };
    const revisionRows = access.canRespond && access.document.familyId ? await db.document.findMany({ where: { deletedAt: null, matterId: access.document.matterId,
      version: { gt: access.document.version }, familyId: access.document.familyId },
      orderBy: { version: "desc" }, select: documentSelect }) : [];
    const revisionOptions: ReviewDocumentOption[] = [];
    for (const row of revisionRows) if (!row.matter?.deletedAt && await canReadDocument(userId, row, db)) revisionOptions.push(documentOption(row));
    return { document: documentOption(access.document), matterId: access.document.matterId,
      canCreate: access.canCreate, canRespond: access.canRespond, canCheck: access.canCheck,
      canBrowseSources: access.canRespond && Boolean(access.document.matterId),
      issues, sourceOptions: sourcePage.items, revisionOptions, sourceNextCursor: sourcePage.nextCursor,
      previousIssues: await previousIssueSummaries(db, userId, access.document) };
  }, { timeout: 20000 });
}

export async function readPreviousReviewIssue(userId: string, input: z.input<typeof previousReviewIssueSchema>): Promise<PreviousReviewIssueView> {
  const data = previousReviewIssueSchema.parse(input);
  return prisma.$transaction(async db => {
    const { document: current } = await reviewAccess(db, userId, data.documentId);
    const issue = await db.documentReviewIssue.findUnique({ where: { id: data.issueId }, include: issueInclude });
    const previous = issue ? await readableDocument(db, userId, issue.documentId) : null;
    if (!issue || !previous || !current.matterId || !current.familyId || previous.matterId !== current.matterId ||
      previous.familyId !== current.familyId || previous.version >= current.version || issue.state === "RESOLVED") {
      throw new ActionError("此前版本意见已变化或当前不可读取，请重新核对本版记录");
    }
    return { document: documentOption(previous), issue: (await presentIssues(db, userId, [issue], false))[0] };
  }, { timeout: 20000 });
}

async function draftPositionTarget(db: Db, userId: string, data: z.infer<typeof reviewPositionOptionsSchema>) {
  const access = await reviewAccess(db, userId, data.documentId);
  if (data.slot === "SUBJECT") {
    if (!access.canCreate || (data.sourceDocumentId && data.sourceDocumentId !== access.document.id)) throw new ActionError("当前资格不能选择此文书的问题位置");
    return access.document;
  }
  const source = data.sourceDocumentId ? await readableDocument(db, userId, data.sourceDocumentId) : null;
  if (!source || !access.document.matterId || source.matterId !== access.document.matterId) throw new ActionError("位置材料不存在、无权读取或不属于当前案件");
  if (data.slot === "BASIS") {
    if (!access.canCreate) throw new ActionError("当前资格不能选择依据位置");
  } else if (!access.canRespond || !access.document.familyId || source.familyId !== access.document.familyId || source.version <= access.document.version) {
    throw new ActionError("请选择此文书实际产生的后续修订版本");
  }
  return source;
}

export async function readReviewPositionOptions(userId: string, input: z.input<typeof reviewPositionOptionsSchema>) {
  const data = reviewPositionOptionsSchema.parse(input);
  return prisma.$transaction(async db => {
    const target = await draftPositionTarget(db, userId, data);
    if (!target.matterId) throw new ActionError("此文书尚未关联案件，请保留人工文字位置与原件");
    return readMaterialSources(userId, { matterId: target.matterId, documentIds: [target.id], offset: data.offset, limit: 20 }, db);
  }, { timeout: 20000 });
}

export async function previewReviewPosition(userId: string, input: z.input<typeof reviewPositionPreviewSchema>) {
  const data = reviewPositionPreviewSchema.parse(input);
  return prisma.$transaction(async db => {
    const target = await draftPositionTarget(db, userId, data);
    const position = await prepareReviewPosition(db, userId, target, data.position);
    return readReviewPosition(db, userId, target.matterId, target.id, position);
  }, { timeout: 20000 });
}

export async function readSavedReviewPosition(userId: string, input: z.input<typeof savedReviewPositionSchema>) {
  const data = savedReviewPositionSchema.parse(input);
  return prisma.$transaction(async db => {
    const issue = await db.documentReviewIssue.findUnique({ where: { id: data.issueId } });
    if (!issue) throw new ActionError("复核问题不存在或当前不可读取");
    const { document } = await reviewAccess(db, userId, issue.documentId);
    if (data.slot === "SUBJECT") return readReviewPosition(db, userId, document.matterId, issue.documentId, issue.position);
    if (data.slot === "BASIS") return issue.basisDocumentId
      ? readReviewPosition(db, userId, document.matterId, issue.basisDocumentId, issue.basisPosition) : { status: "UNAVAILABLE" as const };
    const event = await db.documentReviewEvent.findFirst({ where: { id: data.eventId, issueId: issue.id, kind: "RESPONSE" } });
    return event?.revisionDocumentId ? readReviewPosition(db, userId, document.matterId, event.revisionDocumentId, event.revisionPosition)
      : { status: "UNAVAILABLE" as const };
  }, { timeout: 20000 });
}

export async function createDocumentReviewIssue(userId: string, input: z.input<typeof createReviewIssueSchema>) {
  const data = createReviewIssueSchema.parse(input);
  const requestHash = fingerprint(data);
  return approvalTransaction(async db => {
    const access = await reviewAccess(db, userId, data.documentId, true);
    if (!access.canCreate) throw new ActionError("仅本案办理人员或此文书合格审批人可提出复核问题");
    const basis = data.basisDocumentId ? await readableDocument(db, userId, data.basisDocumentId) : null;
    if (data.basisDocumentId) {
      if (!basis || basis.matterId !== access.document.matterId || (!basis.matterId && basis.id !== access.document.id)) throw new ActionError("依据材料不可读取或不属于当前案件");
    }
    const previous = await db.documentReviewIssue.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.createdById !== userId || previous.requestHash !== requestHash) throw new ActionError("保存标识已用于其他问题，请重新填写");
      await assertSavedReviewPosition(db, userId, access.document.matterId, previous.documentId, previous.position);
      if (previous.basisDocumentId) await assertSavedReviewPosition(db, userId, access.document.matterId, previous.basisDocumentId, previous.basisPosition);
      return { id: previous.id, documentId: previous.documentId, version: previous.version };
    }
    const { position: positionInput, basisPosition: basisInput, ...content } = data;
    const position = await prepareReviewPosition(db, userId, access.document, positionInput);
    const basisPosition = basis ? await prepareReviewPosition(db, userId, basis, basisInput) : null;
    const issue = await db.documentReviewIssue.create({ data: { ...content, position: position ?? Prisma.DbNull,
      basisPosition: basisPosition ?? Prisma.DbNull, createdById: userId, requestHash } });
    await auditTx(db, { userId, action: "DOCUMENT_REVIEW_ISSUE_CREATE", targetType: "DocumentReviewIssue", targetId: issue.id,
      detail: { documentId: data.documentId, basisDocumentId: data.basisDocumentId, position, basisPosition } });
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
    const revision = data.revisionDocumentId ? await readableDocument(db, userId, data.revisionDocumentId) : null;
    if (data.revisionDocumentId) {
      if (!access.document.familyId) throw new ActionError("此文书缺少明确的版本关系，不能关联修订；可仅保存处理说明");
      if (!revision || revision.matterId !== access.document.matterId || revision.familyId !== access.document.familyId || revision.version <= access.document.version) {
        throw new ActionError("请选择此文书实际产生的后续修订版本");
      }
    }
    const previous = await db.documentReviewEvent.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash || previous.kind !== "RESPONSE") throw new ActionError("保存标识已用于其他处理，请重新填写");
      if (previous.revisionDocumentId) await assertSavedReviewPosition(db, userId, access.document.matterId, previous.revisionDocumentId, previous.revisionPosition);
      return { id: issue.id, documentId: issue.documentId, version: previous.version };
    }
    if (issue.version !== data.expectedVersion) throw new ActionError("此问题已有新处理，请刷新后核对，当前输入尚未保存");
    if (issue.state === "RESOLVED") throw new ActionError("此问题已处理；新问题请另行提出，保留原复核结论");
    const revisionPosition = revision ? await prepareReviewPosition(db, userId, revision, data.revisionPosition) : null;
    const version = issue.version + 1;
    await db.documentReviewEvent.create({ data: { issueId: issue.id, kind: "RESPONSE", disposition: data.disposition, note: data.note,
      revisionDocumentId: data.revisionDocumentId, revisionLocation: data.revisionLocation, revisionPosition: revisionPosition ?? Prisma.DbNull,
      actorId: userId, version, requestId: data.requestId, requestHash } });
    await db.documentReviewIssue.update({ where: { id: issue.id, version: data.expectedVersion }, data: { state: "WAITING_CHECK", version } });
    await auditTx(db, { userId, action: "DOCUMENT_REVIEW_RESPOND", targetType: "DocumentReviewIssue", targetId: issue.id,
      detail: { documentId: issue.documentId, version, disposition: data.disposition, revisionDocumentId: data.revisionDocumentId, revisionPosition } });
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
