"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { adoptMatterObservationsSchema } from "@/lib/evidence/case-adoption";
import { chronologyAssessmentInput, chronologyAssessmentSchema, chronologyCategories, chronologyChangeSchema, chronologyDisputes, chronologyStages, chronologyExportInput } from "@/lib/evidence/chronology-assessment";
import { evidenceTextSchema, revisionInputSchema } from "@/lib/evidence/item-input";
import { prisma } from "@/lib/prisma";
import { timelineEventKey } from "@/lib/matters/timeline-levels";
import { timelineGrades } from "@/server/matters/timeline-grades";
import { uniqueIndex } from "@/lib/prisma-errors";
import { requireSession } from "@/lib/auth/session";
import { loadFixedFragments } from "@/server/ai/fixed-fragments";
import { auditTx, auditStrict } from "@/server/audit";
import { assertCanReadMatter, assertCanHandleMatter, matterAssociationFilter } from "@/lib/permissions";
import { assertMatterWritable } from "@/lib/archive/guard";
import { checkRoleMutation } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { ActionError } from "@/lib/action-error";
import { revalidateMatter } from "@/server/matters/route";
import { emptyEvidenceEventDate, evidenceEventDateFromRecord, evidenceEventDateToRecord, evidenceEventDatesEqual } from "@/lib/evidence/event-date";
import {
  recordObservationSchema, sourceInputSchema, sourceRelationSchema,
  type EvidenceItemView, type EvidenceRevisionView, type EvidenceSourceView, type SourceReference,
} from "./contracts";
import { prepareSource, readSourceSnapshot, readableDocumentOptions, resolveReference, sourceReader, sourceReferences } from "./source-links";

import { observationDataSchema, observationInputSchema, type EvidenceObservationView } from "@/lib/evidence/observation-contract";
import { prepareObservation } from "./observation-contract";
import { adoptObservationRunSchema, matterObservationRangesSchema, observationAdoptionSchema, observationCandidatesSchema, observationRangesSchema } from "./analysis-run-contract";

export type { EvidenceItemView } from "./contracts";
type Session = Awaited<ReturnType<typeof requireSession>>;
const itemInclude = {
  sources: { where: { removedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  createdBy: { select: { name: true } }, confirmedBy: { select: { name: true } },
} satisfies Prisma.EvidenceItemInclude;
type Item = Prisma.EvidenceItemGetPayload<{ include: typeof itemInclude }>;

const createSchema = evidenceTextSchema.extend({
  requestKey: z.string().uuid("保存标识无效，请关闭后重新记录").transform(value => value.toLowerCase()),
  matterId: z.string().cuid(), sourceDocumentId: z.string().cuid().optional().nullable(),
  sourcePage: z.number().int().min(1).max(10000).optional().nullable(),
  sourceRelation: sourceRelationSchema.default("CONTEXT"),
}).superRefine((value, context) => {
  if (value.sourcePage != null && !value.sourceDocumentId) context.addIssue({ code: "custom", path: ["sourcePage"], message: "填写页码须先选择来源材料" });
});
export type CreateEvidenceItemInput = z.input<typeof createSchema>;

/** This describes the original submitted intent, never the item's later revisions. */
function creationRequestHash(data: z.output<typeof createSchema>) {
  const date = data.eventDate ?? emptyEvidenceEventDate();
  return createHash("sha256").update(JSON.stringify({
    matterId: data.matterId, title: data.title, content: data.content, kind: data.kind,
    eventDate: { precision: date.precision, start: date.start, end: date.end, text: date.text },
    source: data.sourceDocumentId ? {
      documentId: data.sourceDocumentId, page: data.sourcePage ?? null, relation: data.sourceRelation,
    } : null,
  })).digest("hex");
}

function isCreationRequestConflict(error: { code: unknown; meta?: unknown }) {
  return uniqueIndex(error, "EvidenceItem") === "EvidenceItem_createdById_requestKey_key";
}

/** Only creation retries; a unique-key loser must read the winner in a fresh transaction. */
async function creationTransaction<T>(work: (tx: Prisma.TransactionClient, replayOnly: boolean) => Promise<T>) {
  let replayOnly = false;
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(tx => work(tx, replayOnly), { isolationLevel: "Serializable", timeout: 20000 }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const requestConflict = isCreationRequestConflict(error);
        if ((error.code === "P2034" || requestConflict) && attempt < 2) {
          replayOnly ||= requestConflict;
          continue;
        }
        if (error.code === "P2034" || error.code === "P2002") {
          throw new ActionError("本次保存遇到并发操作，请保留当前输入后重试");
        }
      }
      throw error;
    }
  }
}

