import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalFollowUpQueue } from "@/components/clients/personal-follow-up-queue";
import { WorkQueueCard } from "@/components/dashboard/work-queue-card";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";
import type { PersonalFollowUp, PersonalFollowUpMode, PersonalFollowUpPage, PersonalFollowUpTarget } from "@/lib/clients/follow-ups";
import type { WorkQueue } from "@/server/dashboard/actions";

const mock = vi.hoisted(() => ({ list: vi.fn(), exact: vi.fn(), save: vi.fn(), reschedule: vi.fn(), history: vi.fn() }));
vi.mock("@/server/clients/relationship-actions", () => ({ getPersonalFollowUps: mock.list, getPersonalFollowUp: mock.exact, recordClientActivity: mock.save, rescheduleClientFollowUp: mock.reschedule, getPersonalFollowUpRescheduleHistory: mock.history }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const first: PersonalFollowUp = { id: "cmtestfollowup000000000001", title: "核对原件", client: { id: "cmtestclient00000000000001", name: "合成甲客户" }, dueAt: "2027-01-02T02:00:00.000Z", updatedAt: "2026-11-17T10:00:00.007Z", assigneeName: "合成律师", status: "OPEN", overdue: false, canClose: true };
const second: PersonalFollowUp = { ...first, id: "cmtestfollowup000000000002", title: "确认授权", client: { id: "cmtestclient00000000000002", name: "合成乙客户" } };
const page: PersonalFollowUpPage = { available: true, items: [first], total: 1, page: 1, pageSize: 20, filter: "all", observedAt: "2026-11-17T10:00:00.000Z" };
const target = (item: PersonalFollowUp): PersonalFollowUpTarget => ({ followUpId: item.id, clientId: item.client.id });
const view = (data = page, initialTarget: PersonalFollowUpTarget | null = null, initialMode: PersonalFollowUpMode = "result") => <><PersonalFollowUpQueue initialData={data} initialTarget={initialTarget} initialMode={initialMode} /><ConfirmHost /></>;
const query = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  mock.list.mockReset(); mock.exact.mockReset(); mock.save.mockReset(); mock.reschedule.mockReset(); mock.history.mockReset();
  mock.exact.mockResolvedValue(first);
  mock.history.mockResolvedValue({ items: [], nextCursor: null });
  window.history.replaceState(null, "", "/clients/follow-ups");
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("本人待跟进原位办理（组件环境，服务动作替身）", () => {
  it("只提交真实筛选和页码，客户档案返回位置不携带编辑目标", async () => {
    mock.list.mockResolvedValue({ ...page, filter: "today", total: 21, items: [second] });
    render(view({ ...page, filter: "overdue", total: 21, page: 2 }));
    const archive = new URL(screen.getByRole("link", { name: first.client.name }).getAttribute("href")!, "https://example.test");
    expect(archive.searchParams.get("returnTo")).toBe("/clients/follow-ups?filter=overdue&page=2");
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledWith({ filter: "today", page: 1 }));
    await screen.findByText(second.title);
    expect(query().get("filter")).toBe("today");
    expect(query().has("page")).toBe(false);
    mock.list.mockResolvedValue({ ...page, filter: "today", total: 21, page: 2, items: [first] });
    await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(mock.list).toHaveBeenLastCalledWith({ filter: "today", page: 2 }));
    await screen.findByText("第 2 / 2 页 · 北京时间");
    expect(query().get("page")).toBe("2");
  });

  it("首页深链精确读取页外目标，关闭后保留查询且不自动重开", async () => {
    mock.exact.mockResolvedValue(second);
    render(view({ ...page, filter: "today", page: 2, total: 21 }, target(second)));
    await waitFor(() => expect(mock.exact).toHaveBeenCalledWith(target(second)));
    const dialog = await screen.findByRole("dialog", { name: "录入跟进结果" });
    await waitFor(() => expect(within(dialog).getByText(`${second.client.name} · ${second.title}`)).toBeVisible());
    expect(within(dialog).getByText("2027-01-02 10:00（北京时间）")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.exact).toHaveBeenCalledOnce();
    expect(query().get("filter")).toBe("today");
    expect(query().get("page")).toBe("2");
    expect(query().has("followUp")).toBe(false);
    expect(query().has("client")).toBe(false);
    await waitFor(() => expect(screen.getByRole("heading", { name: "客户待跟进列表" })).toHaveFocus());
  });

  it("保存中不能关闭，失败保留同键草稿；成功回夹取后的页且迟到同目标 props 不重开", async () => {
    let rejectSave!: (cause: Error) => void;
    mock.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const oldPage = { ...page, total: 21, page: 2, filter: "overdue" as const };
    const nextPage = { ...page, items: [second], total: 20, filter: "overdue" as const };
    mock.list.mockResolvedValue(nextPage);
    const rendered = render(view(oldPage));
    fireEvent.click(screen.getByRole("button", { name: `录入结果：${first.title}` }));
    const content = await screen.findByLabelText("跟进结果 *");
    fireEvent.change(content, { target: { value: "合成结果：材料已核对" } });
    fireEvent.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { rejectSave(new Error("资格已变化，请核对后重试")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("资格已变化");
    expect(content).toHaveValue("合成结果：材料已核对");
    mock.save.mockResolvedValue({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存结果" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.save.mock.calls[1][0]).toEqual(mock.save.mock.calls[0][0]);
    expect(mock.save.mock.calls[0][0]).toMatchObject({ clientId: first.client.id, followUpId: first.id, closeStatus: "COMPLETED" });
    await waitFor(() => expect(mock.list).toHaveBeenLastCalledWith({ filter: "overdue", page: 2 }));
    await screen.findByText("第 1 / 1 页 · 北京时间");
    expect(query().get("filter")).toBe("overdue");
    expect(query().has("page")).toBe(false);
    expect(query().has("followUp")).toBe(false);
    rendered.rerender(view({ ...nextPage }, target(first)));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.exact).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("heading", { name: "客户待跟进列表" })).toHaveFocus());
  });

  it("当前读取被拒后遮蔽旧正文与计数，重试原查询成功才恢复", async () => {
    mock.list.mockRejectedValueOnce(new Error("当前无权读取"));
    render(view({ ...page, filter: "overdue", page: 2, total: 21 }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前无权读取");
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: first.client.name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /录入结果/ })).not.toBeInTheDocument();
    expect(screen.queryByText("共 21 项")).not.toBeInTheDocument();
    expect(screen.queryByText("当前筛选下没有待跟进。")).not.toBeInTheDocument();
    expect(screen.getByText("当前列表尚未核实")).toBeVisible();
    expect(query().get("page")).toBe("2");
    mock.list.mockResolvedValue({ ...page, filter: "overdue" });
    await waitFor(() => expect(screen.getByRole("button", { name: "重新读取列表" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重新读取列表" }));
    await waitFor(() => expect(mock.list).toHaveBeenLastCalledWith({ filter: "overdue", page: 2 }));
    await screen.findByText(first.title);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("共 1 项")).toBeVisible();
  });

  it("精确目标读取失败不借用旧标题或办理资格；重试终态仅供查看", async () => {
    mock.exact.mockRejectedValueOnce(new Error("跟进所属客户已变化"));
    render(view());
    fireEvent.click(screen.getByRole("button", { name: `录入结果：${first.title}` }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("跟进所属客户已变化");
    expect(within(dialog).queryByText(first.title)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("跟进结果 *")).not.toBeInTheDocument();
    mock.exact.mockResolvedValue({ ...first, status: "COMPLETED", canClose: false });
    fireEvent.click(within(dialog).getByRole("button", { name: "重新读取跟进" }));
    const readonly = await screen.findByRole("dialog", { name: "查看跟进" });
    expect(await within(readonly).findByText("此跟进已完成。")).toBeVisible();
    expect(within(readonly).queryByRole("button", { name: "保存结果" })).not.toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("关闭加载中的目标后打开另一条，迟到响应不能串入新目标", async () => {
    let resolveFirst!: (value: PersonalFollowUp) => void;
    mock.exact.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(second);
    render(view({ ...page, items: [first, second], total: 2 }));
    const originalTrigger = screen.getByRole("button", { name: `录入结果：${first.title}` });
    fireEvent.click(originalTrigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回列表" }));
    await waitFor(() => expect(originalTrigger).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: `录入结果：${second.title}` }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText(`${second.client.name} · ${second.title}`);
    await act(async () => { resolveFirst(first); });
    expect(within(dialog).getByText(`${second.client.name} · ${second.title}`)).toBeVisible();
    expect(within(dialog).queryByText(`${first.client.name} · ${first.title}`)).not.toBeInTheDocument();
    expect(query().get("followUp")).toBe(second.id);
  });

  it("新路由目标不替换现有草稿，取消放弃仍保留输入", async () => {
    const rendered = render(view());
    fireEvent.click(screen.getByRole("button", { name: `录入结果：${first.title}` }));
    const content = await screen.findByLabelText("跟进结果 *");
    fireEvent.change(content, { target: { value: "合成未完成草稿" } });
    rendered.rerender(view({ ...page }, target(second)));
    expect(content).toHaveValue("合成未完成草稿");
    expect(query().get("followUp")).toBe(first.id);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(content).toHaveValue("合成未完成草稿"));
    expect(mock.exact).toHaveBeenCalledOnce();
  });

  it("同一目标的改期模式保留完整 URL 身份，迟到结果模式与前后退不覆盖草稿", async () => {
    const rendered = render(view({ ...page, filter: "overdue", page: 2, total: 21 }, target(first), "reschedule"));
    const reason = await screen.findByLabelText("改期原因 *");
    fireEvent.change(reason, { target: { value: "合成改期草稿" } });
    expect(query().get("mode")).toBe("reschedule");
    rendered.rerender(view({ ...page, filter: "overdue", page: 2, total: 21 }, target(first), "result"));
    expect(reason).toHaveValue("合成改期草稿");
    expect(query().get("mode")).toBe("reschedule");
    await act(async () => { window.history.pushState(null, "", `/clients/follow-ups?followUp=${second.id}&client=${second.client.id}`); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(query().get("followUp")).toBe(first.id); expect(query().get("client")).toBe(first.client.id); expect(query().get("mode")).toBe("reschedule");
    expect(reason).toHaveValue("合成改期草稿"); expect(mock.exact).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rendered.rerender(view({ ...page, filter: "overdue", page: 2, total: 21 }, target(first), "reschedule"));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(query().has("followUp")).toBe(false); expect(query().has("client")).toBe(false); expect(query().has("mode")).toBe(false);
    expect(query().get("filter")).toBe("overdue"); expect(query().get("page")).toBe("2");
  });

  it("改期成功清除目标与模式、重读夹取末页并回到稳定标题", async () => {
    mock.reschedule.mockResolvedValue({ ok: true }); mock.list.mockResolvedValue({ ...page, items: [], total: 0, filter: "overdue" });
    const rendered = render(view({ ...page, filter: "overdue", page: 2, total: 21 }));
    fireEvent.click(screen.getByRole("button", { name: `改期：${first.title}` }));
    const date = await screen.findByLabelText("新的跟进时间（北京时间）*");
    fireEvent.change(date, { target: { value: "2027-01-03T10:00" } });
    fireEvent.change(screen.getByLabelText("改期原因 *"), { target: { value: "合成约定变更" } });
    fireEvent.click(screen.getByRole("button", { name: "保存改期" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(mock.list).toHaveBeenCalledWith({ filter: "overdue", page: 2 }));
    await screen.findByText("第 1 / 1 页 · 北京时间");
    expect(query().toString()).toBe("filter=overdue");
    rendered.rerender(view({ ...page, items: [], total: 0, filter: "overdue" }, target(first), "reschedule"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "客户待跟进列表" })).toHaveFocus());
  });

  it("列表请求途中接受新改期身份后，迟到旧列表响应不能覆盖草稿或 URL", async () => {
    let resolveList!: (value: PersonalFollowUpPage) => void;
    mock.list.mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve; }));
    const rendered = render(view());
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledWith({ filter: "today", page: 1 }));
    rendered.rerender(view({ ...page, filter: "overdue", page: 2, total: 21 }, target(first), "reschedule"));
    const reason = await screen.findByLabelText("改期原因 *");
    fireEvent.change(reason, { target: { value: "合成等待期间的新稿" } });
    await act(async () => { resolveList({ ...page, filter: "today", items: [second] }); });
    expect(screen.getByLabelText("改期原因 *")).toBe(reason); expect(reason).toHaveValue("合成等待期间的新稿");
    expect(query().get("followUp")).toBe(first.id); expect(query().get("client")).toBe(first.client.id); expect(query().get("mode")).toBe("reschedule");
    expect(query().get("filter")).toBe("overdue"); expect(query().get("page")).toBe("2");
    expect(mock.exact).toHaveBeenCalledOnce();
  });
});

describe("首页跟进入口（组件环境）", () => {
  const home: WorkQueue = { approvals: [], approvalTotal: 0, tasks: [], taskTotal: 0, tasksAvailable: true, followUps: { ...page, pageSize: 5, total: 9 } };
  it("只有本人跟进待办时默认展示该分段，真实总数和精确目标保留", () => {
    render(<WorkQueueCard queue={home} alerts={[]} />);
    expect(screen.getByRole("tab", { name: "跟进 9" })).toHaveAttribute("aria-selected", "true");
    const href = new URL(screen.getByRole("link", { name: new RegExp(first.title) }).getAttribute("href")!, "https://example.test");
    expect(href.pathname).toBe("/clients/follow-ups");
    expect(href.searchParams.get("followUp")).toBe(first.id);
    expect(href.searchParams.get("client")).toBe(first.client.id);
    expect(screen.getByText("本人共 9 项待跟进，按时间先后显示前五项")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看全部待跟进 →" })).toHaveAttribute("href", "/clients/follow-ups");
  });
  it("权限不可用不显示为零项成功", () => {
    render(<WorkQueueCard queue={{ ...home, followUps: { ...page, available: false, items: [], total: 0 } }} alerts={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "跟进 —" }));
    expect(screen.getByText("当前资格不能读取客户跟进")).toBeVisible();
    expect(screen.queryByText("暂无本人待跟进")).not.toBeInTheDocument();
  });
});
