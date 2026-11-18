import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement } from "react";
import type { ClientHistoryFilters, ClientHistoryPage } from "@/lib/clients/history";

const mocks = vi.hoisted(() => ({ history: vi.fn(), matters: vi.fn() }));
vi.mock("@/server/clients/history-actions", () => ({ getClientHistoryPage: mocks.history, getClientHistoryMatterPage: mocks.matters }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
import { ClientHistoryPanel } from "@/app/(app)/clients/[id]/_components/client-history-panel";
import { ClientDetailTabs } from "@/app/(app)/clients/[id]/_components/client-detail-tabs";
import { clientHistoryHref } from "@/lib/clients/navigation";

const clientId = "cmtestclient00000000000001", matter = { id: "cmtestmatter00000000000001", title: "页外所选事项", internalCode: "MATTER-1" };
const empty: ClientHistoryPage = { items: [], nextCursor: null, selectedMatter: null };
const returnTo = "/clients/follow-ups?filter=today&page=2";
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockResolvedValue(empty);
  mocks.matters.mockResolvedValue({ items: [], nextCursor: null });
  window.history.replaceState(null, "", clientHistoryHref(clientId, { returnTo }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("客户动态筛选（组件环境）", () => {
  it("日期应用及类型选择保返回路径、清原页和行；单项清除不丢其他条件", async () => {
    const filters: ClientHistoryFilters = { source: "CONTEXT", matterId: matter.id };
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters, cursor: "old-page", rowId: "CONTEXT:cmtestrecord00000000000001", returnTo }));
    const view = <ClientHistoryPanel clientId={clientId} initial={{ ...empty, selectedMatter: matter }} initialFilters={filters}
      initialCursor="old-page" rowId="CONTEXT:cmtestrecord00000000000001" />;
    const rendered = render(view);
    const dateTrigger = screen.getByRole("button", { name: "筛选动态日期：日期" });
    fireEvent.click(dateTrigger);
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-07-03" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-07-02" } });
    fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
    expect(screen.getByRole("alert")).toHaveTextContent("开始日期不能晚于结束日期");
    expect(new URLSearchParams(window.location.search).get("historyCursor")).toBe("old-page");
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "应用日期" }));
    await waitFor(() => expect(dateTrigger).toHaveFocus());
    let params = new URLSearchParams(window.location.search);
    expect(params.get("historyFrom")).toBe("2026-07-01"); expect(params.get("historyTo")).toBe("2026-07-02");
    expect(params.get("historySource")).toBe("CONTEXT"); expect(params.get("historyMatterId")).toBe(matter.id);
    expect(params.get("returnTo")).toBe(returnTo); expect(params.has("historyCursor")).toBe(false); expect(params.has("rowId")).toBe(false);
    rendered.rerender(cloneElement(view));
    expect(screen.getByRole("button", { name: "筛选动态日期：2026-07-01 至 2026-07-02" })).toBe(dateTrigger);
    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-07-01", to: "2026-07-02" })));
    fireEvent.focus(screen.getByRole("combobox", { name: "动态类型" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "动态类型" }), { key: "Enter", keyCode: 13 });
    fireEvent.click(await screen.findByRole("option", { name: /事项沟通/ }));
    rendered.rerender(cloneElement(view));
    expect(new URLSearchParams(window.location.search).get("historySource")).toBe("NOTE");
    fireEvent.click(screen.getByRole("button", { name: "筛选动态日期：2026-07-01 至 2026-07-02" }));
    fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
    params = new URLSearchParams(window.location.search);
    expect(params.has("historyFrom")).toBe(false); expect(params.has("historyTo")).toBe(false);
    expect(params.get("historySource")).toBe("NOTE"); expect(params.get("historyMatterId")).toBe(matter.id);
    rendered.rerender(cloneElement(view));
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(window.location.search).toBe(new URL(clientHistoryHref(clientId, { returnTo }), "https://example.test").search);
  });

  it("事项候选空扫描页可以继续，失败清旧候选并按原页重试后选择", async () => {
    mocks.matters.mockResolvedValueOnce({ items: [], nextCursor: "candidate-page-2" })
      .mockRejectedValueOnce(new Error("事项读取失败"))
      .mockResolvedValueOnce({ items: [matter], nextCursor: null });
    const view = <ClientHistoryPanel clientId={clientId} initial={empty} />;
    const rendered = render(view);
    fireEvent.click(screen.getByRole("combobox", { name: "筛选动态事项：全部事项" }));
    await screen.findByText("本页没有可选事项，可继续查看。");
    fireEvent.click(screen.getByRole("button", { name: "动态事项下一页" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("事项读取失败");
    expect(screen.queryByText("本页没有可选事项，可继续查看。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试动态事项" }));
    fireEvent.click(await screen.findByRole("option", { name: /页外所选事项/ }));
    expect(mocks.matters).toHaveBeenLastCalledWith({ clientId, cursor: "candidate-page-2" });
    expect(new URLSearchParams(window.location.search).get("historyMatterId")).toBe(matter.id);
    mocks.history.mockResolvedValueOnce({ ...empty, selectedMatter: matter });
    rendered.rerender(cloneElement(view));
    await screen.findByRole("combobox", { name: `筛选动态事项：${matter.title}` });
  });

  it("页外所选名称只取当前成功结果，失败或撤权后保ID但不显示旧名称", async () => {
    const filters = { matterId: matter.id };
    window.history.replaceState(null, "", clientHistoryHref(clientId, { filters }));
    const rendered = render(<ClientHistoryPanel clientId={clientId} initial={{ ...empty, selectedMatter: matter }} initialFilters={filters} />);
    expect(screen.getByRole("combobox", { name: `筛选动态事项：${matter.title}` })).toBeInTheDocument();
    expect(mocks.matters).not.toHaveBeenCalled();
    mocks.history.mockRejectedValueOnce(new Error("动态读取失败"));
    fireEvent.click(screen.getByRole("button", { name: "刷新客户动态" }));
    expect(screen.queryByText(matter.title)).not.toBeInTheDocument();
    await screen.findByRole("combobox", { name: "筛选动态事项：所选事项（读取失败）" });
    rendered.rerender(<ClientHistoryPanel clientId={clientId} initial={{ ...empty }} initialFilters={filters} />);
    expect(screen.getByRole("combobox", { name: "筛选动态事项：所选事项（名称不可读）" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("historyMatterId")).toBe(matter.id);
    fireEvent.click(screen.getByRole("button", { name: "清除事项" }));
    expect(new URLSearchParams(window.location.search).has("historyMatterId")).toBe(false);
  });

  it("日期 Escape 不应用未确认日期并回焦原筛选入口", async () => {
    render(<ClientHistoryPanel clientId={clientId} initial={empty} />);
    const trigger = screen.getByRole("button", { name: "筛选动态日期：日期" });
    fireEvent.click(trigger);
    const from = screen.getByLabelText("开始日期");
    fireEvent.change(from, { target: { value: "2026-07-01" } });
    act(() => from.focus());
    fireEvent.keyDown(from, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByLabelText("开始日期")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(new URLSearchParams(window.location.search).has("historyFrom")).toBe(false);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("开始日期")).toHaveValue(""));
  });

  it("事项键盘选择保真实 ID 并关闭回焦，分页按钮上的 Escape 也回原选择器", async () => {
    mocks.matters.mockResolvedValue({ items: [matter], nextCursor: "opaque-more-matters" });
    render(<ClientHistoryPanel clientId={clientId} initial={empty} />);
    const picker = screen.getByRole("combobox", { name: "筛选动态事项：全部事项" });
    act(() => picker.focus());
    fireEvent.keyDown(picker, { key: "Enter", keyCode: 13 });
    await screen.findByRole("option", { name: /页外所选事项/ });
    fireEvent.keyDown(picker, { key: "ArrowDown", keyCode: 40 });
    fireEvent.keyDown(picker, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("historyMatterId")).toBe(matter.id));
    expect(screen.queryByRole("option", { name: /页外所选事项/ })).not.toBeInTheDocument();
    expect(picker).toHaveFocus();
    fireEvent.click(picker);
    const next = await screen.findByRole("button", { name: "动态事项下一页" });
    await waitFor(() => expect(next).toBeEnabled());
    act(() => next.focus());
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "动态事项下一页" })).not.toBeInTheDocument());
    expect(picker).toHaveFocus();
  });

  it("历史换筛选只重挂自身结果，其他客户分区保留未保存输入", async () => {
    function Customer() {
      return <ClientDetailTabs initialTab="followups" sections={{
        followups: <label>合成沟通草稿<input aria-label="合成沟通草稿" /></label>, matters: <p>合成事项分区</p>, profile: <p>合成档案分区</p>,
        history: <ClientHistoryPanel clientId={clientId} initial={empty} />,
      }} />;
    }
    window.history.replaceState(null, "", `/clients/${clientId}?tab=followups`);
    const rendered = render(<Customer />);
    fireEvent.change(screen.getByRole("textbox", { name: "合成沟通草稿" }), { target: { value: "尚未保存的真实沟通" } });
    fireEvent.keyDown(screen.getByRole("tab", { name: "客户动态" }), { key: "Enter" });
    window.history.pushState(null, "", clientHistoryHref(clientId, { filters: { source: "NOTE" } }));
    rendered.rerender(<Customer />);
    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ source: "NOTE" })));
    fireEvent.keyDown(screen.getByRole("tab", { name: "沟通跟进" }), { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "合成沟通草稿" })).toHaveValue("尚未保存的真实沟通");
  });
});
