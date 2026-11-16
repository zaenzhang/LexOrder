import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDocumentOption, EvidenceItemView } from "@/server/evidence/contracts";
import { emptyEvidenceEventDate } from "@/lib/evidence/event-date";
import type { CaseMaterialEntry } from "@/lib/matters/dossier-location";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), confirm: vi.fn(), history: vi.fn(), resolve: vi.fn(), add: vi.fn(), remove: vi.fn(), create: vi.fn(),
  positions: vi.fn(), refresh: vi.fn(), ask: vi.fn(), material: vi.fn(), options: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/evidence/actions", () => ({
  getEvidenceItem: mocks.get, updateEvidenceItem: mocks.update, confirmEvidenceItem: mocks.confirm,
  listEvidenceRevisions: mocks.history, resolveEvidenceSource: mocks.resolve, addEvidenceSource: mocks.add,
  removeEvidenceSource: mocks.remove, createEvidenceItem: mocks.create,
}));
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: mocks.positions }));
vi.mock("@/server/evidence/workspace-actions", () => ({ getCaseMaterialDetail: mocks.material, getEvidenceCreateOptions: mocks.options }));
vi.mock("@/server/documents/actions", () => ({ approveDocument: vi.fn(), deleteDocument: vi.fn(), fileDocument: vi.fn(), rejectDocument: vi.fn(), submitDocumentForReview: vi.fn(), uploadNewVersion: vi.fn() }));
vi.mock("@/server/document-folders/actions", () => ({ moveDocumentToFolder: vi.fn() }));

import { EvidencePoints } from "@/app/(app)/matters/[id]/_components/evidence-panel";
import { EvidenceTimeline } from "@/app/(app)/matters/[id]/_components/evidence-timeline";
import { CaseMaterialWorkspace } from "@/app/(app)/matters/[id]/_components/case-material-workspace";

const date = new Date("2026-11-16T08:00:00Z");
const matterId = "cmatter00000000000000000001";
const documentId = "cdocume000000000000000000001";
let item: EvidenceItemView;
let documents: EvidenceDocumentOption[];
const sourceResult = {
  status: "AVAILABLE", documentName: "合成合同.pdf", documentVersion: 1, locationLabel: "第 2 页",
  originalUrl: `/api/documents/${documentId}/download?inline=1#page=2`, previewable: true,
  text: "合成来源原文", legacy: false, historicalParse: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  item = {
    id: "ceviden000000000000000000001", matterId, title: "合成要点", content: "原始合成记载", kind: "FACT",
    sourceDocumentId: null, sourceDocumentName: null, sourcePage: null, revision: 1, updatedAt: date,
    confirmedAt: date, confirmedByName: "合成核对人", createdById: "clawyer0000000000000000001", createdByName: "合成记录人", createdAt: date,
    restricted: false, canEdit: true, eventDate: emptyEvidenceEventDate(),
    sources: [{ id: "csource00000000000000000001", relation: "SUPPORTS", legacy: false, status: "AVAILABLE", documentId, documentName: "合成合同.pdf", documentVersion: 1, locationLabel: "第 2 页", hasAnchor: false },
      { id: "csource00000000000000000002", relation: "REBUTS", legacy: false, status: "AVAILABLE", documentId: "cdocume000000000000000000002", documentName: "合成反向材料.pdf", documentVersion: 1, locationLabel: "第 1 页", hasAnchor: true }],
  };
  documents = [{ id: documentId, name: "合成合同.pdf", version: 3, isPdf: true, pageCount: 8, hasIdentity: true }];
  mocks.get.mockImplementation(async () => ({ item: structuredClone(item), documents }));
  mocks.options.mockImplementation(async () => documents);
  mocks.material.mockImplementation(async () => ({
    document: { id: documentId, name: "合成合同.pdf", version: 3, mimeType: "application/pdf", pageCount: 8, size: 1200,
      category: "EVIDENCE", createdAt: date, updatedAt: date, status: "DRAFT", isLatest: true, familyId: "cfamily00000000000000000001", folderId: null, folderName: null, uploadedByName: "合成上传人", reviewReport: null,
      previewable: true, originalUrl: `/api/documents/${documentId}/download?inline=1`, downloadUrl: `/api/documents/${documentId}/download` },
    items: [structuredClone(item)], canCreateEvidence: true,
    versions: [{ id: documentId, name: "合成合同.pdf", version: 3, isLatest: true, status: "DRAFT" }], currentVersionUnavailable: false,
    folders: [], actions: { canUploadVersion: false, canMoveFolder: false, canWithdraw: false, submitMode: null, canDecide: false, canFile: false, restriction: null, submitBlockedReason: null, withdrawBlockedReason: null }, approval: { history: [] },
  }));
  mocks.ask.mockResolvedValue(false);
  mocks.positions.mockResolvedValue({ items: [], nextOffset: null });
  mocks.resolve.mockResolvedValue(sourceResult);
  mocks.history.mockResolvedValue({ items: [], nextBeforeRevision: null });
});
afterEach(cleanup);

