import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ statuses: vi.fn(), retry: vi.fn(), coverage: vi.fn() }));
vi.mock("@/server/documents/processing-actions", () => ({ getMaterialProcessingStatuses: mock.statuses, retryMaterialProcessing: mock.retry }));
vi.mock("@/server/ai/input-coverage-actions", () => ({ getMatterInputCoverage: mock.coverage }));

import { MaterialToolsSheet } from "@/app/(app)/matters/[id]/_components/material-tools-sheet";
import type { MaterialProcessingStatusItem } from "@/server/documents/material-processing";

const documents = [{ id: "doc-1", name: "合成材料", version: 2 }];
const props = { matterId: "matter-1", documents, scopeLabel: "合成程序及未归属材料 · 不限环节", canManage: false };

beforeEach(() => {
  vi.clearAllMocks();
  mock.statuses.mockResolvedValue([]);
});
afterEach(cleanup);

describe("材料工具按需展开（组件环境）", () => {
  it("处理失败仍区分转换预览与同版下载，刷新失权不保留旧链接", async () => {
    const row: MaterialProcessingStatusItem = { documentId: "doc-1", documentName: "合成旧稿.docx", generation: 2, runId: "old-run",
      state: "FAILED", label: "处理失败", detail: "尚未提取文本", inProgress: false, canRetry: false,
      previewKind: "CONVERTED", previewUrl: "/api/documents/doc-1/preview", downloadUrl: "/api/documents/doc-1/download", coverage: null };
    mock.statuses.mockResolvedValue([row]); render(<MaterialToolsSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "处理状态" }));
    const sheet = screen.getByRole("dialog", { name: "材料工具" });
    expect(await within(sheet).findByText("处理失败")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "转换预览" })).toHaveAttribute("href", row.previewUrl);
    expect(within(sheet).getByRole("link", { name: "下载此版本" })).toHaveAttribute("href", row.downloadUrl);
    expect(within(sheet).queryByRole("link", { name: "查看原件" })).not.toBeInTheDocument();
    mock.statuses.mockRejectedValue(new Error("合成权限已变化"));
    fireEvent.click(within(sheet).getByRole("button", { name: "刷新状态" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("合成权限已变化");
    expect(within(sheet).queryByRole("link")).not.toBeInTheDocument(); expect(mock.retry).not.toHaveBeenCalled();
  });

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
    fireEvent.click(within(sheet).getByRole("tab", { name: "处理状态" }));
    expect(within(sheet).queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(mock.statuses).toHaveBeenCalledTimes(1));
    fireEvent.click(within(sheet).getByRole("tab", { name: "读取检查" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "处理状态" }));
    expect(screen.getByText("暂无可处理的材料。")).toBeVisible();
    expect(mock.statuses).not.toHaveBeenCalled();
  });
});
