import type { PrismaClient } from "@prisma/client";
import { hasCustomPermission } from "@/lib/roles/catalog";
import type { MatterBrief } from "@/lib/matters/context";
import { contextAccess, contextClientFilter, contextViewInTransaction, type ContextActor } from "./context-service";

/** Read through the current actor's scope. No copied state, generated assertions or AI dependency. */
export async function readMatterBrief(db: PrismaClient, actor: ContextActor, matterId: string): Promise<MatterBrief> {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const canClients = hasCustomPermission(access.user, "clients.read");
    const [context, tasks, deadlines, followUps, activities] = await Promise.all([
      contextViewInTransaction(tx, access),
      access.canReadSchedule ? tx.task.findMany({ where: {
        matterId, completed: false, OR: [{ responsibility: { is: null } }, { responsibility: { state: "OPEN" } }]
      }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { id: "asc" }], take: 11,
      select: { id: true, title: true, dueAt: true, assigneeId: true, responsibility: { select: { acceptedAt: true, assignee: { select: { name: true } } } } } }) : [],
      access.canReadSchedule ? tx.deadline.findMany({ where: { procedure: { matterId }, completed: false,
        OR: [{ responsibility: { is: null } }, { responsibility: { state: "OPEN" } }] },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 11,
        select: { id: true, procedureId: true, title: true, dueAt: true, duePrecision: true, confirmStatus: true, responsibility: { select: { assignee: { select: { name: true } } } } } }) : [],
      canClients ? tx.clientFollowUp.findMany({ where: { client: contextClientFilter(access), status: "OPEN" },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 11,
        select: { id: true, clientId: true, title: true, dueAt: true, client: { select: { name: true } }, assignee: { select: { name: true } } } }) : [],
      canClients ? tx.clientActivity.findMany({ where: { client: contextClientFilter(access) },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 6,
        select: { id: true, clientId: true, channel: true, occurredAt: true, client: { select: { name: true } } } }) : []
    ]);
    const legacyIds = [...new Set(tasks.filter(task => !task.responsibility && task.assigneeId).map(task => task.assigneeId!))];
    const users = legacyIds.length ? await tx.user.findMany({ where: { id: { in: legacyIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map(user => [user.id, user.name]));
    return {
      matterId, context, serviceScope: access.matter.serviceScope, deliverables: access.matter.deliverables,
      nextActions: tasks.slice(0, 10).map(task => ({ id: task.id, title: task.title, dueAt: task.dueAt?.toISOString() ?? null,
        assigneeName: task.responsibility?.assignee.name ?? (task.assigneeId ? names.get(task.assigneeId) ?? null : null),
        accepted: task.responsibility ? task.responsibility.acceptedAt !== null : null })),
      deadlines: deadlines.slice(0, 10).map(row => ({ id: row.id, procedureId: row.procedureId, title: row.title, dueAt: row.dueAt.toISOString(), duePrecision: row.duePrecision,
        confirmationStatus: row.confirmStatus, assigneeName: row.responsibility?.assignee.name ?? null })),
      clientFollowUps: followUps.slice(0, 10).map(row => ({ id: row.id, clientId: row.clientId, clientName: row.client.name,
        title: row.title, dueAt: row.dueAt.toISOString(), assigneeName: row.assignee.name })),
      // Link metadata only: a client's wider conversation is not silently copied into a matter summary.
      recentClientActivities: activities.slice(0, 5).map(row => ({ id: row.id, clientId: row.clientId, clientName: row.client.name,
        channel: row.channel, occurredAt: row.occurredAt.toISOString() })),
      businessTimeZone: "Asia/Shanghai",
      coverage: { tasksTruncated: tasks.length > 10, deadlinesTruncated: deadlines.length > 10,
        clientFollowUpsTruncated: followUps.length > 10, clientActivitiesTruncated: activities.length > 5 }
    };
  }, { timeout: 20_000 });
}
