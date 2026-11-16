import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { procedureTypeLabel } from "@/lib/enums";
import { matterAssociationFilter, matterVisibilityFilter } from "@/lib/permissions";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import {
  taskDependenciesInput,
  taskWaitingFinishInput,
  taskWaitingRescheduleInput,
  taskWaitingStartInput,
  taskWorkspaceInput,
  type TaskWorkflowDetail,
  type TaskWorkflowItem,
  type TaskWorkflowWorkspace
} from "@/lib/tasks/workflow";
import { auditTx } from "@/server/audit";

/** Preserve existing matter business reads; only current members can manage tasks. */
export async function assertTaskMatterAccess(
  db: Prisma.TransactionClient,
  userId: string,
  matterId: string,
  access: "read" | "write"
) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("账号已停用或不存在");
  const actor = await resolveRoleUser(userId, user.role, db);
  if (!actor.enabled || !hasCustomPermission(actor, access === "read" ? "schedule.read" : "schedule.write")) {
    throw new ActionError("当前岗位无权处理任务");
  }
  if (access === "read" && actor.role === "CUSTOM" && !hasCustomPermission(actor, "matters.read")) {
    throw new ActionError("当前岗位无权读取事项任务");
  }
  // Team overview permission does not include task contents. Builtin business managers retain their existing full-matter read scope.
  const filter = access === "read" && actor.role !== "CUSTOM" && actor.role !== "FINANCE"
    ? matterVisibilityFilter(userId, actor.role, actor.rolePermissions)
    : matterAssociationFilter(userId);
  const matter = await db.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...filter },
    select: { id: true, internalCode: true, status: true, ownerId: true, members: { select: { userId: true } } }
  });
  if (!matter) throw new ActionError("事项不存在或无权处理");
  if (access === "write" && matter.status === "ARCHIVED") throw new ActionError("事项已归档，禁止修改任务");
  const associated = matter.ownerId === userId || matter.members.some(member => member.userId === userId);
  return { matter, canWrite: associated && matter.status !== "ARCHIVED" && hasCustomPermission(actor, "schedule.write") };
}

/** Called only inside approvalTransaction, which also serializes permission changes. */
export async function getTaskForChange(db: Prisma.TransactionClient, userId: string, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { responsibility: true } });
  if (!task) throw new ActionError("任务不存在或无权处理");
  await assertTaskMatterAccess(db, userId, task.matterId, "write");
  if (!task.responsibility) throw new ActionError("任务责任记录缺失");
  return { ...task, responsibility: task.responsibility };
}

function assertOpenRevision(task: Awaited<ReturnType<typeof getTaskForChange>>, revision: number) {
  if (task.responsibility.revision !== revision) throw new ActionError("任务已变化，请刷新后重试");
  if (task.responsibility.state !== "OPEN") throw new ActionError("任务已结束，请先重开");
}

const assigneeSelect = {
  name: true,
  active: true,
  role: true,
  roleDefinition: { select: { active: true, permissions: { where: { permissionKey: "matters.write" }, select: { permissionKey: true } } } }
} satisfies Prisma.UserSelect;

const taskWorkflowSelect = {
  id: true,
  matterId: true,
  stageId: true,
  stage: { select: { name: true, procedure: { select: { matterId: true, type: true, customLabel: true } } } },
  title: true,
  description: true,
  completed: true,
  assigneeId: true,
  dueAt: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  responsibility: {
    select: {
      id: true, revision: true, state: true, assigneeId: true,
      assignee: { select: assigneeSelect },
      proposedAssigneeId: true, proposedAssignee: { select: { name: true } },
      acceptedAt: true, reason: true
    }
  },
  waitings: {
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, waitingFor: true, expectedResult: true, nextCheckAt: true, startedAt: true,
      endedAt: true, result: true, createdById: true, endedById: true
    }
  },
  prerequisites: {
    orderBy: [{ createdAt: "asc" }, { prerequisiteId: "asc" }],
    select: { prerequisite: { select: { id: true, matterId: true, title: true, responsibility: { select: { state: true } } } } }
  }
} satisfies Prisma.TaskSelect;