/** Read current membership and lifecycle inside the write transaction too. */
async function mutationContext(tx: Prisma.TransactionClient, session: Session, matterId: string) {
  await checkRoleMutation(tx, session.user, "matters.write");
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${session.user.id} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { active: true, role: true } });
  if (!actor?.active || actor.role !== session.user.role) throw new ActionError("当前资格已变化，请刷新后重试");
  await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${matterId} FOR UPDATE`;
  const matter = await tx.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) },
    select: { status: true },
  });
  if (!matter) throw new ActionError("案件不存在或无权办理");
  if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改证据要点");
}

async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await prisma.$transaction(work, { isolationLevel: "Serializable", timeout: 20000 }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && ["P2034", "P2002"].includes(String(error.code))) {
      throw new ActionError("记录已被其他操作更新，请刷新后核对再保存");
    }
    throw error;
  }
}

type EvidenceMutation<T> = (tx: Prisma.TransactionClient, item: Item, session: Session) => Promise<T>;
async function changeItem<T>(input: z.infer<typeof revisionInputSchema>, work: EvidenceMutation<T>, replay?: EvidenceMutation<T | null>) {
  const session = await requireSession("matters.write");
  const reference = await prisma.evidenceItem.findUnique({ where: { id: input.evidenceItemId }, select: { matterId: true } });
  if (!reference) throw new ActionError("证据要点不存在");
  await assertCanHandleMatter(session.user, reference.matterId);
  await assertMatterWritable(reference.matterId, { allowPrincipal: true });
  const result = await transaction(async tx => {
    await mutationContext(tx, session, reference.matterId);
    await tx.$queryRaw`SELECT id FROM "EvidenceItem" WHERE id = ${input.evidenceItemId} FOR UPDATE`;
    const item = await tx.evidenceItem.findUnique({ where: { id: input.evidenceItemId }, include: itemInclude });
    if (!item || item.matterId !== reference.matterId) throw new ActionError("证据要点已变化，请刷新后重试");
    const previous = replay ? await replay(tx, item, session) : null;
    if (previous !== null) return previous;
    if (item.revision !== input.expectedRevision) throw new ActionError("此要点已有新修订，请重新打开后核对，当前输入尚未保存");
    return work(tx, item, session);
  });
  await revalidateMatter(reference.matterId);
  return result;
}

async function assertSourcesReadable(tx: Prisma.TransactionClient, item: Item, userId: string) {
  const references = sourceReferences(item);
  const reader = await sourceReader(userId, item.matterId, references, tx);
  if (references.some(reference => !reader.documentFor(reference))) throw new ActionError("部分来源已不可读或身份已变化，请先核对来源，不能编辑或确认此版本");
}

/** Capture the OLD revision exactly once; published snapshots are never updated. */
async function snapshotAndAdvance(tx: Prisma.TransactionClient, item: Item, userId: string, change: Prisma.EvidenceItemUpdateManyMutationInput = {}) {
  await tx.evidenceItemRevision.create({ data: {
    evidenceItemId: item.id, revision: item.revision, title: item.title, content: item.content, kind: item.kind,
    sourceSnapshot: sourceReferences(item) as Prisma.InputJsonValue, observationRevisionIds: item.observationRevisionIds,
    confirmedById: item.confirmedById, confirmedAt: item.confirmedAt, editedById: userId,
    chronologyAssessment: chronologyAssessmentSchema.parse(item.chronologyAssessment),
    eventDatePrecision: item.eventDatePrecision, eventDateStart: item.eventDateStart,
    eventDateEnd: item.eventDateEnd, eventDateText: item.eventDateText,
  } });
  const changed = await tx.evidenceItem.updateMany({
    where: { id: item.id, revision: item.revision },
    data: { confirmedById: null, confirmedAt: null, ...change, revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ActionError("证据要点已有新修订，请刷新后重试");
  return item.revision + 1;
}

export async function createEvidenceItem(input: CreateEvidenceItemInput) {
  const session = await requireSession("matters.write");
  const data = createSchema.parse(input);
  const requestHash = creationRequestHash(data);
  await assertCanHandleMatter(session.user, data.matterId);
  await assertMatterWritable(data.matterId, { allowPrincipal: true });
  const created = await creationTransaction(async (tx, replayOnly) => {
    await mutationContext(tx, session, data.matterId);
    const previous = await tx.evidenceItem.findUnique({
      where: { createdById_requestKey: { createdById: session.user.id, requestKey: data.requestKey } },
      // Keep removed sources available only to verify the original submitted source identity.
      include: { ...itemInclude, sources: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (previous && (previous.matterId !== data.matterId || previous.requestHash !== requestHash)) {
      throw new ActionError("此提交已保存且内容发生变化，请先核对已有记录；需要另记一条时请关闭后重新记录");
    }
    const source = data.sourceDocumentId ? await prepareSource(session.user.id, data.matterId, {
      documentId: data.sourceDocumentId, page: data.sourcePage, relation: data.sourceRelation,
    }, tx) : null;
    if (previous) {
      if (source) {
        const original = previous.sources.find(link => link.documentId === source.documentId &&
          link.relation === source.relation && link.locationKey === source.locationKey);
        if (!original || original.documentSha256 !== source.documentSha256) {
          throw new ActionError("原提交的来源身份已变化，请先核对已有记录");
        }
      }
      await assertSourcesReadable(tx, previous, session.user.id);
      return { id: previous.id };
    }
    if (replayOnly) throw new ActionError("本次保存结果已变化，请先刷新核对已有记录");
    const item = await tx.evidenceItem.create({ data: {
      matterId: data.matterId, title: data.title, content: data.content, kind: data.kind, createdById: session.user.id,
      requestKey: data.requestKey, requestHash,
      ...evidenceEventDateToRecord(data.eventDate ?? emptyEvidenceEventDate()),
      ...(source ? { sources: { create: { ...source, createdById: session.user.id } } } : {}),
    }, select: { id: true } });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_ITEM_CREATE", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: data.matterId, kind: data.kind, revision: 1, sourceDocumentId: source?.documentId ?? null } });
    return item;
  });
  await revalidateMatter(data.matterId);
  return { ok: true as const, id: created.id };
}

export async function updateEvidenceItem(input: z.infer<typeof revisionInputSchema> & z.infer<typeof evidenceTextSchema>) {
  const data = revisionInputSchema.merge(evidenceTextSchema).parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    const currentDate = evidenceEventDateFromRecord(item);
    const eventDate = data.eventDate ?? currentDate;
    if (item.title === data.title && item.content === data.content && item.kind === data.kind && evidenceEventDatesEqual(currentDate, eventDate)) return { ok: true as const, revision: item.revision };
    const revision = await snapshotAndAdvance(tx, item, session.user.id, {
      title: data.title, content: data.content, kind: data.kind, ...evidenceEventDateToRecord(eventDate),
    });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_ITEM_EDIT", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, previousRevision: item.revision, revision, confirmationCleared: Boolean(item.confirmedAt) } });
    return { ok: true as const, revision };
  });
}

export async function confirmEvidenceItem(input: z.infer<typeof revisionInputSchema> & { confirm: true }) {
  const data = revisionInputSchema.extend({ confirm: z.literal(true) }).parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    if (item.confirmedAt) return { ok: true as const, revision: item.revision, alreadyConfirmed: true };
    const result = await tx.evidenceItem.updateMany({
      where: { id: item.id, revision: item.revision, confirmedAt: null }, data: { confirmedById: session.user.id, confirmedAt: new Date() },
    });
    if (result.count !== 1) throw new ActionError("确认状态已变化，请刷新后重试");
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_ITEM_CONFIRM", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision: item.revision, kind: item.kind, sourceIds: sourceReferences(item).map(source => source.id) } });
    return { ok: true as const, revision: item.revision, alreadyConfirmed: false };
  });
}

export async function changeChronologyAssessment(input: z.input<typeof chronologyAssessmentInput>) {
  const data = chronologyAssessmentInput.parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    const change = data.change;
    const assessment = chronologyAssessmentSchema.parse(item.chronologyAssessment);
    let confirmation = { confirmedAt: item.confirmedAt, confirmedById: item.confirmedById };
    if (change.kind === "reviewed") {
      if (Boolean(item.confirmedAt) === change.value) return { ok: true as const, revision: item.revision };
      confirmation = { confirmedAt: change.value ? new Date() : null, confirmedById: change.value ? session.user.id : null };
    } else if (change.kind === "date" || change.kind === "amount") {
      const field = change.kind === "date" ? "dateObservationId" : "amountObservationId";
      if (change.value === (assessment[field] ?? null)) return { ok: true as const, revision: item.revision };
      if (change.value === null) delete assessment[field];
      else {
        const record = await tx.evidenceObservationRevision.findFirst({
          where: { id: change.value }, select: { data: true, sourceLinkId: true },
        });
        if (!item.observationRevisionIds.includes(change.value) || !record ||
          !item.sources.some(source => source.id === record.sourceLinkId)) throw new ActionError("只能采用当前要点的有效记载");
        const observation = observationDataSchema.parse(record.data);
        if (change.kind === "date" ? !observation.date || observation.date.value.precision === "UNKNOWN" : !observation.amount?.value) {
          throw new ActionError("本条记载没有可采用的字段");
        }
        assessment[field] = change.value;
      }
    } else if (change.kind === "category") {
      if (change.value === (assessment.category ?? null)) return { ok: true as const, revision: item.revision };
      if (change.value === null) delete assessment.category;
      else assessment.category = change.value;
    } else if (change.kind === "dispute") {
      if (change.value === (assessment.dispute ?? "pending")) return { ok: true as const, revision: item.revision };
      assessment.dispute = change.value;
    } else if (change.kind === "nature") {
      if (change.value === (assessment.nature ?? null)) return { ok: true as const, revision: item.revision };
      if (change.value === null) delete assessment.nature;
      else assessment.nature = change.value;
    } else if (change.kind === "split") {
      const { observationId, title } = change.value;
      if (item.observationRevisionIds.length < 2 || !item.observationRevisionIds.includes(observationId)) {
        throw new ActionError("拆分须保留当前事件的其他记载");
      }
      const record = await tx.evidenceObservationRevision.findUniqueOrThrow({ where: { id: observationId } });
      const source = item.sources.find(value => value.id === record.sourceLinkId);
      if (!source) throw new ActionError("当前记载的固定来源已不可用");
      const data = observationDataSchema.parse(record.data);
      const text = data.excerpt?.text ?? [data.date?.text, data.amount?.text, ...data.participants?.map(person => person.text) ?? []].filter(Boolean).join("\n");
      const destination = await tx.evidenceItem.create({ data: {
        matterId: item.matterId, title, content: text, kind: item.kind, createdById: session.user.id,
        chronologyAssessment: assessment.category ? { category: assessment.category } : {},
      }, select: { id: true } });
      const copy = await tx.evidenceSourceLink.create({ data: {
        evidenceItemId: destination.id, documentId: source.documentId, documentSha256: source.documentSha256,
        relation: source.relation, location: source.location as Prisma.InputJsonValue, locationKey: source.locationKey,
        parseRunId: source.parseRunId, anchorId: source.anchorId, createdById: session.user.id,
      }, select: { id: true } });
      const saved = await tx.evidenceObservationRevision.create({ data: {
        sourceLinkId: copy.id, seriesId: randomUUID(), revision: 1, requestKey: randomUUID(), baseEvidenceRevision: 1,
        requestInput: observationInputSchema.parse(record.requestInput), data, createdById: session.user.id,
      }, select: { id: true } });
      await tx.evidenceItem.update({ where: { id: destination.id }, data: { observationRevisionIds: [saved.id] } });
      const remaining = item.observationRevisionIds.filter(id => id !== observationId);
      if (assessment.dateObservationId === observationId) delete assessment.dateObservationId;
      if (assessment.amountObservationId === observationId) delete assessment.amountObservationId;
      const revision = await snapshotAndAdvance(tx, item, session.user.id, { observationRevisionIds: remaining, chronologyAssessment: assessment });
      await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_CHRONOLOGY_ASSESSMENT", targetType: "EvidenceItem", targetId: item.id,
        detail: { matterId: item.matterId, revision, change, destinationId: destination.id } });
      await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_CHRONOLOGY_SPLIT_FROM", targetType: "EvidenceItem", targetId: destination.id,
        detail: { matterId: item.matterId, sourceItemId: item.id, sourceObservationId: observationId } });
      return { ok: true as const, revision, destinationId: destination.id };
    } else if (change.kind === "sourceStage") {
      if (!hasCustomPermission(session.user, "documents.write")) throw new ActionError("无权修改材料出现时点");
      const source = sourceReferences(item).find(reference => reference.id === change.sourceId);
      if (!source) throw new ActionError("此来源不在当前要点");
      const previous = await tx.document.findUniqueOrThrow({ where: { id: source.documentId }, select: { chronologyStage: true } });
      if (previous.chronologyStage === change.value) return { ok: true as const, revision: item.revision };
      const changed = await tx.document.updateMany({
        where: { id: source.documentId, matterId: item.matterId, deletedAt: null, chronologyStage: previous.chronologyStage },
        data: { chronologyStage: change.value },
      });
      if (changed.count !== 1) throw new ActionError("材料出现时点已变化，请刷新后重试");
    } else if (change.kind === "addDirection") {
      const value = change.value;
      const source = sourceReferences(item).find(reference => reference.id === value.sourceId && reference.anchorId);
      const target = await tx.evidenceItem.findUnique({ where: { id: value.targetId }, include: itemInclude });
      if (!source || !target || target.id === item.id || target.matterId !== item.matterId) throw new ActionError("请选择本案关联事件和带原文定位的来源");
      await assertSourcesReadable(tx, target, session.user.id);
      const resolved = await resolveReference(session.user.id, item.matterId, source, tx);
      if (resolved.status !== "AVAILABLE" || !value.quote.trim() || !resolved.text?.includes(value.quote)) throw new ActionError("引文须来自所选固定出处");
      const rows = assessment.directions ?? [];
      if (rows.some(row => row.targetId === value.targetId && row.sourceId === value.sourceId && row.quote === value.quote)) {
        return { ok: true as const, revision: item.revision };
      }
      if (rows.length >= 40) throw new ActionError("一个事件最多关联 40 条材料指向");
      assessment.directions = [...rows, { ...value, id: randomUUID() }];
    } else if (change.kind === "removeDirection") {
      const rows = assessment.directions ?? [];
      if (!rows.some(row => row.id === change.value)) return { ok: true as const, revision: item.revision };
      assessment.directions = rows.filter(row => row.id !== change.value);
    } else {
      if (change.value === Boolean(assessment.adverse)) return { ok: true as const, revision: item.revision };
      assessment.adverse = change.value;
    }
    const revision = await snapshotAndAdvance(tx, item, session.user.id, { chronologyAssessment: assessment, ...confirmation });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_CHRONOLOGY_ASSESSMENT", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision, change } });
    return { ok: true as const, revision };
  });
}

export async function addEvidenceSource(input: z.infer<typeof revisionInputSchema> & z.infer<typeof sourceInputSchema>) {
  const data = revisionInputSchema.and(sourceInputSchema).parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    const source = await prepareSource(session.user.id, item.matterId, data, tx);
    const existing = await tx.evidenceSourceLink.findUnique({ where: {
      evidenceItemId_documentId_relation_locationKey: { evidenceItemId: item.id, documentId: source.documentId, relation: source.relation, locationKey: source.locationKey },
    } });
    if (existing && existing.documentSha256 !== source.documentSha256) throw new ActionError("原来源身份已经变化，不能覆盖历史关系");
    if (existing && !existing.removedAt) return { ok: true as const, revision: item.revision, sourceId: existing.id };
    if (item.sources.length >= 50) throw new ActionError("单条要点最多关联 50 条来源，请先整理重复引用");
    const revision = await snapshotAndAdvance(tx, item, session.user.id);
    const linked = existing
      ? await tx.evidenceSourceLink.update({ where: { id: existing.id }, data: { removedAt: null, removedById: null }, select: { id: true } })
      : await tx.evidenceSourceLink.create({ data: { ...source, evidenceItemId: item.id, createdById: session.user.id }, select: { id: true } });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_SOURCE_ADD", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision, sourceId: linked.id, documentId: source.documentId, relation: source.relation, restored: Boolean(existing) } });
    return { ok: true as const, revision, sourceId: linked.id };
  });
}

export async function recordEvidenceObservation(input: z.input<typeof recordObservationSchema>) {
  const data = recordObservationSchema.parse(input);
  return changeItem(data, async (tx, item, session) => {
    const source = sourceReferences(item).find(reference => reference.id === data.sourceId && reference.parseRunId && reference.anchorId);
    if (!source) throw new ActionError("请选当前要点的固定解析出处");
    await assertSourcesReadable(tx, item, session.user.id);
    const original = await resolveReference(session.user.id, item.matterId, source, tx);
    if (original.status !== "AVAILABLE" || !original.text) throw new ActionError("当前无法核对出处原文");

    const observation = prepareObservation(data.observation, original.text);
    const previous = data.supersedesId && item.observationRevisionIds.includes(data.supersedesId)
      ? await tx.evidenceObservationRevision.findFirst({ where: { id: data.supersedesId, sourceLinkId: source.id } }) : null;
    if (data.supersedesId && !previous) throw new ActionError("记载已更新或出处不同，请重新核对");
    if (!previous && item.observationRevisionIds.length >= 200) throw new ActionError("该要点已达到 200 条记载上限");
    const saved = await tx.evidenceObservationRevision.create({
      data: {
        sourceLinkId: source.id, seriesId: previous?.seriesId ?? randomUUID(), revision: (previous?.revision ?? 0) + 1,
        supersedesId: previous?.id, requestKey: data.requestKey, baseEvidenceRevision: item.revision,
        requestInput: data.observation, data: observation, createdById: session.user.id,
      },
    });
    const ids = previous ? item.observationRevisionIds.map(id => id === previous.id ? saved.id : id)
      : [...item.observationRevisionIds, saved.id];
    const revision = await snapshotAndAdvance(tx, item, session.user.id, { observationRevisionIds: ids });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_OBSERVATION_RECORD", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision, sourceId: source.id, observationId: saved.id, supersedesId: previous?.id ?? null } });
    return { ok: true as const, revision, observationId: saved.id };
  }, async (tx, item, session) => {
    const previous = await tx.evidenceObservationRevision.findUnique({
      where: { createdById_requestKey: { createdById: session.user.id, requestKey: data.requestKey } },
      include: { sourceLink: { select: { evidenceItemId: true } } },
    });
    if (!previous) return null;
    if (previous.sourceLink.evidenceItemId !== item.id || previous.sourceLinkId !== data.sourceId ||
      previous.supersedesId !== (data.supersedesId ?? null) || previous.baseEvidenceRevision !== data.expectedRevision ||
      JSON.stringify(observationInputSchema.parse(previous.requestInput)) !== JSON.stringify(data.observation)) {
      throw new ActionError("同一保存标识已经用于另一条记载");
    }
    return { ok: true as const, revision: previous.baseEvidenceRevision + 1, observationId: previous.id };
  });
}

export async function adoptEvidenceObservationRun(raw: z.input<typeof adoptObservationRunSchema>) {
  const input = adoptObservationRunSchema.parse(raw);
  const chosen = [...input.chosen].sort((a, b) => a - b);
  async function selectedRun(tx: Prisma.TransactionClient, item: Item, session: Session) {
    if (item.matterId !== input.matterId) throw new ActionError("要点不存在或不属于本案");
    const run = await tx.evidenceObservationRun.findFirst({ where: {
      id: input.runId, evidenceItemId: item.id, authorId: session.user.id,
    } });
    if (!run) throw new ActionError("该待核批次不属于当前事项");
    return run;
  }
  return changeItem(input, async (tx, item, session) => {
    const run = await selectedRun(tx, item, session);
    if (run.state !== "READY" || run.baseRevision !== item.revision) {
      throw new ActionError("仅可采用当前要点版本中已生成的待核稿");
    }
    const candidates = observationCandidatesSchema.parse(run.candidates);
    if (chosen.some(index => !candidates[index])) throw new ActionError("所选候选不在此批次");
    if (item.observationRevisionIds.length + chosen.length > 200) throw new ActionError("采用后将超过该要点的 200 条记载上限");
    const ranges = observationRangesSchema.parse(run.ranges);
    await assertSourcesReadable(tx, item, session.user.id);
    const bySource = new Map(item.sources.map(source => [source.id, source]));
    if (ranges.some(range => {
      const source = bySource.get(range.sourceId);
      return !source || source.documentId !== range.documentId || source.parseRunId !== range.parseRunId || source.anchorId !== range.anchorId;
    })) throw new ActionError("部分固定出处已变化，请重新核对");
    await loadFixedFragments(tx, { user: session.user, matter: { id: item.matterId } }, ranges);
    const observationIds: string[] = [];
    for (const index of chosen) {
      const candidate = candidates[index];
      const range = ranges[candidate.fragment - 1];
      if (!range) throw new ActionError("候选来源不在此批次");
      const observation = await tx.evidenceObservationRevision.create({
        data: {
          sourceLinkId: range.sourceId, seriesId: randomUUID(), revision: 1, requestKey: randomUUID(),
          baseEvidenceRevision: item.revision, requestInput: candidate.input, data: candidate.data, createdById: session.user.id,
        },
        select: { id: true },
      });
      observationIds.push(observation.id);
    }
    const revision = await snapshotAndAdvance(tx, item, session.user.id, {
      observationRevisionIds: [...item.observationRevisionIds, ...observationIds],
    });
    const adoption = { chosen, revision, observationIds };
    await tx.evidenceObservationRun.update({ where: { id: run.id }, data: { state: "ADOPTED", adoption } });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_AI_ADOPT", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, runId: run.id, ...adoption } });
    return { ok: true as const, ...adoption };
  }, async (tx, item, session) => {
    const run = await selectedRun(tx, item, session);
    if (run.state !== "ADOPTED") return null;
    const adoption = observationAdoptionSchema.parse(run.adoption);
    if (input.expectedRevision !== run.baseRevision || JSON.stringify(chosen) !== JSON.stringify(adoption.chosen)) {
      throw new ActionError("该批次已按其他选择采用");
    }
    return { ok: true as const, ...adoption };
  });
}

export async function adoptMatterObservations(raw: z.input<typeof adoptMatterObservationsSchema>) {
  const { matterId, requestId, target, chosen } = adoptMatterObservationsSchema.parse(raw);
  const session = await requireSession("matters.write");
  const userId = session.user.id;
  await assertCanHandleMatter(session.user, matterId);
  await assertMatterWritable(matterId, { allowPrincipal: true });
  chosen.sort((a, b) => a.runId.localeCompare(b.runId) || a.index - b.index);
  const requestHash = createHash("sha256").update(JSON.stringify({ matterId, target, chosen })).digest("hex");

  const result = await transaction(async tx => {
    await mutationContext(tx, session, matterId);
    const previous = await tx.caseObservationAdoption.findUnique({ where: { id: requestId } });
    if (previous && (previous.authorId !== userId || previous.requestHash !== requestHash)) {
      throw new ActionError("同一保存标识已经用于另一组候选");
    }
    const runIds = [...new Set(chosen.map(pick => pick.runId))];
    const runs = await tx.evidenceObservationRun.findMany({
      where: { id: { in: runIds }, caseMatterId: matterId, authorId: userId, state: "READY" },
      select: { id: true, ranges: true, candidates: true },
    });
    if (runs.length !== runIds.length) throw new ActionError("部分待核批次不可用或不属于本案");
    const batches = new Map(runs.map(run => [run.id, {
      ranges: matterObservationRangesSchema.parse(run.ranges), candidates: observationCandidatesSchema.parse(run.candidates),
    }]));
    const picks = chosen.map(({ runId, index }) => {
      const { ranges, candidates } = batches.get(runId)!;
      const candidate = candidates[index];
      const range = candidate && ranges[candidate.fragment - 1];
      if (!range) throw new ActionError("所选候选不在此批次");
      return { runId, index, candidate, range };
    });
    const ranges = [...new Set(picks.map(pick => pick.range))];
    const documentIds = [...new Set(ranges.map(range => range.documentId))];
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Document" WHERE id IN (${Prisma.join(documentIds)}) ORDER BY id FOR SHARE`);
    const fragments = await loadFixedFragments(tx, { user: session.user, matter: { id: matterId } }, ranges);
    if (previous) {
      const item = await tx.evidenceItem.findUniqueOrThrow({ where: { id: previous.evidenceItemId }, include: itemInclude });
      await assertSourcesReadable(tx, item, userId);
      return { ok: true as const, id: previous.evidenceItemId, revision: previous.revision };
    }
    const used = await tx.caseObservationCandidateAdoption.count({
      where: { OR: chosen.map(({ runId, index }) => ({ runId, candidateIndex: index })) },
    });
    if (used) throw new ActionError("部分候选已被采用，请刷新分析记录后重新选择");

    const item = target.type === "existing" ? await tx.evidenceItem.findFirst({
      where: { id: target.evidenceItemId, matterId }, include: itemInclude,
    }) : null;
    if (target.type === "existing") {
      if (!item) throw new ActionError("要点不存在或不属于本案");
      if (item.revision !== target.expectedRevision) throw new ActionError("此要点已有新修订，请重新选择目标");
      await assertSourcesReadable(tx, item, userId);
      if (item.observationRevisionIds.length + picks.length > 200) throw new ActionError("采用后将超过该要点的 200 条记载上限");
    }
    const anchorKey = ({ parseRunId, anchorId }: { parseRunId: string | null; anchorId: string | null }) =>
      parseRunId && anchorId ? "ANCHOR:" + parseRunId + ":" + anchorId : null;
    const sources = new Map(item?.sources.map(source => [anchorKey(source), source.id]));
    const anchors = new Map(fragments.map(fragment => [anchorKey(fragment)!, fragment]));
    const newAnchors = [...anchors].filter(([key]) => !sources.has(key));
    if ((item?.sources.length ?? 0) + newAnchors.length > 50) throw new ActionError("单条要点最多关联 50 条来源");
    const baseRevision = item?.revision ?? 0;
    const id = target.type === "existing" ? item!.id : (await tx.evidenceItem.create({
      data: {
        matterId, createdById: userId, title: target.title, content: target.content, kind: target.kind,
        ...(target.chronologyCategory && { chronologyAssessment: { category: target.chronologyCategory } }),
        ...evidenceEventDateToRecord(target.eventDate ?? emptyEvidenceEventDate()),
      },
      select: { id: true },
    })).id;
    const revision = baseRevision + 1;
    for (const [locationKey, fragment] of newAnchors) {
      const { documentId, documentSha256, parseRunId, anchorId, sourceLocation } = fragment;
      const relation = "CONTEXT";
      const prior = item ? await tx.evidenceSourceLink.findUnique({ where: {
        evidenceItemId_documentId_relation_locationKey: { evidenceItemId: id, documentId, relation, locationKey },
      }, select: { id: true, documentSha256: true } }) : null;
      if (prior && prior.documentSha256 !== documentSha256) throw new ActionError("原来源身份已变化");
      const linked = prior ? await tx.evidenceSourceLink.update({
        where: { id: prior.id }, data: { removedAt: null, removedById: null }, select: { id: true },
      }) : await tx.evidenceSourceLink.create({
        data: { evidenceItemId: id, documentId, documentSha256, parseRunId, anchorId, relation, locationKey,
          location: sourceLocation, createdById: userId },
        select: { id: true },
      });
      sources.set(locationKey, linked.id);
    }
    await tx.caseObservationAdoption.create({
      data: { id: requestId, authorId: userId, evidenceItemId: id, requestHash, revision },
    });
    const observations = picks.map(pick => ({
      requestKey: randomUUID(), pick,
    }));
    const created = await tx.evidenceObservationRevision.createManyAndReturn({
      data: observations.map(({ requestKey, pick }) => ({
        sourceLinkId: sources.get(anchorKey(pick.range))!, seriesId: randomUUID(), revision: 1, requestKey,
        baseEvidenceRevision: baseRevision || 1, requestInput: pick.candidate.input, data: pick.candidate.data, createdById: userId,
      })),
      select: { id: true, requestKey: true },
    });
    const createdIds = new Map(created.map(row => [row.requestKey, row.id]));
    const links = observations.map(({ requestKey, pick }) => ({
      runId: pick.runId, candidateIndex: pick.index, adoptionId: requestId, observationId: createdIds.get(requestKey)!,
    }));
    await tx.caseObservationCandidateAdoption.createMany({ data: links });
    const observationRevisionIds = [...(item?.observationRevisionIds ?? []), ...links.map(link => link.observationId)];
    if (item) await snapshotAndAdvance(tx, item, userId, { observationRevisionIds });
    else await tx.evidenceItem.update({ where: { id }, data: { observationRevisionIds } });
    await auditTx(tx, { userId, action: "EVIDENCE_AI_ADOPT", targetType: "EvidenceItem", targetId: id,
      detail: { matterId, requestId, revision, candidateCount: links.length, created: !item } });
    return { ok: true as const, id, revision };
  });
  await revalidateMatter(matterId);
  return result;
}

