import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TaskDetailDialog } from "@/components/matters/task-detail-dialog";
import { TaskWorkPanel } from "@/components/matters/task-work-panel";
import { WorkResponsibilityPanel } from "@/components/matters/work-responsibility-panel";
import { WorkQueueCard } from "@/components/dashboard/work-queue-card";
import type { WorkQueue } from "@/server/dashboard/actions";
import type { TaskProgressSummary, TaskWorkflowDetail, TaskWorkflowItem, TaskWorkflowWorkspace } from "@/lib/tasks/workflow";

const actions = vi.hoisted(() => ({
  getTaskWorkspace: vi.fn(), getTaskWorkflow: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
  startTaskWaiting: vi.fn(), finishTaskWaiting: vi.fn(), rescheduleTaskWaiting: vi.fn(), saveTaskDependencies: vi.fn(), changeWork: vi.fn(),
  completeTasksBatch: vi.fn(), requestHandover: vi.fn(), decideHandover: vi.fn(), refreshHandover: vi.fn(), createUrgent: vi.fn(),
  refresh: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn()
}));

vi.mock("@/server/tasks/workflow-actions", () => actions);
vi.mock("@/server/tasks/actions", () => ({ createTask: actions.createTask, updateTask: actions.updateTask, completeTasksBatch: actions.completeTasksBatch }));
vi.mock("@/server/reminders/work-actions", () => actions);
vi.mock("@/components/matters/intake-handover-panel", () => ({ IntakeHandoverPanel: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: actions.success, error: actions.error } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: actions.confirm }));

const matterId = "cm3matter00000000000000001";
const userId = "cm3person00000000000000001";
const taskId = "cm3task0000000000000000001";
const otherTaskId = "cm3task0000000000000000002";
const waitingId = "15d214cb-3b68-4f5f-90a8-13b9886d0f2d";
const stamp = new Date("2026-11-16T02:00:00.000Z");
const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);

function task(overrides: Partial<TaskWorkflowItem> = {}): TaskWorkflowItem {
  return {
    id: taskId, matterId, stageId: null, stageName: null, procedureTitle: null,
    title: "收集付款凭证", description: "核对与本案合同对应的付款记录", dueAt: new Date("2026-11-20T09:00:00.000Z"), priority: 0, createdAt: stamp, updatedAt: stamp,
    responsibility: { id: "cm3work0000000000000000001", revision: 4, state: "OPEN", assigneeId: userId, name: "承办律师", active: true, acceptedAt: stamp, proposedAssigneeId: null, proposedName: null, reason: null },
    activeWaiting: null, waitings: [], prerequisites: [], ...overrides
  };
}

function detail(value = task()): TaskWorkflowDetail {
  return { task: value, people: [{ id: "cm3person00000000000000002", name: "另一位律师" }, { id: userId, name: "承办律师" }], currentUserId: userId, canWrite: true };
}

function workspace(tasks = [task()]): TaskWorkflowWorkspace {
  const { people, currentUserId, canWrite } = detail();
  return { people, currentUserId, canWrite, tasks, untrackedTasks: [] };
}

function activeWaiting() {
  return { id: waitingId, waitingFor: "客户财务", expectedResult: "银行付款回单", reason: null, nextCheckAt: new Date("2026-11-18T01:00:00.000Z"), startedAt: stamp, endedAt: null, result: null, createdById: userId, endedById: null };
}

function tab(name: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}

