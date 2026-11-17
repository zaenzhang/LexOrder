import type { Prisma, PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { clientVisibilityFilter, customMatterFilter, intakeReadVisibilityFilter, matterFinanceVisibilityFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import { hasCustomPermission, type RoleUser } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { clientPageInputSchema, CLIENT_HISTORY_PAGE_SIZE, CLIENT_MATTER_PAGE_SIZE, type ClientPageInput, type ClientMatterPage, type ClientHistoryItem, type ClientHistoryPage, type HistorySource } from "@/lib/clients/history";
import { clientChannelLabels, type ClientRelationshipView, type ClientCommunicationPage, type ClientFollowUpPage } from "@/lib/clients/relationship";
import { contextKindLabels } from "@/lib/matters/context";
import { intakeStatusLabel, procedureTypeLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { shDayKey, shParts } from "@/lib/ui/sh-time";
import { readFinanceFacts } from "@/server/finance/facts";
import { contextAccess, readContextRecordsForHistory } from "@/server/matters/context-service";
import { assertDeliveryAuthority, assertDeliveryDocuments, deliveryDocumentSelect } from "@/server/deliveries/service";
import { deliveryEventLabels } from "@/server/deliveries/contracts";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { clientRelationshipFilter, canCloseClientFollowUp } from "./relationship-access";
import { compareHistoryPositions, decodeClientCursor, encodeClientCursor, pageBoundary, type HistoryPosition } from "./history-cursor";

export type ClientHistoryActor = RoleUser & { id: string };
const activeStatuses = ["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"] as const;
const matterLink = (clientId: string): Prisma.MatterWhereInput => ({ OR: [{ primaryClientId: clientId }, { clientLinks: { some: { clientId } } }] });

/** Private service boundary; the client never supplies an actor or a where clause. */
export async function clientHistoryAccess(tx: Prisma.TransactionClient, actor: ClientHistoryActor, clientId: string) {
  let user = actor;
  if (actor.runtimeMode !== "PERSONAL") {
    const identity = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
    if (!identity?.active) throw new ActionError("账号已停用，请重新登录");
    const role = await resolveRoleUser(actor.id, identity.role, tx);
    if (!role.enabled || !hasCustomPermission(role, "clients.read")) throw new ActionError("无权读取客户");
    user = { ...role, id: actor.id, runtimeMode: "SERVER" };
  }
  const client = await tx.client.findFirst({ where: {
    id: clientId, deletedAt: null, AND: [clientVisibilityFilter(user.id, user.role, user.rolePermissions)]
  }, select: { id: true, name: true, idType: true, idNumberBlind: true, source: true } });
  if (!client) throw new ActionError("客户不存在或已无权读取，请刷新");
  return { user, client };
}
type Access = Awaited<ReturnType<typeof clientHistoryAccess>>;
function visibleMatters(access: Access): Prisma.MatterWhereInput {
  return { deletedAt: null, AND: [matterLink(access.client.id), hasCustomPermission(access.user, "matters.read")
    ? matterReadVisibilityFilter(access.user.id, access.user.role, access.user.rolePermissions) : { id: { in: [] } }] };
}
function financeMatters(access: Access): Prisma.MatterWhereInput {
  return { deletedAt: null, AND: [matterLink(access.client.id), matterFinanceVisibilityFilter(access.user.id, access.user.role, access.user.rolePermissions)] };
}
async function relationshipRights(tx: Prisma.TransactionClient, access: Access) {
  const base = { id: access.client.id, deletedAt: null };
  const [read, write] = await Promise.all([
    tx.client.count({ where: { ...base, AND: [clientRelationshipFilter(access.user, "read")] } }),
    tx.client.count({ where: { ...base, AND: [clientRelationshipFilter(access.user, "write")] } })
  ]);
  return { canRead: read > 0, canWrite: read > 0 && write > 0 };
}

export async function clientMattersInTransaction(tx: Prisma.TransactionClient, access: Access, cursor?: string): Promise<ClientMatterPage> {
  const { client, user } = access;
  const point = decodeClientCursor(cursor, client.id, user.id, "matters");
  const where = visibleMatters(access);
  const [rows, total, activeCount] = await Promise.all([
    tx.matter.findMany({ where: { AND: [where, pageBoundary("createdAt", point, "MATTER")] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CLIENT_MATTER_PAGE_SIZE + 1,
      select: { id: true, internalCode: true, title: true, status: true, category: true, intakeDate: true, createdAt: true,
        owner: { select: { name: true } }, procedures: { where: { engagement: "ENGAGED" }, orderBy: { order: "asc" }, take: 1,
          select: { type: true, customLabel: true, stages: { where: { status: { not: "HIDDEN" }, completedAt: null }, orderBy: { order: "asc" }, take: 1, select: { name: true } } } } } }),
    tx.matter.count({ where }),
    tx.matter.count({ where: { AND: [where, { status: { in: [...activeStatuses] } }] } })
  ]);
  const items = rows.slice(0, CLIENT_MATTER_PAGE_SIZE);
  const contracts = new Map<string, number>();
  if (items.length && hasCustomPermission(user, "finance.read")) {
    const financeWhere = { AND: [financeMatters(access), { id: { in: items.map(row => row.id) } }] };
    const allowed = await tx.matter.findMany({ where: financeWhere, select: { id: true } });
    allowed.forEach(row => contracts.set(row.id, 0));
    const facts = await readFinanceFacts(tx, financeWhere);
    if (facts) {
      for (const billing of facts.billings.filter(row => row.signedAt && row.moneyKind === "LAWYER_FEE"))
        contracts.set(billing.matterId, (contracts.get(billing.matterId) ?? 0) + billing.contractAmount.toNumber());
    } else {
      const sums = await tx.billing.groupBy({ by: ["matterId"], where: { signedAt: { not: null }, matter: financeWhere }, _sum: { contractAmount: true } });
      sums.forEach(row => contracts.set(row.matterId, Number(row._sum.contractAmount ?? 0)));
    }
  }
  const last = items.at(-1);
  return { total, activeCount,
    items: items.map(row => ({ id: row.id, internalCode: row.internalCode, title: row.title, status: row.status, category: row.category,
      year: String(shParts(row.intakeDate ?? row.createdAt).y), ownerName: row.owner?.name ?? null,
      procedure: row.procedures[0] ? row.procedures[0].customLabel ?? procedureTypeLabel[row.procedures[0].type] ?? row.procedures[0].type : null,
      stage: row.procedures[0]?.stages[0]?.name ?? null, contract: contracts.get(row.id) ?? null })),
    nextCursor: rows.length > CLIENT_MATTER_PAGE_SIZE && last
      ? encodeClientCursor(client.id, user.id, "matters", { at: last.createdAt.toISOString(), source: "MATTER", id: last.id }) : null };
}

export async function readClientMatters(db: PrismaClient, actor: ClientHistoryActor, input: ClientPageInput) {
  const data = clientPageInputSchema.parse(input);
  return db.$transaction(async tx => clientMattersInTransaction(tx, await clientHistoryAccess(tx, actor, data.clientId), data.cursor), { timeout: 20_000 });
}

async function communicationPage(tx: Prisma.TransactionClient, access: Access, canWrite: boolean, cursor?: string): Promise<ClientCommunicationPage> {
  const { client, user } = access;
  const point = decodeClientCursor(cursor, client.id, user.id, "communications");
  const [rows, total] = await Promise.all([
    tx.clientActivity.findMany({ where: { clientId: client.id, ...pageBoundary("occurredAt", point, "CLIENT_ACTIVITY") },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: CLIENT_HISTORY_PAGE_SIZE + 1,
      include: { author: { select: { name: true } }, closedFollowUp: { select: { title: true, status: true } } } }),
    tx.clientActivity.count({ where: { clientId: client.id } })
  ]);
  const items = rows.slice(0, CLIENT_HISTORY_PAGE_SIZE), last = items.at(-1);
  return { canWrite, total, items: items.map(row => ({ id: row.id, content: row.content, channel: row.channel,
    occurredAt: row.occurredAt.toISOString(), authorName: row.author.name, closedTitle: row.closedFollowUp?.title ?? null, closedStatus: row.closedFollowUp?.status ?? null })),
    nextCursor: rows.length > CLIENT_HISTORY_PAGE_SIZE && last
      ? encodeClientCursor(client.id, user.id, "communications", { at: last.occurredAt.toISOString(), source: "CLIENT_ACTIVITY", id: last.id }) : null };
}
async function followUpPage(tx: Prisma.TransactionClient, access: Access, canWrite: boolean, cursor?: string): Promise<ClientFollowUpPage> {
  const { client, user } = access;
  const point = decodeClientCursor(cursor, client.id, user.id, "followUps");
  const [rows, total] = await Promise.all([
    tx.clientFollowUp.findMany({ where: { clientId: client.id, status: "OPEN", ...pageBoundary("dueAt", point, "FOLLOW_UP", true) },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: CLIENT_HISTORY_PAGE_SIZE + 1, include: { assignee: { select: { name: true } } } }),
    tx.clientFollowUp.count({ where: { clientId: client.id, status: "OPEN" } })
  ]);
  const items = rows.slice(0, CLIENT_HISTORY_PAGE_SIZE), last = items.at(-1);
  return { canWrite, total, items: items.map(row => ({ id: row.id, title: row.title, dueAt: row.dueAt.toISOString(), assigneeName: row.assignee.name,
    overdue: row.dueAt < new Date(), canClose: canWrite && canCloseClientFollowUp(user, row.assigneeId) })),
    nextCursor: rows.length > CLIENT_HISTORY_PAGE_SIZE && last
      ? encodeClientCursor(client.id, user.id, "followUps", { at: last.dueAt.toISOString(), source: "FOLLOW_UP", id: last.id }) : null };
}

export async function readClientRelationship(db: PrismaClient, actor: ClientHistoryActor, clientId: string): Promise<ClientRelationshipView | null> {
  const data = clientPageInputSchema.parse({ clientId });
  return db.$transaction(async tx => {
    const access = await clientHistoryAccess(tx, actor, data.clientId), rights = await relationshipRights(tx, access);
    if (!rights.canRead) return null;
    const [activities, followUps] = await Promise.all([communicationPage(tx, access, rights.canWrite), followUpPage(tx, access, rights.canWrite)]);
    return { canWrite: rights.canWrite, activityCount: activities.total, openCount: followUps.total,
      activities: activities.items, followUps: followUps.items, activityNextCursor: activities.nextCursor, followUpNextCursor: followUps.nextCursor };
  }, { timeout: 20_000 });
}
export async function readClientCommunicationPage(db: PrismaClient, actor: ClientHistoryActor, input: ClientPageInput) {
  const data = clientPageInputSchema.parse(input);
  return db.$transaction(async tx => {
    const access = await clientHistoryAccess(tx, actor, data.clientId), rights = await relationshipRights(tx, access);
    if (!rights.canRead) throw new ActionError("已无权读取沟通记录，请刷新");
    return communicationPage(tx, access, rights.canWrite, data.cursor);
  }, { timeout: 20_000 });
}
export async function readClientFollowUpPage(db: PrismaClient, actor: ClientHistoryActor, input: ClientPageInput) {
  const data = clientPageInputSchema.parse(input);
  return db.$transaction(async tx => {
    const access = await clientHistoryAccess(tx, actor, data.clientId), rights = await relationshipRights(tx, access);
    if (!rights.canRead) throw new ActionError("已无权读取跟进记录，请刷新");
    return followUpPage(tx, access, rights.canWrite, data.cursor);
  }, { timeout: 20_000 });
}

type Candidate = HistoryPosition & { item?: ClientHistoryItem; matterId?: string; matterTitle?: string; href?: string; deliveryId?: string };
const SCAN_CHUNK = 40, SCAN_BUDGET = 200;
const matterSelect = { id: true, internalCode: true, title: true } as const;
function event(source: HistorySource, id: string, at: Date, recordedAt: Date, title: string, meta: string, content: string | null, href: string, linkLabel: string): Candidate {
  const point = { source, id, at: at.toISOString() };
  return { ...point, item: { ...point, key: `${source}:${id}`, recordedAt: recordedAt.toISOString(), title, meta, content, href, linkLabel } };
}

async function candidates(tx: Prisma.TransactionClient, access: Access, canRelationships: boolean, point: HistoryPosition | null) {
  const { client, user } = access;
  const matters = visibleMatters(access), canMatters = hasCustomPermission(user, "matters.read");
  const clientHref = `/clients/${client.id}`;
  const take = SCAN_CHUNK + 1;
  const scheduleMatters: Prisma.MatterWhereInput = { AND: [matters, user.role === "CUSTOM"
    ? customMatterFilter(user.id, user.rolePermissions, "schedule.read", true) : {}] };
  const sources = await Promise.all([
    canRelationships ? tx.clientActivity.findMany({ where: { clientId: client.id, ...pageBoundary("occurredAt", point, "CLIENT_ACTIVITY") },
      take, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], include: { author: { select: { name: true } }, closedFollowUp: { select: { title: true, status: true } } } })
      .then(rows => rows.map(row => event("CLIENT_ACTIVITY", row.id, row.occurredAt, row.createdAt,
        row.closedFollowUp ? `${row.closedFollowUp.status === "CANCELLED" ? "取消" : "完成"}跟进：${row.closedFollowUp.title}` : "客户沟通",
        `${clientChannelLabels[row.channel]} · ${row.author.name}`, row.content, `${clientHref}#client-relationship-title`, "沟通与跟进"))) : [],
    tx.contact.findMany({ where: { clientId: client.id, ...pageBoundary("createdAt", point, "CONTACT") }, take, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, name: true, createdAt: true } })
      .then(rows => rows.map(row => event("CONTACT", row.id, row.createdAt, row.createdAt, `新增联系人：${row.name}`, "客户档案维护", null, `${clientHref}#client-contacts`, "联系人"))),
    canMatters ? tx.matterContextRecord.findMany({ where: { matter: matters, ...pageBoundary("occurredAt", point, "CONTEXT") },
      take, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true, matterId: true, occurredAt: true, matter: { select: matterSelect } } })
      .then(rows => rows.map(row => ({ source: "CONTEXT" as const, id: row.id, at: row.occurredAt.toISOString(), matterId: row.matterId,
        matterTitle: row.matter.title, href: matterHref(row.matter, `?${new URLSearchParams({ view: "archive", contextRecord: row.id })}`) }))) : [],
    canMatters && hasCustomPermission(user, "documents.download") ? tx.deliveryEvent.findMany({ where: {
      delivery: { recipientClientId: client.id, matter: { deletedAt: null,
        AND: [matterReadVisibilityFilter(user.id, user.role, user.rolePermissions)] } },
      ...pageBoundary("occurredAt", point, "DELIVERY") }, take,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true, deliveryId: true, occurredAt: true } })
      .then(rows => rows.map(row => ({ source: "DELIVERY" as const, id: row.id, at: row.occurredAt.toISOString(), deliveryId: row.deliveryId }))) : [],
    hasCustomPermission(user, "finance.read") ? tx.feeEntry.findMany({ where: { type: "RECEIVED", confirmState: "CONFIRMED", matter: financeMatters(access),
      ...pageBoundary("occurredAt", point, "FEE") }, take, orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, amount: true, occurredAt: true, createdAt: true, recordedBy: { select: { name: true } }, matter: { select: matterSelect } } })
      .then(rows => rows.map(row => event("FEE", row.id, row.occurredAt, row.createdAt, `已确认到账 ¥${Number(row.amount).toLocaleString("zh-CN")}`,
        `${row.matter.title} · ${row.recordedBy.name}登记`, null, "/finance", "财务记录"))) : [],
    canRelationships ? tx.clientFollowUp.findMany({ where: { clientId: client.id, ...pageBoundary("createdAt", point, "FOLLOW_UP") },
      take, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, title: true, dueAt: true, status: true, createdAt: true, createdBy: { select: { name: true } } } })
      .then(rows => rows.map(row => event("FOLLOW_UP", row.id, row.createdAt, row.createdAt, `安排跟进：${row.title}`,
        `${row.createdBy.name} · 约定 ${shDayKey(row.dueAt)} · ${{ OPEN: "待跟进", COMPLETED: "已完成", CANCELLED: "已取消" }[row.status]}`, null,
        `${clientHref}#client-relationship-title`, "沟通与跟进"))) : [],
    canMatters ? tx.intake.findMany({ where: { clientId: client.id, AND: [intakeReadVisibilityFilter(user.id, user.role, user.rolePermissions), pageBoundary("createdAt", point, "INTAKE")] },
      take, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, title: true, createdAt: true, status: true, createdBy: { select: { name: true } } } })
      .then(rows => rows.map(row => event("INTAKE", row.id, row.createdAt, row.createdAt, `新建收案：${row.title}`,
        `${row.createdBy.name} · ${intakeStatusLabel[row.status]}`, null, `/intakes/${row.id}`, "打开收案"))) : [],
    canMatters ? tx.matter.findMany({ where: { AND: [matters, pageBoundary("createdAt", point, "MATTER")] }, take, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { ...matterSelect, createdAt: true, owner: { select: { name: true } } } })
      .then(rows => rows.map(row => event("MATTER", row.id, row.createdAt, row.createdAt, `建立事项：${row.title}`,
        `${row.internalCode ?? ""} · 主办 ${row.owner?.name ?? "—"}`, null, matterHref(row), "打开事项"))) : [],
    canMatters && hasCustomPermission(user, "schedule.read") ? tx.note.findMany({ where: { deletedAt: null, matter: scheduleMatters, ...pageBoundary("occurredAt", point, "NOTE") },
      take, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true, channel: true, occurredAt: true, createdAt: true, content: true,
        author: { select: { name: true } }, matter: { select: matterSelect } } })
      .then(rows => rows.map(row => event("NOTE", row.id, row.occurredAt, row.createdAt, "事项沟通",
        `${row.matter.title} · ${clientChannelLabels[row.channel]} · ${row.author.name}`, row.content, matterHref(row.matter), "打开事项"))) : []
  ]);
  return (sources.flat() as Candidate[]).sort(compareHistoryPositions);
}