export async function removeEvidenceSource(input: z.infer<typeof revisionInputSchema> & { sourceId: string }) {
  const data = revisionInputSchema.extend({ sourceId: z.string().cuid() }).parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    const source = await tx.evidenceSourceLink.findUnique({ where: { id: data.sourceId } });
    if (!source || source.evidenceItemId !== item.id) throw new ActionError("来源关系不存在");
    if (source.removedAt) return { ok: true as const, revision: item.revision };
    const removed = item.observationRevisionIds.length ? await tx.evidenceObservationRevision.findMany({
      where: { sourceLinkId: source.id, id: { in: item.observationRevisionIds } }, select: { id: true },
    }) : [];
    const removedIds = new Set(removed.map(row => row.id));
    const revision = await snapshotAndAdvance(tx, item, session.user.id,
      removed.length ? { observationRevisionIds: item.observationRevisionIds.filter(id => !removedIds.has(id)) } : {});
    await tx.evidenceSourceLink.update({ where: { id: source.id }, data: { removedById: session.user.id, removedAt: new Date() } });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_SOURCE_REMOVE", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision, sourceId: source.id } });
    return { ok: true as const, revision };
  });
}

export async function exportChronology(matterId: string, raw: z.input<typeof chronologyExportInput>) {
  const session = await requireSession("matters.export");
  const id = z.cuid().parse(matterId);
  const input = chronologyExportInput.parse(raw);
  await assertCanReadMatter(session.user.id, session.user.role, id, session.user.rolePermissions);
  const rows = input.items.length ? await prisma.evidenceItem.findMany({
    where: { matterId: id, id: { in: input.items.map(row => row.id) } }, include: itemInclude,
  }) : [];
  const { items } = await itemViews(rows, session, id);
  const byId = new Map(items.map(item => [item.id, item]));
  const selected = input.items.map(row => {
    const item = byId.get(row.id);
    if (!item || item.restricted || item.revision !== row.revision) {
      throw new ActionError("部分事实版本或权限已变化，请重新确认导出范围");
    }
    return item;
  });
  await auditStrict({ userId: session.user.id, action: "EVIDENCE_CHRONOLOGY_EXPORT", targetType: "Matter", targetId: id,
    detail: { kind: input.kind, items: input.items } });
  const label = (item: EvidenceItemView) => {
    const date = item.observations.find(o => o.id === item.chronologyAssessment?.dateObservationId)?.data.date;
    return date?.text ?? item.eventDate?.text ?? item.eventDate?.start ?? item.observations.find(o => o.data.date)?.data.date?.text ?? "未载明";
  };
  const sourceText = (item: EvidenceItemView) => item.sources.map(source =>
    source.documentName + " V" + source.documentVersion + " " + (source.locationLabel ?? "原件")).join(" / ");
  if (input.kind === "narrative") {
    const data = selected.map(item => label(item) + "  " + item.title + "\n" + item.content + "\n" + sourceText(item));
    return { mime: "text/plain; charset=utf-8", suffix: "txt", text: data.join("\n\n") };
  }
  const csv = (value: string) => '"' + (/^[\p{White_Space}]*[=+@\-]/u.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
  const lines = [["日期", "事项", "性质", "内容", "固定出处", "核对状态"], ...selected.map(item =>
    [label(item), item.title, item.kind === "CLAIM" ? "当事人主张" : item.kind === "FACT" ? "事实" : "案情要点",
      item.content, sourceText(item), item.confirmedAt ? "已核对" : "待核对"]
  )];
  return { mime: "text/csv; charset=utf-8", suffix: "csv", text: "\uFEFF" + lines.map(row => row.map(csv).join(",")).join("\r\n") };
}

async function readItem(evidenceItemId: string) {
  const session = await requireSession("matters.read");
  const id = z.string().cuid().parse(evidenceItemId);
  const item = await prisma.evidenceItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) throw new ActionError("证据要点不存在");
  await assertCanReadMatter(session.user.id, session.user.role, item.matterId, session.user.rolePermissions);
  return { session, item };
}

