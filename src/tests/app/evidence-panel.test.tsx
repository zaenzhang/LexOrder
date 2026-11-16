import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceItemView } from "@/server/evidence/contracts";
import { emptyEvidenceEventDate } from "@/lib/evidence/event-date";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), confirm: vi.fn(), history: vi.fn(), resolve: vi.fn(), add: vi.fn(), remove: vi.fn(), create: vi.fn(),
  positions: vi.fn(), refresh: vi.fn(), ask: vi.fn(),
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

import { EvidenceItemDialog, EvidencePoints } from "@/app/(app)/matters/[id]/_components/evidence-panel";
import { EvidenceTimeline } from "@/app/(app)/matters/[id]/_components/evidence-timeline";

const date = new Date("2026-11-16T08:00:00Z");
let item: EvidenceItemView;
beforeEach(() => {
  vi.resetAllMocks();
  item = {
    id: "ceviden000000000000000000001", matterId: "cmatter00000000000000000001", title: "合成要点", content: "原始合成记载", kind: "FACT",
    sourceDocumentId: null, sourceDocumentName: null, sourcePage: null, revision: 1, updatedAt: date,
    confirmedAt: date, confirmedByName: "合成确认人", createdById: "clawyer0000000000000000001", createdByName: "合成记录人", createdAt: date,
    restricted: false, canEdit: true,
    eventDate: emptyEvidenceEventDate(),
    sources: [{ id: "csource00000000000000000001", relation: "SUPPORTS", legacy: false, status: "AVAILABLE", documentId: "cdocume000000000000000000001", documentName: "合成合同.pdf", documentVersion: 1, locationLabel: "第 2 页", hasAnchor: false },
      { id: "csource00000000000000000002", relation: "REBUTS", legacy: false, status: "AVAILABLE", documentId: "cdocume000000000000000000002", documentName: "合成反向材料.pdf", documentVersion: 1, locationLabel: "第 1 页", hasAnchor: true }],
  };
  mocks.get.mockImplementation(async () => ({ item: structuredClone(item), documents: [] }));
  mocks.ask.mockResolvedValue(true);
  mocks.positions.mockResolvedValue({ items: [], nextOffset: null });
});

describe("事实日期组件增量", () => {
  it("只改发生日期可保存，历史日期保持原值，记录时间另行标注", async () => {
    item.eventDate = { precision: "EXACT", start: "2024-02-29", end: null, text: "原文：二月二十九日" };
    const original = structuredClone(item);
    mocks.update.mockImplementation(async input => {
      item = { ...item, eventDate: input.eventDate, revision: 2, confirmedAt: null, confirmedByName: null };
      return { ok: true, revision: 2 };
    });
    mocks.history.mockResolvedValue({ items: [{ ...original, editedByName: "合成编辑人" }], nextBeforeRevision: null });
    render(<EvidencePoints items={[original]} />);
    expect(screen.getByText(/记录时间/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看与编辑要点：合成要点" }));
    fireEvent.change(await screen.findByLabelText("发生日期"), { target: { value: "2024-03-01" } });
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存要点修改" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, eventDate: { ...original.eventDate, start: "2024-03-01" } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "查看历史修订" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看历史修订" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("2024-02-29")).toBeInTheDocument();
    expect(screen.getByLabelText("发生日期")).toHaveValue("2024-03-01");
  });

  it("新建未知时间只保存原始表述，不根据记录日或季节补造日期", async () => {
    mocks.create.mockResolvedValue({ ok: true, id: item.id });
    render(<EvidenceItemDialog open onOpenChange={vi.fn()} matterId={item.matterId} documents={[]} defaultDocumentId={null} />);
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "合成会面" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "当事人称曾会面" } });
    fireEvent.change(screen.getByLabelText("原始时间表述（可选）"), { target: { value: "某年夏天" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ eventDate: { precision: "UNKNOWN", start: null, end: null, text: "某年夏天" } })));
  });

  it("时间线按日期而非记录时间排列，未知单列且刷新后受限项不留在分组", async () => {
    const earlier: EvidenceItemView = { ...item, id: "earlier", title: "早期事实", createdAt: new Date("2026-11-16"), eventDate: { precision: "RANGE", start: "2020-01-01", end: "2020-12-31", text: "全年期间" } };
    const later: EvidenceItemView = { ...item, id: "later", title: "晚期主张", createdAt: new Date("2020-01-01"), kind: "CLAIM", eventDate: { precision: "EXACT", start: "2024-01-01", end: null, text: null } };
    const unknown = { ...item, title: "时间未明的要点" };
    const restricted = { ...earlier, id: "restricted", title: "不得展示的合成日期", restricted: true, eventDate: { ...earlier.eventDate!, text: "受限时间原文" } };
    const view = render(<EvidenceTimeline items={[later, restricted, unknown, earlier]} />);
    fireEvent.click(screen.getByRole("button", { name: "事实时间线" }));
    const dated = screen.getByRole("region", { name: "已记录日期" });
    expect(within(dated).getAllByRole("button", { name: /^查看与编辑要点：/ }).map(button => button.getAttribute("aria-label"))).toEqual(["查看与编辑要点：早期事实", "查看与编辑要点：晚期主张"]);
    expect(within(dated).getByText("2020-01-01 至 2020-12-31")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "时间未明" })).getByRole("button", { name: "查看与编辑要点：时间未明的要点" })).toBeInTheDocument();
    expect(screen.queryByText("受限时间原文")).not.toBeInTheDocument();
    view.rerender(<EvidenceTimeline items={[{ ...earlier, restricted: true, eventDate: null }, unknown]} />);
    expect(screen.queryByRole("region", { name: "已记录日期" })).not.toBeInTheDocument();
    expect(screen.queryByText("全年期间")).not.toBeInTheDocument();
  });
});
afterEach(cleanup);

