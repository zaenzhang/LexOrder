import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { canReadDocument, documentReadGrant, type DocumentReadPurpose } from "@/lib/approvals/documents";
import { documentDerivationReadable } from "@/server/documents/derivation-access";
import { assertContextInputSelections, readOptionContextInputs } from "./context-inputs";
import { matterAssociationFilter, matterFinanceVisibilityFilter, matterReadVisibilityFilter, customMatterFilter } from "@/lib/permissions";
import { hasCustomPermission, type RoleUser } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { clientRelationshipFilter } from "@/server/clients/relationship-access";
import { auditTx } from "@/server/audit";
import { buildContextSourceChoices } from "@/lib/matters/context-source-labels";
import { contextPageBoundary, decodeContextCursor, encodeContextCursor } from "./context-cursor";
import {
  contextRecordSchema, contextConfirmSchema, contextKindLabels, contextCursorSchema, contextSourcePageSchema,
  type ContextRecordInput, type ContextConfirmInput, type ContextRecordView, type MatterContextView,
  type ContextSourceView, type ContextSourceContent, type ContextSourceOptions, type ContextSourcePageInput, type ContextHistoryView
} from "@/lib/matters/context";

export type ContextActor = RoleUser & { id: string };
const recordInclude = { author: { select: { name: true } }, confirmedBy: { select: { name: true } }, supersededBy: { select: { id: true } } } satisfies Prisma.MatterContextRecordInclude;
type ContextRow = Prisma.MatterContextRecordGetPayload<{ include: typeof recordInclude }>;
type SourceIds = Pick<ContextRow, "sourceNoteId" | "sourceClientActivityId" | "sourceDocumentId">;

