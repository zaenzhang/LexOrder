import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ statuses: vi.fn(), retry: vi.fn(), coverage: vi.fn() }));
vi.mock("@/server/documents/processing-actions", () => ({ getMaterialProcessingStatuses: mock.statuses, retryMaterialProcessing: mock.retry }));
vi.mock("@/server/ai/input-coverage-actions", () => ({ getMatterInputCoverage: mock.coverage }));

import { MaterialToolsSheet } from "@/app/(app)/matters/[id]/_components/material-tools-sheet";

const documents = [{ id: "doc-1", name: "合成材料", version: 2 }];
const props = { matterId: "matter-1", documents, scopeLabel: "合成程序及未归属材料 · 不限环节", canManage: false };

beforeEach(() => {
  vi.clearAllMocks();
  mock.statuses.mockResolvedValue([]);
});
afterEach(cleanup);

describe("材料工具按需展开（组件环境）", () => {
  it("未打开不读取状态，入口打开对应工具并在关闭后归还焦点", async () => {
    render(<MaterialToolsSheet {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.statuses).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "处理状态" });
    fireEvent.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "材料工具" });
    expect(within(sheet).getByRole("tab", { name: "处理状态" })).toHaveAttribute("aria-selected", "true");
    expect(within(sheet).getByText(props.scopeLabel)).toBeVisible();
    await waitFor(() => expect(mock.statuses).toHaveBeenCalledWith({ matterId: "matter-1", documentIds: ["doc-1"] }));
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mock.retry).not.toHaveBeenCalled();
    expect(mock.coverage).not.toHaveBeenCalled();
  });

  it("读取检查的已选材料跨工具切换保留，关闭后重新打开恢复未选择状态", async () => {
    render(<MaterialToolsSheet {...props} />);
    const trigger = screen.getByRole("button", { name: "读取检查" });
    fireEvent.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "材料工具" });
    const selected = within(sheet).getByRole("checkbox", { name: "合成材料 · 第 2 版" });
    fireEvent.click(selected);
    expect(selected).toBeChecked();
    expect(mock.statuses).not.toHaveBeenCalled();
    fireEvent.mouseDown(within(sheet).getByRole("tab", { name: "处理状态" }), { button: 0, ctrlKey: false });
    expect(within(sheet).queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(mock.statuses).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(within(sheet).getByRole("tab", { name: "读取检查" }), { button: 0, ctrlKey: false });
    expect(within(sheet).getByRole("checkbox", { name: "合成材料 · 第 2 版" })).toBeChecked();
    expect(within(sheet).queryByRole("region", { name: "材料处理状态" })).not.toBeInTheDocument();
    expect(mock.coverage).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getByRole("checkbox", { name: "合成材料 · 第 2 版" })).not.toBeChecked();
  });

  it("材料版本变化清除旧选择，没有材料时两种工具都有空态", () => {
    const view = render(<MaterialToolsSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "读取检查" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "合成材料 · 第 2 版" }));
    view.rerender(<MaterialToolsSheet {...props} documents={[{ ...documents[0], version: 3 }]} />);
    expect(screen.getByRole("checkbox", { name: "合成材料 · 第 3 版" })).not.toBeChecked();
    view.rerender(<MaterialToolsSheet {...props} documents={[]} scopeLabel="当前事项材料" />);
    expect(screen.getByText("暂无可选择的材料。")).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "处理状态" }), { button: 0, ctrlKey: false });
    expect(screen.getByText("暂无可处理的材料。")).toBeVisible();
    expect(mock.statuses).not.toHaveBeenCalled();
  });
});
