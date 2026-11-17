import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { GlobalSearchResult, SearchResultItem, SearchResultPage } from "@/server/search/actions";
import type { MaterialSourceResult } from "@/server/documents/material-processing";

const mock = vi.hoisted(() => ({ search: vi.fn(), next: vi.fn(), source: vi.fn(), push: vi.fn(), openChange: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/server/search/actions", () => ({ globalSearch: mock.search, continueGlobalSearch: mock.next }));
vi.mock("@/server/documents/processing-actions", () => ({ getMaterialSource: mock.source }));
import { SearchDialog } from "@/components/layout/search-dialog";

const first: SearchResultItem = { id: "document-old", type: "document", title: "合成命中甲.pdf",
  href: "/api/documents/document-old/download?inline=1#page=20", matterLink: "/matters/SYNTHETIC-SEARCH", code: "SYNTHETIC-SEARCH",
  snippet: "旧搜索缓存中的命中片段", documentVersion: 2, parseRunId: "run-old", anchorId: "anchor-20", pageNo: 20,
  sourceLocation: { kind: "PAGE", page: 20 } };
const second: SearchResultItem = { ...first, id: "document-other", title: "合成命中乙.pdf", parseRunId: "run-other", anchorId: "anchor-other" };
function results(documents: SearchResultItem[] = [first]): GlobalSearchResult {
  return { documents, matters: [], clients: [], intakes: [], deadlines: [], documentsFailedCount: 0,
    nextCursorByGroup: { documents: null, matters: null, clients: null, intakes: null, deadlines: null } };
}
function source(hit = first): MaterialSourceResult {
  return { status: "AVAILABLE", document: { id: hit.id, name: `核对后的${hit.title}`, version: hit.documentVersion!, sha256: "a".repeat(64), mimeType: "application/pdf" },
    run: { id: hit.parseRunId!, generation: 1, parserVersion: "synthetic", isCurrent: false },
    anchor: { anchorId: hit.anchorId!, parseGenerationId: hit.parseRunId!, unit: 20,
      source: { kind: "CASE_MATERIAL", documentId: hit.id, matterId: "matter-search", sha256: "a".repeat(64) },
      location: { kind: "PAGE", page: 20 }, text: `${hit.id} 的已授权固定原文` },
    coverage: { unitKind: "PAGE", totalUnits: 20, units: [{ unit: 20, status: "READY" }] }, locationLabel: "第 20 页",
    originalUrl: `/api/documents/${hit.id}/download?inline=1#page=20` };
}
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "open").mockReturnValue(null);
  mock.search.mockResolvedValue(results()); mock.source.mockResolvedValue(source());
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
async function search() {
  const view = render(<SearchDialog open onOpenChange={mock.openChange} />);
  fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "命中" } });
  await screen.findByRole("option", { name: /合成命中甲/ });
  return view;
}