function taskWorkflowItem(task: Prisma.TaskGetPayload<{ select: typeof taskWorkflowSelect }>): TaskWorkflowItem {
  const responsibility = task.responsibility;
  if (!responsibility) throw new ActionError("任务责任记录缺失");
  if (task.stage && task.stage.procedure.matterId !== task.matterId) throw new ActionError("任务的环节归属异常，请核对记录");
  const assignee = responsibility.assignee;
  const active = assignee.active && (assignee.role !== "CUSTOM" || Boolean(assignee.roleDefinition?.active && assignee.roleDefinition.permissions.length));
  return {
    id: task.id, matterId: task.matterId, stageId: task.stageId,
    stageName: task.stage?.name ?? null,
    procedureTitle: task.stage ? task.stage.procedure.customLabel ?? procedureTypeLabel[task.stage.procedure.type] : null,
    title: task.title, description: task.description, dueAt: task.dueAt, priority: task.priority,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    responsibility: {
      id: responsibility.id, revision: responsibility.revision, state: responsibility.state,
      assigneeId: responsibility.assigneeId, name: assignee.name, active,
      proposedAssigneeId: responsibility.proposedAssigneeId, proposedName: responsibility.proposedAssignee?.name ?? null,
      acceptedAt: responsibility.acceptedAt, reason: responsibility.reason
    },
    activeWaiting: task.waitings.find(waiting => waiting.endedAt === null) ?? null,
    waitings: task.waitings,
    prerequisites: task.prerequisites.map(({ prerequisite }) => {
      if (prerequisite.matterId !== task.matterId || !prerequisite.responsibility) throw new ActionError("任务前置关系异常，请核对记录");
      return { id: prerequisite.id, title: prerequisite.title, state: prerequisite.responsibility.state };
    })
  };
}

async function taskPeople(db: Prisma.TransactionClient, matter: Awaited<ReturnType<typeof assertTaskMatterAccess>>["matter"]) {
  return db.user.findMany({
    where: {
      id: { in: [...new Set([matter.ownerId, ...matter.members.map(member => member.userId)])] },
      active: true,
      OR: [
        { role: { not: "CUSTOM" } },
        { role: "CUSTOM", roleDefinition: { is: { active: true, permissions: { some: { permissionKey: "matters.write" } } } } }
      ]
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true }
  });
}

export async function readTaskWorkspaceTx(
  db: Prisma.TransactionClient,
  userId: string,
  input: z.input<typeof taskWorkspaceInput>
): Promise<TaskWorkflowWorkspace> {
  const data = taskWorkspaceInput.parse(input);
  const { matter, canWrite } = await assertTaskMatterAccess(db, userId, data.matterId, "read");
  const tasks = await db.task.findMany({
    where: {
      matterId: matter.id,
      ...(data.includeClosed ? {} : { OR: [{ responsibility: { is: { state: "OPEN" } } }, { responsibility: null }] })
    },
    orderBy: [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    select: taskWorkflowSelect
  });
  const missingResponsibility = tasks.filter(task => task.responsibility === null);
  const assigneeIds = [...new Set(missingResponsibility.map(task => task.assigneeId).filter((id): id is string => Boolean(id)))];
  const assignees = assigneeIds.length ? await db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } }) : [];
  const assigneeNames = new Map(assignees.map(person => [person.id, person.name]));
  return {
    tasks: tasks.filter(task => task.responsibility !== null).map(taskWorkflowItem),
    untrackedTasks: missingResponsibility.map(task => {
      const validStage = task.stage?.procedure.matterId === task.matterId;
      return { id: task.id, title: task.title, stageName: validStage ? task.stage?.name ?? null : task.stage ? "环节归属待核实" : null,
        procedureTitle: validStage && task.stage ? task.stage.procedure.customLabel ?? procedureTypeLabel[task.stage.procedure.type] : null,
        dueAt: task.dueAt, completed: task.completed, assigneeName: task.assigneeId ? assigneeNames.get(task.assigneeId) ?? null : null };
    }),
    people: await taskPeople(db, matter), canWrite, currentUserId: userId
  };
}

export async function readTaskWorkflowTx(db: Prisma.TransactionClient, userId: string, taskId: string, expectedMatterId?: string): Promise<TaskWorkflowDetail> {
  const id = z.string().cuid().parse(taskId);
  const expectedMatter = expectedMatterId === undefined ? undefined : z.string().cuid().parse(expectedMatterId);
  const reference = await db.task.findUnique({ where: { id }, select: { matterId: true } });
  if (!reference) throw new ActionError("任务不存在或无权查看");
  const { matter, canWrite } = await assertTaskMatterAccess(db, userId, reference.matterId, "read");
  if (expectedMatter !== undefined && reference.matterId !== expectedMatter) throw new ActionError("任务不属于当前事项，请从对应事项打开");
  const task = await db.task.findUniqueOrThrow({ where: { id }, select: taskWorkflowSelect });
  return { task: taskWorkflowItem(task), people: await taskPeople(db, matter), canWrite, currentUserId: userId };
}