describe("人工新建请求重试", () => {
  it("不确定响应保留全部草稿与同一请求，修改后也不暗中换请求创建", async () => {
    const onOpenChange = vi.fn();
    mocks.create.mockRejectedValueOnce(new Error("响应中断，请核对后重试"))
      .mockRejectedValueOnce(new Error("此请求已保存不同内容，请先核对已有要点"))
      .mockResolvedValueOnce({ ok: true, id: item.id });
    render(<EvidenceItemDialog open onOpenChange={onOpenChange} matterId={item.matterId}
      documents={[{ id: "cdocume000000000000000000001", name: "合成合同.pdf" }]} defaultDocumentId="cdocume000000000000000000001" />);
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "合成新建要点" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "响应丢失后仍应保留的合成草稿" } });
    fireEvent.change(screen.getByLabelText("原始时间表述（可选）"), { target: { value: "某年夏天" } });
    fireEvent.change(screen.getByLabelText("PDF 页码（可选）"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("响应中断");
    const original = mocks.create.mock.calls[0][0];
    expect(original.requestKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(screen.getByLabelText("标题")).toHaveValue(original.title);
    expect(screen.getByLabelText("内容")).toHaveValue(original.content);
    expect(screen.getByLabelText("原始时间表述（可选）")).toHaveValue("某年夏天");
    expect(screen.getByLabelText("PDF 页码（可选）")).toHaveValue(2);
    expect(screen.getByLabelText("来源材料")).toHaveTextContent("合成合同.pdf");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "用户修改后的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先核对已有要点");
    expect(mocks.create.mock.calls[1][0]).toEqual({ ...original, title: "用户修改后的草稿" });
    expect(screen.getByLabelText("标题")).toHaveValue("用户修改后的草稿");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: original.title } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.create.mock.calls[2][0]).toEqual(original);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("取消关闭后重新打开清空旧草稿，并建立新的创建请求", async () => {
    const onOpenChange = vi.fn();
    mocks.create.mockRejectedValue(new Error("响应中断"));
    const props = { onOpenChange, matterId: item.matterId, documents: [], defaultDocumentId: null };
    const view = render(<EvidenceItemDialog {...props} open />);
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "前一次合成草稿" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "前一次合成内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("alert");
    const previousKey = mocks.create.mock.calls[0][0].requestKey;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(<EvidenceItemDialog {...props} open={false} />);
    view.rerender(<EvidenceItemDialog {...props} open />);
    expect(screen.getByLabelText("标题")).toHaveValue("");
    expect(screen.getByLabelText("内容")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新一次合成草稿" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "新一次合成内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await screen.findByRole("alert");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].requestKey).not.toBe(previousKey);
  });

  it("切换事项重建创建请求，旧事项迟到成功不能关闭或刷新新表单", async () => {
    let resolvePrevious!: (value: { ok: true; id: string }) => void;
    mocks.create.mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }))
      .mockRejectedValueOnce(new Error("新事项响应中断"));
    const onOpenChange = vi.fn();
    const props = { onOpenChange, matterId: item.matterId, documents: [], defaultDocumentId: null };
    const view = render(<EvidenceItemDialog {...props} open />);
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "原事项草稿" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "原事项内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const previousKey = mocks.create.mock.calls[0][0].requestKey;
    const newMatterId = "cmatter00000000000000000002";
    view.rerender(<EvidenceItemDialog {...props} matterId={newMatterId} open />);
    expect(screen.getByLabelText("标题")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存要点" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新事项草稿" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "新事项内容" } });
    await act(async () => { resolvePrevious({ ok: true, id: item.id }); });
    expect(screen.getByLabelText("标题")).toHaveValue("新事项草稿");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存要点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("新事项响应中断");
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ matterId: newMatterId, title: "新事项草稿", content: "新事项内容" });
    expect(mocks.create.mock.calls[1][0].requestKey).not.toBe(previousKey);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("证据要点组件交互", () => {
  it("saves a new manual revision, explicitly confirms it, reopens it and follows a historical opposing source", async () => {
    const original = structuredClone(item);
    mocks.update.mockImplementation(async input => {
      item = { ...item, title: input.title, content: input.content, kind: input.kind, revision: 2, confirmedAt: null, confirmedByName: null };
      return { ok: true, revision: 2 };
    });
    mocks.confirm.mockImplementation(async () => { item = { ...item, confirmedAt: date, confirmedByName: "合成确认人" }; return { ok: true, revision: 2 }; });
    mocks.history.mockResolvedValue({ items: [{ ...original, editedByName: "合成编辑人" }], nextBeforeRevision: null });
    mocks.resolve.mockResolvedValue({ status: "AVAILABLE", documentName: "合成反向材料.pdf", documentVersion: 1,
      locationLabel: "第 1 页", originalUrl: "/api/documents/cdocume000000000000000000002/download?inline=1#page=1",
      previewable: true, text: "合成反向原文", legacy: false, historicalParse: true });
    render(<EvidencePoints items={[original]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看与编辑要点：合成要点" }));
    await screen.findByLabelText("标题");
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "更正后的合成要点" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "修订后的合成内容" } });
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存要点修改" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, title: "更正后的合成要点", content: "修订后的合成内容" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对本版记录" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "核对本版记录" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({ evidenceItemId: item.id, expectedRevision: 2, confirm: true }));
    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ title: "核对第 2 版记录？", description: expect.stringContaining("不等于认定事实"), initialFocus: "cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button", { name: "查看历史修订" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看历史修订" }));
    await screen.findByRole("heading", { name: "历史修订" });
    const opposing = screen.getAllByRole("button", { name: /反驳 · 合成反向材料/ });
    fireEvent.click(opposing[opposing.length - 1]);
    await screen.findByText("合成反向原文");
    expect(mocks.resolve).toHaveBeenCalledWith({ evidenceItemId: item.id, sourceId: original.sources[1].id, revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    fireEvent.click(screen.getByRole("button", { name: "返回要点列表" }));
    fireEvent.click(screen.getByRole("button", { name: "查看与编辑要点：合成要点" }));
    await waitFor(() => expect(screen.getByLabelText("标题")).toHaveValue("更正后的合成要点"));
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
  });

  it("keeps the draft on a revision conflict and disables confirmation until the draft is resolved", async () => {
    mocks.update.mockRejectedValue(new Error("此要点已有新修订，请重新打开后核对，当前输入尚未保存"));
    render(<EvidencePoints items={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看与编辑要点：合成要点" }));
    await screen.findByLabelText("内容");
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "不能被错误提示丢弃的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存要点修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已有新修订");
    expect(screen.getByLabelText("内容")).toHaveValue("不能被错误提示丢弃的草稿");
    expect(screen.getByRole("button", { name: "核对本版记录" })).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
