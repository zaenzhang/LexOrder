// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, getTaskForChange, changeWorkTx, approvalTransaction, saveTaskDependenciesTx } = vi.hoisted(() => {
  const db = { task: { update: vi.fn() }, matterStage: { findFirst: vi.fn() }, workResponsibility: { update: vi.fn() } };
  return { db, getTaskForChange: vi.fn(), changeWorkTx: vi.fn(), saveTaskDependenciesTx: vi.fn(), approvalTransaction: vi.fn(async (fn: (value: typeof db) => Promise<unknown>) => fn(db)) };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "cuser00000000000000000001" } })) }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction }));
vi.mock("@/server/tasks/workflow-service", () => ({ getTaskForChange, assertTaskMatterAccess: vi.fn(), saveTaskDependenciesTx }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/reminders/urgent", () => ({ scanAdditionalWorkReminders: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ refreshScheduleReminderAfterSave: vi.fn() }));
vi.mock("@/server/reminders/responsibility", () => ({ changeWorkTx }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));
vi.mock("@/server/intakes/workflow", () => ({ assertLiveAssignees: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { completeTasksBatch, toggleTaskCompleted, updateTask } from "@/server/tasks/actions";
import { saveTaskDependencies } from "@/server/tasks/workflow-actions";
import { changeWork } from "@/server/reminders/work-actions";
import { revalidatePath } from "next/cache";

const taskId = "ctask00000000000000000001";
const nextTaskId = "ctask00000000000000000002";
const cancelledId = "ctask00000000000000000003";
const matterId = "cmatter000000000000000001";
const actorId = "cuser00000000000000000001";
const task = (id = taskId, state = "OPEN") => ({
  id, matterId, stageId: "cstage0000000000000000001", dueAt: new Date("2026-11-20T08:00:00Z"), completed: true,
  responsibility: { id: `work_${id}`, revision: 7, state, assigneeId: actorId }
});

beforeEach(() => {
  vi.clearAllMocks();
  getTaskForChange.mockReset();
  changeWorkTx.mockReset();
  getTaskForChange.mockResolvedValue(task());
});

describe("单条与批量办结接统一责任服务", () => {
  it("G02 任务、依赖及责任变更都刷新实际首页；批量出口不遗漏", async () => {
    await toggleTaskCompleted(taskId);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    vi.mocked(revalidatePath).mockClear();
    await completeTasksBatch({ ids: [taskId], reason: "真实处理结果" });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    vi.mocked(revalidatePath).mockClear();
    saveTaskDependenciesTx.mockResolvedValue({ matterId });
    await saveTaskDependencies({ taskId, revision: 7, prerequisiteIds: [], reason: "确认无需前置" });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    vi.mocked(revalidatePath).mockClear();
    changeWorkTx.mockResolvedValue({ kind: "Task", targetId: taskId, matterId });
    await changeWork({ id: `work_${taskId}`, revision: 7, action: "COMPLETE", reason: "核对完成" });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).not.toHaveBeenCalledWith("/dashboard");
  });

  it("Task.completed 即使为 true，只要责任仍 OPEN 就必须走核心完成检查", async () => {
    await toggleTaskCompleted(taskId);
    expect(approvalTransaction).toHaveBeenCalledOnce();
    expect(getTaskForChange).toHaveBeenCalledWith(db, actorId, taskId);
    expect(changeWorkTx).toHaveBeenCalledWith(db, actorId, { id: `work_${taskId}`, revision: 7, action: "COMPLETE", reason: "经办通过完成操作确认已办结" });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("取消记录不能被单条或批量完成当成成功", async () => {
    getTaskForChange.mockResolvedValue(task(taskId, "CANCELLED"));
    await expect(toggleTaskCompleted(taskId)).rejects.toThrow("任务已取消");
    expect(await completeTasksBatch({ ids: [taskId], reason: "办结" })).toMatchObject({ results: [{ id: taskId, ok: false, error: expect.stringContaining("任务已取消") }] });
    expect(changeWorkTx).not.toHaveBeenCalled();
  });

  it("DONE 重放也先核当前资格；撤权不能提前返回成功", async () => {
    getTaskForChange.mockResolvedValueOnce(task(taskId, "DONE"));
    await expect(toggleTaskCompleted(taskId)).resolves.toEqual({ ok: true });
    getTaskForChange.mockRejectedValueOnce(new Error("无权处理此事项"));
    await expect(toggleTaskCompleted(taskId)).rejects.toThrow("无权处理");
    getTaskForChange.mockRejectedValueOnce(new Error("无权处理此事项"));
    expect(await completeTasksBatch({ ids: [taskId], reason: "办结" })).toMatchObject({ results: [{ id: taskId, ok: false }] });
    expect(getTaskForChange).toHaveBeenCalledTimes(3);
    expect(changeWorkTx).not.toHaveBeenCalled();
  });

  it("批量按提交顺序逐项处理，前置阻断不拖垮其余结果", async () => {
    getTaskForChange.mockImplementation(async (_db, _actor, id: string) => task(id, id === cancelledId ? "CANCELLED" : "OPEN"));
    changeWorkTx.mockImplementation(async (_db, _actor, input: { id: string }) => {
      if (input.id === `work_${taskId}`) throw new Error("前置任务尚未办结");
    });
    const result = await completeTasksBatch({ ids: [taskId, nextTaskId, cancelledId], reason: "确认已处理" });
    expect(result.results).toEqual([
      { id: taskId, ok: false, error: "前置任务尚未办结" },
      { id: nextTaskId, ok: true },
      { id: cancelledId, ok: false, error: expect.stringContaining("任务已取消") }
    ]);
    expect(getTaskForChange.mock.calls.map(call => call[2])).toEqual([taskId, nextTaskId, cancelledId]);
    expect(approvalTransaction).toHaveBeenCalledTimes(3);
  });

  it("一个无效任务标识只形成该项失败，其余任务仍处理", async () => {
    const result = await completeTasksBatch({ ids: ["", taskId], reason: "确认已处理" });
    expect(result.results).toEqual([{ id: "", ok: false, error: expect.stringContaining("任务标识无效") }, { id: taskId, ok: true }]);
    expect(changeWorkTx).toHaveBeenCalledOnce();
  });
});

describe("任务概况编辑的单一合同", () => {
  it("陈旧责任版本不能覆盖任务或其关系变更", async () => {
    await expect(updateTask({ id: taskId, matterId, revision: 6, title: "标题", priority: 0 })).rejects.toThrow("任务已变化");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("普通保存保留未提交环节、负责人和日期；同值日期可保存", async () => {
    await updateTask({ id: taskId, matterId, revision: 7, title: "修改标题", priority: 1, dueAt: task().dueAt });
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: taskId, matterId }, data: { title: "修改标题", description: null, priority: 1 } });
    expect(db.workResponsibility.update).toHaveBeenCalledWith({ where: { id: `work_${taskId}` }, data: { revision: { increment: 1 } } });
  });

  it("改期和换责任人必须经有原因的责任操作", async () => {
    const input = { id: taskId, matterId, revision: 7, title: "标题", priority: 0 };
    await expect(updateTask({ ...input, dueAt: new Date("2026-11-21T08:00:00Z") })).rejects.toThrow("填写新日期和原因");
    await expect(updateTask({ ...input, assigneeId: "cuser00000000000000000002" })).rejects.toThrow("发起交接");
    expect(db.task.update).not.toHaveBeenCalled();
  });
});
