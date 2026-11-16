import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewPanel } from "@/components/document-reviews/document-review-panel";
import type { DocumentReviewView, ReviewIssueView } from "@/server/document-reviews/contracts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), respond: vi.fn(), check: vi.fn(), confirm: vi.fn() }));
vi.mock("@/server/document-reviews/actions", () => ({ getDocumentReview: mocks.read, createReviewIssue: mocks.create, respondReviewIssue: mocks.respond, checkReviewIssue: mocks.check }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));
const issue: ReviewIssueView = { id: "issue-one", version: 2, state: "WAITING_CHECK", title: "合计与金额明细不符", location: "第 2 页",
  basis: "请核对各项金额。", basisDocument: null, basisUnavailable: false, authorName: "合成审批人", createdAt: "2026-11-16T08:00:00.000Z", canResolve: true,
  events: [{ id: "response", version: 2, kind: "RESPONSE", disposition: "PARTIAL", note: "已更正本金，利息范围保留。",
    revisionDocument: null, revisionUnavailable: false, revisionLocation: null, resolved: null, actorName: "合成经办人", createdAt: "2026-11-16T09:00:00.000Z" }] };
function view(changes: Partial<DocumentReviewView> = {}): DocumentReviewView {
  return { document: { id: "document-one", name: "合成法律意见.docx", version: 1 }, canCreate: true, canCheck: true, canRespond: false,
    issues: [issue], sourceOptions: [], revisionOptions: [], sourcesTruncated: false, ...changes };
}
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(view()); mocks.confirm.mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("具体文书复核面板", () => {
  it("独立审批人处理失败时保留输入和选中问题，可重试同一保存身份", async () => {
    const onDirtyChange = vi.fn(), onPendingChange = vi.fn(), onIssueChange = vi.fn();
    mocks.check.mockRejectedValueOnce(new Error("资格已变化，请重新核对"));
    render(<DocumentReviewPanel documentId="document-one" initialIssueId="issue-one" onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} onIssueChange={onIssueChange} />);
    fireEvent.change(await screen.findByLabelText("复核结论"), { target: { value: "已逐项核对金额与本条回应。" } });
    expect(screen.queryByRole("button", { name: "保存回应" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认已处理" }));
    expect(await screen.findByText("资格已变化，请重新核对")).toBeInTheDocument();
    expect(screen.getByLabelText("复核结论")).toHaveValue("已逐项核对金额与本条回应。");
    const firstInput = mocks.check.mock.calls[0][0];
    expect(firstInput).toMatchObject({ issueId: "issue-one", expectedVersion: 2, resolved: true });
    mocks.check.mockResolvedValue({ id: "issue-one", documentId: "document-one", version: 3 });
    mocks.read.mockResolvedValue(view({ issues: [{ ...issue, state: "RESOLVED", version: 3 }] }));
    fireEvent.click(screen.getByRole("button", { name: "确认已处理" }));
    await waitFor(() => expect(mocks.check).toHaveBeenLastCalledWith(firstInput));
    await waitFor(() => expect(onIssueChange).toHaveBeenCalledWith("issue-one"));
    await waitFor(() => expect(screen.queryByLabelText("复核结论")).not.toBeInTheDocument());
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onPendingChange).toHaveBeenCalledWith(true);
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("依据或修订无权读取时显式限制完成动作，仍可保留未解决", async () => {
    mocks.read.mockResolvedValue(view({ issues: [{ ...issue, basis: null, basisUnavailable: true, canResolve: false,
      events: [{ ...issue.events[0], note: null, revisionUnavailable: true }] }] }));
    render(<DocumentReviewPanel documentId="document-one" initialIssueId="issue-one" />);
    expect(await screen.findByText("依据材料当前不可读取，原文尚不能核实。")).toBeInTheDocument();
    expect(screen.queryByText("请核对各项金额。")).not.toBeInTheDocument();
    expect(screen.queryByText("已更正本金，利息范围保留。")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("复核结论"), { target: { value: "修订尚未送审，等待可读取后再核对。" } });
    expect(screen.getByRole("button", { name: "确认已处理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保留未解决" })).toBeEnabled();
  });

  it("切换问题先保护未保存回应，并将新问题的实际 ID 交回入口", async () => {
    const onIssueChange = vi.fn();
    mocks.read.mockResolvedValue(view({ canCheck: false, canRespond: true, issues: [issue, { ...issue, id: "issue-two", title: "法律依据时点待核对", state: "OPEN", version: 1, events: [] }] }));
    render(<DocumentReviewPanel documentId="document-one" initialIssueId="issue-one" onIssueChange={onIssueChange} />);
    fireEvent.change(await screen.findByLabelText("处理说明"), { target: { value: "尚未保存的金额说明" } });
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: /法律依据时点待核对/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel" })));
    expect(screen.getByLabelText("处理说明")).toHaveValue("尚未保存的金额说明");
    expect(onIssueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /法律依据时点待核对/ }));
    await waitFor(() => expect(screen.getByLabelText("处理说明")).toHaveValue(""));
    expect(onIssueChange).toHaveBeenLastCalledWith("issue-two");
    fireEvent.click(screen.getByRole("button", { name: "提出问题" }));
    fireEvent.change(await screen.findByLabelText("问题"), { target: { value: "遗漏相反依据" } });
    fireEvent.change(screen.getByLabelText("依据与理由"), { target: { value: "请核对另一方提出的时间限制。" } });
    mocks.create.mockResolvedValue({ id: "issue-new", documentId: "document-one", version: 1 });
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: "document-one", title: "遗漏相反依据", basisDocumentId: null })));
    await waitFor(() => expect(onIssueChange).toHaveBeenLastCalledWith("issue-new"));
  });
});
