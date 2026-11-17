import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { auditTx } from "@/server/audit";
import { contextAccess, type ContextAccess, type ContextActor } from "@/server/matters/context-service";
import { prepareSource, readSourceSnapshot, readableDocumentOptions, resolveReference, sourceReader, sourceReferences } from "@/server/evidence/source-links";
import { evidenceEventDateFromRecord } from "@/lib/evidence/event-date";
import { readResearchIssueSnapshot, researchIssueSnapshotSchema, type ResearchIssueSnapshot } from "./issue-snapshot";
import type { SourceReference } from "@/server/evidence/contracts";
import {
  lawMetadataSchema, researchCheckSchema, researchQuerySchema, researchSaveSchema,
  type ResearchCheckInput, type ResearchContent, type ResearchList, type ResearchOptions,
  type ResearchRevisionView, type ResearchSaveInput,
  type ResearchSourceInput, type ResearchIssueSelection,
} from "./contracts";

export const researchInclude = {
  author: { select: { name: true } }, checkedBy: { select: { name: true } }, successor: { select: { id: true } },
  sources: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { document: { select: { isLatest: true } } } },
  issue: { select: { matterId: true, revision: true, confirmedAt: true } },
} satisfies Prisma.ResearchRevisionInclude;
export type ResearchRow = Prisma.ResearchRevisionGetPayload<{ include: typeof researchInclude }>;

function references(row: ResearchRow): SourceReference[] {
  return row.sources.map(source => ({ id: source.id, documentId: source.documentId, documentSha256: source.documentSha256,
    relation: source.relation, location: source.location as SourceReference["location"], parseRunId: source.parseRunId,
    anchorId: source.anchorId, legacy: false }));
}

/** Only the input saved with this research contributes evidence, never today's issue. */
export function researchIssueReferences(row: ResearchRow): SourceReference[] | null {
  if (!row.issueId && !row.issueRevisionId && row.issueSnapshot === null) return [];
  return readResearchIssueSnapshot(row)?.sourceSnapshot ?? null;
}

export async function researchReadAccess(tx: Prisma.TransactionClient, access: ContextAccess, row: ResearchRow) {
  const issueReferences = researchIssueReferences(row);
  if (issueReferences === null) return { readable: false, sourceViews: [], issueSourceViews: [] };
  const ownReferences = references(row);
  const reader = await sourceReader(access.user.id, access.matter.id, [...ownReferences, ...issueReferences], tx);
  const readable = [...ownReferences, ...issueReferences].every(source => Boolean(reader.documentFor(source)));
  return { readable, sourceViews: readable ? ownReferences.map(source => ({ reference: source, view: reader.view(source) })) : [],
    issueSourceViews: readable ? issueReferences.map(source => ({ ...reader.view(source), id: `issue:${source.id}` })) : [] };
}

export async function assertResearchReadable(tx: Prisma.TransactionClient, access: ContextAccess, row: ResearchRow) {
  const result = await researchReadAccess(tx, access, row);
  if (!result.readable) throw new ActionError("研究所用来源已撤回、变化或无权读取，不能继续使用这份研究");
  return result;
}

export async function loadResearch(tx: Prisma.TransactionClient, matterId: string, id: string) {
  const row = await tx.researchRevision.findFirst({ where: { id, matterId }, include: researchInclude });
  if (!row) throw new ActionError("研究不存在或不属于当前事项");
  return row;
}

function contentOf(row: ResearchRow): ResearchContent {
  return {
    question: row.question, purpose: row.purpose, jurisdiction: row.jurisdiction, relevantDate: row.relevantDate ?? "",
    researchedAt: row.researchedAt.toISOString(), scope: row.scope,
    queryLog: researchQuerySchema.array().parse(row.queryLog), rule: row.rule, exceptions: row.exceptions,
    supportingAnalysis: row.supportingAnalysis, opposingAnalysis: row.opposingAnalysis, conclusion: row.conclusion,
    unresolved: row.unresolved, nextSteps: row.nextSteps,
    issueSelection: row.issueId ? { kind: "SAVED", researchRevisionId: row.id } : null,
    sources: row.sources.map(source => ({ documentId: source.documentId, relation: source.relation,
      page: !(source.parseRunId && source.anchorId) && source.location && typeof source.location === "object" && !Array.isArray(source.location) && source.location.kind === "PAGE"
        ? Number(source.location.page) : null,
      ...(source.parseRunId && source.anchorId ? { parseRunId: source.parseRunId, anchorId: source.anchorId } : {}),
      lawMetadata: lawMetadataSchema.parse(source.lawMetadata) })),
  };
}

