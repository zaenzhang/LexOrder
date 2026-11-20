import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewPanel } from "@/components/document-reviews/document-review-panel";
import type { DocumentReviewView, PreviousReviewIssueView, ReviewIssueView, ReviewSourcePage } from "@/server/document-reviews/contracts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), sources: vi.fn(), create: vi.fn(), respond: vi.fn(), check: vi.fn(), confirm: vi.fn(),
  positions: vi.fn(), preview: vi.fn(), savedPosition: vi.fn(), previous: vi.fn() }));
vi.mock("@/server/document-reviews/actions", () => ({ getDocumentReview: mocks.read, getDocumentReviewSourcePage: mocks.sources,
  createReviewIssue: mocks.create, respondReviewIssue: mocks.respond, checkReviewIssue: mocks.check,
  getDocumentReviewPositionOptions: mocks.positions, previewDocumentReviewPosition: mocks.preview,
  getSavedDocumentReviewPosition: mocks.savedPosition, getPreviousDocumentReviewIssue: mocks.previous }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));
const issue: ReviewIssueView = { id: "issue-one", version: 2, state: "WAITING_CHECK", title: "合计与金额明细不符", location: "第 2 页",
  position: null, basisPosition: null, basis: "请核对各项金额。", basisDocument: null, basisUnavailable: false, authorName: "合成审批人", createdAt: "2026-11-16T08:00:00.000Z", canResolve: true,
  events: [{ id: "response", version: 2, kind: "RESPONSE", disposition: "PARTIAL", note: "已更正本金，利息范围保留。",
    revisionDocument: null, revisionUnavailable: false, revisionLocation: null, revisionPosition: null, resolved: null, actorName: "合成经办人", createdAt: "2026-11-16T09:00:00.000Z" }] };
