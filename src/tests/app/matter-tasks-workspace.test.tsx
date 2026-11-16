import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetail, MatterTasksView } from "@/server/tasks/contracts";

const mock = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn(), change: vi.fn(),
  start: vi.fn(), waitChange: vi.fn(), end: vi.fn(), add: vi.fn(), remove: vi.fn(), ask: vi.fn() }));
vi.mock("@/server/tasks/actions", () => ({ getMatterTasks: mock.list, getTask: mock.read, createTask: mock.create, updateTask: mock.update,
  changeTask: mock.change, startTaskWait: mock.start, changeTaskWait: mock.waitChange, endTaskWait: mock.end,
  addTaskDependency: mock.add, removeTaskDependency: mock.remove }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.ask }));
import { MatterTasksWorkspace } from "@/components/tasks/matter-tasks-workspace";

const matterId = "cm00000000000000000000001", taskId = "cm00000000000000000000002", userId = "cm00000000000000000000003", otherId = "cm00000000000000000000004";
const choose = vi.fn(), draftState = vi.fn();
function detail(id = taskId, title = "合成无阶段待办"): TaskDetail {
  return { id, title, description: "合成办理内容", dueAt: null, stageId: null, stageName: null, priority: 0, state: "OPEN", workId: "work", revision: 0,
    assigneeId: userId, assigneeName: "合成律师", assigneeActive: true, acceptedAt: null, proposedAssigneeId: null, proposedAssigneeName: null,
    waiting: null, blockers: 0, canWrite: true, canCancel: true, canAccept: true, canDecline: false, reason: null, waits: [], prerequisites: [], dependents: [] };
}
function list(): MatterTasksView { return { canWrite: true, tasks: [detail()], people: [{ id: userId, name: "合成律师" }], stages: [] }; }
beforeEach(() => { vi.resetAllMocks(); mock.list.mockResolvedValue(list()); mock.read.mockResolvedValue(detail()); mock.ask.mockResolvedValue(false); });
afterEach(cleanup);

