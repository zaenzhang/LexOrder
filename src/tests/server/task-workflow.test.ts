// @vitest-environment node
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, resolveRoleUser, auditTx, matterVisibilityFilter } = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    matter: { findFirst: vi.fn() },
    task: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    taskDependency: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    taskWaiting: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workResponsibility: { update: vi.fn() },
    deadline: { update: vi.fn() }
  },
  resolveRoleUser: vi.fn(),
  auditTx: vi.fn(),
  matterVisibilityFilter: vi.fn()
}));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser }));
vi.mock("@/lib/permissions", () => ({
  matterAssociationFilter: (id: string) => ({ OR: [{ ownerId: id }, { members: { some: { userId: id } } }] }),
  matterVisibilityFilter
}));
vi.mock("@/server/audit", () => ({ auditTx }));

import {
  assertTaskCompletionTx,
  cancelTaskWaitingTx,
  finishTaskWaitingTx,
  readTaskWorkflowTx,
  readTaskWorkspaceTx,
  rescheduleTaskWaitingTx,
  saveTaskDependenciesTx,
  startTaskWaitingTx
} from "@/server/tasks/workflow-service";

const tx = db as unknown as Prisma.TransactionClient;
const userId = "cuser00000000000000000001";
const matterId = "cmatter000000000000000001";
const taskId = "ctask00000000000000000001";
const prerequisiteId = "ctask00000000000000000002";
const waitingId = "e631d4fc-b652-4aca-86f1-10dbe0441788";
const checkDate = new Date("2026-11-18T08:00:00.000Z");
const startInput = { taskId, revision: 3, waitingId, waitingFor: "客户项目组", expectedResult: "已核实的资料", nextCheckAt: checkDate };
const responsibility = () => ({ id: "work_task", revision: 3, state: "OPEN", assigneeId: userId });
const task = () => ({ id: taskId, matterId, stageId: null, dueAt: null, completed: false, responsibility: responsibility() });
const waiting = () => ({ id: waitingId, taskId, waitingFor: startInput.waitingFor, expectedResult: startInput.expectedResult,
  initialCheckAt: checkDate, nextCheckAt: checkDate, createdById: userId, startedAt: new Date("2026-11-16T08:00:00Z"), endedAt: null, endedById: null, result: null });

beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  db.user.findMany.mockResolvedValue([{ id: userId, name: "经办" }]);
  resolveRoleUser.mockResolvedValue({ enabled: true, role: "LAWYER" });
  matterVisibilityFilter.mockImplementation((id: string) => ({ OR: [{ ownerId: id }, { members: { some: { userId: id } } }] }));
  db.matter.findFirst.mockResolvedValue({ id: matterId, internalCode: "TEST-M3", status: "ACTIVE", ownerId: userId, members: [] });
  db.task.findUnique.mockResolvedValue(task());
  db.task.findMany.mockResolvedValue([{ id: prerequisiteId, responsibility: { id: "work_prior" } }]);
  db.taskDependency.findMany.mockResolvedValue([]);
  db.taskWaiting.findUnique.mockResolvedValue(null);
  db.taskWaiting.findFirst.mockResolvedValue(null);
  db.$queryRaw.mockResolvedValue([{ found: false }]);
});