beforeEach(() => {
  vi.resetAllMocks();
  actions.getTaskWorkspace.mockResolvedValue(workspace());
  actions.getTaskWorkflow.mockResolvedValue(detail());
  actions.confirm.mockResolvedValue(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
});

describe("任务弹窗的键盘返回", () => {
  it("未归属与待检查筛选保留同一任务身份，不把未来检查混为已到期", async () => {
    const wait = { ...activeWaiting(), nextCheckAt: new Date("2000-01-01T00:00:00.000Z") };
    actions.getTaskWorkspace.mockResolvedValue(workspace([
      task({ title: "待检查的全案任务", activeWaiting: wait, waitings: [wait] }),
      task({ id: otherTaskId, title: "未来检查任务", activeWaiting: { ...wait, id: "ae70750d-ab89-45d9-9ad7-968203d63621", nextCheckAt: new Date("2099-01-01T00:00:00.000Z") } }),
      task({ id: "cm3task0000000000000000003", title: "环节任务", stageId: "cstage0000000000000000001", activeWaiting: wait }),
    ]));
    render(<TaskWorkPanel matterId={matterId} unassignedOnly />);
    expect(await screen.findByRole("button", { name: "待检查的全案任务" })).toBeVisible();
    expect(screen.getByRole("button", { name: "未来检查任务" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "环节任务" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "仅看待检查" }));
    expect(screen.getByRole("button", { name: "待检查的全案任务" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "未来检查任务" })).not.toBeInTheDocument();
    expect(screen.getByText("待检查")).toBeVisible();
  });

  it("任务创建保存中的位置切换不被迟到结果改回，提交仍绑定打开时环节", async () => {
    const originalLocation = window.location.href;
    const stageId = "cstage0000000000000000001";
    const onCreated = vi.fn();
    let finish!: (value: { id: string }) => void;
    actions.createTask.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    try {
      window.history.replaceState(null, "", "?procedure=first&stage=preparation");
      render(<TaskWorkPanel matterId={matterId} defaultStage={{ id: stageId, name: "准备" }} onTaskCreated={onCreated} />);
      fireEvent.click(await screen.findByRole("button", { name: "新建任务" }));
      fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "核对准备材料" } });
      fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
      await waitFor(() => expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ matterId, stageId })));
      window.history.replaceState(null, "", "?procedure=second&stage=review");
      await act(async () => { finish({ id: otherTaskId }); });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onCreated).not.toHaveBeenCalled();
      expect(actions.getTaskWorkflow).not.toHaveBeenCalled();
      expect(window.location.search).toBe("?procedure=second&stage=review");
    } finally { window.history.replaceState(null, "", originalLocation); }
  });

  it("选中环节只显示该环节任务并预填新任务归属", async () => {
    const stageId = "cstage0000000000000000001";
    actions.getTaskWorkspace.mockResolvedValue(workspace([
      task({ stageId, stageName: "举证", title: "核对证据" }),
      task({ id: otherTaskId, stageId: null, title: "全案任务" })
    ]));
    actions.createTask.mockResolvedValue({ ok: true, id: otherTaskId });
    render(<TaskWorkPanel matterId={matterId} scopeStageIds={[stageId]} defaultStage={{ id: stageId, name: "举证" }} />);
    expect(await screen.findByRole("button", { name: "核对证据" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "全案任务" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(await screen.findByText("关联环节：举证")).toBeVisible();
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "提交证据" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ stageId, title: "提交证据" })));
  });

  it("从真实环节新建任务时提交该环节 ID", async () => {
    actions.createTask.mockResolvedValue({ ok: true, id: otherTaskId });
    render(<TaskWorkPanel matterId={matterId} createRequest={1} createStage={{ id: "cstage0000000000000000001", name: "举证" }} />);
    expect(await screen.findByRole("heading", { name: "新建环节任务" })).toBeVisible();
    expect(screen.getByText("关联环节：举证")).toBeVisible();
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "核对证据" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ matterId, stageId: "cstage0000000000000000001", title: "核对证据" })));
  });

  it("只读显示无责任记录的旧任务及截止信息", async () => {
    actions.getTaskWorkspace.mockResolvedValue({ ...workspace([]), canWrite: false, untrackedTasks: [{ id: taskId, title: "旧任务", stageName: "举证", procedureTitle: "一审", dueAt: stamp, completed: false, assigneeName: "承办律师" }] });
    render(<TaskWorkPanel matterId={matterId} canWrite={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("旧任务");
    expect(alert).toHaveTextContent("原记录未标完成");
    expect(alert).toHaveTextContent("承办律师");
    expect(alert).toHaveTextContent("举证");
    expect(screen.queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument();
  });

  it("保存重读替换任务行后，Esc 回到当前同一任务行", async () => {
    actions.updateTask.mockResolvedValue({ ok: true });
    render(<TaskWorkPanel matterId={matterId} />);
    const original = await screen.findByRole("button", { name: "收集付款凭证" });
    original.focus();
    fireEvent.click(original);
    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "核对付款凭证原件" } });
    const updated = task({ title: "核对付款凭证原件" });
    actions.getTaskWorkspace.mockResolvedValue(workspace([updated]));
    actions.getTaskWorkflow.mockResolvedValue(detail(updated));
    fireEvent.click(screen.getByRole("button", { name: "保存内容" }));
    await screen.findByRole("heading", { name: "核对付款凭证原件" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "核对付款凭证原件" })).toHaveFocus());
    expect(original.isConnected).toBe(false);
  });

  it("办结任务被默认列表滤掉后，关闭详情回到任务标题", async () => {
    actions.changeWork.mockResolvedValue({ ok: true });
    render(<TaskWorkPanel matterId={matterId} />);
    fireEvent.click(await screen.findByRole("button", { name: "收集付款凭证" }));
    fireEvent.click(await screen.findByRole("button", { name: "办结任务" }));
    fireEvent.change(screen.getByLabelText("处置结果"), { target: { value: "已经核对原件" } });
    actions.getTaskWorkspace.mockResolvedValue(workspace([]));
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ responsibility: { ...task().responsibility, state: "DONE" } })));
    fireEvent.click(screen.getByRole("button", { name: "确认办结任务" }));
    await screen.findByText("已办结");
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "任务" })).toHaveFocus());
  });

  it("不可用的任务深链关闭后回到任务区，不尝试聚焦不存在的入口", async () => {
    actions.getTaskWorkflow.mockRejectedValue(new Error("任务不属于当前事项"));
    render(<TaskWorkPanel matterId={matterId} selectedTaskId={otherTaskId} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "任务" })).toHaveFocus());
  });

  it("新建取消回到创建按钮；创建成功交给详情，不被旧弹窗回焦打断", async () => {
    actions.createTask.mockResolvedValue({ ok: true, id: otherTaskId });
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ id: otherTaskId, title: "新建的核对任务" })));
    render(<TaskWorkPanel matterId={matterId} />);
    const create = await screen.findByRole("button", { name: "新建任务" });
    create.focus();
    fireEvent.click(create);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(create).toHaveFocus());
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "新建的核对任务" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await screen.findByRole("heading", { name: "新建的核对任务" });
    // Radix 的卸载回焦在下一轮事件循环执行，检查交接后的最终焦点。
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("button", { name: "新建任务", hidden: true })).not.toHaveFocus();
  });

  it("责任板详情回原任务；该行消失时回责任板标题", async () => {
    const value = task();
    const data: NonNullable<Parameters<typeof WorkResponsibilityPanel>[0]["data"]> = {
      currentUserId: userId, emergency: false, canWrite: true, canTransfer: false, people: detail().people,
      items: [{ ...value.responsibility, kind: "Task", duePrecision: null, targetId: taskId, matterId, intakeId: null, title: value.title, dueAt: value.dueAt, taskHref: null, taskProgress: { availability: "AVAILABLE", waiting: null, blockingPrerequisiteCount: 0, cancelledPrerequisiteCount: 0, checkDue: false } }],
      matters: [], intakes: [], handovers: [], intakeHandovers: []
    };
    const view = render(<WorkResponsibilityPanel data={data} matterId={matterId} />);
    const entry = screen.getByRole("button", { name: "任务 · 收集付款凭证" });
    entry.focus();
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(entry).toHaveFocus());
    fireEvent.click(entry);
    await screen.findByRole("dialog");
    view.rerender(<WorkResponsibilityPanel data={{ ...data, items: [] }} matterId={matterId} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "事项责任与交接" })).toHaveFocus());
  });
});

