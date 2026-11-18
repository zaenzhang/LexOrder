import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ComponentProps } from "react";
import type { ClientHistoryItem, ClientHistoryPage } from "@/lib/clients/history";

const mocks = vi.hoisted(() => ({ read: vi.fn(), scroll: vi.fn() }));
vi.mock("@/server/clients/history-actions", () => ({ getClientHistoryPage: mocks.read, getClientHistoryMatterPage: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/link", () => ({ default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: () => void }) =>
  <a {...props} onClick={event => { event.preventDefault(); onNavigate?.(); }} /> }));
import { ClientHistoryPanel } from "@/app/(app)/clients/[id]/_components/client-history-panel";
import { clientHistoryHref } from "@/lib/clients/navigation";

const clientId = "cmtestclient00000000000001", recordId = "cmtestrecord00000000000001";
const row: ClientHistoryItem = { key: `CONTEXT:${recordId}`, source: "CONTEXT", id: recordId, at: "2026-11-16T08:00:00Z",
  recordedAt: "2026-11-16T08:00:00Z", title: "合成旧版指示", meta: "第1版", content: "仅返回这版内容",
  href: `/matters/MATTER-1?view=archive&contextRecord=${recordId}`, linkLabel: "打开这版记录" };
const first: ClientHistoryPage = { items: [], nextCursor: "second-request-cursor", selectedMatter: null };
const second: ClientHistoryPage = { items: [row], nextCursor: "third-request-cursor", selectedMatter: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", `/clients/${clientId}?tab=history`);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mocks.scroll });
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("具体指示的客户历史返回位置", () => {
  it("第二页入链使用请求cursor并记录精确行，服务端返回同页时可定位", async () => {
    const filters = { from: "2026-11-01", to: "2026-11-17", source: "CONTEXT" as const, matterId: "cmtestmatter00000000000001" };
    const returnTo = "/clients/follow-ups?filter=overdue&page=3";
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters, returnTo }));
    mocks.read.mockResolvedValue(second);
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={first} initialFilters={filters} returnTo={returnTo} />);
    fireEvent.click(screen.getByRole("button", { name: "客户动态下一页" }));
    const link = await screen.findByRole("link", { name: "打开这版记录 →" });
    const target = new URL(link.getAttribute("href")!, "https://example.test");
    expect(target.searchParams.get("contextRecord")).toBe(recordId);
    const back = new URL(target.searchParams.get("contextReturnTo")!, "https://example.test");
    expect(back.searchParams.get("historyCursor")).toBe("second-request-cursor");
    expect(back.searchParams.get("rowId")).toBe(row.key);
    expect(back.searchParams.get("returnTo")).toBe(returnTo);
    expect(back.searchParams.get("historyFrom")).toBe(filters.from);
    expect(back.searchParams.get("historyTo")).toBe(filters.to);
    expect(back.searchParams.get("historySource")).toBe(filters.source);
    expect(back.searchParams.get("historyMatterId")).toBe(filters.matterId);
    fireEvent.click(link);
    expect(window.location.search).toBe(back.search);
    rendered.unmount();
    mocks.read.mockClear();
    render(<ClientHistoryPanel clientId={clientId} initial={second} initialFilters={filters} initialCursor="second-request-cursor" rowId={row.key} />);
    await waitFor(() => expect(screen.getByText(row.title).closest("article")).toHaveFocus());
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("换筛选后空cursor也重读，旧筛选迟到响应不能覆盖正文或事项名称", async () => {
    const old = deferred<ClientHistoryPage>();
    const oldMatter = { id: "cmtestmatter00000000000001", title: "旧条件事项", internalCode: null };
    const newMatter = { id: "cmtestmatter00000000000002", title: "新条件事项", internalCode: null };
    mocks.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...second, selectedMatter: newMatter });
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={first} />);
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters: { matterId: oldMatter.id } }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ clientId, matterId: oldMatter.id })));
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters: { matterId: newMatter.id, source: "CONTEXT" } }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await screen.findByText(row.title);
    expect(screen.getByRole("combobox", { name: `筛选动态事项：${newMatter.title}` })).toHaveTextContent(newMatter.title);
    expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({ clientId, matterId: newMatter.id, source: "CONTEXT" }));
    await act(async () => old.resolve({ ...second, items: [{ ...row, title: "旧筛选迟到正文" }], selectedMatter: oldMatter }));
    expect(screen.queryByText("旧筛选迟到正文")).not.toBeInTheDocument();
    expect(screen.queryByText(oldMatter.title)).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("historyCursor");
  });

  it("同一Server payload从A换到B再返回A，必须重新读取而不能复活旧正文和名称", async () => {
    const selectedMatter = { id: "cmtestmatter00000000000001", title: "已撤权的旧名称", internalCode: null };
    const filters = { matterId: selectedMatter.id };
    const current = deferred<ClientHistoryPage>();
    mocks.read.mockResolvedValueOnce({ ...first, nextCursor: null }).mockReturnValueOnce(current.promise);
    const payload = { ...second, selectedMatter };
    const view = <ClientHistoryPanel clientId={clientId} initial={payload} initialFilters={filters} />;
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters }));
    const rendered = render(view);
    expect(screen.getByText(row.title)).toBeInTheDocument();
    window.history.pushState(null, "", clientHistoryHref(clientId, { filters: { ...filters, source: "NOTE" } }));
    rendered.rerender(cloneElement(view));
    await screen.findByText("本页暂无动态。");
    window.history.pushState(null, "", clientHistoryHref(clientId, { filters }));
    rendered.rerender(cloneElement(view));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(row.title)).not.toBeInTheDocument();
    expect(screen.queryByText(selectedMatter.title)).not.toBeInTheDocument();
    await act(async () => current.resolve({ items: [], nextCursor: null, selectedMatter: null }));
    expect(screen.getByRole("combobox", { name: "筛选动态事项：所选事项（名称不可读）" })).toHaveTextContent("所选事项（名称不可读）");
  });

  it("浏览器恢复URL而Server props仍为首屏时按URL重新读取，迟到页不能替换新目标", async () => {
    const old = deferred<ClientHistoryPage>();
    mocks.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(second);
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={first} />);
    window.history.replaceState(null, "", clientHistoryHref(clientId, { cursor: "stale-request", rowId: row.key }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith({ clientId, cursor: "stale-request" }));
    window.history.replaceState(null, "", clientHistoryHref(clientId, { cursor: "second-request-cursor", rowId: row.key }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await screen.findByText(row.title);
    await act(async () => old.resolve({ items: [{ ...row, title: "不得显示的迟到页" }], nextCursor: null, selectedMatter: null }));
    expect(screen.queryByText("不得显示的迟到页")).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenLastCalledWith({ clientId, cursor: "second-request-cursor" });
    await waitFor(() => expect(screen.getByText(row.title).closest("article")).toHaveFocus());
  });

  it("URL恢复到无cursor的首屏也废弃在途旧页，不能在首屏位置显示旧页", async () => {
    const old = deferred<ClientHistoryPage>();
    mocks.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(first);
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={first} />);
    window.history.replaceState(null, "", clientHistoryHref(clientId, { cursor: "stale-request", rowId: row.key }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith({ clientId, cursor: "stale-request" }));
    window.history.replaceState(null, "", clientHistoryHref(clientId));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={first} />);
    await waitFor(() => expect(mocks.read).toHaveBeenLastCalledWith({ clientId }));
    await screen.findByText("本页没有可显示的动态，可继续查看。");
    await act(async () => old.resolve(second));
    expect(screen.queryByText(row.title)).not.toBeInTheDocument();
    expect(window.location.search).toBe("?tab=history");
  });

  it("坏密文的错误和重试保留原cursor；不可定位行不会换另一条", async () => {
    window.history.replaceState(null, "", clientHistoryHref(clientId, { cursor: "bad-token", rowId: row.key }));
    mocks.read.mockRejectedValueOnce(new Error("分页位置无效"));
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={null} initialCursor="bad-token" rowId={row.key} initialError="分页位置无效" />);
    expect(screen.getByRole("alert")).toHaveTextContent("分页位置无效");
    expect(screen.queryByText(row.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试客户动态" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith({ clientId, cursor: "bad-token" }));
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={{ items: [], nextCursor: null, selectedMatter: null }} initialCursor="bad-token" rowId={row.key} />);
    expect(screen.getByText(/原动态已不在当前可读页中/)).toBeInTheDocument();
  });

  it("无效URL位置立即遮蔽旧页；切到隐藏分区后不抢回焦点", async () => {
    window.history.replaceState(null, "", clientHistoryHref(clientId, { cursor: "second-request-cursor", rowId: row.key }));
    const rendered = render(<div hidden><ClientHistoryPanel clientId={clientId} initial={second} initialCursor="second-request-cursor" rowId={row.key} /></div>);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(mocks.scroll).not.toHaveBeenCalled();
    window.history.replaceState(null, "", `/clients/${clientId}?tab=history&historySource=NOTE&historySource=CONTEXT`);
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={second} initialCursor="second-request-cursor" rowId={row.key} />);
    expect(screen.getByRole("alert")).toHaveTextContent("客户动态位置无效");
    expect(screen.queryByText(row.title)).not.toBeInTheDocument();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
