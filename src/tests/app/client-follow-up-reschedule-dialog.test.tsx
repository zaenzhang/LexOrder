import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientFollowUpRescheduleDialog, PersonalFollowUpRescheduleHistory } from "@/components/clients/client-follow-up-reschedule-dialog";
import { ClientActivityDialog } from "@/components/clients/client-activity-dialog";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";
import type { PersonalFollowUp, PersonalFollowUpHistoryPage } from "@/lib/clients/follow-ups";

const mock = vi.hoisted(() => ({ exact: vi.fn(), reschedule: vi.fn(), history: vi.fn(), save: vi.fn(), close: vi.fn(), saved: vi.fn() }));
vi.mock("@/server/clients/relationship-actions", () => ({ getPersonalFollowUp: mock.exact, rescheduleClientFollowUp: mock.reschedule, getPersonalFollowUpRescheduleHistory: mock.history, recordClientActivity: mock.save }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn() }),
    Notification: Object.assign(semi.Notification, { success: vi.fn() })
  };
});
const item: PersonalFollowUp = { id: "cmtestfollowup000000000001", client: { id: "cmtestclient00000000000001", name: "合成改期客户" }, title: "合成核对材料", dueAt: "2027-01-02T02:00:47.123Z", updatedAt: "2026-11-18T02:00:00.007Z", assigneeName: "合成本人", status: "OPEN", overdue: false, canClose: true };
const target = { clientId: item.client.id, followUpId: item.id };
const empty = { items: [], nextCursor: null };
const receipt = { id: "cmtestaudit000000000000001", beforeDueAt: item.dueAt, afterDueAt: "2027-01-03T02:00:00.000Z", reason: "合成历史约定", actorName: "合成本人", at: "2026-11-18T03:00:00.000Z" };
const refs = { trigger: { current: null }, fallback: { current: null } };
function view() { return <><ClientFollowUpRescheduleDialog {...target} {...refs} onClose={mock.close} onSaved={mock.saved} /><ConfirmHost /></>; }
async function fillDraft() {
  fireEvent.change(await screen.findByLabelText("新的跟进时间（北京时间）*"), { target: { value: "2027-01-03T10:00" } });
  fireEvent.change(screen.getByLabelText("改期原因 *"), { target: { value: "合成新约定" } });
}
beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset();
  mock.exact.mockResolvedValue(item); mock.history.mockResolvedValue(empty);
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("A2 原跟进改期编辑器（纯组件，服务动作替身）", () => {
  it("精确读取原目标；未改分钟不会把原有秒和毫秒截断为一次改期", async () => {
    render(view());
    const input = await screen.findByLabelText("新的跟进时间（北京时间）*");
    expect(mock.exact).toHaveBeenCalledWith(target); expect(input).toHaveValue("2027-01-02T10:00");
    expect(screen.getByText("负责人：合成本人")).toBeVisible();
    fireEvent.change(screen.getByLabelText("改期原因 *"), { target: { value: "合成仅填写原因" } });
    expect(screen.getByRole("button", { name: "保存改期" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(mock.reschedule).not.toHaveBeenCalled();
  });

  it("未知保存结果不换 key；输入、历史、props 刷新不换 key，成功重读才更新版本并保留草稿", async () => {
    let reject!: (error: Error) => void;
    mock.reschedule.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const rendered = render(view()); await fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "保存改期" }));
    await waitFor(() => expect(mock.reschedule).toHaveBeenCalledOnce());
    const first = mock.reschedule.mock.calls[0][0];
    expect(first).toMatchObject({ ...target, expectedUpdatedAt: item.updatedAt, dueAt: "2027-01-03T02:00:00.000Z", reason: "合成新约定" });
    expect(first.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(mock.close).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新读取并核对" })).toBeDisabled();
    await act(async () => { reject(new Error("合成网络中断，提交结果未知")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("提交结果未知");
    fireEvent.change(screen.getByLabelText("改期原因 *"), { target: { value: "合成仍在核对的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "改期记录" }));
    await screen.findByText("暂无改期记录。"); rendered.rerender(view());
    mock.reschedule.mockRejectedValueOnce(new Error("此请求内容不同，请重新读取并核对"));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存改期" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存改期" }));
    await screen.findByText("此请求内容不同，请重新读取并核对");
    expect(mock.reschedule.mock.calls[1][0].requestKey).toBe(first.requestKey);
    expect(mock.exact).toHaveBeenCalledOnce();
    mock.exact.mockResolvedValue({ ...item, dueAt: "2027-01-02T03:00:59.999Z", updatedAt: "2026-11-18T02:00:00.008Z" });
    await waitFor(() => expect(screen.getByRole("button", { name: "重新读取并核对" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" }));
    await waitFor(() => expect(mock.exact).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("新的跟进时间（北京时间）*")).toHaveValue("2027-01-03T10:00");
    expect(screen.getByLabelText("改期原因 *")).toHaveValue("合成仍在核对的草稿");
    expect(screen.getByRole("button", { name: "改期记录" })).toHaveAttribute("aria-expanded", "false");
    mock.reschedule.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "保存改期" }));
    await waitFor(() => expect(mock.saved).toHaveBeenCalledOnce());
    expect(mock.reschedule.mock.calls[2][0]).toMatchObject({ expectedUpdatedAt: "2026-11-18T02:00:00.008Z", dueAt: "2027-01-03T02:00:00.000Z", reason: "合成仍在核对的草稿" });
    expect(mock.reschedule.mock.calls[2][0].requestKey).not.toBe(first.requestKey);
  });

  it("重读显示草稿时间已经保存时无需重复改期，未保存原因保留", async () => {
    render(view()); await fillDraft();
    mock.exact.mockResolvedValue({ ...item, dueAt: "2027-01-03T02:00:00.000Z", updatedAt: "2026-11-18T04:00:00.003Z" });
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" }));
    expect(await screen.findByLabelText("改期原因 *")).toHaveValue("合成新约定");
    expect(screen.getByRole("button", { name: "保存改期" })).toBeDisabled();
    expect(mock.reschedule).not.toHaveBeenCalled();
  });

  it("重读失败清掉已核对正文和历史，迟到历史丢弃，重试后保留改期草稿", async () => {
    let resolveHistory!: (value: PersonalFollowUpHistoryPage) => void;
    mock.history.mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve; }));
    render(view()); await fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "改期记录" }));
    mock.exact.mockRejectedValueOnce(new Error("合成当前读取资格已撤销"));
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" }));
    await screen.findByText("合成当前读取资格已撤销");
    expect(screen.queryByText(`${item.client.name} · ${item.title}`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("改期原因 *")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "改期记录" })).not.toBeInTheDocument();
    await act(async () => { resolveHistory({ items: [receipt], nextCursor: null }); });
    expect(screen.queryByText(receipt.reason)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    expect(mock.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" }));
    expect(await screen.findByLabelText("改期原因 *")).toHaveValue("合成新约定");
    expect(screen.getByLabelText("新的跟进时间（北京时间）*")).toHaveValue("2027-01-03T10:00");
  });

  it.each(["COMPLETED", "CANCELLED", "OPEN"] as const)("终态或无写权 %s 只读，仍可在当前读取权限下查看记录", async status => {
    mock.exact.mockResolvedValue({ ...item, status, canClose: false });
    render(view()); await screen.findByRole("dialog", { name: "查看跟进安排" });
    expect(screen.queryByRole("button", { name: "保存改期" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("新的跟进时间（北京时间）*")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改期记录" }));
    await screen.findByText("暂无改期记录。"); expect(mock.history).toHaveBeenCalledWith({ ...target, cursor: undefined });
  });

  it("目标变更丢弃旧确切读取，关闭前脏草稿需确认且继续编辑保留输入", async () => {
    let resolveFirst!: (value: PersonalFollowUp) => void;
    mock.exact.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const rendered = render(view()), next = { ...item, id: "cmtestfollowup000000000002", title: "合成下一条" };
    mock.exact.mockResolvedValue(next);
    rendered.rerender(<><ClientFollowUpRescheduleDialog clientId={target.clientId} followUpId={next.id} {...refs} onClose={mock.close} onSaved={mock.saved} /><ConfirmHost /></>);
    await screen.findByText(`${next.client.name} · ${next.title}`);
    await act(async () => { resolveFirst(item); });
    expect(screen.queryByText(`${item.client.name} · ${item.title}`)).not.toBeInTheDocument();
    await fillDraft(); fireEvent.click(screen.getByRole("button", { name: "返回" }));
    const continueEditing = await screen.findByRole("button", { name: "继续编辑" });
    await act(async () => { fireEvent.click(continueEditing); });
    expect(screen.getByLabelText("改期原因 *")).toHaveValue("合成新约定"); expect(mock.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回" })); fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
  });

  it("结果草稿先失败保存，再展开、翻页、失败重试历史，原表单及请求 key 始终保留", async () => {
    mock.save.mockRejectedValue(new Error("合成结果暂未确认"));
    mock.history.mockResolvedValueOnce({ items: [receipt], nextCursor: receipt.id }).mockRejectedValueOnce(new Error("合成历史读取中断")).mockResolvedValueOnce({ items: [{ ...receipt, id: "cmtestaudit000000000000002", reason: "合成第二页" }], nextCursor: null });
    render(<><ClientActivityDialog clientId={target.clientId} mode={{ id: target.followUpId, status: "COMPLETED" }} verifyPersonalTarget {...refs} onClose={mock.close} onSaved={mock.saved} /><ConfirmHost /></>);
    const content = await screen.findByLabelText("跟进结果 *");
    fireEvent.change(content, { target: { value: "合成尚未确认的结果" } }); fireEvent.click(screen.getByRole("button", { name: "保存结果" }));
    await screen.findByText("合成结果暂未确认"); const request = mock.save.mock.calls[0][0];
    const historyButton = screen.getByRole("button", { name: "改期记录" });
    expect(historyButton.closest("form")).toBeNull(); expect(historyButton).toHaveAttribute("type", "button");
    fireEvent.click(historyButton); await screen.findByText(receipt.reason);
    fireEvent.click(screen.getByRole("button", { name: "下一页改期记录" }));
    await screen.findByText("合成历史读取中断");
    expect(screen.queryByText(receipt.reason)).not.toBeInTheDocument(); expect(screen.queryByText("暂无改期记录。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试改期记录" })); await screen.findByText("合成第二页");
    expect(mock.history.mock.calls[1][0]).toEqual({ ...target, cursor: receipt.id }); expect(mock.history.mock.calls[2][0]).toEqual(mock.history.mock.calls[1][0]);
    expect(screen.getByLabelText("跟进结果 *")).toBe(content); expect(content).toHaveValue("合成尚未确认的结果");
    expect(mock.save).toHaveBeenCalledOnce(); expect(mock.exact).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "保存结果" })); await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save.mock.calls[1][0]).toEqual(request);
  });

  it("折叠历史后的迟到响应不会重现，重新展开重新核对授权", async () => {
    let resolve!: (value: PersonalFollowUpHistoryPage) => void;
    mock.history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<PersonalFollowUpRescheduleHistory target={target} />);
    fireEvent.click(screen.getByRole("button", { name: "改期记录" })); fireEvent.click(screen.getByRole("button", { name: "改期记录" }));
    await act(async () => { resolve({ items: [receipt], nextCursor: null }); });
    expect(screen.queryByText(receipt.reason)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改期记录" })); await screen.findByText("暂无改期记录。"); expect(mock.history).toHaveBeenCalledTimes(2);
  });
});