type Board = NonNullable<Parameters<typeof WorkResponsibilityPanel>[0]["data"]>;
const clearProgress = (): TaskProgressSummary => ({ availability: "AVAILABLE", waiting: null, blockingPrerequisiteCount: 0, cancelledPrerequisiteCount: 0, checkDue: false });
function boardItem(index: number, progress = clearProgress()): Board["items"][number] {
  const value = task();
  return { ...value.responsibility, id: `work-${index}`, targetId: index === 1 ? taskId : `${taskId}-${index}`, kind: "Task", duePrecision: null, matterId, intakeId: null,
    title: `全局任务 ${index}`, dueAt: value.dueAt, taskHref: null, taskProgress: progress };
}
function board(items: Board["items"]): Board {
  return { currentUserId: userId, emergency: false, canWrite: true, canTransfer: false, people: detail().people, items, matters: [], intakes: [], handovers: [], intakeHandovers: [] };
}
async function filterTasks(label: string) {
  const trigger = screen.getByRole("combobox", { name: "任务推进筛选" });
  trigger.focus(); fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("G02 首页与完整任务责任总览", () => {
  it("首页显示真实等待成果并进入确切任务；旧无责任任务回案内记录，总览链接不冒称本人全集", () => {
    const progress: TaskProgressSummary = { availability: "AVAILABLE", waiting: activeWaiting(), blockingPrerequisiteCount: 1, cancelledPrerequisiteCount: 1, checkDue: true };
    const row = { id: taskId, title: "核对客户回单", dueAt: stamp, priority: 0, matterTitle: "合成案件", matterCode: "CASE-G02", matterId, overdue: true, progress, hasResponsibility: true };
    const queue: WorkQueue = { followUps: { available: true, items: [], total: 0, page: 1, pageSize: 5, filter: "all" as const, observedAt: "2026-11-17T10:00:00.000Z" }, approvals: [], approvalTotal: 0, tasksAvailable: true, taskTotal: 8, tasks: [row, { ...row, id: otherTaskId, title: "历史原任务", progress: { availability: "REVIEW" }, hasResponsibility: false }] };
    render(<WorkQueueCard queue={queue} alerts={[]} />);
    const link = screen.getByRole("link", { name: /核对客户回单/ });
    expect(link).toHaveAttribute("href", `/matters/CASE-G02?view=work&workPane=tasks&task=${taskId}`);
    expect(within(link).getByText("待收成果：银行付款回单")).toBeVisible();
    expect(within(link).getByText("前置未完成 1 项（含已取消 1 项）")).toBeVisible();
    expect(screen.getByRole("link", { name: /历史原任务/ })).toHaveAttribute("href", "/matters/CASE-G02?view=work&workPane=tasks");
    expect(screen.getByRole("link", { name: "打开任务责任总览 →" })).toHaveAttribute("href", "/schedule#work-responsibilities");
    expect(screen.getByText("本人共 8 项任务，逾期任务优先")).toBeVisible();
  });

  it("任务资格不可用不显示零待办断言，独立审批入口保持", () => {
    const queue: WorkQueue = { followUps: { available: true, items: [], total: 0, page: 1, pageSize: 5, filter: "all" as const, observedAt: "2026-11-17T10:00:00.000Z" }, approvals: [{ id: "approval", action: "INTAKE_APPROVE", title: "独立审批", requester: "合成申请人", matter: null, task: "approve", waitDays: null }], approvalTotal: 1, tasks: [], taskTotal: 0, tasksAvailable: false };
    render(<WorkQueueCard queue={queue} alerts={[]} />);
    expect(screen.getByRole("link", { name: /独立审批/ })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "任务 —" }));
    expect(screen.getByText("当前资格不能读取任务详情")).toBeVisible();
    expect(screen.queryByText("暂无指派给你的未完成任务")).not.toBeInTheDocument();
  });

  it("完整板筛出第五条以外及无截止任务；等待和前置同处显示一次，非Task期限保留F01精度", async () => {
    const waiting: TaskProgressSummary = { availability: "AVAILABLE", waiting: activeWaiting(), blockingPrerequisiteCount: 1, cancelledPrerequisiteCount: 1, checkDue: true };
    const waitingItem = boardItem(6, waiting);
    const undated = { ...boardItem(7, { ...waiting, blockingPrerequisiteCount: 0, cancelledPrerequisiteCount: 0 }), dueAt: null };
    const unavailable = boardItem(8, { availability: "UNAVAILABLE" });
    const dateOnly: Board["items"][number] = { ...boardItem(9), kind: "Deadline", title: "日期型期限", dueAt: new Date("2026-11-17T16:00:00Z"), duePrecision: "DATE", taskProgress: null };
    render(<WorkResponsibilityPanel data={board([...Array.from({ length: 5 }, (_, i) => boardItem(i + 1)), waitingItem, undated, unavailable, dateOnly])} />);
    expect(screen.getByRole("heading", { name: "事项责任与交接" }).closest("section")).toHaveAttribute("id", "work-responsibilities");
    const deadline = screen.getByText("期限 · 日期型期限").closest("article")!;
    expect(deadline).toHaveTextContent("2026-11-18");
    expect(deadline).not.toHaveTextContent("00:00");
    expect(screen.getByRole("checkbox", { name: "选择 全局任务 6" })).toBeDisabled();
    const waitingRow = screen.getByRole("button", { name: "任务 · 全局任务 6" }).closest("article")!;
    expect(within(waitingRow).getByText("等待 客户财务")).toBeVisible();
    expect(within(waitingRow).getByText("前置未完成 1 项（含已取消 1 项）")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "任务 · 全局任务 8" }).closest("article")!).getByRole("button", { name: "办结" })).toBeDisabled();
    await filterTasks("待检查的任务");
    expect(screen.getAllByRole("button", { name: "任务 · 全局任务 6" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "任务 · 全局任务 7" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "任务 · 全局任务 1" })).not.toBeInTheDocument();
    expect(screen.queryByText("期限 · 日期型期限")).not.toBeInTheDocument();
    await filterTasks("前置未完成的任务");
    expect(screen.getByRole("button", { name: "任务 · 全局任务 6" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "任务 · 全局任务 7" })).not.toBeInTheDocument();
    await filterTasks("无已知阻塞的任务");
    expect(screen.getByRole("button", { name: "任务 · 全局任务 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "任务 · 全局任务 8" })).not.toBeInTheDocument();
  });

  it("筛选清除隐藏勾选，提交时再排除已从当前集合消失的任务", async () => {
    const items = [boardItem(1), boardItem(2)];
    const view = render(<WorkResponsibilityPanel data={board(items)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 全局任务 1" }));
    await filterTasks("等待外部的任务");
    expect(screen.queryByRole("button", { name: "批量办结（须填统一处置结果）" })).not.toBeInTheDocument();
    await filterTasks("全部事项");
    expect(screen.getByRole("checkbox", { name: "选择 全局任务 1" })).not.toBeChecked();
    for (const index of [1, 2]) fireEvent.click(screen.getByRole("checkbox", { name: `选择 全局任务 ${index}` }));
    fireEvent.click(screen.getByRole("button", { name: "批量办结（须填统一处置结果）" }));
    view.rerender(<WorkResponsibilityPanel data={board([items[1]])} />);
    actions.completeTasksBatch.mockResolvedValue({ results: [{ id: items[1].targetId, ok: true }] });
    fireEvent.change(screen.getByLabelText("统一处置结果或原因"), { target: { value: "已逐件核对结果" } });
    fireEvent.click(screen.getByRole("button", { name: "确认批量办结" }));
    await waitFor(() => expect(actions.completeTasksBatch).toHaveBeenCalledWith({ ids: [items[1].targetId], reason: "已逐件核对结果" }));
  });

  it("刷新使当前筛选中的原行消失仍保留详情草稿；拒绝放弃后可继续，关闭回总览标题", async () => {
    const value = task({ activeWaiting: activeWaiting(), waitings: [activeWaiting()] });
    actions.getTaskWorkflow.mockResolvedValue(detail(value));
    const item = { ...boardItem(1, { availability: "AVAILABLE", waiting: activeWaiting(), blockingPrerequisiteCount: 0, cancelledPrerequisiteCount: 0, checkDue: false }), title: value.title };
    const view = render(<WorkResponsibilityPanel data={board([item])} />);
    await filterTasks("等待外部的任务");
    fireEvent.click(screen.getByRole("button", { name: "任务 · 收集付款凭证" }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "仍未保存的核对记录" } });
    view.rerender(<WorkResponsibilityPanel data={board([{ ...item, taskProgress: clearProgress() }])} />);
    expect(screen.getByLabelText("任务名称")).toHaveValue("仍未保存的核对记录");
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("任务名称")).toHaveValue("仍未保存的核对记录");
    actions.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "事项责任与交接" })).toHaveFocus());
    expect(actions.updateTask).not.toHaveBeenCalled();
  });

  it("页面打开后经过检查时点，再切待检查筛选会按原时点更新而不写任务", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const at = new Date("2030-01-01T08:00:00Z");
      vi.setSystemTime(new Date(at.getTime() - 1));
      const progress: TaskProgressSummary = { availability: "AVAILABLE", waiting: { ...activeWaiting(), nextCheckAt: at }, blockingPrerequisiteCount: 0, cancelledPrerequisiteCount: 0, checkDue: false };
      render(<WorkResponsibilityPanel data={board([boardItem(1, progress)])} />);
      expect(screen.queryByText("待检查")).not.toBeInTheDocument();
      vi.setSystemTime(at);
      await filterTasks("待检查的任务");
      expect(screen.getByRole("button", { name: "任务 · 全局任务 1" })).toBeVisible();
      expect(screen.getByText("待检查")).toBeVisible();
      expect(actions.changeWork).not.toHaveBeenCalled();
      expect(actions.rescheduleTaskWaiting).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe("事项任务的同一对象与保稿", () => {
  it("零程序事项直接创建；失败保留输入，成功打开返回的 Task ID", async () => {
    const createdId = "cm3task0000000000000000003";
    const created = task({ id: createdId, title: "核对客户原件" });
    actions.createTask.mockRejectedValueOnce(new Error("责任人资格已变更，请核对")).mockResolvedValueOnce({ ok: true, id: createdId });
    actions.getTaskWorkflow.mockResolvedValue(detail(created));
    const onCreated = vi.fn();
    render(<TaskWorkPanel matterId={matterId} onTaskCreated={onCreated} />);
    expect(await screen.findByRole("button", { name: "收集付款凭证" })).toBeVisible();
    expect(screen.getByText("事项级")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "核对客户原件" } });
    fireEvent.change(screen.getByLabelText("办理说明"), { target: { value: "现场核对后登记结果" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("责任人资格已变更");
    expect(screen.getByLabelText("任务名称")).toHaveValue("核对客户原件");
    expect(screen.getByLabelText("办理说明")).toHaveValue("现场核对后登记结果");
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByRole("heading", { name: "核对客户原件" })).toBeVisible();
    expect(actions.createTask).toHaveBeenLastCalledWith({ matterId, title: "核对客户原件", description: "现场核对后登记结果", assigneeId: userId, priority: 0, dueAt: undefined, requestKey: expect.any(String) });
    expect(actions.createTask.mock.calls[0][0].requestKey).toBe(actions.createTask.mock.calls[1][0].requestKey);
    expect(onCreated).toHaveBeenCalledWith(createdId, null);
    expect(actions.getTaskWorkflow).toHaveBeenLastCalledWith(createdId, matterId);
  });

  it("登记等待失败及切区保留草稿；重试复用同一个 waitingId，检查时间不走任务改期", async () => {
    actions.startTaskWaiting.mockRejectedValueOnce(new Error("网络暂不可用")).mockResolvedValueOnce({ ok: true });
    const onOpenChange = vi.fn();
    render(<TaskDetailDialog taskId={taskId} open onOpenChange={onOpenChange} />);
    await screen.findByRole("tab", { name: "外部等待" });
    tab("外部等待");
    fireEvent.click(screen.getByRole("button", { name: "登记等待" }));
    fireEvent.change(screen.getByLabelText("等待对象"), { target: { value: "客户财务" } });
    fireEvent.change(screen.getByLabelText("待收成果"), { target: { value: "银行付款回单" } });
    fireEvent.change(screen.getByLabelText("下次检查（北京时间）"), { target: { value: "2026-11-18T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存等待" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络暂不可用");
    tab("概况");
    tab("外部等待");
    expect(screen.getByLabelText("等待对象")).toHaveValue("客户财务");
    expect(screen.getByLabelText("待收成果")).toHaveValue("银行付款回单");
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(onOpenChange).not.toHaveBeenCalled();
    const first = actions.startTaskWaiting.mock.calls[0][0];
    expect(first).toMatchObject({ taskId, revision: 4, waitingFor: "客户财务", expectedResult: "银行付款回单", nextCheckAt: new Date("2026-11-18T01:00:00.000Z") });
    expect(first.waitingId).toMatch(/^[0-9a-f-]{36}$/);
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ activeWaiting: activeWaiting() })));
    fireEvent.click(screen.getByRole("button", { name: "保存等待" }));
    await waitFor(() => expect(actions.startTaskWaiting).toHaveBeenCalledTimes(2));
    expect(actions.startTaskWaiting.mock.calls[1][0]).toEqual(first);
    expect(await screen.findByText("客户财务")).toBeVisible();
    expect(actions.changeWork).not.toHaveBeenCalled();
  });

  it("取消的前置仍阻塞办结；只请求同案候选，移除失败保留选择与理由", async () => {
    const blocked = task({ prerequisites: [{ id: otherTaskId, title: "核实银行回单", state: "CANCELLED" }] });
    actions.getTaskWorkflow.mockResolvedValue(detail(blocked));
    actions.getTaskWorkspace.mockResolvedValue(workspace([blocked, task({ id: otherTaskId, title: "核实银行回单", responsibility: { ...task().responsibility, state: "CANCELLED" } })]));
    actions.saveTaskDependencies.mockRejectedValueOnce(new Error("任务已有更新，请重新核对"));
    render(<TaskDetailDialog taskId={taskId} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "办结任务" })).toBeDisabled();
    tab(/前置任务/);
    expect(screen.getByText("已取消 · 仍阻塞")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "维护前置任务" }));
    const checkbox = await screen.findByRole("checkbox", { name: /核实银行回单/ });
    expect(checkbox).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(actions.getTaskWorkspace).toHaveBeenCalledWith({ matterId, includeClosed: true });
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "客户已改用现场核对原件，取消此前置要求" } });
    fireEvent.click(screen.getByRole("button", { name: "保存前置任务" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("任务已有更新");
    expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText("变更原因")).toHaveValue("客户已改用现场核对原件，取消此前置要求");
    expect(actions.saveTaskDependencies).toHaveBeenCalledWith({ taskId, revision: 4, prerequisiteIds: [], reason: "客户已改用现场核对原件，取消此前置要求" });
  });

  it("等待结果单独保存；任务仍办理中，历史统一显示已结束", async () => {
    const waiting = activeWaiting();
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ activeWaiting: waiting, waitings: [waiting] })));
    actions.finishTaskWaiting.mockResolvedValue({ ok: true });
    render(<TaskDetailDialog taskId={taskId} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "办结任务" })).toBeDisabled();
    tab("外部等待");
    fireEvent.click(screen.getByRole("button", { name: "结束等待并继续办理" }));
    fireEvent.change(screen.getByLabelText("实际结果或结束原因"), { target: { value: "对方不再提供回单，改为核对原件" } });
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ waitings: [{ ...waiting, endedAt: stamp, endedById: userId, result: "对方不再提供回单，改为核对原件" }] })));
    fireEvent.click(screen.getByRole("button", { name: "保存结果并结束等待" }));
    await waitFor(() => expect(actions.finishTaskWaiting).toHaveBeenCalledWith({ taskId, revision: 4, waitingId, result: "对方不再提供回单，改为核对原件" }));
    expect(await screen.findByText("当前没有外部等待。")).toBeVisible();
    expect(actions.changeWork).not.toHaveBeenCalled();
    tab(/等待记录/);
    expect(screen.getByText("已结束")).toBeVisible();
    expect(screen.getByText("对方不再提供回单，改为核对原件")).toBeVisible();
    expect(screen.queryByText("已收到答复")).not.toBeInTheDocument();
    tab("概况");
    expect(screen.getByRole("button", { name: "办结任务" })).toBeEnabled();
  });

  it("取消任务走责任链并提示结束等待，不制造外部答复", async () => {
    const waiting = activeWaiting();
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ activeWaiting: waiting, waitings: [waiting] })));
    actions.changeWork.mockResolvedValue({ ok: true });
    render(<TaskDetailDialog taskId={taskId} open onOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "取消任务" }));
    expect(screen.getByText("同时结束当前外部等待，并以本次取消原因留痕。")).toBeVisible();
    fireEvent.change(screen.getByLabelText("变更原因及通知情况"), { target: { value: "本任务取消，已通知承办人" } });
    const cancelled = task({ responsibility: { ...task().responsibility, state: "CANCELLED" }, waitings: [{ ...waiting, endedAt: stamp, endedById: userId, result: "任务取消：本任务取消，已通知承办人" }] });
    actions.getTaskWorkflow.mockResolvedValue(detail(cancelled));
    fireEvent.click(screen.getByRole("button", { name: "确认取消任务" }));
    await waitFor(() => expect(actions.changeWork).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCEL", reason: "本任务取消，已通知承办人", revision: 4 })));
    expect(await screen.findByText("已取消")).toBeVisible();
    expect(actions.finishTaskWaiting).not.toHaveBeenCalled();
    tab(/等待记录/);
    expect(screen.getByText("任务取消：本任务取消，已通知承办人")).toBeVisible();
    expect(screen.getByText("已结束")).toBeVisible();
  });

  it("迟到的旧任务读取不覆盖当前选中的任务", async () => {
    let resolveOld!: (value: TaskWorkflowDetail) => void;
    actions.getTaskWorkflow.mockImplementation((id: string) => id === taskId ? new Promise<TaskWorkflowDetail>(resolve => { resolveOld = resolve; }) : Promise.resolve(detail(task({ id: otherTaskId, title: "当前选中的任务" }))));
    const view = render(<TaskDetailDialog taskId={taskId} open onOpenChange={vi.fn()} />);
    view.rerender(<TaskDetailDialog taskId={otherTaskId} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "当前选中的任务" })).toBeVisible();
    await act(async () => { resolveOld(detail()); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("heading", { name: "收集付款凭证" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "当前选中的任务" })).toBeVisible();
  });

  it("同案历史切换任务时保留当前草稿；选择继续编辑会恢复原 Task 参数", async () => {
    const rejected = vi.fn();
    actions.getTaskWorkflow.mockImplementation((id: string) => Promise.resolve(detail(id === taskId ? task() : task({ id: otherTaskId, title: "后退要打开的任务" }))));
    const props = { open: true, expectedMatterId: matterId, onOpenChange: vi.fn(), onTaskChangeRejected: rejected };
    const view = render(<TaskDetailDialog {...props} taskId={taskId} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByLabelText("办理说明"), { target: { value: "尚未保存的核对说明" } });
    view.rerender(<TaskDetailDialog {...props} taskId={otherTaskId} />);
    await waitFor(() => expect(rejected).toHaveBeenCalledWith(taskId));
    expect(screen.getByLabelText("办理说明")).toHaveValue("尚未保存的核对说明");
    expect(actions.getTaskWorkflow).not.toHaveBeenCalledWith(otherTaskId, matterId);
    expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" }));
    view.rerender(<TaskDetailDialog {...props} taskId={taskId} />);
    actions.confirm.mockResolvedValue(true);
    view.rerender(<TaskDetailDialog {...props} taskId={otherTaskId} />);
    expect(await screen.findByRole("heading", { name: "后退要打开的任务" })).toBeVisible();
    expect(actions.getTaskWorkflow).toHaveBeenLastCalledWith(otherTaskId, matterId);
  });

  it("刷新并发新状态后保留输入，未经明确核对不会自动换 revision 覆盖内容", async () => {
    actions.updateTask.mockRejectedValueOnce(new Error("任务已有更新，请重新核对")).mockResolvedValue({ ok: true });
    render(<TaskDetailDialog taskId={taskId} open onOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑内容" }));
    fireEvent.change(screen.getByLabelText("办理说明"), { target: { value: "我的待保存说明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存内容" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("任务已有更新");
    actions.getTaskWorkflow.mockResolvedValue(detail(task({ title: "同事修改后的任务名称", responsibility: { ...task().responsibility, revision: 5 } })));
    fireEvent.click(screen.getByRole("button", { name: "重新核对状态" }));
    expect(await screen.findByRole("heading", { name: "同事修改后的任务名称" })).toBeVisible();
    expect(screen.getByLabelText("办理说明")).toHaveValue("我的待保存说明");
    fireEvent.click(screen.getByRole("button", { name: "保存内容" }));
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "任务已有更新，请核对当前记录", initialFocus: "cancel" })));
    expect(actions.updateTask).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存内容" })).toBeEnabled());
    actions.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "保存内容" }));
    await waitFor(() => expect(actions.updateTask).toHaveBeenCalledTimes(2));
    expect(actions.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: taskId, revision: 5, description: "我的待保存说明" }));
  });

  it("外部添加任务请求等待读取权限后打开同一表单，每个请求只打开一次", async () => {
    let resolveWorkspace!: (value: TaskWorkflowWorkspace) => void;
    actions.getTaskWorkspace.mockImplementation(() => new Promise<TaskWorkflowWorkspace>(resolve => { resolveWorkspace = resolve; }));
    const view = render(<TaskWorkPanel matterId={matterId} createRequest={1} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { resolveWorkspace(workspace()); });
    expect(await screen.findByRole("heading", { name: "新建事项级任务" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.rerender(<TaskWorkPanel matterId={matterId} createRequest={1} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<TaskWorkPanel matterId={matterId} createRequest={2} />);
    expect(await screen.findByRole("heading", { name: "新建事项级任务" })).toBeVisible();
  });

  it("当前事项壳给详情传真实预期事项，跨案拒绝不会回退到列表首项", async () => {
    actions.getTaskWorkflow.mockRejectedValue(new Error("任务不属于当前事项"));
    render(<TaskWorkPanel matterId={matterId} selectedTaskId={otherTaskId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("任务不属于当前事项");
    expect(actions.getTaskWorkflow).toHaveBeenCalledWith(otherTaskId, matterId);
    expect(screen.queryByRole("heading", { name: "收集付款凭证" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试读取" })).toBeVisible();
  });
});