/** Read event bodies only after the concrete frozen material list passes current disclosure access. */
async function deliveryHistoryItems(tx: Prisma.TransactionClient, access: Access, rows: Candidate[]) {
  const result = new Map<string, ClientHistoryItem>();
  if (!rows.length) return result;
  const records = await tx.deliveryRecord.findMany({ where: {
    id: { in: [...new Set(rows.map(row => row.deliveryId!))] }, recipientClientId: access.client.id,
  }, select: { id: true, matterId: true, items: { include: { document: { select: deliveryDocumentSelect } } } } });
  const allowed: string[] = [];
  for (const record of records) {
    try {
      await assertDeliveryAuthority(tx, access.user.id, record.matterId, false);
      await assertDeliveryDocuments(tx, access.user.id, record, false);
      allowed.push(record.id);
    } catch (error) { if (!(error instanceof ActionError)) throw error; }
  }
  if (!allowed.length) return result;
  const eventReferences = await tx.deliveryEvent.findMany({ where: { id: { in: rows.map(row => row.id) }, deliveryId: { in: allowed } },
    select: { id: true, deliveryId: true, proofDocumentId: true } });
  const proofs = await tx.document.findMany({ where: { id: { in: eventReferences.flatMap(row => row.proofDocumentId ? [row.proofDocumentId] : []) } },
    select: { id: true, matterId: true, deletedAt: true } });
  const proofById = new Map(proofs.map(proof => [proof.id, proof]));
  const allowedEvents: string[] = [];
  for (const row of eventReferences) {
    if (row.proofDocumentId) {
      const proof = proofById.get(row.proofDocumentId), matterId = records.find(record => record.id === row.deliveryId)?.matterId;
      if (!proof || proof.deletedAt || proof.matterId !== matterId) continue;
      try { await assertDocumentDerivationAccess(access.user.id, proof.id, { purpose: "EXPORT", db: tx }); }
      catch (error) { if (error instanceof ActionError) continue; throw error; }
    }
    allowedEvents.push(row.id);
  }
  if (!allowedEvents.length) return result;
  const events = await tx.deliveryEvent.findMany({ where: { id: { in: allowedEvents } },
    select: { id: true, deliveryId: true, kind: true, occurredAt: true, recordedAt: true, channel: true, note: true,
      proofDocumentId: true, actor: { select: { name: true } },
      delivery: { select: { purpose: true, matter: { select: matterSelect } } } } });
  for (const row of events) {
    const href = matterHref(row.delivery.matter,
      `?view=work&workPane=records&delivery=${row.deliveryId}&deliveryEvent=${row.id}`);
    const meta = [row.delivery.matter.title, row.actor.name, row.channel,
      row.kind !== "EXPORTED" && !row.proofDocumentId ? "仅人工登记，未附凭据" : null].filter(Boolean).join(" · ");
    result.set(row.id, event("DELIVERY", row.id, row.occurredAt, row.recordedAt,
      `${deliveryEventLabels[row.kind]}：${row.delivery.purpose}`, meta, row.note, href, "打开交付记录").item!);
  }
  return result;
}

