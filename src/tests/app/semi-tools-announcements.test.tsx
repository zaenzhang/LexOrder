import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), refresh: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/server/announcements/actions", () => ({ createAnnouncement: actions.create, updateAnnouncement: actions.update }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: actions.success }),
    Notification: Object.assign(semi.Notification, { error: actions.error, success: actions.success })
  };
});

import { AnnouncementDialog } from "@/app/(app)/announcements/_components/announcement-dialog";
import { CourtFeeCalc, useCourtFeeCalculator } from "@/app/(app)/tools/calc/_components/court-fee-calc";
import { DaysCalc, useDaysCalculator } from "@/app/(app)/tools/calc/_components/days-calc";
import { LateInterestCalc, useLateInterestCalculator } from "@/app/(app)/tools/calc/_components/late-interest-calc";
import { ToolsDialog } from "@/components/layout/tools-dialog";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.create.mockResolvedValue({ id: "new-announcement" });
  actions.update.mockResolvedValue({ id: "announcement-original" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const editing = { id: "announcement-original", title: "合成旧标题", content: "原公告正文", pinned: false, expiresAt: new Date("2026-11-18T16:00:00.000Z") };

describe("公告 Semi 控件保留原保存合同", () => {
  it("原公告的上海日期和值正常提交，失败保稿并允许对同一记录重试", async () => {
    const onOpenChange = vi.fn();
    actions.update.mockRejectedValueOnce(new Error("合成保存失败"));
    render(<AnnouncementDialog open onOpenChange={onOpenChange} editing={editing} />);
    expect(screen.getByLabelText("过期日期（可选）")).toHaveValue("2026-11-19");
    fireEvent.change(screen.getByLabelText("标题 *"), { target: { value: "修订标题" } });
    fireEvent.change(screen.getByLabelText("内容 *"), { target: { value: "修订正文\n第二行" } });
    fireEvent.change(screen.getByLabelText("过期日期（可选）"), { target: { value: "2026-11-21" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "置顶到公告栏" }));
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(actions.error).toHaveBeenCalledWith(expect.objectContaining({ title: "保存失败", content: expect.any(String) })));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("标题 *")).toHaveValue("修订标题");
    expect(screen.getByLabelText("内容 *")).toHaveValue("修订正文\n第二行");
    expect(screen.getByRole("checkbox", { name: "置顶到公告栏" })).toBeChecked();
    const expected = { id: editing.id, title: "修订标题", content: "修订正文\n第二行", pinned: true, expiresAt: new Date("2026-11-20T16:00:00.000Z") };
    expect(actions.update).toHaveBeenLastCalledWith(expected);
    await waitFor(() => expect(screen.getByRole("button", { name: "更新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actions.update).toHaveBeenCalledTimes(2);
    expect(actions.update).toHaveBeenLastCalledWith(expected);
    expect(actions.create).not.toHaveBeenCalled();
    expect(actions.refresh).toHaveBeenCalledOnce();
  });

  it("保存未完成时保留窗口与已冻结输入，取消和 Escape 不丢弃原稿", async () => {
    let rejectSave!: (reason: Error) => void;
    actions.update.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
    const onOpenChange = vi.fn();
    render(<AnnouncementDialog open onOpenChange={onOpenChange} editing={editing} />);
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(screen.getByLabelText("标题 *")).toBeDisabled());
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "更新" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(actions.update).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape", keyCode: 27 });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => { rejectSave(new Error("合成失败")); });
    await waitFor(() => expect(screen.getByLabelText("标题 *")).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("新公告保持必填校验，清空到期日以 null 保存", async () => {
    const onOpenChange = vi.fn();
    render(<AnnouncementDialog open onOpenChange={onOpenChange} editing={null} />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(actions.create).not.toHaveBeenCalled();
    expect(actions.error).toHaveBeenCalledWith(expect.objectContaining({ title: "标题和内容必填" }));
    fireEvent.change(screen.getByLabelText("标题 *"), { target: { value: "新公告" } });
    fireEvent.change(screen.getByLabelText("内容 *"), { target: { value: "新公告内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actions.create).toHaveBeenCalledWith({ title: "新公告", content: "新公告内容", pinned: false, expiresAt: null });
    expect(actions.update).not.toHaveBeenCalled();
  });
});

function ToolsHarness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>打开实务工具</button><ToolsDialog open={open} onOpenChange={setOpen} /></>;
}

function CourtFeeHarness() { return <CourtFeeCalc calculator={useCourtFeeCalculator()} />; }
function DaysHarness() { return <DaysCalc calculator={useDaysCalculator()} />; }
function LateInterestHarness() { return <LateInterestCalc calculator={useLateInterestCalculator()} />; }

describe("实务工具 Semi 输入与切换", () => {
  it("金额和案件类型沿原计算函数，切到无金额类型不使用隐藏金额", () => {
    render(<CourtFeeHarness />);
    fireEvent.change(screen.getByLabelText("诉讼标的金额（元）"), { target: { value: "200000" } });
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("¥4,300")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "劳动争议" }));
    expect(screen.queryByLabelText("诉讼标的金额（元）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("¥10")).toBeVisible();
  });

  it("日期输入与工作日勾选保持计算，切换加减天数读取其实际输入", () => {
    render(<DaysHarness />);
    fireEvent.change(screen.getByLabelText("起始日"), { target: { value: "2026-11-13" } });
    fireEvent.change(screen.getByLabelText("截止日"), { target: { value: "2026-11-16" } });
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("3 天")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "仅算工作日（排除周末，不含法定节假日）" }));
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("1 天")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "加减天数" }));
    fireEvent.change(screen.getByLabelText("基准日"), { target: { value: "2026-11-18" } });
    fireEvent.change(screen.getByLabelText("加减天数（可负）"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("2026-11-15")).toBeVisible();
  });

  it("迟延履行金额、两日期与可修改利率传递到原计算", () => {
    render(<LateInterestHarness />);
    fireEvent.change(screen.getByLabelText("判决金额（元）"), { target: { value: "36500" } });
    fireEvent.change(screen.getByLabelText("应履行日期"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("实际履行日期（或截至日）"), { target: { value: "2026-11-11" } });
    fireEvent.change(screen.getByLabelText("一年期 LPR（%）"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("加成（%）"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    expect(screen.getByText("10 天")).toBeVisible();
    expect(screen.getByText("8.00%")).toBeVisible();
    expect(screen.getByText("¥80")).toBeVisible();
  });

  it("切换工具与关闭重开保留输入，Escape 关闭后焦点返回原入口", async () => {
    render(<ToolsHarness />);
    const trigger = screen.getByRole("button", { name: "打开实务工具" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("诉讼标的金额（元）"), { target: { value: "230000" } });
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    fireEvent.change(screen.getByLabelText("起始日"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("tab", { name: "诉讼费" }));
    expect(screen.getByLabelText("诉讼标的金额（元）")).toHaveValue(230000);
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape", keyCode: 27 });
    // jsdom lacks AnimationEvent, so React subscribes to the WebKit-prefixed event.
    expect(dialog).toHaveClass("semi-modal-content-animate-hide");
    fireEvent(dialog, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("诉讼标的金额（元）")).toHaveValue(230000);
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    expect(screen.getByLabelText("起始日")).toHaveValue("2026-11-02");
  });
});
