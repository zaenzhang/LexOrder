import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@prisma/client";

const mock = vi.hoisted(() => ({
  notifications: vi.fn(), unread: vi.fn(), mark: vi.fn(), markAll: vi.fn(), sms: vi.fn(), markSms: vi.fn(), parseSms: vi.fn(),
  push: vi.fn(), refresh: vi.fn(), error: vi.fn(), success: vi.fn(),
}));
vi.mock("next/navigation", () => {
  const router = { push: mock.push, refresh: mock.refresh };
  return { useRouter: () => router };
});
vi.mock("@/server/notifications/actions", () => ({
  getNotifications: mock.notifications, getUnreadCount: mock.unread,
  markNotificationRead: mock.mark, markAllNotificationsRead: mock.markAll,
}));
vi.mock("@/server/sms/actions", () => ({ listSmsMessages: mock.sms, markSmsProcessed: mock.markSms, parseAndSaveSms: mock.parseSms }));
vi.mock("@douyinfe/semi-ui", async (importOriginal) => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return { ...semi, Toast: { ...semi.Toast, error: mock.error } };
});

import { NotificationPopover } from "@/components/layout/notification-popover";
import { SmsPopover } from "@/components/layout/sms-popover";
import { NotificationsView } from "@/app/(app)/notifications/notifications-view";

const notification = (id: string, read = false): Notification => ({
  id, userId: "synthetic-user", type: "SYSTEM", priority: "NORMAL", title: `合成通知${id}`, content: "合成内容",
  href: null, refType: null, refId: null, read, readAt: read ? new Date() : null, createdAt: new Date(),
});
const sms = { id: "synthetic-sms", smsType: "HEARING_NOTICE", receivedAt: new Date(), rawText: "合成庭期通知",
  parsedJson: { court: "合成法院", summary: "合成庭期通知" }, matchedMatter: { title: "合成案件", internalCode: "TEST-01" } };