async function historyInTransaction(tx: Prisma.TransactionClient, access: Access, cursor?: string): Promise<ClientHistoryPage> {
  const { client, user } = access;
  let point = decodeClientCursor(cursor, client.id, user.id, "history");
  const rights = await relationshipRights(tx, access);
  const items: ClientHistoryItem[] = [];
  for (let scanned = 0; scanned < SCAN_BUDGET; scanned += SCAN_CHUNK) {
    const all = await candidates(tx, access, rights.canRead, point);
    const batch = all.slice(0, SCAN_CHUNK), more = all.length > SCAN_CHUNK;
    const groups = new Map<string, Candidate[]>();
    for (const row of batch.filter(row => row.source === "CONTEXT")) groups.set(row.matterId!, [...(groups.get(row.matterId!) ?? []), row]);
    const contextItems = new Map<string, ClientHistoryItem>();
    for (const [matterId, rows] of groups) {
      const currentAccess = await contextAccess(tx, user, matterId);
      const records = await readContextRecordsForHistory(tx, currentAccess, rows.map(row => row.id));
      for (const record of records) {
        const row = rows.find(row => row.id === record.id)!;
        contextItems.set(record.id, { source: "CONTEXT", id: record.id, key: `CONTEXT:${record.id}`, at: record.occurredAt, recordedAt: record.createdAt,
          title: `${contextKindLabels[record.kind]} · 第 ${record.version} 版`,
          meta: `${row.matterTitle} · ${record.authorName} · ${record.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"}`,
          content: record.content, href: row.href!, linkLabel: "打开这版记录" });
      }
    }
    const deliveryItems = await deliveryHistoryItems(tx, access, batch.filter(row => row.source === "DELIVERY"));
    for (let index = 0; index < batch.length; index++) {
      const row = batch[index];
      point = { at: row.at, source: row.source, id: row.id };
      const item = row.source === "CONTEXT" ? contextItems.get(row.id) : row.source === "DELIVERY" ? deliveryItems.get(row.id) : row.item;
      if (item) items.push(item);
      if (items.length === CLIENT_HISTORY_PAGE_SIZE) return { items,
        nextCursor: more || index < batch.length - 1 ? encodeClientCursor(client.id, user.id, "history", point) : null };
    }
    if (!more) return { items, nextCursor: null };
  }
  // The cursor is encrypted: hidden source timestamps/IDs never leave as readable JSON.
  // Even an empty scan page advances, so a long unavailable run cannot hide older records.
  return { items, nextCursor: point ? encodeClientCursor(client.id, user.id, "history", point) : null };
}

export async function readClientHistory(db: PrismaClient, actor: ClientHistoryActor, input: ClientPageInput): Promise<ClientHistoryPage> {
  const data = clientPageInputSchema.parse(input);
  return db.$transaction(async tx => historyInTransaction(tx, await clientHistoryAccess(tx, actor, data.clientId), data.cursor), { timeout: 20_000 });
}
