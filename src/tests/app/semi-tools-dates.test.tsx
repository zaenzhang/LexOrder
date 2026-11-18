import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsDialog } from "@/components/layout/tools-dialog";

beforeEach(() => {
  // 只冻结日期，保留 Semi Modal 的真实关闭定时器。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T15:59:59.000Z"));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function ToolsHarness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>打开实务工具</button><ToolsDialog open={open} onOpenChange={setOpen} /></>;
}

async function openTools() {
  fireEvent.click(screen.getByRole("button", { name: "打开实务工具" }));
  return screen.findByRole("dialog");
}

describe("实务工具首次打开的上海默认日期", () => {
  it("工作台闭合跨过上海午夜后，按各工具首次激活时的当天初始化", async () => {
    render(<ToolsHarness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    vi.setSystemTime(new Date("2026-11-18T16:00:01.000Z"));
    await openTools();
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    expect(screen.getByLabelText("起始日")).toHaveValue("2026-11-19");
    expect(screen.getByLabelText("截止日")).toHaveValue("2026-11-19");
    fireEvent.click(screen.getByRole("radio", { name: "加减天数" }));
    expect(screen.getByLabelText("基准日")).toHaveValue("2026-11-19");

    // 迟延履行工具尚未打开，应按它自己的首次激活日期初始化。
    vi.setSystemTime(new Date("2026-11-19T16:00:01.000Z"));
    fireEvent.click(screen.getByRole("tab", { name: "迟延履行金" }));
    expect(screen.getByLabelText("实际履行日期（或截至日）")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("应履行日期")).toHaveValue("2026-05-20");
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    expect(screen.getByLabelText("基准日")).toHaveValue("2026-11-19");
  });

  it("关闭后隔日重开保留修改日期和故意清空的日期", async () => {
    render(<ToolsHarness />);
    vi.setSystemTime(new Date("2026-11-18T16:00:01.000Z"));
    const dialog = await openTools();
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    fireEvent.change(screen.getByLabelText("起始日"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("截止日"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "加减天数" }));
    fireEvent.change(screen.getByLabelText("基准日"), { target: { value: "2026-10-31" } });
    fireEvent.click(screen.getByRole("tab", { name: "迟延履行金" }));
    fireEvent.change(screen.getByLabelText("应履行日期"), { target: { value: "2026-09-08" } });
    fireEvent.change(screen.getByLabelText("实际履行日期（或截至日）"), { target: { value: "" } });

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape", keyCode: 27 });
    // jsdom lacks AnimationEvent, so React subscribes to the WebKit-prefixed event.
    expect(dialog).toHaveClass("semi-modal-content-animate-hide");
    fireEvent(dialog, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    vi.setSystemTime(new Date("2026-11-19T16:00:01.000Z"));
    await openTools();
    expect(screen.getByLabelText("应履行日期")).toHaveValue("2026-09-08");
    expect(screen.getByLabelText("实际履行日期（或截至日）")).toHaveValue("");
    fireEvent.click(screen.getByRole("tab", { name: "天数计算" }));
    expect(screen.getByLabelText("基准日")).toHaveValue("2026-10-31");
    fireEvent.click(screen.getByRole("radio", { name: "两日期之间" }));
    expect(screen.getByLabelText("起始日")).toHaveValue("2026-11-02");
    expect(screen.getByLabelText("截止日")).toHaveValue("");
  });
});
