import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ history: vi.fn(), detail: vi.fn(), review: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/server/ai/review-document", () => ({ reviewDocument: mocks.review }));
vi.mock("@/server/ai/review-history", () => ({ listReviewHistory: mocks.history, getReviewRecord: mocks.detail }));
vi.mock("@/server/ai/save-review", () => ({ saveReviewToMatter: mocks.save }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { DocumentReviewDialog } from "@/app/(app)/matters/[id]/_components/document-review-dialog";
import type { ReviewHistoryDetail, ReviewHistoryEntry } from "@/server/ai/review-history";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function result(documentId: string): ReviewHistoryDetail {
  return { recordId: `record-${documentId}`, matterId: "matter-a", documentId, documentName: `材料${documentId}`, documentVersion: 2,
    reviewedAt: new Date("2026-11-16T10:00:00Z"), items: [], reportReady: true, reportDocumentId: null,
    coverage: { totalChars: 30, totalSegments: 1, segments: [{ index: 1, chars: 30, status: "SUCCEEDED", errorCode: null }], stopReason: null } };
}
function entry(documentId: string): ReviewHistoryEntry {
  return { id: `record-${documentId}`, reviewedAt: new Date("2026-11-16T10:00:00Z"), reviewedBy: { id: "actor", name: `作者${documentId}` },
    itemCount: 0, severityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 }, coverage: result(documentId).coverage, reportReady: true, reportDocumentId: null };
}
const props = { open: true, documentId: "A", matterId: "matter-a", canStartReview: true, canSaveReport: true, onOpenChange: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockResolvedValue([]);
  mocks.review.mockImplementation(async ({ documentId }) => result(documentId));
  mocks.detail.mockImplementation(async ({ documentId }) => result(documentId));
  mocks.save.mockResolvedValue({ ok: true, documentId: "report-a", documentName: "合成报告.md" });
});
afterEach(cleanup);

async function startReview() {
  fireEvent.click(screen.getByRole("button", { name: "发起新审查" }));
  await waitFor(() => expect(mocks.review).toHaveBeenCalled());
}

