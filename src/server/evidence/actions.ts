"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx, auditStrict } from "@/server/audit";
import { assertCanReadMatter, assertCanHandleMatter, matterAssociationFilter } from "@/lib/permissions";
import { assertMatterWritable } from "@/lib/archive/guard";
import { checkRoleMutation } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { ActionError } from "@/lib/action-error";
import { revalidateMatter } from "@/server/matters/route";
import { emptyEvidenceEventDate, evidenceEventDateFromRecord, evidenceEventDateToRecord, evidenceEventDatesEqual } from "@/lib/evidence/event-date";
import {
  evidenceTextSchema, revisionInputSchema, sourceInputSchema, sourceRelationSchema,
  type EvidenceItemView, type EvidenceRevisionView, type SourceReference,
} from "./contracts";
import { prepareSource, readSourceSnapshot, readableDocumentOptions, resolveReference, sourceReader, sourceReferences } from "./source-links";

export type { EvidenceItemView } from "./contracts";
type Session = Awaited<ReturnType<typeof requireSession>>;
const itemInclude = {
  sources: { where: { removedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  createdBy: { select: { name: true } }, confirmedBy: { select: { name: true } },
} satisfies Prisma.EvidenceItemInclude;
type Item = Prisma.EvidenceItemGetPayload<{ include: typeof itemInclude }>;

const createSchema = evidenceTextSchema.extend({
  matterId: z.string().cuid(), sourceDocumentId: z.string().cuid().optional().nullable(),
  sourcePage: z.number().int().min(1).max(10000).optional().nullable(),
  sourceRelation: sourceRelationSchema.default("CONTEXT"),
}).superRefine((value, context) => {
  if (value.sourcePage != null && !value.sourceDocumentId) context.addIssue({ code: "custom", path: ["sourcePage"], message: "填写页码须先选择来源材料" });
});
export type CreateEvidenceItemInput = z.input<typeof createSchema>;

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

async function changeItem<T>(input: z.infer<typeof revisionInputSchema>, work: (tx: Prisma.TransactionClient, item: Item, session: Session) => Promise<T>) {
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
    sourceSnapshot: sourceReferences(item) as Prisma.InputJsonValue,
    confirmedById: item.confirmedById, confirmedAt: item.confirmedAt, editedById: userId,
    eventDatePrecision: item.eventDatePrecision, eventDateStart: item.eventDateStart,
    eventDateEnd: item.eventDateEnd, eventDateText: item.eventDateText,
  } });
  const changed = await tx.evidenceItem.updateMany({
    where: { id: item.id, revision: item.revision },
    data: { ...change, revision: { increment: 1 }, confirmedById: null, confirmedAt: null },
  });
  if (changed.count !== 1) throw new ActionError("证据要点已有新修订，请刷新后重试");
  return item.revision + 1;
}