beforeEach(() => {
  vi.resetAllMocks();
  mock.notifications.mockResolvedValue([notification("甲", true), notification("乙")]);
  mock.unread.mockResolvedValue(2);
  mock.mark.mockImplementation(async (id: string) => notification(id, true));
  mock.markAll.mockResolvedValue({ ok: true });
  mock.sms.mockResolvedValue([sms]);
  mock.markSms.mockResolvedValue({ ok: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openNotifications() {
  render(<NotificationPopover />);
  const trigger = await screen.findByRole("button", { name: "通知（2 条未读）" });
  trigger.focus(); fireEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  await screen.findByRole("button", { name: /合成通知甲/ });
  await waitFor(() => expect(screen.queryByText("正在读取通知…")).not.toBeInTheDocument());
  return trigger;
}

describe("Semi 通知入口与当前回执", () => {
  it("重复打开已读通知不扣未读数，真正未读只在成功后扣一次", async () => {
    await openNotifications();
    fireEvent.click(screen.getByRole("button", { name: /合成通知甲/ }));
    expect(mock.mark).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "通知（2 条未读）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /合成通知乙/ }));
    await screen.findByRole("button", { name: "通知（1 条未读）" });
    fireEvent.click(screen.getByRole("button", { name: /合成通知乙/ }));
    expect(mock.mark).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "通知（1 条未读）" })).toBeInTheDocument();
  });

  it("读取失败隐藏旧列表并给重试，Escape 关闭回到铃铛", async () => {
    const trigger = await openNotifications();
    fireEvent.keyDown(screen.getByRole("region", { name: "通知列表" }), { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("region", { name: "通知列表" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    mock.notifications.mockRejectedValueOnce(new Error("private-query"));
    fireEvent.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("通知读取失败");
    expect(screen.queryByRole("button", { name: /合成通知甲/ })).not.toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-query/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    await screen.findByRole("button", { name: /合成通知甲/ });
  });

  it("标记失败保留未读和当前位置，重试成功后才导航", async () => {
    mock.notifications.mockResolvedValue([{ ...notification("乙"), href: "/matters/TEST-01" }]);
    render(<NotificationPopover />);
    fireEvent.click(await screen.findByRole("button", { name: "通知（2 条未读）" }));
    const entry = await screen.findByRole("button", { name: /合成通知乙/ });
    mock.mark.mockRejectedValueOnce(new Error("synthetic failure"));
    fireEvent.click(entry);
    expect(await screen.findByRole("alert")).toHaveTextContent("标记已读失败");
    expect(mock.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "通知（2 条未读）" })).toBeInTheDocument();
    await waitFor(() => expect(entry).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(entry);
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/matters/TEST-01"));
    expect(mock.mark).toHaveBeenCalledTimes(2);
  });

  it("先前读取迟到时不覆盖已成功的单条已读回执", async () => {
    let finish!: (value: Notification[]) => void;
    render(<NotificationPopover />);
    const trigger = await screen.findByRole("button", { name: "通知（2 条未读）" });
    mock.notifications.mockReturnValueOnce(new Promise<Notification[]>(resolve => { finish = resolve; }));
    fireEvent.click(trigger);
    await screen.findByText("正在读取通知…");
    // 读取中保留已有已授权行，标记原行会使该次旧读取失效。
    fireEvent.click(await screen.findByRole("button", { name: /合成通知乙/ }));
    await screen.findByRole("button", { name: "通知（1 条未读）" });
    await act(async () => { finish([notification("甲", true), notification("乙")]); });
    expect(screen.getByRole("button", { name: "通知（1 条未读）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /合成通知乙/ }));
    expect(mock.mark).toHaveBeenCalledTimes(1);
  });

  it("全部已读成功后铃铛圆点消失，空通知不显示未读圆点", async () => {
    const trigger = await openNotifications();
    expect(trigger.querySelector(".semi-badge-dot")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "通知" }).querySelector(".semi-badge-dot")).toBeNull());
    expect(mock.markAll).toHaveBeenCalledOnce();
  });

  it("通知整页全部已读失败可重试，成功后更新显示并回读页面", async () => {
    mock.markAll.mockRejectedValueOnce(new Error("synthetic failure"));
    render(<NotificationsView notifications={[notification("乙")]} />);
    fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("全部标记已读失败");
    const retry = screen.getByRole("button", { name: "全部已读" });
    await waitFor(() => expect(retry).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument());
    expect(mock.markAll).toHaveBeenCalledTimes(2);
    expect(mock.refresh).toHaveBeenCalledOnce();
  });
});

describe("Semi 法院短信入口", () => {
  it("读取失败不冒充全部处理，重试后保原记录深链", async () => {
    mock.sms.mockRejectedValue(new Error("synthetic failure"));
    render(<SmsPopover />);
    const trigger = await screen.findByRole("button", { name: "法院短信（读取失败），可粘贴新短信" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    expect(await screen.findByRole("alert")).toHaveTextContent("法院短信读取失败");
    expect(screen.queryByText("均已处理")).not.toBeInTheDocument();
    expect(screen.queryByText("没有未处理的法院短信")).not.toBeInTheDocument();
    mock.sms.mockResolvedValue([sms]);
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    expect(await screen.findByRole("link", { name: "去处理" })).toHaveAttribute("href", "/inbox?focus=synthetic-sms");
  });

  it("标记失败保原条目，成功后才移除；取消粘贴返回稳定短信入口", async () => {
    render(<SmsPopover />);
    const trigger = await screen.findByRole("button", { name: "法院短信（1 条未处理），可粘贴新短信" });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const mark = await screen.findByRole("button", { name: "标记已处理" });
    mock.markSms.mockRejectedValueOnce(new Error("合成保存失败"));
    fireEvent.click(mark);
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "去处理" })).toBeInTheDocument();
    await waitFor(() => expect(mark).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(mark);
    await waitFor(() => expect(screen.queryByRole("link", { name: "去处理" })).not.toBeInTheDocument());
    expect(mock.markSms).toHaveBeenLastCalledWith({ id: "synthetic-sms" });
    fireEvent.click(screen.getByRole("button", { name: "粘贴短信" }));
    const dialog = await screen.findByRole("dialog", { name: "粘贴法院短信" });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("region", { name: "法院短信列表" })).not.toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("原文粘贴在此...")).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