describe("审查弹窗的对象与请求生命周期", () => {
  it("A 新审查迟到不会覆盖 B 的结果", async () => {
    const pendingA = deferred<ReviewHistoryDetail>();
    mocks.review.mockImplementation(({ documentId }) => documentId === "A" ? pendingA.promise : Promise.resolve(result(documentId)));
    const view = render(<DocumentReviewDialog {...props} />);
    await startReview();
    view.rerender(<DocumentReviewDialog {...props} documentId="B" />);
    await startReview();
    expect(await screen.findByText(/材料B · 版本 2/)).toBeVisible();
    await act(async () => { pendingA.resolve(result("A")); });
    expect(screen.queryByText(/材料A · 版本/)).not.toBeInTheDocument();
    expect(screen.getByText(/材料B · 版本 2/)).toBeVisible();
  });

  it("关闭再打开同一材料也不会接收旧审查响应", async () => {
    const first = deferred<ReviewHistoryDetail>();
    mocks.review.mockReturnValue(first.promise);
    const view = render(<DocumentReviewDialog {...props} />);
    await startReview();
    view.rerender(<DocumentReviewDialog {...props} open={false} />);
    view.rerender(<DocumentReviewDialog {...props} />);
    await act(async () => { first.resolve(result("A")); });
    expect(screen.queryByText(/材料A · 版本/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发起新审查" })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("A 历史详情迟到不进入 B 的视图", async () => {
    const pendingA = deferred<ReviewHistoryDetail>();
    mocks.history.mockImplementation(async ({ documentId }) => [entry(documentId)]);
    mocks.detail.mockImplementation(({ documentId }) => documentId === "A" ? pendingA.promise : Promise.resolve(result(documentId)));
    const view = render(<DocumentReviewDialog {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /作者A/ }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith({ recordId: "record-A", matterId: "matter-a", documentId: "A" }));
    view.rerender(<DocumentReviewDialog {...props} documentId="B" />);
    await screen.findByRole("button", { name: /作者B/ });
    await act(async () => { pendingA.resolve(result("A")); });
    expect(screen.queryByText(/材料A · 版本/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /作者B/ })).toBeVisible();
  });

  it("A 保存迟到不会把 B 标为已保存或发出旧成功提示", async () => {
    const pendingSave = deferred<{ ok: true; documentId: string; documentName: string }>();
    mocks.save.mockReturnValue(pendingSave.promise);
    const view = render(<DocumentReviewDialog {...props} />);
    await startReview();
    fireEvent.click(await screen.findByRole("button", { name: "保存报告到本案" }));
    expect(mocks.save).toHaveBeenCalledWith({ recordId: "record-A", matterId: "matter-a", documentId: "A" });
    expect(Object.keys(mocks.save.mock.calls[0][0]).sort()).toEqual(["documentId", "matterId", "recordId"]);
    view.rerender(<DocumentReviewDialog {...props} documentId="B" />);
    await startReview();
    await screen.findByText(/材料B · 版本 2/);
    await act(async () => { pendingSave.resolve({ ok: true, documentId: "report-a", documentName: "A报告" }); });
    expect(screen.queryByRole("link", { name: "下载报告" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存报告到本案" })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("旧历史列表和错误均不能污染新材料", async () => {
    const pendingA = deferred<ReviewHistoryEntry[]>();
    mocks.history.mockImplementation(({ documentId }) => documentId === "A" ? pendingA.promise : Promise.resolve([entry("B")]));
    const view = render(<DocumentReviewDialog {...props} />);
    view.rerender(<DocumentReviewDialog {...props} documentId="B" />);
    await screen.findByRole("button", { name: /作者B/ });
    await act(async () => { pendingA.reject(new Error("A历史读取失败")); });
    expect(screen.queryByText(/A历史读取失败/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /作者B/ })).toBeVisible();
  });

  it("历史读取失败显式提供重试，不显示伪空态", async () => {
    mocks.history.mockRejectedValueOnce(new Error("合成读取失败")).mockResolvedValueOnce([]);
    render(<DocumentReviewDialog {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("历史读取失败");
    expect(screen.queryByText("暂无审查记录")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试读取历史" }));
    expect(await screen.findByText("暂无审查记录")).toBeVisible();
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it("未启用模型仍可读历史和保存有来源的记录", async () => {
    mocks.history.mockResolvedValue([entry("A")]);
    render(<DocumentReviewDialog {...props} canStartReview={false} />);
    expect(screen.getByRole("button", { name: "发起新审查" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: /作者A/ }));
    expect(await screen.findByRole("button", { name: "保存报告到本案" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存报告到本案" }));
    expect(await screen.findByRole("link", { name: "下载报告" })).toHaveAttribute("href", "/api/documents/report-a/download");
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("无实际覆盖的旧历史不提供生成报告", async () => {
    mocks.history.mockResolvedValue([entry("A")]);
    mocks.detail.mockResolvedValue({ ...result("A"), coverage: null, reportReady: false });
    render(<DocumentReviewDialog {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /作者A/ }));
    expect(await screen.findByText(/该历史未记录实际覆盖范围/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存报告到本案" })).not.toBeInTheDocument();
  });

  it("失败的片段显示真实范围且不宣称无问题", async () => {
    const failed = result("A");
    failed.coverage!.segments[0] = { index: 1, chars: 30, status: "FAILED", errorCode: "INVALID_RESPONSE" };
    failed.reportReady = false;
    mocks.review.mockResolvedValue(failed);
    render(<DocumentReviewDialog {...props} />);
    await startReview();
    expect(await screen.findByText("本次未取得有效审查回复，不能判断材料是否存在问题。")).toBeVisible();
    expect(screen.getByText("未请求")).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存报告到本案" })).not.toBeInTheDocument();
  });
});