/** Internal service, never a client-callable actor/permission endpoint. */
export async function contextAccess(tx: Prisma.TransactionClient, actor: ContextActor, matterId: string, write = false) {
  if (write) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  const identity = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
  if (!identity?.active || (write && identity.role !== actor.role)) throw new ActionError("账号或岗位已变化，请重新登录");
  const role = await resolveRoleUser(actor.id, identity.role, tx);
  if (!role.enabled || !hasCustomPermission(role, "matters.read")) throw new ActionError("无权读取事项上下文");
  const runtimeMode = role.runtimeMode ?? "SERVER";
  if (actor.runtimeMode !== undefined && actor.runtimeMode !== runtimeMode) throw new ActionError("当前操作者与工作区不一致");
  const user = { ...role, id: actor.id, runtimeMode };
  if (write) await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${matterId} FOR UPDATE`;
  const where = { id: matterId, deletedAt: null };
  const visible = await tx.matter.count({ where: { ...where, AND: [matterReadVisibilityFilter(user.id, user.role, user.rolePermissions)] } });
  const borrowed = !visible && await tx.archiveBorrowRequest.count({ where: {
    applicantId: user.id, status: "APPROVED", accessUntil: { gte: new Date() }, archiveRecord: { status: "APPROVED", matterId }
  } });
  if (!visible && !borrowed) throw new ActionError("事项不存在或无权读取");
  const matter = await tx.matter.findFirst({ where, select: {
    id: true, internalCode: true, status: true, serviceScope: true, deliverables: true, primaryClientId: true,
    clientLinks: { select: { clientId: true } }, intake: { select: { clientId: true } }
  } });
  if (!matter) throw new ActionError("事项不存在或无权读取");
  const [associated, lead, finance, schedule] = await Promise.all([
    tx.matter.count({ where: { ...where, ...(user.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(user.id)) } }),
    tx.matter.count({ where: { ...where, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id, role: { in: ["LEAD", "CO_LEAD"] } } } }] } }),
    hasCustomPermission(user, "finance.read") ? tx.matter.count({ where: { ...where, AND: [matterFinanceVisibilityFilter(user.id, user.role, user.rolePermissions)] } }) : 0,
    hasCustomPermission(user, "schedule.read") ? tx.matter.count({ where: { ...where, AND: [user.role === "CUSTOM"
      ? customMatterFilter(user.id, user.rolePermissions, "schedule.read", true) : matterReadVisibilityFilter(user.id, user.role, user.rolePermissions)] } }) : 0
  ]);
  const canWrite = Boolean(associated && visible && matter.status !== "ARCHIVED" && hasCustomPermission(user, "matters.write"));
  if (write && !canWrite) throw new ActionError(matter.status === "ARCHIVED" ? "事项已归档，不能修改上下文" : "无权维护事项上下文");
  return {
    user, matter, canWrite, canConfirm: canWrite && lead > 0, canReadFinance: finance > 0, canReadSchedule: schedule > 0,
    clientIds: [...new Set([matter.primaryClientId, matter.intake?.clientId, ...matter.clientLinks.map(row => row.clientId)].filter((id): id is string => Boolean(id)))]
  };
}
export type ContextAccess = Awaited<ReturnType<typeof contextAccess>>;

export function contextClientFilter(access: ContextAccess): Prisma.ClientWhereInput {
  return { id: { in: access.clientIds }, deletedAt: null, AND: [clientRelationshipFilter(access.user, "read")] };
}
function recordWhere(access: ContextAccess): Prisma.MatterContextRecordWhereInput {
  return { matterId: access.matter.id, ...(access.canReadFinance ? {} : { visibility: "MATTER" as const }) };
}

export async function sourceView(tx: Prisma.TransactionClient, access: ContextAccess, source: SourceIds,
  visitedDocuments: ReadonlySet<string> = new Set(), purpose: DocumentReadPurpose = "READ"): Promise<ContextSourceView | null> {
  if (source.sourceDocumentId) {
    const doc = await tx.document.findFirst({ where: { id: source.sourceDocumentId, matterId: access.matter.id, deletedAt: null },
      select: { id: true, name: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true } });
    const grant = doc && await documentReadGrant(access.user.id, doc, tx, purpose);
    const available = Boolean(doc && grant && await documentDerivationReadable(access.user.id, doc, grant, tx, purpose, visitedDocuments));
    return { type: "DOCUMENT", id: available ? doc!.id : null, label: available ? doc!.name : null, available };
  }
  if (source.sourceNoteId) {
    const note = access.canReadSchedule ? await tx.note.findFirst({ where: { id: source.sourceNoteId, matterId: access.matter.id, deletedAt: null }, select: { id: true } }) : null;
    return { type: "NOTE", id: note?.id ?? null, label: note ? "事项沟通记录" : null, available: Boolean(note) };
  }
  if (source.sourceClientActivityId) {
    const activity = hasCustomPermission(access.user, "clients.read") ? await tx.clientActivity.findFirst({
      where: { id: source.sourceClientActivityId, client: contextClientFilter(access) }, select: { id: true }
    }) : null;
    return { type: "CLIENT_ACTIVITY", id: activity?.id ?? null, label: activity ? "客户沟通记录" : null, available: Boolean(activity) };
  }
  return null;
}

async function assertSources(tx: Prisma.TransactionClient, access: ContextAccess, source: SourceIds) {
  const result = await sourceView(tx, access, source);
  if (result && !result.available) throw new ActionError("来源不存在或已无权读取，请刷新并重新选择");
}

async function present(tx: Prisma.TransactionClient, access: ContextAccess, row: ContextRow): Promise<ContextRecordView> {
  const source = await sourceView(tx, access, row);
  const contextInputs = row.kind === "OPTION" ? await readOptionContextInputs(tx, access, row.id) : undefined;
  const readable = (!source || source.available) && !contextInputs?.unavailable;
  const current = !row.supersededBy;
  return {
    id: row.id, seriesId: row.seriesId, version: row.version, kind: row.kind, visibility: row.visibility, contextInputs,
    // The record may quote the source; hiding only the source link would still disclose it.
    content: readable ? row.content : null, reason: readable ? row.reason : null,
    sourceDescription: readable ? row.sourceDescription : null, source, readable,
    occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), authorName: row.author.name,
    confirmationStatus: row.confirmationStatus, confirmedByName: row.confirmedBy?.name ?? null, confirmedAt: row.confirmedAt?.toISOString() ?? null,
    canRevise: access.canWrite && current && readable,
    canConfirm: access.canConfirm && current && readable && row.confirmationStatus === "PENDING"
  };
}

export async function contextViewInTransaction(tx: Prisma.TransactionClient, access: ContextAccess, cursor?: string): Promise<MatterContextView> {
  const point = decodeContextCursor(cursor, access.matter.id, access.user.id, "records");
  const rows = await tx.matterContextRecord.findMany({ where: { ...recordWhere(access), supersededBy: { is: null }, ...contextPageBoundary("createdAt", point) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, include: recordInclude });
  const shown = rows.slice(0, 100), last = shown.at(-1), hasMore = rows.length > 100;
  return { canWrite: access.canWrite, canReadFinance: access.canReadFinance, canConfirm: access.canConfirm,
    records: await Promise.all(shown.map(row => present(tx, access, row))), hasMore,
    nextCursor: hasMore && last ? encodeContextCursor(access.matter.id, access.user.id, "records", { at: last.createdAt.toISOString(), id: last.id }) : null };
}

/** Internal read projection for client history; callers obtain current contextAccess first. */
export async function readContextRecordsForHistory(
  tx: Prisma.TransactionClient,
  access: ContextAccess,
  recordIds: readonly string[],
): Promise<ContextRecordView[]> {
  if (recordIds.length > 200) throw new ActionError("本页记录过多，请刷新后重试");
  if (recordIds.length === 0) return [];
  // IDs are positions only. Matter, finance and original-source permission remain authoritative.
  const rows = await tx.matterContextRecord.findMany({
    where: { ...recordWhere(access), id: { in: [...new Set(recordIds)] } },
    include: recordInclude,
  });
  const views = await Promise.all(rows.map(row => present(tx, access, row)));
  return views.filter(row => row.readable);
}

export async function readMatterContext(db: PrismaClient, actor: ContextActor, matterId: string, cursor?: string): Promise<MatterContextView> {
  const position = contextCursorSchema.optional().parse(cursor);
  return db.$transaction(async tx => contextViewInTransaction(tx, await contextAccess(tx, actor, matterId), position), { timeout: 20_000 });
}

/** An explicit history link opens this revision, including one outside the current list. */
export async function readMatterContextRecord(db: PrismaClient, actor: ContextActor, matterId: string, recordId: string): Promise<ContextRecordView> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const [record] = await readContextRecordsForHistory(tx, access, [recordId]);
    if (!record) throw new ActionError("这条记录不存在或已无权读取，请返回客户动态重新核对");
    return record;
  }, { timeout: 20_000 });
}

export async function saveMatterContext(db: PrismaClient, actor: ContextActor, input: ContextRecordInput) {
  const parsed = contextRecordSchema.parse(input);
  if (new Date(parsed.occurredAt).getTime() > Date.now() + 300_000) throw new ActionError("发生时间不能晚于当前时间；未来安排请记在内容中");
  const data = { matterId: parsed.matterId, requestKey: parsed.requestKey, kind: parsed.kind, visibility: parsed.visibility,
    content: parsed.content, occurredAt: new Date(parsed.occurredAt).toISOString(), reason: parsed.reason || null,
    sourceDescription: parsed.sourceDescription, supersedesId: parsed.supersedesId ?? null,
    sourceNoteId: parsed.sourceNoteId ?? null, sourceClientActivityId: parsed.sourceClientActivityId ?? null,
    sourceDocumentId: parsed.sourceDocumentId ?? null };
  const requestHash = createHash("sha256").update(JSON.stringify({ ...data, contextInputs: parsed.contextInputs })).digest("hex");
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, data.matterId, true);
    if (data.visibility === "FINANCE" && !access.canReadFinance) throw new ActionError("无权维护此事项的费用约束");
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`matter-context:${actor.id}:${data.requestKey}`}, 0))`;
    const priorRequest = await tx.matterContextRecord.findUnique({ where: { authorId_requestKey: { authorId: actor.id, requestKey: data.requestKey } } });
    if (priorRequest) {
      if (priorRequest.requestHash !== requestHash) throw new ActionError("此提交已经保存且内容发生变化，请重新打开记录表单");
      await assertSources(tx, access, priorRequest);
      await assertContextInputSelections(tx, actor.id, data.matterId, parsed.contextInputs, false);
      return { ok: true as const, id: priorRequest.id, version: priorRequest.version, replayed: true };
    }
    let seriesId: string = randomUUID();
    let version = 1;
    if (data.supersedesId) {
      const previous = await tx.matterContextRecord.findFirst({ where: { id: data.supersedesId, ...recordWhere(access) }, include: recordInclude });
      if (!previous) throw new ActionError("原记录不存在或无权更正");
      if (previous.supersededBy) throw new ActionError("记录已被更新，请刷新后根据最新版本更正");
      if (previous.kind !== data.kind || previous.visibility !== data.visibility) throw new ActionError("更正不能改变记录类型或可见范围");
      await assertSources(tx, access, previous);
      if (previous.kind === "OPTION" && (await readOptionContextInputs(tx, access, previous.id)).unavailable) throw new ActionError("原方案采用的目标或指示已无权读取，不能更正");
      if (previous.kind === "OPTION" && input.contextInputs === undefined && await tx.optionContextInput.count({ where: { optionRecordId: previous.id } })) {
        throw new ActionError("请明确沿用或调整原方案采用的目标和指示，再保存新修订");
      }
      seriesId = previous.seriesId;
      version = previous.version + 1;
    }
    await assertSources(tx, access, data);
    const adopted = await assertContextInputSelections(tx, actor.id, data.matterId, parsed.contextInputs);
    const row = await tx.matterContextRecord.create({ data: {
      ...data, occurredAt: new Date(data.occurredAt), authorId: actor.id, requestHash, seriesId, version
    }, select: { id: true } });
    if (adopted.length) await tx.optionContextInput.createMany({ data: adopted.map(input => ({ optionRecordId: row.id, ...input })) });
    await auditTx(tx, { userId: actor.id, action: data.supersedesId ? "MATTER_CONTEXT_REVISE" : "MATTER_CONTEXT_CREATE",
      targetType: "MatterContextRecord", targetId: row.id, detail: { matterId: data.matterId, kind: data.kind, version, visibility: data.visibility, supersedesId: data.supersedesId } });
    // Timeline is broadly readable: never copy content, source titles, reasons or amounts.
    if (data.visibility === "MATTER") await tx.timelineEvent.create({ data: {
      matterId: data.matterId, eventType: "MATTER_CONTEXT_RECORDED", title: `${data.supersedesId ? "更正" : "记录"}${contextKindLabels[data.kind]}`,
      occurredAt: new Date(), refType: "MatterContextRecord", refId: row.id
    } });
    return { ok: true as const, id: row.id, version, replayed: false };
  }, { timeout: 20_000 });
}

