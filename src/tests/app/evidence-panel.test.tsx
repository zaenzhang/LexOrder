import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: "合成要点" }));
    fireEvent.change(await screen.findByLabelText("发生日期"), { target: { value: "2024-03-01" } });
    expect(screen.getByRole("button", { name: "确认此版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
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
    expect(within(dated).getAllByRole("button").filter(button => ["早期事实", "晚期主张"].includes(button.textContent ?? "")).map(button => button.textContent)).toEqual(["早期事实", "晚期主张"]);
    expect(within(dated).getByText("2020-01-01 至 2020-12-31")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "时间未明" })).getByRole("button", { name: "时间未明的要点" })).toBeInTheDocument();
    expect(screen.queryByText("受限时间原文")).not.toBeInTheDocument();
    view.rerender(<EvidenceTimeline items={[{ ...earlier, restricted: true, eventDate: null }, unknown]} />);
    expect(screen.queryByRole("region", { name: "已记录日期" })).not.toBeInTheDocument();
    expect(screen.queryByText("全年期间")).not.toBeInTheDocument();
  });
});
afterEach(cleanup);

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
    fireEvent.click(screen.getByRole("button", { name: "合成要点" }));
    await screen.findByLabelText("标题");
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "更正后的合成要点" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "修订后的合成内容" } });
    expect(screen.getByRole("button", { name: "确认此版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, title: "更正后的合成要点", content: "修订后的合成内容" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认此版本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "确认此版本" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({ evidenceItemId: item.id, expectedRevision: 2, confirm: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认此版本" })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button", { name: "查看历史修订" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看历史修订" }));
    await screen.findByRole("heading", { name: "历史修订" });
    const opposing = screen.getAllByRole("button", { name: /反驳 · 合成反向材料/ });
    fireEvent.click(opposing[opposing.length - 1]);
    await screen.findByText("合成反向原文");
    expect(mocks.resolve).toHaveBeenCalledWith({ evidenceItemId: item.id, sourceId: original.sources[1].id, revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "返回要点" }));
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "合成要点" }));
    await waitFor(() => expect(screen.getByLabelText("标题")).toHaveValue("更正后的合成要点"));
    expect(screen.getByRole("button", { name: "确认此版本" })).toBeDisabled();
  });

  it("keeps the draft on a revision conflict and disables confirmation until the draft is resolved", async () => {
    mocks.update.mockRejectedValue(new Error("此要点已有新修订，请重新打开后核对，当前输入尚未保存"));
    render(<EvidencePoints items={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "合成要点" }));
    await screen.findByLabelText("内容");
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "不能被错误提示丢弃的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已有新修订");
    expect(screen.getByLabelText("内容")).toHaveValue("不能被错误提示丢弃的草稿");
    expect(screen.getByRole("button", { name: "确认此版本" })).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
