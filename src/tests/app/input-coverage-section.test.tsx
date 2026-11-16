import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableInputCoverageItem, MatterInputCoverageItem, MatterInputCoverageView } from "@/lib/ai/input-coverage";
import { ActionError } from "@/lib/action-error";

const mock = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/server/ai/input-coverage-actions", () => ({ getMatterInputCoverage: mock.check }));

import { InputCoverageSection } from "@/app/(app)/matters/[id]/_components/input-coverage-section";

const matterId = "cmtestmatter00000000000001";
const choices = [
  { id: "document-1", name: "合成主材料", version: 1 },
  { id: "document-2", name: "合成补充材料", version: 2 }
];

function available(id = "document-1", overrides: Partial<AvailableInputCoverageItem> = {}): AvailableInputCoverageItem {
  return {
    status: "AVAILABLE", documentId: id, documentName: id === "document-1" ? "当前授权主材料" : "当前授权补充材料", documentVersion: id === "document-1" ? 1 : 2,
    documentSha256: "1".repeat(64), run: { id: "run-1", generation: 2, parserVersion: "synthetic-v1", isCurrent: true },
    processing: { state: "READY", label: "文本可用" },
    coverage: { unitKind: "PAGE", totalUnits: 1, counts: { ready: 1, pending: 0, failed: 0, unsupported: 0, truncated: 0 }, units: [{ unit: 1, status: "READY" }], omittedUnitCount: 0 },
    preparation: { canPrepare: true, availableChars: 100, preparedChars: 100, unpreparedChars: 0, rangeCount: 1, ranges: [{ anchorId: "anchor-1", unit: 1, location: { kind: "PAGE", page: 1 }, locationLabel: "第 1 页", start: 0, end: 100, totalChars: 100 }], omittedRangeCount: 0 },
    issues: [], ...overrides
  };
}

