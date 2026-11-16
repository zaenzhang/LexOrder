import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { shDayKey } from "@/lib/ui/sh-time";
import { assertTaskMatterAccess } from "@/server/tasks/workflow-service";

/** A check date is an internal follow-up reminder, never a change to a legal deadline. */
export async function scanTaskWaitingReminders(db: PrismaClient, now = new Date()): Promise<number> {
  return db.$transaction(async tx => {
    // This is the same transaction boundary as waiting/assignment/permission changes.
    // Take the lock before the read, so a preceding revocation is visible to this scan.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    const due = await tx.taskWaiting.findMany({
      where: { endedAt: null, nextCheckAt: { lte: now }, task: {
        matter: { deletedAt: null, status: { not: "ARCHIVED" } },
        responsibility: { is: { state: "OPEN", assignee: { active: true } } },
      } },
      select: { id: true, nextCheckAt: true, waitingFor: true, expectedResult: true,
        task: { select: { id: true, matterId: true, title: true, responsibility: { select: { assigneeId: true } } } } },
      orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }],
    });
    let created = 0;
    for (const waiting of due) {
      const assigneeId = waiting.task.responsibility!.assigneeId;
      let access;
      try { access = await assertTaskMatterAccess(tx, assigneeId, waiting.task.matterId, "read"); }
      catch (error) { if (error instanceof ActionError) continue; throw error; }
      if (!access.canWrite) continue;
      const id = `taskwaiting_${createHash("sha256").update(JSON.stringify([
        waiting.id, waiting.nextCheckAt.toISOString(), assigneeId, shDayKey(now),
      ])).digest("hex")}`;
      const result = await tx.notification.createMany({ skipDuplicates: true, data: {
        id, userId: assigneeId, type: "SYSTEM", priority: "HIGH", title: "外部等待待检查",
        content: `${waiting.task.title}；等待 ${waiting.waitingFor}：${waiting.expectedResult}`,
        href: `/matters/${encodeURIComponent(access.matter.internalCode)}?view=work&workPane=tasks&task=${encodeURIComponent(waiting.task.id)}`,
        refType: "TaskWaiting", refId: waiting.id,
      } });
      created += result.count;
    }
    return created;
  }, { timeout: 20000 });
}
