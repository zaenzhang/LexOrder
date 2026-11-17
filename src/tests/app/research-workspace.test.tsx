import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLawMetadata, emptyResearchContent, type ResearchRevisionView } from "@/server/research/contracts";

const mock = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), options: vi.fn(), history: vi.fn(), source: vi.fn(), preview: vi.fn(),
  save: vi.fn(), check: vi.fn(), draft: vi.fn(), ask: vi.fn(), prompt: vi.fn(), contextOptions: vi.fn(), contextChoice: vi.fn(), contextHistory: vi.fn() }));
vi.mock("@/server/matters/context-actions", () => ({ getMatterContextInputOptions: mock.contextOptions, getMatterContextInputChoice: mock.contextChoice, getMatterContextHistory: mock.contextHistory }));
vi.mock("@/server/research/actions", () => ({ getResearchList: mock.list, getResearch: mock.read, getResearchOptions: mock.options,
  getResearchHistory: mock.history, getResearchSource: mock.source, getResearchSourcePreview: mock.preview,
  saveResearchRevision: mock.save, checkResearchRevision: mock.check, formResearchDraft: mock.draft }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.ask, promptDialog: mock.prompt }));
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: vi.fn() }));
import { ResearchWorkspace } from "@/components/research/research-workspace";

const matterId = "cm00000000000000000000001", researchId = "cm00000000000000000000002", documentId = "cm00000000000000000000003";
const choose = vi.fn(), openDocument = vi.fn();
function view(id = researchId, question = "合成旧法研究"): ResearchRevisionView {
  return { id, seriesId: "series", version: 1, current: true, createdAt: "2026-11-16T08:00:00Z", authorName: "合成律师",
    checkedAt: null, checkedByName: null, checkNote: null, readable: true, content: { ...emptyResearchContent(), question },
    sources: [], issue: null, canRevise: true, canCheck: true, canDraft: true };
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.list.mockResolvedValue({ records: [], canWrite: true, nextCursor: null });
  mock.options.mockResolvedValue({ documents: [], issues: [] });
  mock.read.mockResolvedValue(view());
  mock.ask.mockResolvedValue(false);
  mock.history.mockResolvedValue({ records: [view()], nextVersion: null });
});
afterEach(cleanup);

