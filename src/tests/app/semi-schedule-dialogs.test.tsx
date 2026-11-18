import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddTaskDialog } from "@/app/(app)/schedule/_components/add-task-dialog";
import { CalendarSubscriptionDialog } from "@/app/(app)/schedule/_components/calendar-subscription-dialog";
import { civilFromKey } from "@/lib/ui/sh-time";

const mock = vi.hoisted(() => ({ create: vi.fn(), token: vi.fn(), regenerate: vi.fn(), confirm: vi.fn(), close: vi.fn(), refresh: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("@/server/tasks/actions", () => ({ createTask: mock.create }));
vi.mock("@/server/calendar/actions", () => ({ getCalendarToken: mock.token, regenerateCalendarToken: mock.regenerate }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.error, warning: mock.warning } }));

const matters = [{ id: "cmtestmatter000000000001", internalCode: "SYN-01", title: "合成案件一" }, { id: "cmtestmatter000000000002", internalCode: "SYN-02", title: "合成案件二" }];
function task() { return <AddTaskDialog open onOpenChange={mock.close} date={civilFromKey("2026-11-18")} matters={matters} />; }
async function chooseMatter() {
  fireEvent.click(screen.getByRole("combobox", { name: /关联案件/ }));
  fireEvent.click(await screen.findByRole("option", { name: /SYN-02 合成案件二/ }));
}
beforeEach(() => {
  Object.values(mock).forEach(fn => fn.mockReset());
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Semi 日程入口（真实控件，Server Action 替身）", () => {
  it("未选案件不能提交；下拉留在表单内，Escape 先关闭下拉再关闭表单", async () => {
    render(task());
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(mock.warning).toHaveBeenCalledWith("请选择关联案件");
    expect(mock.create).not.toHaveBeenCalled();
    const picker = screen.getByRole("combobox", { name: /关联案件/ });
    fireEvent.click(picker);
    const option = await screen.findByRole("option", { name: /SYN-01 合成案件一/ });
    expect(screen.getByRole("dialog", { name: "新建任务" })).toContainElement(option);
    // Semi 2.105.0 reads keyCode; dispatch a complete event from the focused input.
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("option", { name: /SYN-01 合成案件一/ })).not.toBeInTheDocument());
    expect(mock.close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape", keyCode: 27 });
    expect(mock.close).toHaveBeenCalledWith(false);
  });

  it("提交失败保留原案件与草稿、同一请求身份和北京时间，成功才关闭", async () => {
    let reject!: (error: Error) => void;
    mock.create.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(task());
    await chooseMatter();
    fireEvent.change(screen.getByLabelText(/事项标题/), { target: { value: "合成起草任务" } });
    fireEvent.change(screen.getByLabelText("描述（可选）"), { target: { value: "合成留存说明" } });
    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "14:25" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    const first = mock.create.mock.calls[0][0];
    expect(first).toMatchObject({ matterId: matters[1].id, title: "合成起草任务", description: "合成留存说明", dueAt: new Date("2026-11-18T06:25:00.000Z") });
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mock.close).not.toHaveBeenCalled();
    await act(async () => { reject(new Error("合成网络中断")); });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled());
    expect(mock.error).toHaveBeenCalledWith("创建失败", { description: "合成网络中断" });
    expect(screen.getByLabelText(/事项标题/)).toHaveValue("合成起草任务");
    expect(screen.getByLabelText("描述（可选）")).toHaveValue("合成留存说明");
    expect(screen.getByRole("combobox", { name: /关联案件/ })).toHaveTextContent("合成案件二");
    mock.create.mockResolvedValueOnce({ ok: true, id: "cmtesttask00000000000001" });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledWith(false));
    expect(mock.create.mock.calls[1][0]).toEqual(first);
    expect(mock.refresh).toHaveBeenCalledOnce();
  });

  it("全天与优先级沿原业务合同提交，不使用浏览器本地日期", async () => {
    mock.create.mockResolvedValueOnce({ ok: true, id: "cmtesttask00000000000002" });
    render(task());
    await chooseMatter();
    fireEvent.change(screen.getByLabelText(/事项标题/), { target: { value: "合成全天任务" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "全天" }));
    fireEvent.click(screen.getByRole("radio", { name: "紧急" }));
    expect(screen.getByLabelText("时间")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    expect(mock.create.mock.calls[0][0]).toMatchObject({ priority: 2, dueAt: new Date("2026-11-18T15:59:00.000Z") });
  });

  it("订阅仅打开时读取，失败后可在原弹窗内重试", async () => {
    mock.token.mockRejectedValueOnce(new Error("合成读取失败")).mockResolvedValueOnce({ token: "synthetic-calendar-token" });
    render(<CalendarSubscriptionDialog />);
    expect(mock.token).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "订阅日历" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("alert");
    expect(mock.error).toHaveBeenCalledWith("获取订阅链接失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/\/api\/calendar\/synthetic-calendar-token/)).toBeVisible();
    expect(mock.token).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("取消重置不调用服务；重置失败保留原订阅链接", async () => {
    mock.token.mockResolvedValue({ token: "synthetic-original-token" });
    mock.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mock.regenerate.mockRejectedValueOnce(new Error("合成重置失败"));
    render(<CalendarSubscriptionDialog />);
    fireEvent.click(screen.getByRole("button", { name: "订阅日历" }));
    await screen.findByText(/\/api\/calendar\/synthetic-original-token/);
    fireEvent.click(screen.getByRole("button", { name: "重置链接" }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledOnce());
    expect(mock.regenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重置链接" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("重置失败", { description: "合成重置失败" }));
    expect(within(screen.getByRole("dialog")).getByText(/\/api\/calendar\/synthetic-original-token/)).toBeVisible();
  });
});