async function canEditMatter(session: Session, matterId: string) {
  if (!hasCustomPermission(session.user, "matters.write")) return false;
  return Boolean(await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null, status: { not: "ARCHIVED" },
      ...(session.user.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) }, select: { id: true },
  }));
}

async function observationReader(ids: readonly string[]) {
  const rows = ids.length ? await prisma.evidenceObservationRevision.findMany({ where: { id: { in: [...new Set(ids)] } },
    select: { id: true, sourceLinkId: true, revision: true, data: true } }) : [];
  const rowsById = new Map(rows.map(row => [row.id, row]));
  return (selected: readonly string[], sources: EvidenceSourceView[], restricted: boolean): EvidenceObservationView[] => {
    if (restricted || !selected.length) return [];
    const readable = new Set(sources.filter(source => source.status === "AVAILABLE").map(source => source.id));
    return selected.flatMap(id => {
      const row = rowsById.get(id);
      return row && readable.has(row.sourceLinkId)
        ? [{ id, sourceId: row.sourceLinkId, revision: row.revision, data: observationDataSchema.parse(row.data) }] : [];
    });
  };
}

function visibleChronologyAssessment(raw: Prisma.JsonValue, sources: EvidenceSourceView[], restricted: boolean) {
  if (restricted) return null;
  const assessment = chronologyAssessmentSchema.parse(raw);
  if (assessment.directions?.length) {
    const allowed = new Set(sources.filter(source => source.status === "AVAILABLE").map(source => source.id));
    assessment.directions = assessment.directions.filter(direction => allowed.has(direction.sourceId));
  }
  return assessment;
}

