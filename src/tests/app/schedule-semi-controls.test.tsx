import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ token: vi.fn(), regenerate: vi.fn(), copy: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("view=list") }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));
vi.mock("@/server/calendar/actions", () => ({ getCalendarToken: mock.token, regenerateCalendarToken: mock.regenerate }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error } }));
vi.mock("@/app/(app)/schedule/_components/add-task-dialog", () => ({ AddTaskDialog: () => null }));

import { ActionError } from "@/lib/action-error";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";
import { CalendarSubscriptionDialog } from "@/app/(app)/schedule/_components/calendar-subscription-dialog";
import { ScheduleView } from "@/app/(app)/schedule/_components/schedule-view";
import type { ScheduleItem } from "@/server/schedule/query";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T02:00:00Z"));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mock.copy } });
  mock.token.mockResolvedValue({ token: "synthetic-calendar-token" });
  mock.regenerate.mockResolvedValue({ token: "synthetic-new-token" });
  mock.copy.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

function renderSubscription() {
  render(<><CalendarSubscriptionDialog /><ConfirmHost /></>);
  return screen.getByRole("button", { name: "订阅日历" });
}
async function openSubscription() {
  const trigger = renderSubscription();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "订阅日历" });
  await within(dialog).findByText(`${window.location.origin}/api/calendar/synthetic-calendar-token`);
  return { trigger, dialog };
}

describe("日历订阅 Semi 控件与既有确认边界", () => {
  it("只在打开时读取，每次重新打开读取当前链接，关闭返回真实触发按钮", async () => {
    mock.token.mockResolvedValueOnce({ token: "synthetic-first-token" }).mockResolvedValueOnce({ token: "synthetic-second-token" });
    const trigger = renderSubscription();
    expect(mock.token).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await screen.findByText(`${window.location.origin}/api/calendar/synthetic-first-token`);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    await screen.findByText(`${window.location.origin}/api/calendar/synthetic-second-token`);
    expect(mock.token).toHaveBeenCalledTimes(2);
  });

  it("取消或 Escape 关闭重置确认时不调用重置，也不关闭订阅窗口", async () => {
    const { dialog } = await openSubscription();
    fireEvent.click(within(dialog).getByRole("button", { name: "重置链接" }));
    let confirm = await screen.findByRole("dialog", { name: "重置订阅链接？" });
    fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "重置订阅链接？" })).not.toBeInTheDocument());
    expect(mock.regenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "订阅日历" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "重置链接" }));
    confirm = await screen.findByRole("dialog", { name: "重置订阅链接？" });
    fireEvent.keyDown(confirm, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "重置订阅链接？" })).not.toBeInTheDocument());
    expect(mock.regenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "订阅日历" })).toBeVisible();
  });

  it("重置失败保留原链接，重试成功才更新，提交期间不复制旧链接", async () => {
    mock.regenerate.mockRejectedValueOnce(new ActionError("重置暂不可用"));
    const { dialog } = await openSubscription();
    fireEvent.click(within(dialog).getByRole("button", { name: "重置链接" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "重置订阅链接？" })).getByRole("button", { name: "重置链接" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("重置失败", { description: "重置暂不可用" }));
    expect(within(dialog).getByText(`${window.location.origin}/api/calendar/synthetic-calendar-token`)).toBeVisible();
    let finish!: (value: { token: string }) => void;
    mock.regenerate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(within(dialog).getByRole("button", { name: "重置链接" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "重置订阅链接？" })).getByRole("button", { name: "重置链接" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "复制链接" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "重置链接" })).toBeDisabled();
    await act(async () => finish({ token: "synthetic-new-token" }));
    await within(dialog).findByText(`${window.location.origin}/api/calendar/synthetic-new-token`);
    fireEvent.click(within(dialog).getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(`${window.location.origin}/api/calendar/synthetic-new-token`));
    expect(mock.regenerate).toHaveBeenCalledTimes(2);
  });

  it("读取或复制失败反馈真实失败，关闭重开仍能重新读取", async () => {
    mock.token.mockRejectedValueOnce(new Error("synthetic read failure"));
    const trigger = renderSubscription();
    fireEvent.click(trigger);
    expect(await screen.findByText("订阅链接不可用。")).toBeVisible();
    expect(mock.error).toHaveBeenCalledWith("获取订阅链接失败");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(trigger);
    await screen.findByText(`${window.location.origin}/api/calendar/synthetic-calendar-token`);
    mock.copy.mockRejectedValueOnce(new Error("synthetic clipboard failure"));
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("复制失败，请手动选中复制"));
  });
});

describe("日程 Semi 详情弹窗", () => {
  const item: ScheduleItem = {
    id: "synthetic-deadline", type: "deadline", title: "合成举证期限", occurredAt: new Date("2027-02-05T00:00:00+08:00"),
    deadlineId: "synthetic-deadline", duePrecision: "DATE", matter: { id: "synthetic-matter", internalCode: "TEST-001", title: "合成案件" },
    clientName: "合成客户", procedureLabel: "FIRST_INSTANCE", category: "CUSTOM", remindDays: 3,
    description: "合成详情第一行\n合成详情第二行", href: "/matters/TEST-001?procedure=synthetic-procedure"
  };

  it("日期型期限不补造时刻，保留实际案件链接和原条目返回焦点", async () => {
    render(<ScheduleView items={[item]} matters={[]} />);
    const trigger = screen.getAllByRole("button", { name: /合成举证期限/ })[0];
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: item.title });
    expect(within(dialog).getByText("2027-02-05")).toBeVisible();
    expect(within(dialog).queryByText(/00:00/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("合成详情第一行 合成详情第二行")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "查看案件" })).toHaveAttribute("href", item.href);
    expect(within(dialog).getByRole("link", { name: "合成案件" })).toHaveAttribute("href", item.href);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("准确时刻继续使用上海时间，未提供专属链接时使用真实案件编号", async () => {
    render(<ScheduleView items={[{ ...item, occurredAt: new Date("2027-02-05T01:30:00Z"), duePrecision: "DATETIME", href: undefined }]} matters={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /合成举证期限/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: item.title });
    expect(within(dialog).getByText("2027-02-05 09:30")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "查看案件" })).toHaveAttribute("href", "/matters/TEST-001");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