export async function saveTaskDependenciesTx(db: Prisma.TransactionClient, userId: string, input: z.input<typeof taskDependenciesInput>) {
  const data = taskDependenciesInput.parse(input);
  const task = await getTaskForChange(db, userId, data.taskId);
  assertOpenRevision(task, data.revision);
  const prerequisiteIds = [...new Set(data.prerequisiteIds)].sort();
  if (prerequisiteIds.includes(task.id)) throw new ActionError("任务不能以自身作为前置");
  const prerequisites = await db.task.findMany({
    where: { id: { in: prerequisiteIds }, matterId: task.matterId },
    select: { id: true, responsibility: { select: { id: true } } }
  });
  if (prerequisites.length !== prerequisiteIds.length) throw new ActionError("前置任务不存在或不属于同一事项");
  if (prerequisites.some(prerequisite => !prerequisite.responsibility)) throw new ActionError("前置任务责任记录缺失");
  if (prerequisiteIds.length) {
    // UNION terminates even if an existing malformed graph contains a cycle. No depth cutoff.
    const [cycle] = await db.$queryRaw<{ found: boolean }[]>(Prisma.sql`
      WITH RECURSIVE predecessors(id) AS (
        SELECT id FROM "Task" WHERE id IN (${Prisma.join(prerequisiteIds)})
        UNION
        SELECT edge."prerequisiteId" FROM "TaskDependency" edge JOIN predecessors p ON edge."taskId" = p.id
      ) SELECT EXISTS(SELECT 1 FROM predecessors WHERE id = ${task.id}) AS found
    `);
    if (cycle.found) throw new ActionError("该前置关系会形成循环，请调整选择");
  }
  const existing = await db.taskDependency.findMany({ where: { taskId: task.id }, select: { prerequisiteId: true } });
  const previousIds = existing.map(edge => edge.prerequisiteId);
  const added = prerequisiteIds.filter(id => !previousIds.includes(id));
  const removed = previousIds.filter(id => !prerequisiteIds.includes(id));
  if (!added.length && !removed.length) return { matterId: task.matterId };
  if (removed.length) await db.taskDependency.deleteMany({ where: { taskId: task.id, prerequisiteId: { in: removed } } });
  if (added.length) await db.taskDependency.createMany({ data: added.map(prerequisiteId => ({ taskId: task.id, prerequisiteId, createdById: userId })) });
  await db.workResponsibility.update({ where: { id: task.responsibility.id }, data: { revision: { increment: 1 } } });
  await auditTx(db, {
    userId, action: "TASK_DEPENDENCIES_CHANGE", targetType: "Task", targetId: task.id,
    detail: { previousRevision: data.revision, added, removed, reason: data.reason }
  });
  return { matterId: task.matterId };
}

export async function startTaskWaitingTx(db: Prisma.TransactionClient, userId: string, input: z.input<typeof taskWaitingStartInput>) {
  const data = taskWaitingStartInput.parse(input);
  const task = await getTaskForChange(db, userId, data.taskId);
  const existing = await db.taskWaiting.findUnique({ where: { id: data.waitingId } });
  if (existing) {
    if (existing.taskId !== task.id || existing.createdById !== userId || existing.waitingFor !== data.waitingFor ||
      existing.expectedResult !== data.expectedResult || existing.initialCheckAt.getTime() !== data.nextCheckAt.getTime()) {
      throw new ActionError("该等待登记标识已用于不同内容，请刷新并重新登记");
    }
    // A retry returns the original registration, including after rescheduling, closing or task completion.
    return { matterId: task.matterId };
  }
  assertOpenRevision(task, data.revision);
  if (await db.taskWaiting.findFirst({ where: { taskId: task.id, endedAt: null }, select: { id: true } })) {
    throw new ActionError("此任务仍有未结束的等待，请先记录结束结果");
  }
  await db.taskWaiting.create({
    data: {
      id: data.waitingId, taskId: task.id, waitingFor: data.waitingFor, expectedResult: data.expectedResult,
      initialCheckAt: data.nextCheckAt, nextCheckAt: data.nextCheckAt, createdById: userId
    }
  });
  await db.workResponsibility.update({ where: { id: task.responsibility.id }, data: { revision: { increment: 1 } } });
  await auditTx(db, {
    userId, action: "TASK_WAITING_START", targetType: "Task", targetId: task.id,
    detail: { waitingId: data.waitingId, waitingFor: data.waitingFor, expectedResult: data.expectedResult, nextCheckAt: data.nextCheckAt.toISOString(), previousRevision: data.revision }
  });
  return { matterId: task.matterId };
}