async function itemViews(items: Item[], session: Session, matterId: string) {
  const references = items.map(sourceReferences);
  const [reader, canEdit, observationsFor] = await Promise.all([
    sourceReader(session.user.id, matterId, references.flat()), canEditMatter(session, matterId),
    observationReader(items.flatMap(item => item.observationRevisionIds)),
  ]);
  const projected: EvidenceItemView[] = items.map((item, index) => {
    const sources = references[index].map(reader.view);
    const restricted = sources.some(source => source.status !== "AVAILABLE");
    const legacy = sources.find(source => source.legacy && source.status === "AVAILABLE");
    return {
      id: item.id, matterId: item.matterId, title: restricted ? "来源不可用的要点" : item.title, content: restricted ? "" : item.content,
      kind: item.kind, sourceDocumentId: legacy?.documentId ?? null, sourceDocumentName: legacy?.documentName ?? null,
      sourcePage: legacy ? item.sourcePage : null, revision: item.revision, updatedAt: item.updatedAt,
      confirmedAt: item.confirmedAt, confirmedByName: item.confirmedBy?.name ?? null,
      createdById: item.createdById, createdByName: item.createdBy?.name ?? null, createdAt: item.createdAt, sources, restricted, canEdit: canEdit && !restricted,
      chronologyAssessment: visibleChronologyAssessment(item.chronologyAssessment, sources, restricted),
      eventDate: restricted ? null : evidenceEventDateFromRecord(item), observations: observationsFor(item.observationRevisionIds, sources, restricted),
    };
  });
  return { items: projected, canWrite: canEdit };
}