export async function presentResearch(tx: Prisma.TransactionClient, access: ContextAccess, row: ResearchRow): Promise<ResearchRevisionView> {
  const result = await researchReadAccess(tx, access, row);
  const content = result.readable ? contentOf(row) : null;
  const issue = result.readable ? readResearchIssueSnapshot(row) : null;
  const current = !row.successor;
  return {
    id: row.id, seriesId: row.seriesId, version: row.version, current, createdAt: row.createdAt.toISOString(), authorName: row.author.name,
    checkedAt: row.checkedAt?.toISOString() ?? null, checkedByName: row.checkedBy?.name ?? null,
    checkNote: result.readable ? row.checkNote : null, readable: result.readable, content,
    sources: result.readable ? result.sourceViews.map(({ view }, index) => ({ ...content!.sources[index], id: row.sources[index].id,
      documentName: view.documentName!, version: view.documentVersion!, locationLabel: view.locationLabel!, changed: !row.sources[index].document.isLatest })) : [],
    issue: issue ? { id: issue.evidenceItemId, revisionId: issue.revisionId,
      revision: issue.revision, title: issue.title, content: issue.content, confirmedAt: issue.confirmedAt,
      capturedAt: issue.capturedAt, changed: issue.revision !== row.issue!.revision,
      confirmationChanged: issue.confirmedAt !== (row.issue!.confirmedAt?.toISOString() ?? null), sources: result.issueSourceViews } : null,
    canRevise: access.canWrite && result.readable && current, canCheck: access.canConfirm && result.readable && current && !row.checkedAt,
    canDraft: access.canWrite && result.readable && hasCustomPermission(access.user, "documents.write"),
  };
}

/** The shared authorization lock and matter lock serialize actual mutations and revocations. */
export async function researchTransaction<T>(db: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try { return await db.$transaction(run, { timeout: 20000 }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002", "P2025"].includes(error.code)) {
      throw new ActionError("研究或权限已变化，请保留输入并重新打开当前研究后重试");
    }
    throw error;
  }
}

