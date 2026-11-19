"use server";

import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
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
import { assertPersonalProcedureOpen } from "@/server/procedures/personal-schedule";
import { recordTimelineEvent } from "@/server/timeline/record";
import { assertTaskMatterAccess, getTaskForChange } from "./workflow-service";

const taskCreateSchema = z.object({
  matterId: z.string().cuid(),
  title: z.string().trim().min(1, "任务标题必填").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  assigneeId: z.string().cuid().optional().or(z.literal("")),
  dueAt: z.coerce.date().optional(),
  priority: z.coerce.number().int().min(0).max(2).default(0),
  stageId: z.string().cuid().optional().or(z.literal("")),
  requestKey: z.string().uuid().optional()
});
const taskUpdateSchema = taskCreateSchema.extend({ id: z.string().cuid(), revision: z.number().int().nonnegative() });

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

async function assertTaskStage(db: Prisma.TransactionClient, matterId: string, stageId?: string, allowHidden = false) {
  if (!stageId) return;
  await db.$queryRaw`SELECT id FROM "MatterStage" WHERE id=${stageId} FOR SHARE`;
  const stage = await db.matterStage.findFirst({ where: { id: stageId, procedure: { matterId }, ...(allowHidden ? {} : { status: "ACTIVE" }) }, select: { procedureId: true } });
  if (!stage) throw new ActionError("环节不存在或不属于当前事项");
  return stage.procedureId;
}

async function refreshTasks(matterId: string) {
  await revalidateMatter(matterId);
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function createTask(input: TaskCreateInput) {
  const session = await requireSession("schedule.write");
  const data = taskCreateSchema.parse(input);
  const created = await approvalTransaction(async db => {
    const { matter } = await assertTaskMatterAccess(db, session.user.id, data.matterId, "write");
    const requestHash = data.requestKey ? createHash("sha256").update(JSON.stringify({
      actorId: session.user.id, matterId: data.matterId, title: data.title, description: data.description || null,
      assigneeId: data.assigneeId || null, dueAt: data.dueAt?.toISOString() ?? null,
      priority: data.priority, stageId: data.stageId || null
    })).digest("hex") : null;
    if (data.requestKey) {
      const previous = await db.task.findUnique({ where: { createRequestKey: data.requestKey } });
      if (previous) {
        if (previous.matterId !== matter.id || previous.createRequestHash !== requestHash) throw new ActionError("此提交标识已用于不同内容，请重新打开创建表单");
        return previous;
      }
    }
    const procedureId = await assertTaskStage(db, matter.id, data.stageId);
    if (procedureId && session.user.runtimeMode === "PERSONAL") await assertPersonalProcedureOpen(db, matter.id, procedureId);
    const assigneeId = data.assigneeId || matter.ownerId;
    if (![matter.ownerId, ...matter.members.map(member => member.userId)].includes(assigneeId)) {
      throw new ActionError("请先将责任人加入本事项团队");
    }
    await assertLiveAssignees(db, [assigneeId]);
    const task = await db.task.create({
      data: {
        matterId: matter.id, title: data.title, description: data.description || null,
        assigneeId, dueAt: data.dueAt, priority: data.priority, stageId: data.stageId || null,
        createRequestKey: data.requestKey ?? null, createRequestHash: requestHash
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
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
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
    const procedureId = await assertTaskStage(db, task.matterId, data.stageId, data.stageId === task.stageId);
    if (procedureId && data.stageId !== task.stageId && session.user.runtimeMode === "PERSONAL") await assertPersonalProcedureOpen(db, task.matterId, procedureId);
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
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await refreshTasks(matterId);
  return { ok: true };
}

async function completeTaskTx(db: Prisma.TransactionClient, userId: string, id: string, reason: string, expected?: { matterId: string; revision: number }) {
  const task = await getTaskForChange(db, userId, id);
  if (expected && task.matterId !== expected.matterId) throw new ActionError("任务不属于当前事项");
  // Even a completed replay first checks the current actor, membership and archive state.
  if (task.responsibility.state === "DONE") return task.matterId;
  if (expected && task.responsibility.revision !== expected.revision) throw new ActionError("任务已变化，请重新读取后确认");
  if (task.responsibility.state === "CANCELLED") throw new ActionError("任务已取消，不能作为已办结处理；如需继续办理请先重开");
  await changeWorkTx(db, userId, { id: task.responsibility.id, revision: task.responsibility.revision, action: "COMPLETE", reason });
  return task.matterId;
}

/** Existing task buttons complete work; reopening always requires an explicit reason. */
export async function toggleTaskCompleted(id: string, expected?: { matterId: string; revision: number }) {
  const session = await requireSession("schedule.write");
  const taskId = z.string().cuid().parse(id);
  const current = z.object({ matterId: z.string().cuid(), revision: z.number().int().nonnegative() }).optional().parse(expected);
  const matterId = await approvalTransaction(db => completeTaskTx(db, session.user.id, taskId, "经办通过完成操作确认已办结", current), Prisma.TransactionIsolationLevel.ReadCommitted);
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
      const matterId = await approvalTransaction(db => completeTaskTx(db, session.user.id, taskId, data.reason), Prisma.TransactionIsolationLevel.ReadCommitted);
      changedMatters.add(matterId);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "任务办结失败" });
    }
  }
  for (const matterId of changedMatters) await revalidateMatter(matterId);
  revalidatePath("/schedule");
  revalidatePath("/");
  return { ok: true, results };
}