function Workspace({ start, changed = () => undefined }: { start: CaseMaterialEntry; changed?: (entry: CaseMaterialEntry | null, mode?: "push" | "replace") => void }) {
  const [entry, setEntry] = useState<CaseMaterialEntry | null>(start);
  return <><button onClick={() => setEntry(start)}>重新打开</button><CaseMaterialWorkspace matterId={matterId} entry={entry}
    onEntryChange={(next, mode) => { changed(next, mode); setEntry(next); }} /></>;
}
function EvidenceList({ items, timeline = false }: { items: EvidenceItemView[]; timeline?: boolean }) {
  const [entry, setEntry] = useState<CaseMaterialEntry | null>(null);
  const callbacks = { onOpenItem: (evidenceItemId: string) => setEntry({ kind: "evidence", evidenceItemId }),
    onOpenSource: (source: { evidenceItemId: string; sourceId: string; revision?: number }) => setEntry({ kind: "source", ...source }) };
  return <>{timeline ? <EvidenceTimeline items={items} {...callbacks} /> : <EvidencePoints items={items} {...callbacks} />}
    <CaseMaterialWorkspace matterId={matterId} entry={entry} onEntryChange={setEntry} /></>;
}
async function fillNew() {
  fireEvent.change(await screen.findByLabelText("标题"), { target: { value: "合成新建要点" } });
  fireEvent.change(screen.getByLabelText("内容"), { target: { value: "不能丢失的合成草稿" } });
}
function onlyDialog() { expect(screen.getAllByRole("dialog")).toHaveLength(1); return screen.getByRole("dialog"); }