function view(changes: Partial<DocumentReviewView> = {}): DocumentReviewView {
  return { document: { id: "document-one", name: "合成法律意见.docx", version: 1, pageCount: null, isPdf: false, hasIdentity: false },
    matterId: "matter-one", canCreate: true, canCheck: true, canRespond: false,
    canBrowseSources: false, issues: [issue], sourceOptions: [], revisionOptions: [], sourceNextCursor: null, previousIssues: [], ...changes };
}
const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
beforeEach(() => {
  vi.resetAllMocks(); mocks.read.mockResolvedValue(view()); mocks.confirm.mockResolvedValue(true);
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const [name, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name);
} });
const oldSource = { id: "source-old", name: "合成旧依据", version: 2, pageCount: null, isPdf: false, hasIdentity: false };
const otherSource = { id: "source-other", name: "合成其他依据", version: 1, pageCount: null, isPdf: false, hasIdentity: false };
async function beginSourceDraft() {
  mocks.read.mockResolvedValue(view({ canRespond: true, canBrowseSources: true, sourceOptions: [oldSource], sourceNextCursor: "source-first" }));
  render(<DocumentReviewPanel documentId="document-one" />);
  fireEvent.click(await screen.findByRole("button", { name: "提出问题" }));
  fireEvent.change(await screen.findByLabelText("问题"), { target: { value: "合成未保存问题" } });
  fireEvent.change(screen.getByLabelText("依据与理由"), { target: { value: "合成未保存依据文字" } });
  const select = screen.getByRole("combobox", { name: "关联依据材料（可选）" });
  fireEvent.click(select);
  fireEvent.click(await screen.findByRole("option", { name: text => text.includes("合成旧依据 · 第 2 版") }));
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
    await waitFor(() => expect(screen.getByRole("button", { name: "确认已处理" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "确认已处理" }));
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.check).toHaveBeenLastCalledWith(firstInput));
    await waitFor(() => expect(onIssueChange).toHaveBeenCalledWith("issue-one"));
    await waitFor(() => expect(screen.queryByLabelText("复核结论")).not.toBeInTheDocument());
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onPendingChange).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
    });
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
    await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "false"));
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

  it("后页依据使用实际页数固定位置，预览失败返回保草稿和请求身份，换依据只清对应位置", async () => {
    const subject = { ...view().document, isPdf: true, pageCount: 4, hasIdentity: true };
    const later = { ...oldSource, isPdf: true, pageCount: 7, hasIdentity: true };
    const replacement = { ...otherSource, isPdf: true, pageCount: 8, hasIdentity: true };
    mocks.read.mockResolvedValue(view({ document: subject, canRespond: true, canBrowseSources: true, sourceNextCursor: "later-page" }));
    mocks.sources.mockResolvedValue({ items: [later, replacement], nextCursor: null, selected: null });
    mocks.create.mockRejectedValue(new Error("合成保存暂不可用"));
    mocks.preview.mockRejectedValue(new Error("合成位置暂不可用"));
    render(<DocumentReviewPanel documentId="document-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "提出问题" }));
    fireEvent.change(await screen.findByLabelText("问题"), { target: { value: "保留当前问题" } });
    fireEvent.change(screen.getByLabelText("依据与理由"), { target: { value: "保留人工依据" } });
    fireEvent.change(screen.getByLabelText("页码（可选，共 4 页）"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "继续查找依据" }));
    const select = screen.getByRole("combobox", { name: "关联依据材料（可选）" });
    await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: text => text.includes("合成旧依据 · 第 2 版") }));
    fireEvent.change(await screen.findByLabelText("页码（可选，共 7 页）"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await screen.findByText("合成保存暂不可用");
    const original = mocks.create.mock.calls[0][0];
    expect(original).toMatchObject({ position: { page: 2 }, basisDocumentId: later.id, basisPosition: { page: 6 } });
    const preview = screen.getAllByRole("button", { name: "查看所选位置" })[1];
    await waitFor(() => expect(preview).toBeEnabled());
    fireEvent.click(preview);
    const positionDialog = await screen.findByRole("dialog", { name: "复核原文位置" });
    expect(await within(positionDialog).findByRole("alert")).toHaveTextContent("合成位置暂不可用");
    expect(mocks.preview).toHaveBeenCalledWith({ documentId: "document-one", slot: "BASIS", sourceDocumentId: later.id, position: { page: 6 } });
    fireEvent.click(screen.getByRole("button", { name: "返回复核内容" }));
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).toEqual(original);
    await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: text => text.includes("合成其他依据 · 第 1 版") }));
    expect(await screen.findByLabelText("页码（可选，共 8 页）")).toHaveValue(null);
    expect(screen.getByLabelText("页码（可选，共 4 页）")).toHaveValue(2);
    expect(screen.getByLabelText("问题")).toHaveValue("保留当前问题");
    fireEvent.click(screen.getByRole("button", { name: "保存问题" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.create.mock.calls[2][0]).toMatchObject({ position: { page: 2 }, basisDocumentId: replacement.id, basisPosition: null });
  });

  it("实际修订固定页允许不重复文字，换确切修订只清修订位置并保处理说明", async () => {
    const revision = { id: "revision-two", name: "合成第二版.pdf", version: 2, isPdf: true, pageCount: 6, hasIdentity: true };
    const next = { ...revision, id: "revision-three", name: "合成第三版.pdf", version: 3, pageCount: 9 };
    mocks.read.mockResolvedValue(view({ canRespond: true, canCheck: false, revisionOptions: [revision, next] }));
    mocks.respond.mockRejectedValue(new Error("合成回应暂不可用"));
    render(<DocumentReviewPanel documentId="document-one" initialIssueId={issue.id} />);
    fireEvent.change(await screen.findByLabelText("处理说明"), { target: { value: "保留本次处理理由" } });
    const select = screen.getByRole("combobox", { name: "实际修订版本（可选）" });
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: text => text.includes("合成第二版.pdf · 第 2 版") }));
    expect(screen.getByRole("button", { name: "保存回应" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("页码（可选，共 6 页）"), { target: { value: "5" } });
    expect(screen.getByLabelText("修订位置")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "保存回应" }));
    await screen.findByText("合成回应暂不可用");
    expect(mocks.respond).toHaveBeenCalledWith(expect.objectContaining({ revisionDocumentId: revision.id, revisionLocation: null, revisionPosition: { page: 5 } }));
    await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: text => text.includes("合成第三版.pdf · 第 3 版") }));
    expect(screen.getByLabelText("页码（可选，共 9 页）")).toHaveValue(null);
    expect(screen.getByLabelText("处理说明")).toHaveValue("保留本次处理理由");
    expect(screen.getByRole("button", { name: "保存回应" })).toBeDisabled();
  });

  it("查看关闭前版只读意见保当前选择、过滤、草稿和保存身份，并回到触发入口", async () => {
    const previousDocument = { ...view().document, id: "previous-document", name: "合成前版原稿.pdf" };
    const previousIssue = { ...issue, id: "previous-issue", title: "合成前版问题", events: [], canResolve: false };
    mocks.read.mockResolvedValue(view({ previousIssues: [{ id: previousIssue.id, title: previousIssue.title, state: "OPEN", document: previousDocument, linkedToCurrent: true }] }));
    mocks.previous.mockResolvedValue({ document: previousDocument, issue: previousIssue });
    mocks.check.mockRejectedValue(new Error("合成核对暂不可用"));
    const onIssueChange = vi.fn();
    render(<DocumentReviewPanel documentId="document-one" initialIssueId={issue.id} onIssueChange={onIssueChange} />);
    fireEvent.change(await screen.findByLabelText("复核结论"), { target: { value: "本版未保存结论" } });
    fireEvent.click(screen.getByRole("radio", { name: "待复核" }));
    fireEvent.click(screen.getByRole("button", { name: "保留未解决" }));
    await screen.findByText("合成核对暂不可用"); const original = mocks.check.mock.calls[0][0];
    const heading = screen.getByText("前版未决意见（1）");
    expect(heading).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(heading);
    const trigger = screen.getByRole("button", { name: /合成前版原稿.*合成前版问题/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "前版复核意见" });
    expect(await within(dialog).findByText("合成前版问题")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(mocks.previous).toHaveBeenCalledWith({ documentId: "document-one", issueId: previousIssue.id });
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(onIssueChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回本版复核" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText("复核结论")).toHaveValue("本版未保存结论");
    expect(screen.getByRole("radio", { name: "待复核" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保留未解决" }));
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
    expect(mocks.check.mock.calls[1][0]).toEqual(original);
  });

  it("前版读取失败可重试，关闭重开后的迟到回复不覆盖新结果或清当前草稿", async () => {
    const previousDocument = { ...view().document, id: "previous-document", name: "合成前版.pdf" };
    const previousIssue = { ...issue, id: "previous-issue", title: "合成前版问题", events: [], canResolve: false };
    mocks.read.mockResolvedValue(view({ previousIssues: [{ id: previousIssue.id, title: previousIssue.title, state: "OPEN", document: previousDocument, linkedToCurrent: false }] }));
    let finish!: (value: PreviousReviewIssueView) => void;
    mocks.previous.mockImplementationOnce(() => new Promise<PreviousReviewIssueView>(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error("合成前版读取失败"))
      .mockResolvedValueOnce({ document: previousDocument, issue: { ...previousIssue, basis: "合成重试后的意见" } });
    render(<DocumentReviewPanel documentId="document-one" initialIssueId={issue.id} />);
    fireEvent.change(await screen.findByLabelText("复核结论"), { target: { value: "本版保留的结论" } });
    fireEvent.click(screen.getByText("前版未决意见（1）"));
    fireEvent.click(screen.getByRole("button", { name: /合成前版.pdf.*合成前版问题/ }));
    await waitFor(() => expect(mocks.previous).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "返回本版复核" }));
    fireEvent.click(screen.getByRole("button", { name: /合成前版.pdf.*合成前版问题/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成前版读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重新读取前版意见" }));
    await screen.findByText("合成重试后的意见");
    await act(async () => finish({ document: previousDocument, issue: { ...previousIssue, basis: "合成已关闭的迟到意见" } }));
    expect(screen.queryByText("合成已关闭的迟到意见")).not.toBeInTheDocument();
    expect(screen.getByText("合成重试后的意见")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回本版复核" }));
    expect(screen.getByLabelText("复核结论")).toHaveValue("本版保留的结论");
  });
});