export async function createEvidenceItem(input: CreateEvidenceItemInput) {
  const session = await requireSession("matters.write");
  const data = createSchema.parse(input);
  await assertCanHandleMatter(session.user, data.matterId);
  await assertMatterWritable(data.matterId, { allowPrincipal: true });
  const created = await transaction(async tx => {
    await mutationContext(tx, session, data.matterId);
    const source = data.sourceDocumentId ? await prepareSource(session.user.id, data.matterId, {
      documentId: data.sourceDocumentId, page: data.sourcePage, relation: data.sourceRelation,
    }, tx) : null;
    const item = await tx.evidenceItem.create({ data: {
      matterId: data.matterId, title: data.title, content: data.content, kind: data.kind, createdById: session.user.id,
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

export async function removeEvidenceSource(input: z.infer<typeof revisionInputSchema> & { sourceId: string }) {
  const data = revisionInputSchema.extend({ sourceId: z.string().cuid() }).parse(input);
  return changeItem(data, async (tx, item, session) => {
    await assertSourcesReadable(tx, item, session.user.id);
    const source = await tx.evidenceSourceLink.findUnique({ where: { id: data.sourceId } });
    if (!source || source.evidenceItemId !== item.id) throw new ActionError("来源关系不存在");
    if (source.removedAt) return { ok: true as const, revision: item.revision };
    const revision = await snapshotAndAdvance(tx, item, session.user.id);
    await tx.evidenceSourceLink.update({ where: { id: source.id }, data: { removedById: session.user.id, removedAt: new Date() } });
    await auditTx(tx, { userId: session.user.id, action: "EVIDENCE_SOURCE_REMOVE", targetType: "EvidenceItem", targetId: item.id,
      detail: { matterId: item.matterId, revision, sourceId: source.id } });
    return { ok: true as const, revision };
  });
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

async function itemViews(items: Item[], session: Session, matterId: string): Promise<EvidenceItemView[]> {
  const references = items.map(sourceReferences);
  const [reader, canEdit] = await Promise.all([
    sourceReader(session.user.id, matterId, references.flat()), canEditMatter(session, matterId),
  ]);
  return items.map((item, index) => {
    const sources = references[index].map(reader.view);
    const restricted = sources.some(source => source.status !== "AVAILABLE");
    const legacy = sources.find(source => source.legacy && source.status === "AVAILABLE");
    return {
      id: item.id, matterId: item.matterId, title: restricted ? "来源不可用的要点" : item.title, content: restricted ? "" : item.content,
      kind: item.kind, sourceDocumentId: legacy?.documentId ?? null, sourceDocumentName: legacy?.documentName ?? null,
      sourcePage: legacy ? item.sourcePage : null, revision: item.revision, updatedAt: item.updatedAt,
      confirmedAt: item.confirmedAt, confirmedByName: item.confirmedBy?.name ?? null,
      createdById: item.createdById, createdByName: item.createdBy?.name ?? null, createdAt: item.createdAt, sources, restricted, canEdit: canEdit && !restricted,
      eventDate: restricted ? null : evidenceEventDateFromRecord(item),
    };
  });
}

export async function listEvidenceItems(matterId: string): Promise<EvidenceItemView[]> {
  const session = await requireSession("matters.read");
  const id = z.string().cuid().parse(matterId);
  await assertCanReadMatter(session.user.id, session.user.role, id, session.user.rolePermissions);
  const rows = await prisma.evidenceItem.findMany({ where: { matterId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: itemInclude });
  return itemViews(rows, session, id);
}

export async function getEvidenceItem(evidenceItemId: string) {
  const { session, item } = await readItem(evidenceItemId);
  const [view] = await itemViews([item], session, item.matterId);
  const documents = view.canEdit ? await readableDocumentOptions(session.user.id, item.matterId) : [];
  return { item: view, documents };
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
  const reader = await sourceReader(session.user.id, item.matterId, snapshots.flatMap(snapshot => snapshot ?? []));
  const confirmerIds = [...new Set(page.map(row => row.confirmedById).filter((id): id is string => Boolean(id)))];
  const names = new Map((confirmerIds.length ? await prisma.user.findMany({ where: { id: { in: confirmerIds } }, select: { id: true, name: true } }) : []).map(user => [user.id, user.name]));
  const items: EvidenceRevisionView[] = page.map((row, index) => {
    const snapshot = snapshots[index];
    const sources = snapshot?.map(reader.view) ?? [];
    const restricted = snapshot === null || sources.some(source => source.status !== "AVAILABLE");
    return { revision: row.revision, title: restricted ? "来源不可用的历史修订" : row.title, content: restricted ? "" : row.content,
      kind: row.kind, createdAt: row.createdAt, editedByName: row.editedBy?.name ?? null,
      confirmedAt: row.confirmedAt, confirmedByName: row.confirmedById ? names.get(row.confirmedById) ?? null : null, sources, restricted,
      eventDate: restricted ? null : evidenceEventDateFromRecord(row) };
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