describe("材料、要点与来源的同一详情", () => {
  it("材料进入新建，保存后定位返回ID的详情，再经来源返回材料", async () => {
    const changed = vi.fn();
    mocks.create.mockImplementation(async input => {
      item = { ...item, title: input.title, content: input.content, confirmedAt: null };
      return { ok: true, id: item.id };
    });
    render(<Workspace start={{ kind: "material", documentId }} changed={changed} />);
    await screen.findByRole("region", { name: "材料相关要点" });
    onlyDialog();
    fireEvent.click(screen.getByRole("button", { name: "添加要点" }));
    await fillNew();
    expect(screen.getByLabelText("来源材料")).toHaveTextContent("第 3 版");
    fireEvent.change(screen.getByLabelText("PDF 页码（可选，共 8 页）"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("button", { name: "保存要点修改" });
    expect(mocks.get).toHaveBeenCalledWith(item.id);
    expect(changed).toHaveBeenCalledWith({ kind: "evidence", evidenceItemId: item.id }, "replace");
    expect(screen.getByLabelText("标题")).toHaveValue("合成新建要点");
    onlyDialog();
    fireEvent.click(screen.getByRole("button", { name: /支持 · 合成合同.pdf/ }));
    await screen.findByText("合成来源原文");
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ kind: "source", evidenceItemId: item.id }), "push");
    onlyDialog();
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    expect(screen.getByLabelText("内容")).toHaveValue("不能丢失的合成草稿");
    fireEvent.click(screen.getByRole("button", { name: "返回材料" }));
    await screen.findByRole("region", { name: "材料相关要点" });
    expect(mocks.material).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("列表与事实时间线只发对象回调，来源不会叠加弹窗（timeline=%s）", async timeline => {
    render(<EvidenceList items={[item]} timeline={timeline} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const source = screen.getByRole("button", { name: /支持 · 合成合同.pdf/ });
    source.focus(); fireEvent.click(source);
    await screen.findByText("合成来源原文");
    onlyDialog();
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ evidenceItemId: item.id, sourceId: item.sources[0].id, revision: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    onlyDialog();
    expect(screen.getByLabelText("标题")).toHaveValue(item.title);
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(source).toHaveFocus();
  });

  it("查看来源与返回保留未保存正文、日期，并返回来源触发按钮", async () => {
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    fireEvent.change(await screen.findByLabelText("内容"), { target: { value: "核查来源时继续保留的草稿" } });
    fireEvent.change(screen.getByLabelText("原始时间表述（可选）"), { target: { value: "某年夏天" } });
    const source = screen.getByRole("button", { name: /支持 · 合成合同.pdf/ });
    fireEvent.click(source);
    await screen.findByText("合成来源原文");
    expect(screen.queryByRole("textbox", { name: "内容" })).not.toBeInTheDocument();
    onlyDialog();
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    expect(screen.getByLabelText("内容")).toHaveValue("核查来源时继续保留的草稿");
    expect(screen.getByLabelText("原始时间表述（可选）")).toHaveValue("某年夏天");
    expect(source).toHaveFocus();
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("来源请求返回晚于返回按钮时，不重新打开来源或覆盖当前输入", async () => {
    let resolveSource!: (value: typeof sourceResult) => void;
    mocks.resolve.mockReturnValue(new Promise(resolve => { resolveSource = resolve; }));
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    fireEvent.change(await screen.findByLabelText("内容"), { target: { value: "保留编辑" } });
    fireEvent.click(screen.getByRole("button", { name: /支持 · 合成合同.pdf/ }));
    await screen.findByText("正在读取来源…");
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    await act(async () => resolveSource(sourceResult));
    expect(screen.getByLabelText("内容")).toHaveValue("保留编辑");
    expect(screen.queryByText("合成来源原文")).not.toBeInTheDocument();
  });

  // Current jsdom recurses between Radix Select/Dialog focus scopes. Verify this exact path in the browser.
  it.skip("浏览器验收：尚未添加的来源选择与页码在查看原来源后仍保留", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    fireEvent.click(await screen.findByRole("button", { name: "添加来源" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "材料版本" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "合成合同.pdf · 第 3 版" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "材料版本" })).toHaveFocus());
    fireEvent.change(screen.getByLabelText("页码（可选，共 8 页）"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /支持 · 合成合同.pdf/ }));
    await screen.findByText("合成来源原文");
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    expect(screen.getByLabelText("页码（可选，共 8 页）")).toHaveValue(5);
    expect(screen.getByRole("combobox", { name: "材料版本" })).toHaveTextContent("第 3 版");
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("浏览器在同一要点和来源之间返回时保留草稿，不重新读取详情", async () => {
    const changed = vi.fn();
    const evidence: CaseMaterialEntry = { kind: "evidence", evidenceItemId: item.id };
    const source: CaseMaterialEntry = { kind: "source", evidenceItemId: item.id, sourceId: item.sources[0].id, revision: 1 };
    const view = render(<CaseMaterialWorkspace matterId={matterId} entry={evidence} onEntryChange={changed} />);
    fireEvent.change(await screen.findByLabelText("内容"), { target: { value: "浏览器返回仍保留的草稿" } });
    view.rerender(<CaseMaterialWorkspace matterId={matterId} entry={source} onEntryChange={changed} />);
    await screen.findByText("合成来源原文");
    view.rerender(<CaseMaterialWorkspace matterId={matterId} entry={evidence} onEntryChange={changed} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "内容" })).toHaveValue("浏览器返回仍保留的草稿"));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("当前来源不可用时不显示旧原文，错误有返回与重新读取入口", async () => {
    mocks.resolve.mockResolvedValue({ status: "UNAVAILABLE" });
    render(<Workspace start={{ kind: "source", evidenceItemId: item.id, sourceId: item.sources[0].id, revision: 1 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("来源当前不可用");
    expect(screen.queryByTitle("来源原件")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    expect(screen.getByLabelText("标题")).toHaveValue(item.title);
  });

  it("只读要点保留来源查看，不提供写入和核对动作", async () => {
    item.canEdit = false;
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    expect(await screen.findByLabelText("标题")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存要点修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对本版记录" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /支持 · 合成合同.pdf/ }));
    await screen.findByText("合成来源原文");
  });
});

describe("新建草稿与原请求身份", () => {
  it("新建查看所选原件后完整返回草稿，保持同一创建请求", async () => {
    mocks.create.mockRejectedValue(new Error("响应中断"));
    render(<Workspace start={{ kind: "create", documentId }} />);
    await fillNew();
    fireEvent.change(screen.getByLabelText("PDF 页码（可选，共 8 页）"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("alert");
    const request = mocks.create.mock.calls[0][0];
    await waitFor(() => expect(screen.getByRole("button", { name: "查看来源原件" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看来源原件" }));
    await screen.findByTitle("来源原件");
    onlyDialog();
    expect(screen.queryByRole("textbox", { name: "内容" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回草稿" }));
    expect(screen.getByLabelText("内容")).toHaveValue("不能丢失的合成草稿");
    expect(screen.getByLabelText("PDF 页码（可选，共 8 页）")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).toEqual(request);
  });
  it("不确定响应保留全部草稿；修改不暗换请求；成功直接打开已有记录", async () => {
    mocks.create.mockRejectedValueOnce(new Error("响应中断"))
      .mockRejectedValueOnce(new Error("此请求已保存不同内容，请先核对已有要点"))
      .mockResolvedValueOnce({ ok: true, id: item.id });
    render(<Workspace start={{ kind: "create", documentId }} />);
    await fillNew();
    fireEvent.change(screen.getByLabelText("原始时间表述（可选）"), { target: { value: "某年夏天" } });
    fireEvent.change(screen.getByLabelText("PDF 页码（可选，共 8 页）"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("响应中断");
    const original = mocks.create.mock.calls[0][0];
    expect(original.requestKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(original.eventDate).toEqual({ precision: "UNKNOWN", start: null, end: null, text: "某年夏天" });
    expect(screen.getByLabelText("PDF 页码（可选，共 8 页）")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "用户修改后的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先核对已有要点");
    expect(mocks.create.mock.calls[1][0]).toEqual({ ...original, title: "用户修改后的草稿" });
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: original.title } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("button", { name: "保存要点修改" });
    expect(mocks.create.mock.calls[2][0]).toEqual(original);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["escape", "close", "outside"])("%s 离开脏草稿默认继续；明确放弃后再开建立新请求", async method => {
    mocks.create.mockRejectedValue(new Error("响应中断"));
    render(<Workspace start={{ kind: "create", documentId: null }} />);
    await fillNew();
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("alert");
    const originalKey = mocks.create.mock.calls[0][0].requestKey;
    await waitFor(() => expect(screen.getByRole("button", { name: "保存要点" })).toBeEnabled());
    if (method === "escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    else if (method === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    else {
      await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
      fireEvent.pointerDown(document.body);
    }
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(screen.getByLabelText("内容")).toHaveValue("不能丢失的合成草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0].requestKey).toBe(originalKey);
    await waitFor(() => expect(screen.getByRole("button", { name: "返回列表" })).toBeEnabled());
    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
    await fillNew();
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("alert");
    expect(mocks.create.mock.calls[2][0].requestKey).not.toBe(originalKey);
  });

  it("提交中阻止关闭；切换案件后旧请求的迟到成功不关闭新任务", async () => {
    let resolvePrevious!: (value: { ok: true; id: string }) => void;
    mocks.create.mockReturnValue(new Promise(resolve => { resolvePrevious = resolve; }));
    const changed = vi.fn();
    const entry: CaseMaterialEntry = { kind: "create", documentId: null };
    const view = render(<CaseMaterialWorkspace matterId={matterId} entry={entry} onEntryChange={changed} />);
    await fillNew(); fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(changed).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
    const newMatterId = "cmatter00000000000000000002";
    view.rerender(<CaseMaterialWorkspace matterId={newMatterId} entry={entry} onEntryChange={changed} />);
    expect(await screen.findByLabelText("标题")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新案件草稿" } });
    await act(async () => resolvePrevious({ ok: true, id: item.id }));
    expect(screen.getByLabelText("标题")).toHaveValue("新案件草稿");
    expect(changed).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([{ isPdf: false, pageCount: 8 }, { isPdf: true, pageCount: null }])("非PDF或页数未知不提供页码输入：%j", async flags => {
    documents = [{ ...documents[0], ...flags }];
    render(<Workspace start={{ kind: "create", documentId }} />);
    await screen.findByLabelText("标题");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByLabelText("来源材料")).toHaveTextContent("第 3 版");
  });

  it("创建已成功但详情读取失败时只重读返回ID，不重复创建", async () => {
    mocks.create.mockResolvedValue({ ok: true, id: item.id });
    mocks.get.mockRejectedValueOnce(new Error("暂时无法读取")).mockImplementation(async () => ({ item, documents }));
    render(<Workspace start={{ kind: "create", documentId: null }} />);
    await fillNew(); fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("要点已保存");
    expect(screen.queryByRole("button", { name: "保存要点" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await screen.findByRole("button", { name: "保存要点修改" });
    expect(mocks.get).toHaveBeenNthCalledWith(2, item.id);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("外部entry改变被取消时恢复原URL对象，保留草稿；明确放弃才切换", async () => {
    const changed = vi.fn();
    const initial: CaseMaterialEntry = { kind: "create", documentId: null };
    const next: CaseMaterialEntry = { kind: "material", documentId };
    const view = render(<CaseMaterialWorkspace matterId={matterId} entry={initial} onEntryChange={changed} />);
    await fillNew();
    view.rerender(<CaseMaterialWorkspace matterId={matterId} entry={next} onEntryChange={changed} />);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(initial, "replace"));
    expect(screen.getByLabelText("内容")).toHaveValue("不能丢失的合成草稿");
    expect(mocks.material).not.toHaveBeenCalled();
    view.rerender(<CaseMaterialWorkspace matterId={matterId} entry={initial} onEntryChange={changed} />);
    mocks.ask.mockResolvedValueOnce(true);
    view.rerender(<CaseMaterialWorkspace matterId={matterId} entry={next} onEntryChange={changed} />);
    await screen.findByRole("region", { name: "材料相关要点" });
    expect(mocks.material).toHaveBeenCalledTimes(1);
  });
});

describe("修订与事件日期继续沿用真实服务合同", () => {
  it("保存日期修订、核对本版、读取历史和反向来源时保留原修订号", async () => {
    item.eventDate = { precision: "EXACT", start: "2024-02-29", end: null, text: "原文日期" };
    const original = structuredClone(item);
    mocks.update.mockImplementation(async input => { item = { ...item, eventDate: input.eventDate, revision: 2, confirmedAt: null }; return { ok: true, revision: 2 }; });
    mocks.confirm.mockImplementation(async () => { item = { ...item, confirmedAt: date }; return { ok: true, revision: 2 }; });
    mocks.history.mockResolvedValue({ items: [{ ...original, editedByName: "合成编辑人" }], nextBeforeRevision: null });
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    fireEvent.change(await screen.findByLabelText("发生日期"), { target: { value: "2024-03-01" } });
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存要点修改" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对本版记录" })).toBeEnabled());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, eventDate: { ...original.eventDate, start: "2024-03-01" } }));
    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "核对本版记录" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({ evidenceItemId: item.id, expectedRevision: 2, confirm: true }));
    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("不等于认定事实"), initialFocus: "cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "查看历史修订" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看历史修订" }));
    await screen.findByText("2024-02-29");
    const opposing = screen.getAllByRole("button", { name: /反驳 · 合成反向材料/ });
    fireEvent.click(opposing[opposing.length - 1]);
    await screen.findByText("合成来源原文");
    expect(mocks.resolve).toHaveBeenLastCalledWith({ evidenceItemId: item.id, sourceId: item.sources[1].id, revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    expect(screen.getByLabelText("发生日期")).toHaveValue("2024-03-01");
  });

  it("冲突保留输入且核对不可点击", async () => {
    mocks.update.mockRejectedValue(new Error("此要点已有新修订，请重新打开后核对，当前输入尚未保存"));
    render(<Workspace start={{ kind: "evidence", evidenceItemId: item.id }} />);
    fireEvent.change(await screen.findByLabelText("内容"), { target: { value: "不被冲突清空的输入" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已有新修订");
    expect(screen.getByLabelText("内容")).toHaveValue("不被冲突清空的输入");
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
  });

  it("时间线按发生时间排列、未知单列、受限项不泄露事件日期", () => {
    const earlier = { ...item, id: "earlier", title: "早期事实", createdAt: new Date("2026-11-16"), eventDate: { precision: "RANGE" as const, start: "2020-01-01", end: "2020-12-31", text: "全年期间" } };
    const later = { ...item, id: "later", title: "晚期主张", createdAt: new Date("2020-01-01"), eventDate: { precision: "EXACT" as const, start: "2024-01-01", end: null, text: null } };
    const restricted = { ...earlier, id: "restricted", restricted: true, eventDate: { ...earlier.eventDate, text: "受限时间原文" } };
    const callbacks = { onOpenItem: vi.fn(), onOpenSource: vi.fn() };
    const view = render(<EvidenceTimeline items={[later, restricted, item, earlier]} {...callbacks} />);
    expect(within(screen.getByRole("region", { name: "已记录日期" })).getAllByRole("button", { name: /^查看与编辑要点：/ }).map(button => button.getAttribute("aria-label"))).toEqual(["查看与编辑要点：早期事实", "查看与编辑要点：晚期主张"]);
    expect(screen.queryByText("受限时间原文")).not.toBeInTheDocument();
    view.rerender(<EvidenceTimeline items={[{ ...earlier, restricted: true, eventDate: null }, item]} {...callbacks} />);
    expect(screen.queryByRole("region", { name: "已记录日期" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "时间未明" })).toBeInTheDocument();
  });
});