export async function confirmMatterContext(db: PrismaClient, actor: ContextActor, input: ContextConfirmInput) {
  const data = contextConfirmSchema.parse(input);
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, data.matterId, true);
    if (!access.canConfirm) throw new ActionError("仅事项主办或协办可以核对确认");
    const row = await tx.matterContextRecord.findFirst({ where: { id: data.id, ...recordWhere(access) }, include: recordInclude });
    if (!row) throw new ActionError("记录不存在或无权确认");
    if (row.supersededBy || row.version !== data.expectedVersion) throw new ActionError("记录已被更新，请刷新后核对最新版本");
    await assertSources(tx, access, row);
    if (row.kind === "OPTION" && (await readOptionContextInputs(tx, access, row.id)).unavailable) throw new ActionError("方案采用的目标或指示已无权读取，不能确认");
    if (row.confirmationStatus === "CONFIRMED") return { ok: true as const, id: row.id, replayed: true };
    const result = await tx.matterContextRecord.updateMany({ where: { id: row.id, version: data.expectedVersion, confirmationStatus: "PENDING" },
      data: { confirmationStatus: "CONFIRMED", confirmedById: actor.id, confirmedAt: new Date() } });
    if (result.count !== 1) throw new ActionError("记录状态已变化，请刷新后重试");
    await auditTx(tx, { userId: actor.id, action: "MATTER_CONTEXT_CONFIRM", targetType: "MatterContextRecord", targetId: row.id,
      detail: { matterId: row.matterId, version: row.version, visibility: row.visibility } });
    return { ok: true as const, id: row.id, replayed: false };
  }, { timeout: 20_000 });
}