describe("研究工作区的保存与来源连续性", () => {
  it("出稿选择属于本次文书，失败重试保留固定输入及原请求，不写回研究", async () => {
    const selection = { recordId: "cm00000000000000000000004", expectedCurrentRecordId: "cm00000000000000000000005", expectedConfirmedAt: null };
    mock.contextOptions.mockResolvedValue({ choices: [{ selection, kind: "INSTRUCTION", version: 1, content: "合成选入的旧指示", sourceDescription: "合成来源", historical: true }], nextCursor: null });
    mock.draft.mockRejectedValueOnce(new Error("合成出稿失败")).mockResolvedValueOnce({ documentId });
    render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "选择目标或指示" }));
    fireEvent.click(await screen.findByRole("button", { name: "采用所显示的这版" }));
    fireEvent.click(screen.getByRole("button", { name: "形成分析稿" }));
    await screen.findByText("合成出稿失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(openDocument).toHaveBeenCalledWith(documentId));
    expect(mock.draft.mock.calls[0][0]).toEqual(mock.draft.mock.calls[1][0]);
    expect(mock.draft.mock.calls[0][0]).toMatchObject({ contextInputs: [selection] });
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("出稿失败后另一次修改读取失败，通用重试不会错误地再次出稿", async () => {
    mock.draft.mockRejectedValue(new Error("合成出稿失败"));
    mock.options.mockRejectedValueOnce(new Error("合成修改入口读取失败"));
    render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "形成分析稿" }));
    await screen.findByText("合成出稿失败");
    fireEvent.click(screen.getByRole("button", { name: "修改研究" }));
    await screen.findByText("合成修改入口读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    expect(mock.draft).toHaveBeenCalledTimes(1);
  });

  it("保存失败保留草稿与同一次请求身份，重试成功定位具体研究", async () => {
    mock.save.mockRejectedValueOnce(new Error("合成响应中断")).mockResolvedValueOnce({ id: researchId, version: 1, replayed: true });
    render(<ResearchWorkspace matterId={matterId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建研究" }));
    fireEvent.change(await screen.findByLabelText("研究问题"), { target: { value: "合成旧法研究" } });
    fireEvent.click(screen.getByRole("button", { name: "保存研究" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成响应中断");
    expect(screen.getByLabelText("研究问题")).toHaveValue("合成旧法研究");
    fireEvent.click(await screen.findByRole("button", { name: "保存研究" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save.mock.calls[0][0].requestKey).toBe(mock.save.mock.calls[1][0].requestKey);
    await waitFor(() => expect(choose).toHaveBeenCalledWith(researchId));
    expect(await screen.findByText("已保存研究修订 1")).toBeInTheDocument();
  });

  it("受控返回默认继续编辑，不能误丢草稿", async () => {
    render(<ResearchWorkspace matterId={matterId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建研究" }));
    fireEvent.change(await screen.findByLabelText("研究问题"), { target: { value: "保留合成草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "返回研究列表" }));
    await waitFor(() => expect(mock.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(screen.getByLabelText("研究问题")).toHaveValue("保留合成草稿");
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("更换研究后迟到读取不能覆盖新对象，旧正文在加载中不继续显示", async () => {
    let resolveOld: (value: ResearchRevisionView) => void = () => undefined;
    mock.read.mockImplementationOnce(() => new Promise<ResearchRevisionView>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(view("cm00000000000000000000004", "新研究"));
    const rendered = render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    rendered.rerender(<ResearchWorkspace matterId={matterId} researchId="cm00000000000000000000004" onSelectResearch={choose} onOpenDocument={openDocument} />);
    expect(await screen.findByLabelText("研究问题")).toHaveValue("新研究");
    await act(async () => { resolveOld(view(researchId, "旧研究迟到内容")); });
    expect(screen.getByLabelText("研究问题")).toHaveValue("新研究");
  });

  it.each(["PDF", "Office"] as const)("草稿内查看%s来源并关闭，编辑内容和具体来源保持", async format => {
    const office = format === "Office";
    const name = office ? "合成反向费用.xlsx" : "合成反向材料.pdf";
    const locationLabel = office ? "费用表 · 第 3 行，第 2—4 列" : "第 2 页";
    const text = office ? "合成表格原文".repeat(500) : "合成反向原文";
    const previewUrl = `/api/documents/${documentId}/${office ? "preview" : "download?inline=1#page=2"}`;
    const original = view();
    original.content!.sources = [{ documentId, relation: "REBUTS", ...(office ? { parseRunId: "cm00000000000000000000010", anchorId: "old-table" } : { page: 2 }), lawMetadata: emptyLawMetadata() }];
    original.sources = [{ ...original.content!.sources[0], id: "cm00000000000000000000005", documentName: name, version: 2, locationLabel, changed: false }];
    mock.read.mockResolvedValue(original);
    mock.options.mockResolvedValue({ documents: [{ id: documentId, name, version: 2, pageCount: office ? null : 3, isPdf: !office, hasIdentity: true }], issues: [] });
    mock.preview.mockResolvedValue({ status: "AVAILABLE", documentName: name, documentVersion: 2, locationLabel,
      previewKind: office ? "CONVERTED" : "NATIVE", previewUrl, downloadUrl: `/api/documents/${documentId}/download`, text, legacy: false, historicalParse: office });
    render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "修改研究" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存新修订" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("研究问题"), { target: { value: "保留来源核对中的草稿" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "依据与阅读" }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "查看原文" }));
    const dialog = await screen.findByRole("dialog", { name });
    expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: office ? "查看整份转换预览" : "查看预览" })).toHaveAttribute("href", previewUrl);
    expect(within(dialog).getByRole("link", { name: "下载此版本" })).toHaveAttribute("href", `/api/documents/${documentId}/download`);
    expect(mock.preview).toHaveBeenCalledWith(matterId, original.content!.sources[0]);
    if (office) {
      expect(within(dialog).getByText("转换预览打开整份文件，未按引用位置跳转。")).toBeInTheDocument();
      expect(within(dialog).getByText(/费用表.*历史解析位置/)).toBeInTheDocument();
    }
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "问题与范围" }), { button: 0 });
    expect(screen.getByLabelText("研究问题")).toHaveValue("保留来源核对中的草稿");
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("历史读取失败明确可重试，不能显示为空历史", async () => {
    mock.history.mockRejectedValue(new Error("合成历史读取失败"));
    render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "修订记录" }));
    const dialog = await screen.findByRole("dialog", { name: "研究修订" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("合成历史读取失败");
    expect(within(dialog).getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("显式争点失效时不替用户换成另一争点", async () => {
    mock.options.mockResolvedValue({ documents: [], issues: [{ id: "cm00000000000000000000006", revision: 1, title: "另一个争点",
      selection: { kind: "CURRENT", issueId: "cm00000000000000000000006", revision: 1, confirmedAt: null } }] });
    render(<ResearchWorkspace matterId={matterId} issueId="cm00000000000000000000008" onSelectResearch={choose} onOpenDocument={openDocument} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("此争点已变化或无权读取");
    expect(screen.queryByLabelText("研究问题")).not.toBeInTheDocument();
  });

  it("正常争点入口使用当前内容与核对时点；冲突后更新选项保留输入且不自动改绑", async () => {
    const issueId = "cm00000000000000000000006";
    const selection = { kind: "CURRENT", issueId, revision: 2, confirmedAt: null };
    mock.options.mockResolvedValueOnce({ documents: [], issues: [{ id: issueId, revision: 2, title: "当前争点", selection }] })
      .mockResolvedValueOnce({ documents: [], issues: [{ id: issueId, revision: 2, title: "当前争点", selection: { ...selection, confirmedAt: "2026-11-16T10:00:00.000Z" } }] });
    mock.save.mockRejectedValue(new Error("争点内容或核对状态已变化，请更新争点选项并重新选择"));
    render(<ResearchWorkspace matterId={matterId} issueId={issueId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    expect(await screen.findByLabelText("研究问题")).toHaveValue("当前争点");
    fireEvent.change(screen.getByLabelText("研究问题"), { target: { value: "保留已输入的研究问题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存研究" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("核对状态已变化");
    expect(mock.save.mock.calls[0][0].issueSelection).toEqual(selection);
    fireEvent.click(screen.getByRole("button", { name: "更新争点选项" }));
    expect(await screen.findByRole("status")).toHaveTextContent("研究输入已保留");
    expect(screen.getByLabelText("研究问题")).toHaveValue("保留已输入的研究问题");
    expect(screen.getByRole("combobox", { name: "关联争点" })).toHaveTextContent("所选争点已变化，请重新选择");
  });

  it("另存研究修订默认明确保留旧争点输入，不自动选当前新版", async () => {
    const original = view(), issueId = "cm00000000000000000000006";
    original.content!.issueSelection = { kind: "SAVED", researchRevisionId: researchId };
    original.issue = { id: issueId, revisionId: null, revision: 1, title: "旧争点", content: "原始输入", confirmedAt: null,
      capturedAt: "2026-11-16T08:00:00.000Z", changed: true, confirmationChanged: false, sources: [] };
    mock.read.mockResolvedValue(original);
    mock.options.mockResolvedValue({ documents: [], issues: [{ id: issueId, revision: 2, title: "新争点",
      selection: { kind: "CURRENT", issueId, revision: 2, confirmedAt: null } }] });
    mock.save.mockRejectedValue(new Error("合成保存中断"));
    render(<ResearchWorkspace matterId={matterId} researchId={researchId} onSelectResearch={choose} onOpenDocument={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "修改研究" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存新修订" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "关联争点" })).toHaveTextContent("保留原研究的争点输入");
    fireEvent.click(screen.getByRole("button", { name: "保存新修订" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成保存中断");
    expect(mock.save.mock.calls[0][0].issueSelection).toEqual({ kind: "SAVED", researchRevisionId: researchId });
  });
});
