import { createHash } from "node:crypto";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { customMatterFilter, matterAssociationFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import { hasCustomPermission, type RoleUser } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { procedureTypeLabel } from "@/lib/enums";
import { shDateFromKey, shDayKey } from "@/lib/ui/sh-time";
import { assertLiveAssignees } from "@/server/intakes/workflow";
import { auditTx } from "@/server/audit";
import { recordTimelineEvent } from "@/server/timeline/record";
import { changeWorkTx, type workChangeInput } from "@/server/reminders/responsibility";
import type { z } from "zod";
import { dependencyWouldCycle } from "./dependency-guard";
import {
  taskCreateSchema, taskUpdateSchema, taskWaitStartSchema, taskWaitChangeSchema, taskWaitEndSchema, taskDependencySchema, taskDependencyRemoveSchema,
  type TaskCreateInput, type TaskUpdateInput, type TaskWaitStartInput, type TaskWaitChangeInput, type TaskWaitEndInput,
  type TaskDependencyInput, type TaskDependencyRemoveInput, type MatterTasksView, type TaskSummary, type TaskDetail,
} from "./contracts";

export type TaskActor = RoleUser & { id: string };
const taskInclude = {
  stage: { select: { name: true } },
  responsibility: { include: { assignee: { select: { name: true, active: true } }, proposedAssignee: { select: { name: true } } } },
  waits: { where: { endedAt: null }, orderBy: { createdAt: "desc" } },
  prerequisites: { include: { prerequisiteTask: { select: { id: true, matterId: true, title: true, responsibility: { select: { state: true } } } } } },
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export async function taskAccess(tx: Prisma.TransactionClient, actor: TaskActor, matterId: string, write = false, allowArchived = false) {
  if (actor.runtimeMode === "PERSONAL") throw new ActionError("此功能当前仅在部署版开放");
  if (write) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  const identity = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true } });
  if (!identity?.active || (write && identity.role !== actor.role)) throw new ActionError("账号或岗位已变化，请重新登录");
  const role = await resolveRoleUser(actor.id, identity.role, tx);
  const key = write ? "schedule.write" : "schedule.read";
  if (!role.enabled || !hasCustomPermission(role, key)) throw new ActionError("当前岗位无权处理此待办");
  const user = { ...role, id: actor.id };
  const scope = write ? matterAssociationFilter(user.id) : matterReadVisibilityFilter(user.id, user.role, user.rolePermissions);
  const scheduleScope = user.role === "CUSTOM" ? customMatterFilter(user.id, user.rolePermissions, key, !write) : {};
  if (write) await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${matterId} FOR UPDATE`;
  const matter = await tx.matter.findFirst({ where: { id: matterId, deletedAt: null, AND: [scope, scheduleScope] },
    select: { id: true, status: true, ownerId: true, members: { select: { userId: true } } } });
  if (!matter) throw new ActionError("案件不存在或无权处理此案件待办");
  const associated = [matter.ownerId, ...matter.members.map(row => row.userId)].includes(user.id);
  const mayManage = associated && hasCustomPermission(user, "schedule.write");
  const canWrite = mayManage && matter.status !== "ARCHIVED";
  if (write && !canWrite && !(allowArchived && mayManage)) throw new ActionError("案件已归档，不能修改待办");
  return { user, matter, canWrite, canCancel: mayManage };
}

async function taskInMatter(tx: Prisma.TransactionClient, matterId: string, id: string, revision?: number) {
  const row = await tx.task.findFirst({ where: { id, matterId }, include: taskInclude });
  if (!row) throw new ActionError("待办不存在或不属于当前案件");
  if (!row.responsibility) throw new ActionError("待办责任记录缺失，请联系管理员核对");
  if (revision !== undefined && row.responsibility.revision !== revision) throw new ActionError("待办已变化，请刷新后重试");
  return row;
}
function requireOpen(row: TaskRow) {
  if (row.responsibility?.state !== "OPEN") throw new ActionError("待办已结束，请先填写原因重新办理");
}
async function touchResponsibility(tx: Prisma.TransactionClient, row: TaskRow) {
  await tx.workResponsibility.update({ where: { id: row.responsibility!.id }, data: { revision: { increment: 1 } } });
}
async function assertStage(tx: Prisma.TransactionClient, matterId: string, stageId?: string) {
  if (stageId && !await tx.matterStage.count({ where: { id: stageId, procedure: { matterId } } })) throw new ActionError("阶段不存在或不属于当前案件");
}
function summarize(row: TaskRow): TaskSummary {
  const work = row.responsibility;
  if (!work) throw new ActionError("待办责任记录缺失，请联系管理员核对");
  const wait = row.waits[0];
  return { id: row.id, title: row.title, description: row.description, stageId: row.stageId, stageName: row.stage?.name ?? null,
    priority: row.priority, dueAt: row.dueAt?.toISOString() ?? null, state: work.state, workId: work.id, revision: work.revision,
    assigneeId: work.assigneeId, assigneeName: work.assignee.name, assigneeActive: work.assignee.active,
    acceptedAt: work.acceptedAt?.toISOString() ?? null, proposedAssigneeId: work.proposedAssigneeId, proposedAssigneeName: work.proposedAssignee?.name ?? null,
    waiting: wait ? { id: wait.id, externalParty: wait.externalParty, nextCheckDate: shDayKey(wait.nextCheckAt) } : null,
    blockers: row.prerequisites.filter(edge => edge.prerequisiteTask.responsibility?.state !== "DONE").length,
  };
}

export async function readMatterTasks(db: PrismaClient, actor: TaskActor, matterId: string): Promise<MatterTasksView> {
  return db.$transaction(async tx => {
    const access = await taskAccess(tx, actor, matterId);
    const [rows, stages, people] = await Promise.all([
      tx.task.findMany({ where: { matterId }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], include: taskInclude }),
      tx.matterStage.findMany({ where: { procedure: { matterId } }, orderBy: [{ procedure: { order: "asc" } }, { order: "asc" }],
        select: { id: true, name: true, procedure: { select: { type: true, customLabel: true } } } }),
      tx.user.findMany({ where: { id: { in: [access.matter.ownerId, ...access.matter.members.map(row => row.userId)] }, active: true }, select: { id: true, name: true, role: true } }),
    ]);
    const eligible = await Promise.all(people.map(async person => {
      const role = await resolveRoleUser(person.id, person.role, tx);
      return role.enabled && hasCustomPermission(role, "matters.write") ? { id: person.id, name: person.name } : null;
    }));
    return { canWrite: access.canWrite, tasks: rows.map(summarize),
      stages: stages.map(stage => ({ id: stage.id, name: stage.name, procedureLabel: stage.procedure.customLabel || procedureTypeLabel[stage.procedure.type] })),
      people: eligible.filter((person): person is NonNullable<typeof person> => Boolean(person)) };
  });
}

export async function readTask(db: PrismaClient, actor: TaskActor, matterId: string, id: string): Promise<TaskDetail> {
  return db.$transaction(async tx => {
    const access = await taskAccess(tx, actor, matterId), row = await taskInMatter(tx, matterId, id);
    const [waits, dependents] = await Promise.all([
      tx.taskWait.findMany({ where: { taskId: row.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { createdBy: { select: { name: true } }, endedBy: { select: { name: true } } } }),
      tx.taskDependency.findMany({ where: { prerequisiteTaskId: row.id, task: { matterId } }, include: { task: { select: { id: true, title: true, responsibility: { select: { state: true } } } } } }),
    ]);
    const work = row.responsibility!;
    return { ...summarize(row), canWrite: access.canWrite, canCancel: access.canCancel,
      canAccept: access.canWrite && work.state === "OPEN" && (work.proposedAssigneeId ?? work.assigneeId) === actor.id,
      canDecline: access.canWrite && work.state === "OPEN" && work.proposedAssigneeId === actor.id, reason: work.reason,
      waits: waits.map(wait => ({ id: wait.id, externalParty: wait.externalParty, expectedResult: wait.expectedResult, reason: wait.reason,
        nextCheckDate: shDayKey(wait.nextCheckAt), startedAt: wait.startedAt.toISOString(), endedAt: wait.endedAt?.toISOString() ?? null,
        result: wait.result, revision: wait.revision, createdByName: wait.createdBy.name, endedByName: wait.endedBy?.name ?? null })),
      prerequisites: row.prerequisites.filter(edge => edge.prerequisiteTask.matterId === matterId).map(edge => ({ id: edge.id, taskId: edge.prerequisiteTask.id,
        title: edge.prerequisiteTask.title, state: edge.prerequisiteTask.responsibility?.state ?? "OPEN", satisfied: edge.prerequisiteTask.responsibility?.state === "DONE" })),
      dependents: dependents.map(edge => ({ id: edge.id, taskId: edge.task.id, title: edge.task.title,
        state: edge.task.responsibility?.state ?? "OPEN", satisfied: work.state === "DONE" })),
    };
  });
}

export async function createTaskTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskCreateInput) {
  const parsed = taskCreateSchema.parse(input);
  const data = { title: parsed.title, description: parsed.description || null, matterId: parsed.matterId, priority: parsed.priority,
    stageId: parsed.stageId || null, assigneeId: parsed.assigneeId || null, dueAt: parsed.dueAt?.toISOString() ?? null };
  const access = await taskAccess(tx, actor, data.matterId, true);
  const requestHash = createHash("sha256").update(JSON.stringify({ ...data, actorId: actor.id })).digest("hex");
  const previous = await tx.task.findUnique({ where: { createRequestKey: parsed.requestKey } });
  if (previous) {
    if (previous.matterId !== data.matterId || previous.createRequestHash !== requestHash) throw new ActionError("此提交标识已用于不同内容，请重新打开创建表单");
    await taskInMatter(tx, data.matterId, previous.id);
    return { ok: true as const, id: previous.id, replayed: true };
  }
  await assertStage(tx, data.matterId, data.stageId ?? undefined);
  const assigneeId = data.assigneeId ?? access.matter.ownerId;
  if (![access.matter.ownerId, ...access.matter.members.map(row => row.userId)].includes(assigneeId)) throw new ActionError("请从本案团队中选择责任人");
  await assertLiveAssignees(tx, [assigneeId]);
  const row = await tx.task.create({ data: { ...data, assigneeId, dueAt: data.dueAt ? new Date(data.dueAt) : null,
    createRequestKey: parsed.requestKey, createRequestHash: requestHash } });
  await auditTx(tx, { userId: actor.id, action: "TASK_CREATE", targetType: "Task", targetId: row.id,
    detail: { matterId: data.matterId, stageId: data.stageId, assigneeId, requestKey: parsed.requestKey } });
  await recordTimelineEvent(tx, { matterId: data.matterId, eventType: "TASK_ADDED", title: "新增待办", refType: "Task", refId: row.id });
  return { ok: true as const, id: row.id, replayed: false };
}

export async function updateTaskTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskUpdateInput) {
  const data = taskUpdateSchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true);
  const row = await taskInMatter(tx, data.matterId, data.id, data.expectedRevision); requireOpen(row);
  await assertStage(tx, data.matterId, data.stageId);
  await tx.task.update({ where: { id: row.id, matterId: data.matterId }, data: { title: data.title, description: data.description || null,
    priority: data.priority, stageId: data.stageId || null } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_UPDATE", targetType: "Task", targetId: row.id,
    detail: { matterId: data.matterId, reason: data.reason, previousRevision: data.expectedRevision, previousStageId: row.stageId, stageId: data.stageId || null } });
  return { ok: true as const, id: row.id };
}

export async function changeTaskTx(tx: Prisma.TransactionClient, actor: TaskActor, matterId: string, taskId: string, input: Omit<z.input<typeof workChangeInput>, "id">) {
  await taskAccess(tx, actor, matterId, true, input.action === "CANCEL");
  const row = await taskInMatter(tx, matterId, taskId, input.revision);
  await changeWorkTx(tx, actor.id, { ...input, id: row.responsibility!.id });
  return { ok: true as const, id: row.id };
}

export async function completeTaskTx(tx: Prisma.TransactionClient, actor: TaskActor, id: string, reason: string, allowAlreadyDone: boolean) {
  const row = await tx.task.findUnique({ where: { id }, select: { matterId: true } });
  if (!row) throw new ActionError("待办不存在或无权处理");
  await taskAccess(tx, actor, row.matterId, true);
  const task = await taskInMatter(tx, row.matterId, id);
  if (task.responsibility!.state === "DONE" && allowAlreadyDone) return { matterId: row.matterId, replayed: true };
  if (task.responsibility!.state !== "OPEN") throw new ActionError("待办已结束；如需继续办理，请填写原因重新办理");
  await changeWorkTx(tx, actor.id, { id: task.responsibility!.id, revision: task.responsibility!.revision, action: "COMPLETE", reason });
  return { matterId: row.matterId, replayed: false };
}

export async function startTaskWaitTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskWaitStartInput) {
  const data = taskWaitStartSchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true);
  const requestHash = createHash("sha256").update(JSON.stringify({ actorId: actor.id, matterId: data.matterId, taskId: data.taskId,
    externalParty: data.externalParty, expectedResult: data.expectedResult, reason: data.reason, nextCheckDate: data.nextCheckDate })).digest("hex");
  const previous = await tx.taskWait.findUnique({ where: { requestKey: data.requestKey } });
  if (previous) {
    if (previous.taskId !== data.taskId || previous.createdById !== actor.id || previous.requestHash !== requestHash) throw new ActionError("此等待提交已用于不同内容");
    await taskInMatter(tx, data.matterId, data.taskId);
    return { ok: true as const, id: previous.id, replayed: true };
  }
  const row = await taskInMatter(tx, data.matterId, data.taskId, data.expectedRevision); requireOpen(row);
  if (row.waits.length) throw new ActionError("待办已有进行中的等待，请先处理当前等待");
  const wait = await tx.taskWait.create({ data: { taskId: row.id, externalParty: data.externalParty, expectedResult: data.expectedResult,
    reason: data.reason, nextCheckAt: shDateFromKey(data.nextCheckDate), createdById: actor.id, requestKey: data.requestKey, requestHash } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_WAIT_START", targetType: "Task", targetId: row.id,
    detail: { waitId: wait.id, reason: data.reason, nextCheckDate: data.nextCheckDate, responsibilityId: row.responsibility!.id, assigneeId: row.responsibility!.assigneeId } });
  return { ok: true as const, id: wait.id, replayed: false };
}

export async function changeTaskWaitTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskWaitChangeInput) {
  const data = taskWaitChangeSchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true);
  const row = await taskInMatter(tx, data.matterId, data.taskId); requireOpen(row);
  const wait = row.waits.find(wait => wait.id === data.id);
  if (!wait || wait.revision !== data.revision) throw new ActionError("等待记录已变化，请刷新后重试");
  await tx.taskWait.update({ where: { id: wait.id, revision: data.revision, endedAt: null }, data: { nextCheckAt: shDateFromKey(data.nextCheckDate), revision: { increment: 1 } } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_WAIT_CHECK_DATE", targetType: "Task", targetId: row.id,
    detail: { waitId: wait.id, previousRevision: wait.revision, previousDate: shDayKey(wait.nextCheckAt), nextCheckDate: data.nextCheckDate, reason: data.reason } });
  return { ok: true as const, id: wait.id };
}

export async function endTaskWaitTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskWaitEndInput) {
  const data = taskWaitEndSchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true, true);
  const row = await taskInMatter(tx, data.matterId, data.taskId); requireOpen(row);
  const wait = row.waits.find(wait => wait.id === data.id);
  if (!wait || wait.revision !== data.revision) throw new ActionError("等待记录已结束或变化，请刷新后重试");
  await tx.taskWait.update({ where: { id: wait.id, revision: data.revision, endedAt: null }, data: { endedAt: new Date(), endedById: actor.id, result: data.result, revision: { increment: 1 } } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_WAIT_END", targetType: "Task", targetId: row.id,
    detail: { waitId: wait.id, previousRevision: wait.revision, result: data.result } });
  return { ok: true as const, id: wait.id };
}

export async function addTaskDependencyTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskDependencyInput) {
  const data = taskDependencySchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true);
  const row = await taskInMatter(tx, data.matterId, data.taskId, data.expectedRevision); requireOpen(row);
  await taskInMatter(tx, data.matterId, data.prerequisiteTaskId);
  if (row.prerequisites.some(edge => edge.prerequisiteTaskId === data.prerequisiteTaskId)) throw new ActionError("此前置待办已经关联");
  const edges = await tx.taskDependency.findMany({ where: { task: { matterId: data.matterId } }, select: { taskId: true, prerequisiteTaskId: true } });
  if (dependencyWouldCycle(edges, row.id, data.prerequisiteTaskId)) throw new ActionError("不能添加自身或循环依赖");
  const edge = await tx.taskDependency.create({ data: { taskId: row.id, prerequisiteTaskId: data.prerequisiteTaskId, createdById: actor.id } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_DEPENDENCY_ADD", targetType: "Task", targetId: row.id,
    detail: { dependencyId: edge.id, prerequisiteTaskId: data.prerequisiteTaskId, reason: data.reason, previousRevision: data.expectedRevision } });
  return { ok: true as const, id: edge.id };
}

export async function removeTaskDependencyTx(tx: Prisma.TransactionClient, actor: TaskActor, input: TaskDependencyRemoveInput) {
  const data = taskDependencyRemoveSchema.parse(input);
  await taskAccess(tx, actor, data.matterId, true);
  const row = await taskInMatter(tx, data.matterId, data.taskId, data.expectedRevision); requireOpen(row);
  const edge = row.prerequisites.find(edge => edge.id === data.id);
  if (!edge) throw new ActionError("依赖已不存在或不属于此待办");
  await tx.taskDependency.delete({ where: { id: edge.id } });
  await touchResponsibility(tx, row);
  await auditTx(tx, { userId: actor.id, action: "TASK_DEPENDENCY_REMOVE", targetType: "Task", targetId: row.id,
    detail: { dependencyId: edge.id, prerequisiteTaskId: edge.prerequisiteTaskId, reason: data.reason, previousRevision: data.expectedRevision } });
  return { ok: true as const, id: row.id };
}