describe("全案待办工作区", () => {
  it("无阶段可创建，保存失败保留草稿与原请求键", async () => {
    mock.create.mockRejectedValueOnce(new Error("合成响应中断")).mockResolvedValueOnce({ id: taskId, replayed: true });
    render(<MatterTasksWorkspace matterId={matterId} onSelectTask={choose} onDraftStateChange={draftState} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建待办" }));
    fireEvent.change(await screen.findByLabelText("待办标题"), { target: { value: "保留创建输入" } });
    fireEvent.click(await screen.findByRole("button", { name: "保存待办" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成响应中断");
    expect(screen.getByLabelText("待办标题")).toHaveValue("保留创建输入");
    fireEvent.click(await screen.findByRole("button", { name: "保存待办" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
    expect(mock.create.mock.calls[0][0]).toMatchObject({ stageId: "", title: "保留创建输入" });
    expect(mock.create.mock.calls[0][0].requestKey).toBe(mock.create.mock.calls[1][0].requestKey);
    await waitFor(() => expect(choose).toHaveBeenCalledWith(taskId));
  });

  it("取消离开默认继续填写，并向主页面报告脏状态", async () => {
    render(<MatterTasksWorkspace matterId={matterId} onSelectTask={choose} onDraftStateChange={draftState} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建待办" }));
    fireEvent.change(await screen.findByLabelText("待办标题"), { target: { value: "未保存的跟进" } });
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    await waitFor(() => expect(mock.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续填写" })));
    expect(screen.getByLabelText("待办标题")).toHaveValue("未保存的跟进");
    expect(draftState).toHaveBeenCalledWith(true, false);
  });

  it("页头创建信号打开明确的新建表单，无需选择程序", async () => {
    const rendered = render(<MatterTasksWorkspace matterId={matterId} onSelectTask={choose} createSignal={0} />);
    await screen.findByRole("button", { name: "新建待办" });
    rendered.rerender(<MatterTasksWorkspace matterId={matterId} onSelectTask={choose} createSignal={1} />);
    expect(await screen.findByLabelText("待办标题")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "所属阶段" })).toHaveTextContent("全案待办（不绑定阶段）");
  });

  it("新建全案待办后移除旧筛选，列表与详情都定位保存结果", async () => {
    mock.create.mockResolvedValue({ id: taskId });
    render(<MatterTasksWorkspace matterId={matterId} onSelectTask={choose} />);
    fireEvent.change(await screen.findByLabelText("筛选待办标题"), { target: { value: "不匹配的旧筛选" } });
    fireEvent.click(screen.getByRole("button", { name: "新建待办" }));
    fireEvent.change(await screen.findByLabelText("待办标题"), { target: { value: "合成无阶段待办" } });
    fireEvent.click(screen.getByRole("button", { name: "保存待办" }));
    expect(await screen.findByRole("heading", { name: "合成无阶段待办" })).toBeInTheDocument();
    expect(screen.getByLabelText("筛选待办标题")).toHaveValue("");
    expect(screen.getByRole("button", { name: /合成无阶段待办合成律师/ })).toBeInTheDocument();
  });

  it("显式任务不存在时报告错误，不选择另一项；重试仍请求原对象", async () => {
    mock.read.mockRejectedValue(new Error("待办不存在或不属于当前案件"));
    render(<MatterTasksWorkspace matterId={matterId} taskId={otherId} onSelectTask={choose} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不属于当前案件");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    expect(mock.read).toHaveBeenLastCalledWith(matterId, otherId); expect(choose).not.toHaveBeenCalled();
  });

  it("切换对象时隐藏旧正文，迟到结果不能改写新选中对象", async () => {
    let resolveOld: (value: TaskDetail) => void = () => undefined;
    mock.read.mockImplementationOnce(() => new Promise<TaskDetail>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(detail(otherId, "新选中待办"));
    const rendered = render(<MatterTasksWorkspace matterId={matterId} taskId={taskId} onSelectTask={choose} />);
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    rendered.rerender(<MatterTasksWorkspace matterId={matterId} taskId={otherId} onSelectTask={choose} />);
    expect(await screen.findByRole("heading", { name: "新选中待办" })).toBeInTheDocument();
    await act(async () => { resolveOld(detail(taskId, "迟到旧正文")); });
    expect(screen.queryByRole("heading", { name: "迟到旧正文" })).not.toBeInTheDocument();
  });

  it("等待处理失败保留输入和提交身份，检查日与安排期限分别呈现", async () => {
    mock.start.mockRejectedValue(new Error("合成等待保存失败"));
    render(<MatterTasksWorkspace matterId={matterId} taskId={taskId} onSelectTask={choose} />);
    fireEvent.click(await screen.findByRole("button", { name: "记录等待" }));
    const dialog = await screen.findByRole("dialog", { name: "记录外部等待" });
    fireEvent.change(within(dialog).getByLabelText("等待对象"), { target: { value: "合成法院" } });
    fireEvent.change(within(dialog).getByLabelText("预期结果"), { target: { value: "盖章副本" } });
    fireEvent.change(within(dialog).getByLabelText("下次检查日"), { target: { value: "2026-12-05" } });
    fireEvent.change(within(dialog).getByLabelText("原因"), { target: { value: "已申请补发" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "记录外部等待" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("合成等待保存失败");
    expect(within(dialog).getByLabelText("等待对象")).toHaveValue("合成法院");
    fireEvent.click(await within(dialog).findByRole("button", { name: "记录外部等待" }));
    await waitFor(() => expect(mock.start).toHaveBeenCalledTimes(2));
    expect(mock.start.mock.calls[0][0].requestKey).toBe(mock.start.mock.calls[1][0].requestKey);
    expect(mock.start.mock.calls[0][0].nextCheckDate).toBe("2026-12-05");
  });

  it("已取消前置显示为阻塞，完成动作不能误开", async () => {
    const blocked = detail(); blocked.blockers = 1;
    blocked.prerequisites = [{ id: "edge", taskId: otherId, title: "被取消的前置", state: "CANCELLED", satisfied: false }];
    mock.read.mockResolvedValue(blocked);
    render(<MatterTasksWorkspace matterId={matterId} taskId={taskId} onSelectTask={choose} />);
    expect(await screen.findByRole("button", { name: "完成待办" })).toBeDisabled();
    expect(screen.getByText("已取消 · 阻塞当前待办")).toBeInTheDocument();
    expect(mock.change).not.toHaveBeenCalled();
  });
});