export async function readContextHistory(db: PrismaClient, actor: ContextActor, matterId: string, recordId: string, beforeVersion?: number): Promise<ContextHistoryView> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const selected = await tx.matterContextRecord.findFirst({ where: { id: recordId, ...recordWhere(access) }, select: { seriesId: true } });
    if (!selected) throw new ActionError("记录不存在或无权读取");
    const rows = await tx.matterContextRecord.findMany({ where: { ...recordWhere(access), seriesId: selected.seriesId,
      ...(beforeVersion === undefined ? {} : { version: { lt: beforeVersion } }) }, orderBy: { version: "desc" }, take: 51, include: recordInclude });
    const shown = rows.slice(0, 50);
    return { records: await Promise.all(shown.map(row => present(tx, access, row))), nextBeforeVersion: rows.length > 50 ? shown.at(-1)!.version : null };
  }, { timeout: 20_000 });
}

export async function readContextSource(db: PrismaClient, actor: ContextActor, matterId: string, recordId: string): Promise<ContextSourceContent> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const record = await tx.matterContextRecord.findFirst({ where: { id: recordId, ...recordWhere(access) } });
    if (!record) throw new ActionError("记录不存在或无权读取");
    const source = await sourceView(tx, access, record);
    if (!source?.available || !source.id) throw new ActionError("来源不存在或已无权读取");
    if (source.type === "DOCUMENT") return { type: source.type, label: source.label!, content: null, href: `/api/documents/${encodeURIComponent(source.id)}/download` };
    const content = source.type === "NOTE"
      ? (await tx.note.findFirst({ where: { id: source.id, matterId, deletedAt: null }, select: { content: true } }))?.content
      : (await tx.clientActivity.findFirst({ where: { id: source.id, client: contextClientFilter(access) }, select: { content: true } }))?.content;
    if (content === undefined) throw new ActionError("来源不存在或已无权读取");
    return { type: source.type, label: source.label!, content, href: null };
  }, { timeout: 20_000 });
}

