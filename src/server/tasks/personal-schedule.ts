import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { approvalTransaction } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { matterAssociationFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { revalidateMatter } from "@/server/matters/route";
import { assertPersonalProcedureOpen } from "@/server/procedures/personal-schedule";
import { changeWorkTx } from "@/server/reminders/responsibility";
import { getTaskForChange } from "./workflow-service";

export const personalTaskAction = z.object({
  action: z.literal("resolve-schedule-task"),
  taskId: z.cuid(),
  matterId: z.cuid(),
  revision: z.number().int().nonnegative(),
  outcome: z.enum(["COMPLETE", "CANCEL", "REOPEN"]),
  reason: z.string().trim().min(1, "请填写处理原因").max(1000),
}).strict();

export async function readPersonalTaskBoard(includeClosed: boolean) {
  const { user } = await requireSession("schedule.read");
  const rows = await prisma.task.findMany({
    where: {
      matter: { deletedAt: null, ...matterAssociationFilter(user.id) },
      responsibility: { is: { assigneeId: user.id, ...(includeClosed ? {} : { state: "OPEN" }) } },
    },
    select: {
      id: true, title: true, dueAt: true,
      matter: { select: { id: true, title: true, status: true } },
      responsibility: { select: { state: true, revision: true } },
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  const canWrite = hasCustomPermission(user, "schedule.write");
  return { items: rows.flatMap(({ id, title, dueAt, matter, responsibility }) => responsibility ? [{
    id, title, dueAt, matterId: matter.id, matterTitle: matter.title,
    ...responsibility, canWrite: canWrite && matter.status !== "ARCHIVED",
  }] : []) };
}

export async function resolvePersonalTask(input: z.infer<typeof personalTaskAction>) {
  const { user } = await requireSession("schedule.write");
  await approvalTransaction(async db => {
    const task = await getTaskForChange(db, user.id, input.taskId);
    if (task.matterId !== input.matterId || task.responsibility.assigneeId !== user.id)
      throw new ActionError("任务不属于本案或当前责任人");
    if (input.outcome === "REOPEN" && task.stageId) {
      const stage = await db.matterStage.findUniqueOrThrow({ where: { id: task.stageId }, select: { procedureId: true } });
      await assertPersonalProcedureOpen(db, task.matterId, stage.procedureId);
    }
    await changeWorkTx(db, user.id, {
      id: task.responsibility.id, revision: input.revision, action: input.outcome, reason: input.reason,
    });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(input.matterId);
  revalidatePath("/schedule");
  revalidatePath("/");
  return { ok: true };
}