async function captureIssueInput(tx: Prisma.TransactionClient, access: ContextAccess, selection: ResearchIssueSelection | null): Promise<ResearchIssueSnapshot | null> {
  if (!selection) return null;
  if (selection.kind === "SAVED") {
    const previous = await loadResearch(tx, access.matter.id, selection.researchRevisionId);
    await assertResearchReadable(tx, access, previous);
    const snapshot = readResearchIssueSnapshot(previous);
    if (!snapshot) throw new ActionError("所选研究没有可复用的争点输入，请重新选择");
    return snapshot;
  }
  let snapshot: ResearchIssueSnapshot;
  if (selection.kind === "CURRENT") {
    const issue = await tx.evidenceItem.findFirst({ where: { id: selection.issueId, matterId: access.matter.id, kind: "ISSUE" },
      include: { sources: { where: { removedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    if (!issue) throw new ActionError("争点不存在、不属于本事项或已改变性质，请重新选择");
    if (issue.revision !== selection.revision || (issue.confirmedAt?.toISOString() ?? null) !== selection.confirmedAt) {
      throw new ActionError("争点内容或核对状态已变化，请保留研究输入，更新争点选项并重新选择");
    }
    snapshot = { evidenceItemId: issue.id, matterId: issue.matterId, revision: issue.revision, revisionId: null,
      title: issue.title, content: issue.content, kind: "ISSUE", eventDate: evidenceEventDateFromRecord(issue),
      sourceSnapshot: sourceReferences(issue), confirmedById: issue.confirmedById, confirmedAt: issue.confirmedAt?.toISOString() ?? null,
      capturedAt: new Date().toISOString(), capturedById: access.user.id };
  } else {
    const revision = await tx.evidenceItemRevision.findFirst({ where: { id: selection.revisionId, kind: "ISSUE", evidenceItem: { matterId: access.matter.id } } });
    if (!revision) throw new ActionError("争点历史修订不存在或不属于本事项");
    const sources = readSourceSnapshot(revision.sourceSnapshot);
    if (!sources) throw new ActionError("争点历史来源记录不完整，请重新选择");
    snapshot = { evidenceItemId: revision.evidenceItemId, matterId: access.matter.id, revision: revision.revision, revisionId: revision.id,
      title: revision.title, content: revision.content, kind: "ISSUE", eventDate: evidenceEventDateFromRecord(revision),
      sourceSnapshot: sources, confirmedById: revision.confirmedById, confirmedAt: revision.confirmedAt?.toISOString() ?? null,
      capturedAt: new Date().toISOString(), capturedById: access.user.id };
  }
  const reader = await sourceReader(access.user.id, access.matter.id, snapshot.sourceSnapshot, tx);
  if (snapshot.sourceSnapshot.some(source => !reader.documentFor(source))) throw new ActionError("无权读取所选争点的来源，或来源已撤回");
  return researchIssueSnapshotSchema.parse(snapshot);
}

export async function saveResearch(db: PrismaClient, actor: ContextActor, input: ResearchSaveInput) {
  const parsed = researchSaveSchema.parse(input);
  if (new Date(parsed.researchedAt).getTime() > Date.now() + 300000) throw new ActionError("研究时间不能晚于当前时间");
  const requestHash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  return researchTransaction(db, async tx => {
    const access = await contextAccess(tx, actor, parsed.matterId, true);
    const prior = await tx.researchRevision.findUnique({ where: { authorId_requestKey: { authorId: actor.id, requestKey: parsed.requestKey } }, include: researchInclude });
    if (prior) {
      if (prior.matterId !== parsed.matterId || prior.requestHash !== requestHash) throw new ActionError("本次提交已保存为不同内容，请重新打开研究后修改");
      await assertResearchReadable(tx, access, prior);
      return { id: prior.id, version: prior.version, replayed: true };
    }
    let seriesId: string = randomUUID();
    let version = 1;
    if (parsed.supersedesId) {
      const previous = await loadResearch(tx, parsed.matterId, parsed.supersedesId);
      await assertResearchReadable(tx, access, previous);
      if (previous.successor || previous.version !== parsed.expectedVersion) throw new ActionError("研究已产生新修订，请保留输入并打开最新记录");
      seriesId = previous.seriesId;
      version = previous.version + 1;
    }
    const issueSnapshot = await captureIssueInput(tx, access, parsed.issueSelection);
    const sources = [];
    const keys = new Set<string>();
    for (const source of parsed.sources) {
      const prepared = await prepareSource(actor.id, parsed.matterId, source, tx);
      const key = `${prepared.documentId}:${prepared.relation}:${prepared.locationKey}`;
      if (keys.has(key)) throw new ActionError("同一位置和用途的来源请只选择一次");
      keys.add(key);
      sources.push({ ...prepared, lawMetadata: source.lawMetadata as Prisma.InputJsonValue });
    }
    const row = await tx.researchRevision.create({ data: { matterId: parsed.matterId, question: parsed.question, purpose: parsed.purpose,
      jurisdiction: parsed.jurisdiction, scope: parsed.scope, rule: parsed.rule, exceptions: parsed.exceptions,
      supportingAnalysis: parsed.supportingAnalysis, opposingAnalysis: parsed.opposingAnalysis, conclusion: parsed.conclusion,
      unresolved: parsed.unresolved, nextSteps: parsed.nextSteps,
      issueId: issueSnapshot?.evidenceItemId ?? null, issueRevisionId: issueSnapshot?.revisionId ?? null,
      issueSnapshot: issueSnapshot ? issueSnapshot as Prisma.InputJsonValue : Prisma.DbNull,
      requestKey: parsed.requestKey, supersedesId: parsed.supersedesId, seriesId, version,
      researchedAt: new Date(parsed.researchedAt), relevantDate: parsed.relevantDate || null,
      queryLog: parsed.queryLog as Prisma.InputJsonValue, authorId: actor.id, requestHash, sources: { create: sources } }, select: { id: true } });
    await auditTx(tx, { userId: actor.id, action: parsed.supersedesId ? "RESEARCH_REVISE" : "RESEARCH_CREATE", targetType: "ResearchRevision", targetId: row.id,
      detail: { matterId: parsed.matterId, seriesId, version, supersedesId: parsed.supersedesId, sourceCount: sources.length,
        issueId: issueSnapshot?.evidenceItemId ?? null, issueRevision: issueSnapshot?.revision ?? null,
        issueSelection: parsed.issueSelection?.kind ?? null } });
    return { id: row.id, version, replayed: false };
  });
}

export async function checkResearch(db: PrismaClient, actor: ContextActor, input: ResearchCheckInput) {
  const parsed = researchCheckSchema.parse(input);
  return researchTransaction(db, async tx => {
    const access = await contextAccess(tx, actor, parsed.matterId, true);
    if (!access.canConfirm) throw new ActionError("仅本事项主办或协办可核对研究");
    const row = await loadResearch(tx, parsed.matterId, parsed.id);
    await assertResearchReadable(tx, access, row);
    if (row.successor || row.version !== parsed.expectedVersion) throw new ActionError("研究已产生新修订，请打开最新记录后核对");
    if (row.checkedAt) {
      if (row.checkNote !== parsed.note || row.checkedById !== actor.id) throw new ActionError("这份研究已核对，核对结论不能覆盖；需要补充请另存修订");
      return { id: row.id, replayed: true };
    }
    await tx.researchRevision.update({ where: { id: row.id }, data: { checkedAt: new Date(), checkedById: actor.id, checkNote: parsed.note } });
    await auditTx(tx, { userId: actor.id, action: "RESEARCH_CHECK", targetType: "ResearchRevision", targetId: row.id,
      detail: { matterId: row.matterId, version: row.version } });
    return { id: row.id, replayed: false };
  });
}

export async function readResearch(db: PrismaClient, actor: ContextActor, matterId: string, id: string) {
  return db.$transaction(async tx => presentResearch(tx, await contextAccess(tx, actor, matterId), await loadResearch(tx, matterId, id)), { timeout: 20000 });
}

export async function listResearch(db: PrismaClient, actor: ContextActor, matterId: string, beforeId?: string): Promise<ResearchList> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const before = beforeId ? await tx.researchRevision.findFirst({ where: { id: beforeId, matterId }, select: { id: true, createdAt: true } }) : null;
    if (beforeId && !before) throw new ActionError("翻页位置已失效，请刷新研究列表");
    const rows = await tx.researchRevision.findMany({ where: { matterId, successor: { is: null }, ...(before ? { OR: [
      { createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } },
    ] } : {}) }, include: researchInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 });
    const page = rows.slice(0, 20);
    const views = await Promise.all(page.map(row => presentResearch(tx, access, row)));
    return { canWrite: access.canWrite, records: views.map(row => ({ id: row.id, seriesId: row.seriesId, version: row.version,
      createdAt: row.createdAt, authorName: row.authorName, checkedAt: row.checkedAt, readable: row.readable, question: row.content?.question ?? null })),
      nextCursor: rows.length > 20 ? page[page.length - 1].id : null };
  }, { timeout: 20000 });
}

export async function readResearchHistory(db: PrismaClient, actor: ContextActor, matterId: string, id: string, beforeVersion?: number) {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const target = await loadResearch(tx, matterId, id);
    const rows = await tx.researchRevision.findMany({ where: { matterId, seriesId: target.seriesId,
      ...(beforeVersion ? { version: { lt: beforeVersion } } : {}) }, orderBy: { version: "desc" }, take: 21, include: researchInclude });
    return { records: await Promise.all(rows.slice(0, 20).map(row => presentResearch(tx, access, row))),
      nextVersion: rows.length > 20 ? rows[19].version : null };
  }, { timeout: 20000 });
}