export async function readContextSourceOptions(db: PrismaClient, actor: ContextActor, matterId: string, page?: ContextSourcePageInput): Promise<ContextSourceOptions> {
  const request = contextSourcePageSchema.optional().parse(page);
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    if (!access.canWrite) throw new ActionError("无权维护事项上下文");
    const canRead = {
      DOCUMENT: hasCustomPermission(access.user, "documents.read"),
      NOTE: access.canReadSchedule,
      CLIENT_ACTIVITY: hasCustomPermission(access.user, "clients.read"),
    };
    if (request && !canRead[request.type]) throw new ActionError("已无权读取此类来源，请重新读取来源");
    const point = request ? decodeContextCursor(request.cursor, matterId, access.user.id, request.type) : null;
    const [documents, notes, activities] = await Promise.all([
      canRead.DOCUMENT && (!request || request.type === "DOCUMENT") ? tx.document.findMany({ where: { matterId, deletedAt: null, ...contextPageBoundary("createdAt", point) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101,
        select: { id: true, name: true, version: true, createdAt: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true } }) : [],
      canRead.NOTE && (!request || request.type === "NOTE") ? tx.note.findMany({ where: { matterId, deletedAt: null, ...contextPageBoundary("occurredAt", point) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51,
        select: { id: true, occurredAt: true, withWhom: true } }) : [],
      canRead.CLIENT_ACTIVITY && (!request || request.type === "CLIENT_ACTIVITY") ? tx.clientActivity.findMany({ where: { client: contextClientFilter(access), ...contextPageBoundary("occurredAt", point) },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, occurredAt: true, content: true, client: { select: { name: true } } } }) : []
    ]);
    const readable = await Promise.all(documents.slice(0, 100).map(async doc => await canReadDocument(access.user.id, doc, tx) ? doc : null));
    return {
      choices: buildContextSourceChoices({
        documents: readable.filter((doc): doc is NonNullable<typeof doc> => Boolean(doc)),
        notes: notes.slice(0, 50), activities: activities.slice(0, 50),
      }),
      // The document cursor advances across unreadable rows without exposing their IDs or dates.
      nextCursors: {
        DOCUMENT: documents.length > 100 ? encodeContextCursor(matterId, access.user.id, "DOCUMENT", { at: documents[99].createdAt.toISOString(), id: documents[99].id }) : null,
        NOTE: notes.length > 50 ? encodeContextCursor(matterId, access.user.id, "NOTE", { at: notes[49].occurredAt.toISOString(), id: notes[49].id }) : null,
        CLIENT_ACTIVITY: activities.length > 50 ? encodeContextCursor(matterId, access.user.id, "CLIENT_ACTIVITY", { at: activities[49].occurredAt.toISOString(), id: activities[49].id }) : null,
      },
    };
  }, { timeout: 20_000 });
}
