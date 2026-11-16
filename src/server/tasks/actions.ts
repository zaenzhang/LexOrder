"use server";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { approvalTransaction } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { matterHref } from "@/lib/matters/route";
import { auditTx } from "@/server/audit";
import { assertLiveAssignees } from "@/server/intakes/workflow";
import { revalidateMatter } from "@/server/matters/route";
import { changeWorkTx } from "@/server/reminders/responsibility";
import { recordTimelineEvent } from "@/server/timeline/record";
import { assertTaskMatterAccess, getTaskForChange } from "./workflow-service";

const taskCreateSchema = z.object({
  matterId: z.string().cuid(),
  title: z.string().trim().min(1, "任务标题必填").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  assigneeId: z.string().cuid().optional().or(z.literal("")),
  dueAt: z.coerce.date().optional(),
  priority: z.coerce.number().int().min(0).max(2).default(0),
  stageId: z.string().cuid().optional().or(z.literal(""))
});
const taskUpdateSchema = taskCreateSchema.extend({ id: z.string().cuid(), revision: z.number().int().nonnegative() });

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

async function assertTaskStage(db: Prisma.TransactionClient, matterId: string, stageId?: string) {
  if (!stageId) return;
  const stage = await db.matterStage.findFirst({ where: { id: stageId, procedure: { matterId } }, select: { id: true } });
  if (!stage) throw new ActionError("环节不存在或不属于当前事项");
}

async function refreshTasks(matterId: string) {
  await revalidateMatter(matterId);
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
}

export async function createTask(input: TaskCreateInput) {
  const session = await requireSession("schedule.write");
  const data = taskCreateSchema.parse(input);
  const created = await approvalTransaction(async db => {
    const { matter } = await assertTaskMatterAccess(db, session.user.id, data.matterId, "write");
    await assertTaskStage(db, matter.id, data.stageId);
    const assigneeId = data.assigneeId || matter.ownerId;
    if (![matter.ownerId, ...matter.members.map(member => member.userId)].includes(assigneeId)) {
      throw new ActionError("请先将责任人加入本事项团队");
    }
    await assertLiveAssignees(db, [assigneeId]);
    const task = await db.task.create({
      data: {
        matterId: matter.id, title: data.title, description: data.description || null,
        assigneeId, dueAt: data.dueAt, priority: data.priority, stageId: data.stageId || null
      }
    });
    await auditTx(db, {
      userId: session.user.id, action: "TASK_CREATE", targetType: "Task", targetId: task.id,
      detail: { matterId: matter.id, title: task.title }
    });
    await recordTimelineEvent(db, { matterId: matter.id, eventType: "TASK_ADDED", title: `新增事项：${task.title}`, refType: "Task", refId: task.id });
    if (assigneeId !== session.user.id) {
      await db.notification.create({
        data: {
          userId: assigneeId, type: "TASK_ASSIGNED", title: "您有新事项", content: `事项「${task.title}」已指派给您`,
          href: matterHref(matter), refType: "Task", refId: task.id
        }
      });
    }
    return task;
  });
  await refreshTasks(created.matterId);
  return { ok: true, id: created.id };
}

export async function updateTask(input: TaskUpdateInput) {
  const session = await requireSession("schedule.write");
  const data = taskUpdateSchema.parse(input);
  const matterId = await approvalTransaction(async db => {
    const task = await getTaskForChange(db, session.user.id, data.id);
    if (task.matterId !== data.matterId) throw new ActionError("任务不存在或不属于当前事项");
    if (task.responsibility.revision !== data.revision) throw new ActionError("任务已变化，请刷新后重试");
    if (task.responsibility.state !== "OPEN") throw new ActionError("任务已结束，请先重开");
    if (data.assigneeId !== undefined && data.assigneeId !== task.responsibility.assigneeId) {
      throw new ActionError("变更责任人请从事项责任面板发起交接，接收后生效");
    }
    if (data.dueAt !== undefined && data.dueAt.getTime() !== task.dueAt?.getTime()) {
      throw new ActionError("任务安排改期请从责任操作填写新日期和原因");
    }
    await assertTaskStage(db, task.matterId, data.stageId);
    await db.task.update({
      where: { id: task.id, matterId: task.matterId },
      data: {
        title: data.title, description: data.description || null, priority: data.priority,
        ...(data.stageId !== undefined ? { stageId: data.stageId || null } : {})
      }
    });
    await db.workResponsibility.update({ where: { id: task.responsibility.id }, data: { revision: { increment: 1 } } });
    await auditTx(db, {
      userId: session.user.id, action: "TASK_UPDATE", targetType: "Task", targetId: task.id,
      detail: { previousRevision: data.revision }
    });
    return task.matterId;
  });
  await refreshTasks(matterId);
  return { ok: true };
}

async function completeTaskTx(db: Prisma.TransactionClient, userId: string, id: string, reason: string) {
  const task = await getTaskForChange(db, userId, id);
  // Even a completed replay first checks the current actor, membership and archive state.
  if (task.responsibility.state === "DONE") return task.matterId;
  if (task.responsibility.state === "CANCELLED") throw new ActionError("任务已取消，不能作为已办结处理；如需继续办理请先重开");
  await changeWorkTx(db, userId, { id: task.responsibility.id, revision: task.responsibility.revision, action: "COMPLETE", reason });
  return task.matterId;
}

/** Existing task buttons complete work; reopening always requires an explicit reason. */
export async function toggleTaskCompleted(id: string) {
  const session = await requireSession("schedule.write");
  const taskId = z.string().cuid().parse(id);
  const matterId = await approvalTransaction(db => completeTaskTx(db, session.user.id, taskId, "经办通过完成操作确认已办结"));
  await refreshTasks(matterId);
  return { ok: true };
}

/** Each item has its own current authorization and transaction. Input order is preserved. */
export async function completeTasksBatch(input: { ids: string[]; reason: string }) {
  const session = await requireSession("schedule.write");
  const data = z.object({
    ids: z.array(z.string()).min(1, "请先选择要办结的任务").max(100, "单次批量办结最多 100 条，请分批处理"),
    reason: z.string().trim().min(1, "请填写批量办结的统一处置结果或原因").max(1000)
  }).parse(input);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const changedMatters = new Set<string>();
  for (const id of data.ids) {
    try {
      const taskId = z.string().cuid("任务标识无效").parse(id);
      const matterId = await approvalTransaction(db => completeTaskTx(db, session.user.id, taskId, data.reason));
      changedMatters.add(matterId);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "任务办结失败" });
    }
  }
  for (const matterId of changedMatters) await revalidateMatter(matterId);
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, results };
}