export async function readResearchOptions(db: PrismaClient, actor: ContextActor, matterId: string): Promise<ResearchOptions> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    if (!access.canWrite) throw new ActionError("无权维护事项研究");
    const candidates = await tx.evidenceItem.findMany({ where: { matterId, kind: "ISSUE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { sources: { where: { removedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    const issues: ResearchOptions["issues"] = [];
    for (const item of candidates) {
      const issueSources = sourceReferences(item);
      const reader = await sourceReader(actor.id, matterId, issueSources, tx);
      if (issueSources.every(source => reader.documentFor(source))) issues.push({ id: item.id, revision: item.revision, title: item.title,
        selection: { kind: "CURRENT", issueId: item.id, revision: item.revision, confirmedAt: item.confirmedAt?.toISOString() ?? null } });
    }
    return { documents: await readableDocumentOptions(actor.id, matterId), issues };
  }, { timeout: 20000 });
}

export async function readResearchSource(db: PrismaClient, actor: ContextActor, matterId: string, id: string, sourceId: string) {
  const reference = await db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const row = await loadResearch(tx, matterId, id);
    await assertResearchReadable(tx, access, row);
    const selected = sourceId.startsWith("issue:")
      ? researchIssueReferences(row)?.find(source => source.id === sourceId.slice(6))
      : references(row).find(source => source.id === sourceId);
    if (!selected) throw new ActionError("来源不属于这份研究修订");
    return selected;
  }, { timeout: 20000 });
  return resolveReference(actor.id, matterId, reference);
}

export async function previewResearchSource(db: PrismaClient, actor: ContextActor, matterId: string, input: ResearchSourceInput) {
  const reference = await db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    if (!access.canWrite) throw new ActionError("无权维护事项研究");
    const prepared = await prepareSource(actor.id, matterId, input, tx);
    return { ...prepared, id: "preview", legacy: false, location: prepared.location as SourceReference["location"] };
  }, { timeout: 20000 });
  return resolveReference(actor.id, matterId, reference);
}
