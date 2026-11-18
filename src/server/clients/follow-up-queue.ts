import type { Prisma, PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { clientVisibilityFilter } from "@/lib/permissions";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { shDayKey, shDayBoundary } from "@/lib/ui/sh-time";
import { personalFollowUpQuerySchema, personalFollowUpTargetSchema, type PersonalFollowUpQuery, type PersonalFollowUpTarget, type PersonalFollowUpPage } from "@/lib/clients/follow-ups";
import { clientRelationshipFilter, canCloseClientFollowUp, type RelationshipUser } from "./relationship-access";

const PAGE_SIZE = 20;
const rowSelect = { id: true, title: true, dueAt: true, updatedAt: true, status: true, clientId: true, assigneeId: true,
  client: { select: { id: true, name: true } }, assignee: { select: { name: true } } } satisfies Prisma.ClientFollowUpSelect;
type Row = Prisma.ClientFollowUpGetPayload<{ select: typeof rowSelect }>;

async function liveReader(db: Prisma.TransactionClient, userId: string): Promise<RelationshipUser | null> {
  const identity = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!identity?.active) return null;
  const role = await resolveRoleUser(userId, identity.role, db);
  return role.enabled && hasCustomPermission(role, "clients.read") ? { ...role, id: userId } : null;
}
function readableClients(user: RelationshipUser): Prisma.ClientWhereInput {
  return { deletedAt: null, AND: [clientVisibilityFilter(user.id, user.role, user.rolePermissions), clientRelationshipFilter(user, "read")] };
}
async function writableClientIds(db: Prisma.TransactionClient, user: RelationshipUser, ids: string[]) {
  if (!ids.length || !hasCustomPermission(user, "clients.write")) return new Set<string>();
  const rows = await db.client.findMany({ where: { id: { in: ids }, AND: [readableClients(user), clientRelationshipFilter(user, "write")] }, select: { id: true } });
  return new Set(rows.map(row => row.id));
}
function present(row: Row, user: RelationshipUser, writable: Set<string>, now: Date) {
  return { id: row.id, title: row.title, dueAt: row.dueAt.toISOString(), updatedAt: row.updatedAt.toISOString(), status: row.status, client: row.client,
    assigneeName: row.assignee.name, overdue: row.dueAt < now,
    canClose: row.status === "OPEN" && writable.has(row.clientId) && canCloseClientFollowUp(user, row.assigneeId) };
}

/** Used by both the five-row home preview and the full queue, inside the caller's read transaction. */
export async function personalFollowUpsInTransaction(db: Prisma.TransactionClient, userId: string, input: PersonalFollowUpQuery = {}, pageSize = PAGE_SIZE, observedAt = new Date()): Promise<PersonalFollowUpPage> {
  const query = personalFollowUpQuerySchema.parse(input), user = await liveReader(db, userId);
  const base = { available: Boolean(user), filter: query.filter, pageSize, observedAt: observedAt.toISOString() };
  if (!user) return { ...base, items: [], total: 0, page: 1 };
  const dayKey = shDayKey(observedAt), day = { gte: shDayBoundary(dayKey)!, lte: shDayBoundary(dayKey, true)! };
  const where: Prisma.ClientFollowUpWhereInput = { assigneeId: user.id, status: "OPEN", client: readableClients(user),
    ...(query.filter === "overdue" ? { dueAt: { lt: observedAt } } : query.filter === "today" ? { dueAt: day } : {}) };
  const total = await db.clientFollowUp.count({ where });
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await db.clientFollowUp.findMany({ where, select: rowSelect, orderBy: [{ dueAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
  const writable = await writableClientIds(db, user, [...new Set(rows.map(row => row.clientId))]);
  return { ...base, total, page, items: rows.map(row => present(row, user, writable, observedAt)) };
}
export async function readPersonalFollowUps(db: PrismaClient, userId: string, input: PersonalFollowUpQuery) {
  return db.$transaction(tx => personalFollowUpsInTransaction(tx, userId, input), { isolationLevel: "RepeatableRead", timeout: 20000 });
}
export async function readPersonalFollowUp(db: PrismaClient, userId: string, input: PersonalFollowUpTarget) {
  const data = personalFollowUpTargetSchema.parse(input);
  return db.$transaction(async tx => {
    const user = await liveReader(tx, userId);
    if (!user) throw new ActionError("当前资格不能读取客户跟进");
    const row = await tx.clientFollowUp.findUnique({ where: { id: data.followUpId }, select: rowSelect });
    if (!row || !await tx.client.count({ where: { id: row.clientId, AND: [readableClients(user)] } }) || row.assigneeId !== user.id) {
      throw new ActionError("跟进不存在或当前无权读取，请刷新列表");
    }
    if (row.clientId !== data.clientId) throw new ActionError("跟进所属客户已变化，请刷新列表后重新打开");
    return present(row, user, await writableClientIds(tx, user, [row.clientId]), new Date());
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
