"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ClientActivityInput, ClientRelationshipView } from "@/lib/clients/relationship";
import { clientRelationshipFilter, canCloseClientFollowUp } from "./relationship-access";
import { saveClientActivity } from "./relationship-service";

export async function getClientRelationship(clientId: string): Promise<ClientRelationshipView | null> {
  const { user } = await requireSession("clients.read");
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null, AND: [clientRelationshipFilter(user, "read")] }, select: { id: true } });
  if (!client) return null;
  const [writable, activities, followUps, activityCount, openCount] = await Promise.all([
    prisma.client.count({ where: { id: clientId, deletedAt: null, AND: [clientRelationshipFilter(user, "write")] } }),
    prisma.clientActivity.findMany({ where: { clientId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50, include: { author: { select: { name: true } }, closedFollowUp: { select: { title: true, status: true } } } }),
    prisma.clientFollowUp.findMany({ where: { clientId, status: "OPEN" }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 100, include: { assignee: { select: { name: true } } } }),
    prisma.clientActivity.count({ where: { clientId } }),
    prisma.clientFollowUp.count({ where: { clientId, status: "OPEN" } })
  ]);
  return {
    canWrite: writable > 0, activityCount, openCount,
    activities: activities.map(row => ({ id: row.id, content: row.content, channel: row.channel, occurredAt: row.occurredAt.toISOString(), authorName: row.author.name, closedTitle: row.closedFollowUp?.title ?? null, closedStatus: row.closedFollowUp?.status ?? null })),
    followUps: followUps.map(row => ({ id: row.id, title: row.title, dueAt: row.dueAt.toISOString(), assigneeName: row.assignee.name, overdue: row.dueAt < new Date(), canClose: writable > 0 && canCloseClientFollowUp(user, row.assigneeId) }))
  };
}

export async function recordClientActivity(input: ClientActivityInput) {
  const { user } = await requireSession("clients.write");
  const result = await saveClientActivity(prisma, user, input);
  revalidatePath(`/clients/${input.clientId}`);
  revalidatePath("/clients");
  return result;
}