describe("材料搜索命中的固定来源与返回", () => {
  it.each(["click", "Enter"] as const)("%s 都读取同一固定身份，旧解析合法保留且返回原搜索位置", async method => {
    await search();
    fireEvent.click(screen.getByRole("tab", { name: /^材料正文/ }));
    const hit = screen.getByRole("option", { name: /合成命中甲/ });
    const body = hit.parentElement!;
    body.scrollTop = 180;
    if (method === "click") fireEvent.click(hit);
    else fireEvent.keyDown(screen.getByLabelText("搜索关键词"), { key: "Enter" });
    const dialog = await screen.findByRole("dialog", { name: "核对后的合成命中甲.pdf" });
    expect(mock.source).toHaveBeenCalledWith({ documentId: first.id, runId: "run-old", anchorId: "anchor-20" });
    expect(within(dialog).getByText("document-old 的已授权固定原文")).toBeInTheDocument();
    expect(within(dialog).getByText("显示本次命中保留的解析版本。")).toBeInTheDocument();
    expect(within(dialog).queryByText(first.snippet!)).not.toBeInTheDocument();
    expect(within(dialog).getByTitle("命中位置原件")).toHaveAttribute("src", first.href);
    expect(within(dialog).getByRole("link", { name: "另页打开原件" })).toHaveAttribute("href", first.href);
    fireEvent.keyDown(dialog, { key: "Enter" }); fireEvent.keyDown(dialog, { key: "Tab" });
    expect(mock.source).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "返回搜索结果" }));
    await waitFor(() => expect(hit).toHaveFocus());
    expect(screen.getByLabelText("搜索关键词")).toHaveValue("命中");
    expect(screen.getByRole("tab", { name: /^材料正文/ })).toHaveAttribute("aria-selected", "true");
    expect(hit).toHaveAttribute("aria-selected", "true"); expect(body.scrollTop).toBe(180);
    expect(mock.openChange).not.toHaveBeenCalled(); expect(mock.push).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "business", "internal"] as const)("%s 不展示缓存原文或替换到最新来源，重试保留确切身份", async failure => {
    if (failure === "unavailable") mock.source.mockResolvedValueOnce({ status: "UNAVAILABLE" });
    else mock.source.mockRejectedValueOnce(failure === "business" ? new ActionError("合成来源资格已变化") : new Error("Prisma SELECT synthetic-private-path"));
    await search(); fireEvent.click(screen.getByRole("option", { name: /合成命中甲/ }));
    const dialog = await screen.findByRole("dialog", { name: "材料命中来源" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(failure === "unavailable" ? "此来源当前不可用" : failure === "business" ? "合成来源资格已变化" : "来源读取失败，请重试");
    expect(dialog).not.toHaveTextContent("Prisma"); expect(dialog).not.toHaveTextContent("旧搜索缓存");
    expect(within(dialog).queryByTitle("命中位置原件")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument(); expect(window.open).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新读取来源" }));
    await screen.findByText("document-old 的已授权固定原文");
    expect(mock.source).toHaveBeenCalledTimes(2);
    expect(mock.source.mock.calls[1][0]).toEqual(mock.source.mock.calls[0][0]);
  });

  it("关闭后打开另一命中，旧来源的迟到响应不能覆盖新对象", async () => {
    let resolveFirst!: (value: MaterialSourceResult) => void;
    mock.search.mockResolvedValue(results([first, second]));
    mock.source.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(source(second));
    await search(); fireEvent.click(screen.getByRole("option", { name: /合成命中甲/ }));
    const loading = await screen.findByRole("dialog", { name: "材料命中来源" });
    fireEvent.click(within(loading).getByRole("button", { name: "返回搜索结果" }));
    fireEvent.click(await screen.findByRole("option", { name: /合成命中乙/ }));
    const current = await screen.findByRole("dialog", { name: "核对后的合成命中乙.pdf" });
    await act(async () => { resolveFirst(source(first)); });
    expect(current).toHaveTextContent("document-other 的已授权固定原文");
    expect(current).not.toHaveTextContent("document-old 的已授权固定原文");
  });

  it("整个搜索关闭后丢弃在途来源，重开只保留搜索而不重开旧弹层", async () => {
    let finish!: (value: MaterialSourceResult) => void;
    mock.source.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await search(); fireEvent.click(screen.getByRole("option", { name: /合成命中甲/ }));
    await screen.findByRole("dialog", { name: "材料命中来源" });
    view.rerender(<SearchDialog open={false} onOpenChange={mock.openChange} />);
    await act(async () => { finish(source()); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<SearchDialog open onOpenChange={mock.openChange} />);
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeInTheDocument();
    expect(screen.queryByText("document-old 的已授权固定原文")).not.toBeInTheDocument();
    expect(mock.source).toHaveBeenCalledTimes(1);
  });

  it("无锚点的具体原件另页打开且保留查询，归属按钮独立导航", async () => {
    mock.search.mockResolvedValue(results([{ ...first, parseRunId: undefined, anchorId: undefined }]));
    await search();
    const hit = screen.getByRole("option", { name: /合成命中甲/ });
    fireEvent.click(hit); fireEvent.keyDown(screen.getByLabelText("搜索关键词"), { key: "Enter" });
    expect(window.open).toHaveBeenCalledTimes(2);
    expect(window.open).toHaveBeenCalledWith(first.href, "_blank", "noopener,noreferrer");
    expect(screen.getByLabelText("搜索关键词")).toHaveValue("命中");
    expect(mock.source).not.toHaveBeenCalled(); expect(mock.push).not.toHaveBeenCalled();
    const jump = within(hit).getByRole("button", { name: "跳转案件" });
    fireEvent.keyDown(jump, { key: "Enter" });
    expect(window.open).toHaveBeenCalledTimes(2);
    fireEvent.click(jump);
    expect(mock.push).toHaveBeenCalledWith(first.matterLink); expect(mock.openChange).toHaveBeenCalledWith(false);
  });

  it("空候选页仍可继续，输入框不吞Tab且新按钮能独立接受键盘操作", async () => {
    const initial = results([]); initial.nextCursorByGroup.documents = "after-scan-200";
    mock.search.mockResolvedValue(initial); mock.next.mockResolvedValue({ items: [first], nextCursor: null });
    render(<SearchDialog open onOpenChange={mock.openChange} />);
    const input = screen.getByLabelText("搜索关键词");
    fireEvent.change(input, { target: { value: "命中" } });
    expect(await screen.findByText("本批没有可展示结果。")).toBeInTheDocument();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false);
    const more = screen.getByRole("button", { name: "继续检索" });
    more.focus(); expect(more).toHaveFocus();
    fireEvent.keyDown(more, { key: "Enter" });
    expect(mock.source).not.toHaveBeenCalled(); expect(mock.push).not.toHaveBeenCalled();
    fireEvent.click(more);
    expect(await screen.findByRole("option", { name: /合成命中甲/ })).toBeInTheDocument();
    expect(mock.next).toHaveBeenCalledWith({ query: "命中", group: "documents", cursor: "after-scan-200" });
    expect(screen.getByRole("tab", { name: /^材料正文/ })).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveValue("命中");
  });

  it("继续失败隐藏旧片段及来源入口，重试同一游标只恢复当前重读页", async () => {
    const initial = results(); initial.nextCursorByGroup.documents = "after-first";
    mock.search.mockResolvedValue(initial); mock.next.mockRejectedValueOnce(new Error("synthetic internal detail"));
    await search(); fireEvent.click(screen.getByRole("tab", { name: /^材料正文/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续检索" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("先前结果已隐藏");
    expect(screen.queryByRole("option", { name: /合成命中甲/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/旧搜索缓存/)).not.toBeInTheDocument();
    expect(screen.queryByText(/synthetic internal/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜索关键词")).toHaveValue("命中");
    mock.next.mockResolvedValue({ items: [second], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "重试此批" }));
    const fresh = await screen.findByRole("option", { name: /合成命中乙/ });
    expect(mock.next.mock.calls[1][0]).toEqual(mock.next.mock.calls[0][0]);
    expect(screen.queryByRole("option", { name: /合成命中甲/ })).not.toBeInTheDocument();
    mock.source.mockResolvedValue(source(second)); fireEvent.click(fresh);
    await screen.findByRole("dialog", { name: "核对后的合成命中乙.pdf" });
    expect(mock.source).toHaveBeenCalledWith({ documentId: second.id, runId: second.parseRunId, anchorId: second.anchorId });
  });

  it.each([["success", "clients"], ["failure", "clients"], ["success", "all"], ["failure", "all"]] as const)("材料续查%s迟到时保留%s范围的当前客户身份和滚动", async (outcome, scope) => {
    let resolve!: (value: SearchResultPage) => void, reject!: (reason: Error) => void;
    const initial = results(); initial.nextCursorByGroup.documents = "after-first";
    initial.clients = [{ id: "client-one", type: "client", title: "合成命中客户甲", href: "/clients/client-one" },
      { id: "client-two", type: "client", title: "合成命中客户乙", href: "/clients/client-two" }];
    mock.search.mockResolvedValue(initial);
    mock.next.mockImplementationOnce(() => new Promise<SearchResultPage>((yes, no) => { resolve = yes; reject = no; }));
    await search(); fireEvent.click(screen.getByRole("tab", { name: /^材料正文/ }));
    const body = screen.getByRole("option", { name: /合成命中甲/ }).parentElement!; body.scrollTop = 180;
    fireEvent.click(screen.getByRole("button", { name: "继续检索" }));
    const activeTab = scope === "all" ? /^全部/ : /^客户/;
    fireEvent.click(screen.getByRole("tab", { name: activeTab }));
    const client = screen.getByRole("option", { name: /合成命中客户乙/ });
    fireEvent.mouseMove(client); body.scrollTop = 45;
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    await act(async () => { if (outcome === "success") resolve({ items: [second], nextCursor: null }); else reject(new Error("合成继续失败")); });
    expect(client).toHaveAttribute("aria-selected", "true"); expect(body.scrollTop).toBe(45);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: activeTab })).toHaveAttribute("aria-selected", "true");
    expect(mock.push).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("搜索关键词"), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /合成命中客户甲/ })).toHaveAttribute("aria-selected", "true");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("更换查询后旧续查响应不会写入新查询列表", async () => {
    let resolve!: (value: SearchResultPage) => void;
    const initial = results(); initial.nextCursorByGroup.documents = "after-first";
    mock.search.mockResolvedValueOnce(initial).mockResolvedValueOnce(results([{ ...second, title: "合成新词结果" }]));
    mock.next.mockImplementationOnce(() => new Promise<SearchResultPage>(done => { resolve = done; }));
    await search(); fireEvent.click(screen.getByRole("button", { name: "继续检索" }));
    fireEvent.change(screen.getByLabelText("搜索关键词"), { target: { value: "新词" } });
    await screen.findByRole("option", { name: /合成新词结果/ });
    await act(async () => resolve({ items: [first], nextCursor: "stale-next" }));
    expect(screen.queryByRole("option", { name: /合成命中甲/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /合成新词结果/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续检索" })).not.toBeInTheDocument();
  });
});