export async function getEvidenceFormOptions(matterId: string) {
  const session = await requireSession("matters.read");
  const id = z.string().cuid().parse(matterId);
  await assertCanReadMatter(session.user.id, session.user.role, id, session.user.rolePermissions);
  const canWrite = await canEditMatter(session, id);
  return { canWrite, documents: canWrite ? await readableDocumentOptions(session.user.id, id) : [] };
}

export async function getEvidenceWorkspace(matterId: string, limit?: number, includeTimelineGrades = false) {
  const session = await requireSession("matters.read");
  const id = z.string().cuid().parse(matterId);
  await assertCanReadMatter(session.user.id, session.user.role, id, session.user.rolePermissions);
  const [rows, grades] = await Promise.all([
    prisma.evidenceItem.findMany({ where: { matterId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: itemInclude,
      take: z.number().int().min(1).max(50).optional().parse(limit) }),
    includeTimelineGrades ? timelineGrades(session.user.id, id, true) : undefined,
  ]);
  const workspace = await itemViews(rows, session, id);
  return grades ? { ...workspace, items: workspace.items.map(item => ({
    ...item, level: item.restricted ? null : grades.get(timelineEventKey("fact", item.id)) ?? null,
  })) } : workspace;
}

export async function listEvidenceItems(matterId: string, limit?: number): Promise<EvidenceItemView[]> {
  return (await getEvidenceWorkspace(matterId, limit)).items;
}

export async function getEvidenceItem(evidenceItemId: string) {
  const { session, item } = await readItem(evidenceItemId);
  const { items: [view] } = await itemViews([item], session, item.matterId);
  const documents = view.canEdit ? await readableDocumentOptions(session.user.id, item.matterId) : [];
  return { item: view, documents };
}

const chronologyLogLabels = {
  EVIDENCE_ITEM_CREATE: "记录要点",
  EVIDENCE_ITEM_EDIT: "修订要点",
  EVIDENCE_ITEM_CONFIRM: "标为已核对",
  EVIDENCE_SOURCE_ADD: "关联固定来源",
  EVIDENCE_SOURCE_REMOVE: "撤回来源关系",
  EVIDENCE_OBSERVATION_RECORD: "保存来源记载",
  EVIDENCE_AI_ADOPT: "采用 AI 候选",
  EVIDENCE_CHRONOLOGY_SPLIT_FROM: "从原事实拆分保留固定出处",
  TIMELINE_GRADE_SET: "调整重要等级",
  EVIDENCE_CHRONOLOGY_ASSESSMENT: "更新核对标记",
} as const;

export async function listChronologyChanges(evidenceItemId: string) {
  const { session, item } = await readItem(evidenceItemId);
  const references = sourceReferences(item);
  const reader = await sourceReader(session.user.id, item.matterId, references);
  if (references.some(reference => !reader.documentFor(reference))) return { items: [] };
  const rows = await prisma.auditLog.findMany({
    where: { targetId: item.id, OR: [
      { targetType: "EvidenceItem", action: { in: Object.keys(chronologyLogLabels).filter(action => action !== "TIMELINE_GRADE_SET") } },
      { targetType: "MatterTimelineEvent", action: "TIMELINE_GRADE_SET", userId: session.user.id },
    ] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
    select: { id: true, action: true, createdAt: true, detail: true, user: { select: { name: true } } },
  });
  return { items: rows.map(row => {
    let label: string = chronologyLogLabels[row.action as keyof typeof chronologyLogLabels];
    if (row.action === "EVIDENCE_CHRONOLOGY_ASSESSMENT" && row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)) {
      const change = chronologyChangeSchema.safeParse(row.detail.change);
      if (change.success) {
        const entry = change.data;
        switch (entry.kind) {
          case "reviewed": label = entry.value ? "标为已核对" : "改回待核对"; break;
          case "category": label = entry.value ? "分类改为 " + chronologyCategories[entry.value] : "恢复建议分类"; break;
          case "dispute": label = "争议改为 " + chronologyDisputes[entry.value]; break;
          case "adverse": label = entry.value ? "标为不利 · 仅内部" : "取消不利标记"; break;
          case "date": label = entry.value ? "采用记载日期" : "撤销采用日期"; break;
          case "amount": label = entry.value ? "采用记载金额" : "撤销采用金额"; break;
          case "sourceStage": label = "材料出现时点改为 " + (entry.value ? chronologyStages[entry.value] : "未登记"); break;
          case "addDirection": label = "新增材料指向"; break;
          case "removeDirection": label = "移除材料指向"; break;
          case "split": label = "将记载拆为独立事件"; break;
          case "nature": label = entry.value === "planned" ? "标为约定" : entry.value === "estimated" ? "标为推定" :
            entry.value === "occurred" ? "标为已发生" : "清除事件性质标记"; break;
        }
      }
    }
    return { id: row.id, label, actor: row.user?.name ?? null, time: row.createdAt };
  }) };
}

export async function listEvidenceRevisions(input: { evidenceItemId: string; beforeRevision?: number }) {
  const data = z.object({ evidenceItemId: z.string().cuid(), beforeRevision: z.number().int().positive().optional() }).parse(input);
  const { session, item } = await readItem(data.evidenceItemId);
  const rows = await prisma.evidenceItemRevision.findMany({
    where: { evidenceItemId: item.id, revision: { lt: data.beforeRevision ?? item.revision } }, orderBy: { revision: "desc" }, take: 21,
    include: { editedBy: { select: { name: true } } },
  });
  const page = rows.slice(0, 20);
  const snapshots = page.map(row => readSourceSnapshot(row.sourceSnapshot));
  const [reader, observationsFor] = await Promise.all([
    sourceReader(session.user.id, item.matterId, snapshots.flatMap(snapshot => snapshot ?? [])),
    observationReader(page.flatMap(row => row.observationRevisionIds)),
  ]);
  const confirmerIds = [...new Set(page.map(row => row.confirmedById).filter((id): id is string => Boolean(id)))];
  const names = new Map((confirmerIds.length ? await prisma.user.findMany({ where: { id: { in: confirmerIds } }, select: { id: true, name: true } }) : []).map(user => [user.id, user.name]));
  const items: EvidenceRevisionView[] = page.map((row, index) => {
    const snapshot = snapshots[index];
    const sources = snapshot?.map(reader.view) ?? [];
    const restricted = snapshot === null || sources.some(source => source.status !== "AVAILABLE");
    return { revision: row.revision, title: restricted ? "来源不可用的历史修订" : row.title, content: restricted ? "" : row.content,
      kind: row.kind, createdAt: row.createdAt, editedByName: row.editedBy?.name ?? null,
      confirmedAt: row.confirmedAt, confirmedByName: row.confirmedById ? names.get(row.confirmedById) ?? null : null, sources, restricted,
      chronologyAssessment: visibleChronologyAssessment(row.chronologyAssessment, sources, restricted),
      eventDate: restricted ? null : evidenceEventDateFromRecord(row), observations: observationsFor(row.observationRevisionIds, sources, restricted) };
  });
  return { items, nextBeforeRevision: rows.length > 20 ? page.at(-1)!.revision : null };
}

export async function resolveEvidenceSource(input: { evidenceItemId: string; sourceId: string; revision?: number }) {
  const data = z.object({ evidenceItemId: z.string().cuid(), sourceId: z.string().min(1).max(600), revision: z.number().int().positive().optional() }).parse(input);
  const { session, item } = await readItem(data.evidenceItemId);
  let references: SourceReference[];
  if (data.revision !== undefined && data.revision !== item.revision) {
    const history = await prisma.evidenceItemRevision.findUnique({ where: { evidenceItemId_revision: { evidenceItemId: item.id, revision: data.revision } }, select: { sourceSnapshot: true } });
    references = history ? readSourceSnapshot(history.sourceSnapshot) ?? [] : [];
  } else references = sourceReferences(item);
  const reference = references.find(source => source.id === data.sourceId);
  if (!reference) return { status: "UNAVAILABLE" as const };
  const result = await resolveReference(session.user.id, item.matterId, reference);
  if (result.status === "AVAILABLE") await auditStrict({ userId: session.user.id, action: "EVIDENCE_SOURCE_OPEN", targetType: "EvidenceItem", targetId: item.id,
    detail: { matterId: item.matterId, revision: data.revision ?? item.revision, sourceId: reference.id, documentId: reference.documentId } });
  return result;
}