export async function finishTaskWaitingTx(db: Prisma.TransactionClient, userId: string, input: z.input<typeof taskWaitingFinishInput>) {
  const data = taskWaitingFinishInput.parse(input);
  const task = await getTaskForChange(db, userId, data.taskId);
  const waiting = await db.taskWaiting.findFirst({ where: { id: data.waitingId, taskId: task.id } });
  if (!waiting) throw new ActionError("等待记录不存在或不属于此任务");
  if (waiting.endedAt) {
    if (waiting.endedById === userId && waiting.result === data.result) return { matterId: task.matterId };
    throw new ActionError("此等待已经结束，原结果保留");
  }
  assertOpenRevision(task, data.revision);
  await db.taskWaiting.update({ where: { id: waiting.id }, data: { endedAt: new Date(), endedById: userId, result: data.result } });
  await db.workResponsibility.update({ where: { id: task.responsibility.id }, data: { revision: { increment: 1 } } });
  await auditTx(db, {
    userId, action: "TASK_WAITING_FINISH", targetType: "Task", targetId: task.id,
    detail: { waitingId: waiting.id, result: data.result, previousRevision: data.revision }
  });
  return { matterId: task.matterId };
}

export async function rescheduleTaskWaitingTx(db: Prisma.TransactionClient, userId: string, input: z.input<typeof taskWaitingRescheduleInput>) {
  const data = taskWaitingRescheduleInput.parse(input);
  const task = await getTaskForChange(db, userId, data.taskId);
  assertOpenRevision(task, data.revision);
  const waiting = await db.taskWaiting.findFirst({ where: { id: data.waitingId, taskId: task.id } });
  if (!waiting || waiting.endedAt) throw new ActionError("等待不存在或已经结束");
  if (waiting.nextCheckAt.getTime() === data.nextCheckAt.getTime()) return { matterId: task.matterId };
  await db.taskWaiting.update({ where: { id: waiting.id }, data: { nextCheckAt: data.nextCheckAt } });
  await db.workResponsibility.update({ where: { id: task.responsibility.id }, data: { revision: { increment: 1 } } });
  await auditTx(db, {
    userId, action: "TASK_WAITING_RESCHEDULE", targetType: "Task", targetId: task.id,
    detail: { waitingId: waiting.id, previousCheckAt: waiting.nextCheckAt.toISOString(), nextCheckAt: data.nextCheckAt.toISOString(), reason: data.reason, previousRevision: data.revision }
  });
  return { matterId: task.matterId };
}

/** Shared by every Task COMPLETE path through changeWorkTx. Cancellation never satisfies a prerequisite. */
export async function assertTaskCompletionTx(db: Prisma.TransactionClient, taskId: string, matterId: string) {
  const prerequisites = await db.taskDependency.findMany({
    where: { taskId },
    select: { prerequisite: { select: { matterId: true, title: true, responsibility: { select: { state: true } } } } }
  });
  if (prerequisites.some(({ prerequisite }) => prerequisite.matterId !== matterId)) throw new ActionError("任务前置关系异常，请核对记录");
  const blocking = prerequisites.filter(({ prerequisite }) => prerequisite.responsibility?.state !== "DONE");
  if (blocking.length) throw new ActionError(`前置任务尚未办结：${blocking.map(({ prerequisite }) => prerequisite.title).join("、")}`);
  if (await db.taskWaiting.findFirst({ where: { taskId, endedAt: null }, select: { id: true } })) {
    throw new ActionError("任务仍在等待外部成果，请先记录等待结束的实际结果");
  }
}

/** Cancellation ends the wait as cancellation, without claiming that an external reply arrived. */
export async function cancelTaskWaitingTx(db: Prisma.TransactionClient, userId: string, taskId: string, reason: string) {
  const waiting = await db.taskWaiting.findFirst({ where: { taskId, endedAt: null }, select: { id: true } });
  if (!waiting) return null;
  const result = `任务取消：${reason}`;
  await db.taskWaiting.update({ where: { id: waiting.id }, data: { endedAt: new Date(), endedById: userId, result } });
  await auditTx(db, {
    userId, action: "TASK_WAITING_CANCEL", targetType: "Task", targetId: taskId,
    detail: { waitingId: waiting.id, result }
  });
  return waiting.id;
}