describe("任务前置的服务规则", () => {
  it.each(["OPEN", "CANCELLED", null])("前置责任为 %s 时不能完成后置任务", async state => {
    db.taskDependency.findMany.mockResolvedValue([{ prerequisite: { matterId, title: "取得确认", responsibility: state ? { state } : null } }]);
    await expect(assertTaskCompletionTx(tx, taskId, matterId)).rejects.toThrow("前置任务尚未办结");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("前置仅在 DONE 满足；重开后再次阻止未来办结", async () => {
    db.taskDependency.findMany.mockResolvedValueOnce([{ prerequisite: { matterId, title: "取得确认", responsibility: { state: "DONE" } } }]);
    await expect(assertTaskCompletionTx(tx, taskId, matterId)).resolves.toBeUndefined();
    db.taskDependency.findMany.mockResolvedValueOnce([{ prerequisite: { matterId, title: "取得确认", responsibility: { state: "OPEN" } } }]);
    await expect(assertTaskCompletionTx(tx, taskId, matterId)).rejects.toThrow("取得确认");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("跨事项前置不泄露标题，也不能新增跨事项关系", async () => {
    db.taskDependency.findMany.mockResolvedValue([{ prerequisite: { matterId: "another", title: "不可读标题", responsibility: { state: "DONE" } } }]);
    await expect(assertTaskCompletionTx(tx, taskId, matterId)).rejects.toThrow("前置关系异常");
    db.task.findMany.mockResolvedValue([]);
    await expect(saveTaskDependenciesTx(tx, userId, { taskId, revision: 3, prerequisiteIds: [prerequisiteId], reason: "先取得资料" })).rejects.toThrow("不属于同一事项");
    expect(db.taskDependency.createMany).not.toHaveBeenCalled();
  });

  it("自依赖、循环和陈旧责任版本都在写入前拒绝", async () => {
    await expect(saveTaskDependenciesTx(tx, userId, { taskId, revision: 3, prerequisiteIds: [taskId], reason: "先取得资料" })).rejects.toThrow("自身");
    db.$queryRaw.mockResolvedValue([{ found: true }]);
    await expect(saveTaskDependenciesTx(tx, userId, { taskId, revision: 3, prerequisiteIds: [prerequisiteId], reason: "先取得资料" })).rejects.toThrow("循环");
    await expect(saveTaskDependenciesTx(tx, userId, { taskId, revision: 2, prerequisiteIds: [], reason: "无需等待" })).rejects.toThrow("已变化");
    expect(db.taskDependency.createMany).not.toHaveBeenCalled();
    expect(db.taskDependency.deleteMany).not.toHaveBeenCalled();
  });

  it("有资格者明确解除关系时保存理由和原责任版本", async () => {
    db.task.findMany.mockResolvedValue([]);
    db.taskDependency.findMany.mockResolvedValue([{ prerequisiteId }]);
    await saveTaskDependenciesTx(tx, userId, { taskId, revision: 3, prerequisiteIds: [], reason: "该资料取消，依现有材料继续" });
    expect(db.taskDependency.deleteMany).toHaveBeenCalledWith({ where: { taskId, prerequisiteId: { in: [prerequisiteId] } } });
    expect(auditTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "TASK_DEPENDENCIES_CHANGE", detail: expect.objectContaining({ removed: [prerequisiteId], reason: "该资料取消，依现有材料继续", previousRevision: 3 }) }));
    expect(db.workResponsibility.update).toHaveBeenCalledWith({ where: { id: "work_task" }, data: { revision: { increment: 1 } } });
  });
});

describe("外部等待记录", () => {
  it("登记等待保留内部责任，不改任务安排或法定日期", async () => {
    await startTaskWaitingTx(tx, userId, { ...startInput, waitingFor: ` ${startInput.waitingFor} ` });
    expect(db.taskWaiting.create).toHaveBeenCalledWith({ data: { id: waitingId, taskId, waitingFor: startInput.waitingFor, expectedResult: startInput.expectedResult, reason: null, initialCheckAt: checkDate, nextCheckAt: checkDate, createdById: userId } });
    expect(db.workResponsibility.update).toHaveBeenCalledWith({ where: { id: "work_task" }, data: { revision: { increment: 1 } } });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.deadline.update).not.toHaveBeenCalled();
  });

  it("改期并结束后重放原登记，只认不可变初始日期且不恢复等待", async () => {
    db.task.findUnique.mockResolvedValue({ ...task(), responsibility: { ...responsibility(), revision: 9, state: "DONE" } });
    db.taskWaiting.findUnique.mockResolvedValue({ ...waiting(), nextCheckAt: new Date("2026-11-25T08:00:00Z"), endedAt: new Date(), endedById: userId, result: "已收齐" });
    await expect(startTaskWaitingTx(tx, userId, startInput)).resolves.toEqual({ matterId });
    expect(db.taskWaiting.create).not.toHaveBeenCalled();
    expect(db.taskWaiting.update).not.toHaveBeenCalled();
    expect(db.workResponsibility.update).not.toHaveBeenCalled();
    expect(auditTx).not.toHaveBeenCalled();
  });

  it.each([
    { waitingFor: "另一对象" },
    { expectedResult: "另一成果" },
    { initialCheckAt: new Date("2026-11-19T08:00:00Z") },
    { createdById: "another-user" },
    { taskId: prerequisiteId }
  ])("同一登记标识不能换载荷、作者或任务：%j", async mismatch => {
    db.taskWaiting.findUnique.mockResolvedValue({ ...waiting(), ...mismatch });
    await expect(startTaskWaitingTx(tx, userId, startInput)).rejects.toThrow("不同内容");
    expect(db.taskWaiting.create).not.toHaveBeenCalled();
  });

  it("撤销关联或岗位授权后，旧请求也不能重放成功", async () => {
    db.taskWaiting.findUnique.mockResolvedValue(waiting());
    db.matter.findFirst.mockResolvedValueOnce(null);
    await expect(startTaskWaitingTx(tx, userId, startInput)).rejects.toThrow("无权处理");
    resolveRoleUser.mockResolvedValue({ enabled: true, role: "CUSTOM", rolePermissions: [{ permissionKey: "schedule.read", scope: "OWN" }] });
    await expect(startTaskWaitingTx(tx, userId, startInput)).rejects.toThrow("当前岗位");
    expect(db.taskWaiting.findUnique).not.toHaveBeenCalled();
  });

  it("一次只能保留一个开放等待；未结束的等待阻止完成", async () => {
    db.taskWaiting.findFirst.mockResolvedValue(waiting());
    await expect(startTaskWaitingTx(tx, userId, startInput)).rejects.toThrow("仍有未结束");
    await expect(assertTaskCompletionTx(tx, taskId, matterId)).rejects.toThrow("实际结果");
    expect(db.taskWaiting.create).not.toHaveBeenCalled();
  });

  it("调整检查日只更新该等待的当前日期，保留初始请求和理由", async () => {
    db.taskWaiting.findFirst.mockResolvedValue(waiting());
    const nextCheckAt = new Date("2026-11-25T08:00:00Z");
    await rescheduleTaskWaitingTx(tx, userId, { taskId, revision: 3, waitingId, nextCheckAt, reason: "客户承诺下周反馈" });
    expect(db.taskWaiting.update).toHaveBeenCalledWith({ where: { id: waitingId }, data: { nextCheckAt } });
    expect(auditTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "TASK_WAITING_RESCHEDULE", detail: expect.objectContaining({ previousCheckAt: checkDate.toISOString(), nextCheckAt: nextCheckAt.toISOString(), reason: "客户承诺下周反馈" }) }));
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.deadline.update).not.toHaveBeenCalled();
  });

  it("记录结果不完成任务，结束后不覆盖历史结果", async () => {
    db.taskWaiting.findFirst.mockResolvedValueOnce(waiting());
    await finishTaskWaitingTx(tx, userId, { taskId, revision: 3, waitingId, result: "客户说明无法提供" });
    expect(db.taskWaiting.update).toHaveBeenCalledWith({ where: { id: waitingId }, data: { endedAt: expect.any(Date), endedById: userId, result: "客户说明无法提供" } });
    expect(db.task.update).not.toHaveBeenCalled();
    db.taskWaiting.findFirst.mockResolvedValue({ ...waiting(), endedAt: new Date(), endedById: userId, result: "客户说明无法提供" });
    await expect(finishTaskWaitingTx(tx, userId, { taskId, revision: 3, waitingId, result: "假改为已收到" })).rejects.toThrow("原结果保留");
  });

  it("取消结束等待明确写取消原因，不声称收到答复或解除依赖", async () => {
    db.taskWaiting.findFirst.mockResolvedValue(waiting());
    await expect(cancelTaskWaitingTx(tx, userId, taskId, "委托终止")).resolves.toBe(waitingId);
    expect(db.taskWaiting.update).toHaveBeenCalledWith({ where: { id: waitingId }, data: { endedAt: expect.any(Date), endedById: userId, result: "任务取消：委托终止" } });
    expect(auditTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "TASK_WAITING_CANCEL", detail: { waitingId, result: "任务取消：委托终止" } }));
    expect(db.taskDependency.deleteMany).not.toHaveBeenCalled();
  });
});

