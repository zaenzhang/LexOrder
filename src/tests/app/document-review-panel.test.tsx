import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewPanel } from "@/components/document-reviews/document-review-panel";
import type { DocumentReviewView, ReviewIssueView, ReviewSourcePage } from "@/server/document-reviews/contracts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), sources: vi.fn(), create: vi.fn(), respond: vi.fn(), check: vi.fn(), confirm: vi.fn() }));
vi.mock("@/server/document-reviews/actions", () => ({ getDocumentReview: mocks.read, getDocumentReviewSourcePage: mocks.sources, createReviewIssue: mocks.create, respondReviewIssue: mocks.respond, checkReviewIssue: mocks.check }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));
const issue: ReviewIssueView = { id: "issue-one", version: 2, state: "WAITING_CHECK", title: "合计与金额明细不符", location: "第 2 页",
  basis: "请核对各项金额。", basisDocument: null, basisUnavailable: false, authorName: "合成审批人", createdAt: "2026-11-16T08:00:00.000Z", canResolve: true,
  events: [{ id: "response", version: 2, kind: "RESPONSE", disposition: "PARTIAL", note: "已更正本金，利息范围保留。",
    revisionDocument: null, revisionUnavailable: false, revisionLocation: null, resolved: null, actorName: "合成经办人", createdAt: "2026-11-16T09:00:00.000Z" }] };
function view(changes: Partial<DocumentReviewView> = {}): DocumentReviewView {
  return { document: { id: "document-one", name: "合成法律意见.docx", version: 1 }, canCreate: true, canCheck: true, canRespond: false,
    canBrowseSources: false, issues: [issue], sourceOptions: [], revisionOptions: [], sourceNextCursor: null, ...changes };
}
const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
beforeEach(() => {
  vi.resetAllMocks(); mocks.read.mockResolvedValue(view()); mocks.confirm.mockResolvedValue(true);
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const [name, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name);
} });
const oldSource = { id: "source-old", name: "合成旧依据", version: 2 };
const otherSource = { id: "source-other", name: "合成其他依据", version: 1 };
async function beginSourceDraft() {
  mocks.read.mockResolvedValue(view({ canRespond: true, canBrowseSources: true, sourceOptions: [oldSource], sourceNextCursor: "source-first" }));
  render(<DocumentReviewPanel documentId="document-one" />);
  fireEvent.click(await screen.findByRole("button", { name: "提出问题" }));
  fireEvent.change(await screen.findByLabelText("问题"), { target: { value: "合成未保存问题" } });
  fireEvent.change(screen.getByLabelText("依据与理由"), { target: { value: "合成未保存依据文字" } });
  const select = screen.getByRole("combobox", { name: "关联依据材料（可选）" });
  select.focus(); fireEvent.keyDown(select, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "合成旧依据 · 第 2 版" }));
  return select;
}

describe("具体文书复核面板", () => {
  it("独立审批人处理失败时保留输入和选中问题，可重试同一保存身份", async () => {
    const onDirtyChange = vi.fn(), onPendingChange = vi.fn(), onIssueChange = vi.fn();
    mocks.check.mockRejectedValueOnce(new Error("资格已变化，请重新核对"));
    render(<DocumentReviewPanel documentId="document-one" initialIssueId="issue-one" onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} onIssueChange={onIssueChange} />);
    fireEvent.change(await screen.findByLabelText("复核结论"), { target: { value: "已逐项核对金额与本条回应。" } });
    expect(screen.queryByLabelText("按材料名称查找")).not.toBeInTheDocument(); expect(mocks.sources).not.toHaveBeenCalled();
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

  it("页外确切旧版独立保留，续查失败遮蔽名称并保草稿和原保存身份", async () => {
    const select = await beginSourceDraft();
    mocks.create.mockRejectedValue(new Error("合成保存失败"));
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await screen.findByText("合成保存失败"); const savedInput = mocks.create.mock.calls[0][0];
    mocks.sources.mockResolvedValueOnce({ items: [otherSource], nextCursor: "source-second", selected: { id: oldSource.id, document: oldSource } });
    fireEvent.change(screen.getByLabelText("按材料名称查找"), { target: { value: "其他" } });
    fireEvent.click(screen.getByRole("button", { name: "查找材料" }));
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("合成旧依据 · 第 2 版");
    expect(mocks.sources).toHaveBeenLastCalledWith({ documentId: "document-one", query: "其他", selectedId: oldSource.id });
    mocks.sources.mockRejectedValueOnce(new Error("private database detail"));
    fireEvent.click(screen.getByRole("button", { name: "继续查找依据" }));
    await screen.findByText("依据材料读取失败，所选版本和问题内容已保留。");
    expect(select).toHaveTextContent("所选材料待重新核对"); expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("问题")).toHaveValue("合成未保存问题");
    expect(screen.getByLabelText("依据与理由")).toHaveValue("合成未保存依据文字");
    mocks.sources.mockResolvedValueOnce({ items: [otherSource], nextCursor: null, selected: { id: oldSource.id, document: oldSource } });
    fireEvent.click(screen.getByRole("button", { name: "重试依据查找" }));
    await waitFor(() => expect(select).toHaveTextContent("合成旧依据 · 第 2 版"));
    expect(mocks.sources.mock.calls[2][0]).toEqual(mocks.sources.mock.calls[1][0]);
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).toEqual(savedInput);
    expect(savedInput).toMatchObject({ basisDocumentId: oldSource.id, title: "合成未保存问题", basis: "合成未保存依据文字" });
  });

  it("续页明确所选版本不可读时遮蔽首批旧名称，保留其确切保存ID", async () => {
    const select = await beginSourceDraft();
    mocks.sources.mockResolvedValue({ items: [otherSource], nextCursor: null, selected: { id: oldSource.id, document: null } });
    fireEvent.click(screen.getByRole("button", { name: "继续查找依据" }));
    await waitFor(() => expect(select).toHaveTextContent("所选材料待重新核对"));
    expect(select).not.toHaveTextContent(oldSource.name);
    mocks.create.mockRejectedValue(new Error("所选来源当前不可读"));
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ basisDocumentId: oldSource.id })));
    expect(screen.getByLabelText("问题")).toHaveValue("合成未保存问题");
  });

  it("名称查找的迟到页不能覆盖新查找或恢复已遮蔽的所选旧名称", async () => {
    const select = await beginSourceDraft(); let finish!: (page: ReviewSourcePage) => void;
    mocks.sources.mockImplementationOnce(() => new Promise<ReviewSourcePage>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ items: [otherSource], nextCursor: null, selected: { id: oldSource.id, document: null } });
    fireEvent.change(screen.getByLabelText("按材料名称查找"), { target: { value: "旧查询" } });
    fireEvent.click(screen.getByRole("button", { name: "查找材料" }));
    fireEvent.change(screen.getByLabelText("按材料名称查找"), { target: { value: "新查询" } });
    fireEvent.click(screen.getByRole("button", { name: "查找材料" }));
    await waitFor(() => expect(select).toHaveTextContent("所选材料待重新核对"));
    await act(async () => finish({ items: [oldSource], nextCursor: "old-next", selected: { id: oldSource.id, document: oldSource } }));
    expect(select).toHaveTextContent("所选材料待重新核对"); expect(screen.queryByRole("button", { name: "继续查找依据" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("按材料名称查找")).toHaveValue("新查询");
    expect(screen.getByLabelText("问题")).toHaveValue("合成未保存问题");
  });
});