function view(items: MatterInputCoverageItem[] = [available()], id = matterId): MatterInputCoverageView {
  const readable = items.filter(item => item.status === "AVAILABLE");
  return {
    mode: "PREVIEW", matterId: id, checkedAt: "2026-11-16T01:00:00.000Z",
    budget: { maxChars: 36000, maxDocuments: 50, maxRangeDetails: 200, maxUnitDetails: 200, order: "REQUEST_ORDER" },
    modelSupply: { status: "NOT_SENT", sentChars: 0 },
    summary: {
      selectedDocuments: items.length, availableDocuments: readable.length, unavailableDocuments: items.length - readable.length,
      availableChars: readable.reduce((sum, item) => sum + item.preparation.availableChars, 0),
      preparedChars: readable.reduce((sum, item) => sum + item.preparation.preparedChars, 0),
      rangeCount: readable.reduce((sum, item) => sum + item.preparation.rangeCount, 0),
      omittedRangeCount: readable.reduce((sum, item) => sum + item.preparation.omittedRangeCount, 0),
      omittedUnitCount: readable.reduce((sum, item) => sum + (item.coverage?.omittedUnitCount ?? 0), 0)
    }, items
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function select(name = "合成主材料 · 第 1 版") {
  fireEvent.click(screen.getByRole("checkbox", { name }));
}

beforeEach(() => { mock.check.mockReset(); });
afterEach(cleanup);

describe("离线输入范围检查（组件环境）", () => {
  it("初始空选择不请求；显式选择后仅按当前列表顺序检查所选版本", async () => {
    mock.check.mockResolvedValue(view([available(), available("document-2")]));
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    expect(mock.check).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "检查所选材料" })).toBeDisabled();
    select("合成补充材料 · 第 2 版");
    select();
    expect(mock.check).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    await screen.findByText("本次未调用 AI");
    expect(mock.check).toHaveBeenCalledExactlyOnceWith({ matterId, documents: [{ documentId: "document-1" }, { documentId: "document-2" }] });
    expect(screen.getByText("当前授权主材料")).toBeVisible();
    expect(screen.getByText("当前授权补充材料")).toBeVisible();
    expect(screen.getByText(/不表示 AI 已读或已完成审查/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /AI|生成|审查/ })).not.toBeInTheDocument();
  });

  it("分别显示未知总范围、历史解析、未准备内容与省略明细，不把局部文本称为整页覆盖", async () => {
    const item = available();
    item.documentId = "document-1";
    item.documentName = "合成受限准备材料";
    item.run = { id: "run-old", generation: 1, parserVersion: "synthetic-v1", isCurrent: false };
    item.coverage = { unitKind: "PAGE", totalUnits: null, counts: { ready: 2, pending: 1, failed: 1, unsupported: 0, truncated: 0 }, units: [{ unit: 1, status: "READY" }, { unit: 2, status: "PENDING" }], omittedUnitCount: 2 };
    item.preparation = { canPrepare: true, availableChars: 120, preparedChars: 60, unpreparedChars: 60, rangeCount: 2, ranges: [{ anchorId: "anchor-1", unit: 1, location: { kind: "PAGE", page: 1 }, locationLabel: "第 1 页", start: 0, end: 40, totalChars: 100 }], omittedRangeCount: 1 };
    item.issues = [{ code: "PREPARATION_BUDGET", label: "超出本次可检查字数", detail: "合成未包含内容说明" }];
    const readOnly = available("document-2", { preparation: { canPrepare: false, availableChars: 100, preparedChars: 0, unpreparedChars: 100, rangeCount: 0, ranges: [], omittedRangeCount: 0 } });
    mock.check.mockResolvedValue(view([item, readOnly]));
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    select();
    select("合成补充材料 · 第 2 版");
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    await screen.findByText("合成受限准备材料");
    expect(screen.getByText(/以前提取的文本/)).toBeVisible();
    expect(screen.getByText(/总范围未知/)).toHaveTextContent("不能判断是否完整");
    expect(screen.getByText(/本次未包含 60 字符/)).toBeVisible();
    expect(screen.getByText(/当前无权把此材料用于 AI 审查；仍可查看本地处理状态/)).toBeVisible();
    expect(screen.getByText("超出本次可检查字数")).toBeVisible();
    expect(screen.getByText(/明细展示有上限/)).toHaveTextContent("统计仍包含已知范围");
    fireEvent.click(screen.getByText("查看未处理部分"));
    expect(screen.getByText("第 2 页：尚未识别")).toBeVisible();
    fireEvent.click(screen.getByText("查看本次可用文本的位置"));
    expect(screen.getByText(/不代表原件整页或整段均已覆盖/)).toBeVisible();
    expect(screen.getByText(/仅此片段的第 1—40 个字符/)).toBeVisible();
    expect(screen.getByText(/UTF-16 长度统计/)).toBeVisible();
  });

  it("不可用材料只展示通用占位，同时遮蔽选择列表中的旧名称和版本", async () => {
    mock.check.mockResolvedValue(view([{ status: "UNAVAILABLE", documentId: "document-1" }]));
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    select();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    await screen.findByText("所选材料 1 当前不可用");
    expect(screen.queryByText(/合成主材料/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /合成主材料/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "材料 1（当前不可用）" })).toBeChecked();
    expect(screen.queryByText("当前授权主材料")).not.toBeInTheDocument();
    expect(screen.queryByText("查看本次可用文本的位置")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消全部勾选" }));
    expect(screen.queryByText("所选材料 1 当前不可用")).not.toBeInTheDocument();
    expect(screen.queryByText(/合成主材料/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查所选材料" })).toBeDisabled();
  });

  it("重查立即清除旧结果，失败保留明确错误与重试且不回填旧范围", async () => {
    const again = deferred<MatterInputCoverageView>();
    mock.check.mockResolvedValueOnce(view()).mockReturnValueOnce(again.promise);
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    select();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    await screen.findByText("当前授权主材料");
    fireEvent.click(screen.getByRole("button", { name: "重新检查所选材料" }));
    expect(screen.queryByText("当前授权主材料")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeVisible();
    await act(async () => { again.reject(new ActionError("当前没有材料读取资格")); });
    expect(screen.getByRole("alert")).toHaveTextContent("当前没有材料读取资格");
    expect(screen.queryByText("本次未调用 AI")).not.toBeInTheDocument();
    mock.check.mockResolvedValueOnce(view([{ status: "UNAVAILABLE", documentId: "document-1" }]));
    fireEvent.click(screen.getByRole("button", { name: "重试材料检查" }));
    await screen.findByText("所选材料 1 当前不可用");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("当前授权主材料")).not.toBeInTheDocument();
  });

  it("内部错误只显示可重试提示，不显示原始服务细节", async () => {
    mock.check.mockRejectedValue(new Error("Synthetic internal database details"));
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    expect(screen.getByText("从下列材料中选择版本（不限当前环节，最多 50 份）")).toBeVisible();
    select();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法检查，请稍后重试");
    expect(screen.queryByText(/Synthetic internal database details/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试材料检查" })).toBeEnabled();
  });

  it("改变选择会丢弃待返回结果，新选择不会混入前次材料", async () => {
    const earlier = deferred<MatterInputCoverageView>();
    mock.check.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(view([available("document-2")]));
    render(<InputCoverageSection matterId={matterId} documents={choices} />);
    select();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    select();
    select("合成补充材料 · 第 2 版");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    await screen.findByText("当前授权补充材料");
    await act(async () => { earlier.resolve(view()); });
    expect(screen.queryByText("当前授权主材料")).not.toBeInTheDocument();
    expect(screen.getByText("当前授权补充材料")).toBeVisible();
    expect(mock.check).toHaveBeenLastCalledWith({ matterId, documents: [{ documentId: "document-2" }] });
  });

  it("同事项服务端刷新重置选择，并拒绝刷新前的迟到结果", async () => {
    const earlier = deferred<MatterInputCoverageView>();
    mock.check.mockReturnValue(earlier.promise);
    const { rerender } = render(<InputCoverageSection matterId={matterId} documents={choices} refreshKey="before" />);
    select();
    fireEvent.click(screen.getByRole("button", { name: "检查所选材料" }));
    rerender(<InputCoverageSection matterId={matterId} documents={choices} refreshKey="after" />);
    expect(screen.getByRole("checkbox", { name: "合成主材料 · 第 1 版" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "检查所选材料" })).toBeDisabled();
    await act(async () => { earlier.resolve(view()); });
    expect(screen.queryByText("当前授权主材料")).not.toBeInTheDocument();
    expect(screen.queryByText("本次未调用 AI")).not.toBeInTheDocument();
    expect(mock.check).toHaveBeenCalledTimes(1);
  });

  it("当前材料列表为空时不查询，也不暗中改查全案", () => {
    render(<InputCoverageSection matterId={matterId} documents={[]} />);
    expect(screen.getByText("暂无可选择的材料。")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(mock.check).not.toHaveBeenCalled();
  });
});