describe("事项级任务读取", () => {
  it("用户可读两案也不能把别案任务放进当前事项详情", async () => {
    await expect(readTaskWorkflowTx(tx, userId, taskId, "cmatter000000000000000002")).rejects.toThrow("不属于当前事项");
    expect(db.task.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("无程序/环节的任务可从全案列表保存后重新打开", async () => {
    const record = {
      ...task(), stage: null, title: "跟进实际材料", description: null, priority: 0, createdAt: checkDate, updatedAt: checkDate,
      responsibility: { ...responsibility(), assignee: { name: "经办", active: true, role: "LAWYER", roleDefinition: null }, proposedAssigneeId: null, proposedAssignee: null, acceptedAt: null, reason: null },
      waitings: [], prerequisites: []
    };
    db.task.findMany.mockResolvedValue([record]);
    db.task.findUniqueOrThrow.mockResolvedValue(record);
    const workspace = await readTaskWorkspaceTx(tx, userId, { matterId });
    const detail = await readTaskWorkflowTx(tx, userId, taskId);
    expect(workspace.tasks).toHaveLength(1);
    expect(workspace.tasks[0]).toEqual(detail.task);
    expect(detail).toMatchObject({ task: { id: taskId, matterId, stageId: null, stageName: null, procedureTitle: null }, canWrite: true, currentUserId: userId });
  });

  it("既有任务缺少责任记录时，列表仍显示该任务且不伪造责任状态", async () => {
    db.task.findMany.mockResolvedValue([{ ...task(), title: "历史待核任务", assigneeId: userId, stage: { name: "举证", procedure: { matterId, type: "FIRST_INSTANCE", customLabel: null } }, responsibility: null }]);
    const workspace = await readTaskWorkspaceTx(tx, userId, { matterId, includeClosed: true });
    expect(workspace.tasks).toEqual([]);
    expect(workspace.untrackedTasks).toEqual([{ id: taskId, title: "历史待核任务", stageName: "举证", procedureTitle: "一审", dueAt: null, completed: false, assigneeName: "经办" }]);
  });

  it("只有任务读取权时返回只读；团队只读不能取代当前事项关联", async () => {
    resolveRoleUser.mockResolvedValue({ enabled: true, role: "CUSTOM", rolePermissions: [{ permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "matters.read", scope: "OWN" }] });
    db.task.findMany.mockResolvedValue([]);
    await expect(readTaskWorkspaceTx(tx, userId, { matterId })).resolves.toMatchObject({ canWrite: false });
    db.matter.findFirst.mockResolvedValue(null);
    await expect(readTaskWorkspaceTx(tx, userId, { matterId })).rejects.toThrow("无权处理");
  });

  it.each([
    { role: "PRINCIPAL_LAWYER", rolePermissions: undefined },
    { role: "LAWYER", rolePermissions: [{ permissionKey: "matters.read", scope: "ALL" }] }
  ])("保留内置业务管理人的非经办读取，仍拒绝写入：%j", async actor => {
    db.user.findUnique.mockResolvedValue({ active: true, role: actor.role });
    resolveRoleUser.mockResolvedValue({ enabled: true, ...actor });
    matterVisibilityFilter.mockReturnValue({});
    db.matter.findFirst.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => where.OR ? null : {
      id: matterId, internalCode: "TEST-M3", status: "ACTIVE", ownerId: "cuser00000000000000000002", members: []
    });
    db.task.findMany.mockResolvedValue([]);
    await expect(readTaskWorkspaceTx(tx, userId, { matterId })).resolves.toMatchObject({ canWrite: false });
    expect(matterVisibilityFilter).toHaveBeenCalledWith(userId, actor.role, actor.rolePermissions);
    await expect(startTaskWaitingTx(tx, userId, startInput)).rejects.toThrow("无权处理");
    expect(db.taskWaiting.create).not.toHaveBeenCalled();
  });

  it("CUSTOM 全所概况授权不开放非经办任务正文", async () => {
    resolveRoleUser.mockResolvedValue({ enabled: true, role: "CUSTOM", rolePermissions: [
      { permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "matters.read", scope: "ALL" }
    ] });
    db.matter.findFirst.mockResolvedValue(null);
    await expect(readTaskWorkspaceTx(tx, userId, { matterId })).rejects.toThrow("无权处理");
    expect(matterVisibilityFilter).not.toHaveBeenCalled();
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
});
