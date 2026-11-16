import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRecordView, MatterContextView } from "@/lib/matters/context";

const mocks = vi.hoisted(() => ({ options: vi.fn(), page: vi.fn(), history: vi.fn(), source: vi.fn(), save: vi.fn(), confirm: vi.fn(), ask: vi.fn(), refresh: vi.fn(), search: new URLSearchParams("view=archive") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), useSearchParams: () => mocks.search }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/matters/context-actions", () => ({
  getMatterContext: mocks.page, getMatterContextSourceOptions: mocks.options, getMatterContextHistory: mocks.history,
  getMatterContextSource: mocks.source, recordMatterContext: mocks.save, confirmMatterContextRecord: mocks.confirm,
}));
import { MatterContextSection } from "@/app/(app)/matters/[id]/_components/matter-context-section";

let record: ContextRecordView;
let view: MatterContextView;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.search = new URLSearchParams("view=archive");
  record = {
    id: "record", seriesId: "record-series", version: 2, kind: "GOAL", visibility: "MATTER",
    content: "本条合成目标：补齐交付资料后再作决定", reason: null, sourceDescription: "合成沟通记录",
    source: { type: "CLIENT_ACTIVITY", id: "activity", label: "客户沟通记录", available: true }, readable: true,
    occurredAt: "2026-11-16T08:00:00Z", createdAt: "2026-11-16T08:00:00Z", authorName: "合成记录人",
    confirmationStatus: "PENDING", confirmedByName: null, confirmedAt: null, canRevise: true, canConfirm: true,
  };
  view = { canWrite: true, canReadFinance: false, canConfirm: true, hasMore: false, nextCursor: null, records: [record] };
  mocks.options.mockResolvedValue({ choices: [], nextCursors: { DOCUMENT: null, NOTE: null, CLIENT_ACTIVITY: null } });
  mocks.history.mockResolvedValue({ records: [{ ...record, id: "old-record", version: 1, content: "历史合成目标" }], nextBeforeVersion: null });
  mocks.source.mockResolvedValue({ type: "CLIENT_ACTIVITY", label: "客户沟通记录", content: "合成来源正文", href: null });
  mocks.ask.mockResolvedValue(false);
});
afterEach(cleanup);

describe("目标与指示的明确动作与焦点", () => {
  it("新建草稿关闭时可继续编辑，确认放弃后回入口且重开为空", async () => {
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const create = screen.getByRole("button", { name: "记录目标或指示" });
    fireEvent.click(create);
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    const content = within(editor).getByLabelText("内容 *");
    fireEvent.change(content, { target: { value: "不能因误关而丢失的合成指示" } });
    fireEvent.change(within(editor).getByLabelText("来源说明 *"), { target: { value: "合成电话沟通" } });
    rendered.rerender(<MatterContextSection matterId="matter" view={{ ...view }} />);
    content.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({
      title: "放弃未保存的记录？", cancelText: "继续编辑", initialFocus: "cancel",
    })));
    expect(content).toHaveValue("不能因误关而丢失的合成指示");
    expect(within(editor).getByLabelText("来源说明 *")).toHaveValue("合成电话沟通");
    await waitFor(() => expect(content).toHaveFocus());

    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(create).toHaveFocus());
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(create);
    expect(await screen.findByLabelText("内容 *")).toHaveValue("");
    expect(screen.getByLabelText("来源说明 *")).toHaveValue("");
  });

  it("更正草稿点击外层也需确认，连续关闭只产生一次询问", async () => {
    let settle: (value: boolean) => void = () => undefined;
    mocks.ask.mockImplementationOnce(() => new Promise<boolean>(resolve => { settle = resolve; }));
    render(<MatterContextSection matterId="matter" view={view} />);
    const revise = screen.getByRole("button", { name: "更正客户目标第 2 版记录" });
    fireEvent.click(revise);
    const editor = await screen.findByRole("dialog", { name: "更正客户目标记录（当前第 2 版）" });
    await waitFor(() => expect(revise).toBeEnabled());
    fireEvent.change(within(editor).getByLabelText("更正或决定理由"), { target: { value: "待核对的合成更正理由" } });
    fireEvent.pointerDown(document.body, { pointerType: "mouse", button: 0 });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    await act(async () => { settle(false); });
    expect(within(editor).getByLabelText("更正或决定理由")).toHaveValue("待核对的合成更正理由");
    expect(within(editor).getByLabelText("内容 *")).toHaveValue(record.content);

    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(revise).toHaveFocus());
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("保存中关闭不打断请求，失败后仍保留草稿并受放弃保护", async () => {
    let rejectSave: (error: Error) => void = () => undefined;
    mocks.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "记录目标或指示" }));
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    fireEvent.change(within(editor).getByLabelText("内容 *"), { target: { value: "合成保存失败草稿" } });
    fireEvent.change(within(editor).getByLabelText("来源说明 *"), { target: { value: "合成电话沟通" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(editor).toBeInTheDocument();
    await act(async () => { rejectSave(new Error("合成响应失败")); });
    expect(await within(editor).findByRole("alert")).toHaveTextContent("合成响应失败");
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("合成保存失败草稿");
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1));
    expect(editor).toBeInTheDocument();
  });

  it("新建和更正明确对象，Esc分别返回实际触发按钮", async () => {
    render(<MatterContextSection matterId="matter" view={view} />);
    const create = screen.getByRole("button", { name: "记录目标或指示" });
    expect(screen.getByRole("region", { name: "目标与指示" })).toHaveClass("scroll-mt-44");
    fireEvent.click(create);
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(create).toHaveFocus());
    const revise = screen.getByRole("button", { name: "更正客户目标第 2 版记录" });
    fireEvent.click(revise);
    const correction = await screen.findByRole("dialog", { name: "更正客户目标记录（当前第 2 版）" });
    expect(within(correction).getByText("保存为第 3 版，保留第 2 版；新版需重新核对确认。")).toBeInTheDocument();
    expect(within(correction).getByRole("button", { name: "保存更正版" })).toBeInTheDocument();
    await waitFor(() => expect(revise).toBeEnabled());
    fireEvent.keyDown(correction, { key: "Escape" });
    await waitFor(() => expect(revise).toHaveFocus());
  });

  it("历史中的来源关闭后回到历史来源按钮，再关闭历史回到外层按钮", async () => {
    render(<MatterContextSection matterId="matter" view={view} />);
    const historyTrigger = screen.getByRole("button", { name: "查看客户目标记录的历史版本" });
    fireEvent.click(historyTrigger);
    const history = await screen.findByRole("dialog", { name: "客户目标的历史版本" });
    const sourceTrigger = await within(history).findByRole("button", { name: "查看客户目标第 1 版的来源：客户沟通记录" });
    fireEvent.click(sourceTrigger);
    const source = await screen.findByRole("dialog", { name: "客户目标第 1 版的来源" });
    await within(source).findByText("合成来源正文");
    fireEvent.keyDown(source, { key: "Escape" });
    await waitFor(() => expect(sourceTrigger).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "客户目标的历史版本" })).toBeInTheDocument();
    fireEvent.keyDown(history, { key: "Escape" });
    await waitFor(() => expect(historyTrigger).toHaveFocus());
  });

  it("直接来源各自返回；触发记录消失后退回模块标题", async () => {
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const trigger = screen.getByRole("button", { name: "查看客户目标第 2 版的来源：客户沟通记录" });
    fireEvent.click(trigger);
    let source = await screen.findByRole("dialog", { name: "客户目标第 2 版的来源" });
    await within(source).findByText("合成来源正文");
    fireEvent.keyDown(source, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    source = await screen.findByRole("dialog", { name: "客户目标第 2 版的来源" });
    await within(source).findByText("合成来源正文");
    rendered.rerender(<MatterContextSection matterId="matter" view={{ ...view, canWrite: false, records: [] }} />);
    fireEvent.keyDown(source, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "目标与指示" })).toHaveFocus());
  });

  it("确认文案包含当前可读内容和版本，明确选择取消初始焦点", async () => {
    render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "核对确认客户目标第 2 版记录" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({
      title: "核对确认客户目标记录（第 2 版）", initialFocus: "cancel",
      description: expect.stringContaining(record.content!),
    })));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("同案切换查询视图只隐藏概况，草稿和来源选择保持；加载错误也只在概况显示", async () => {
    view = { ...view, canReadFinance: true };
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "记录目标或指示" }));
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    fireEvent.change(within(editor).getByLabelText("内容 *"), { target: { value: "同案切换保留的指示" } });
    fireEvent.change(within(editor).getByLabelText("可见范围"), { target: { value: "FINANCE" } });
    mocks.search = new URLSearchParams("view=work");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("同案切换保留的指示");
    expect(within(editor).getByLabelText("可见范围")).toHaveValue("FINANCE");
    expect(document.querySelector("#matter-context")).toHaveAttribute("hidden");
    expect(mocks.page).not.toHaveBeenCalled();
    rendered.rerender(<MatterContextSection matterId="matter" view={null} error="读取失败" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("同案切换保留的指示");
    expect(within(editor).getByLabelText("可见范围")).toHaveValue("FINANCE");
    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    mocks.search = new URLSearchParams("view=archive");
    rendered.rerender(<MatterContextSection matterId="matter" view={null} error="读取失败" />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取失败");
  });

  it("来源继续加载及失败重试不重置同份草稿、来源选择或请求身份", async () => {
    mocks.options.mockResolvedValueOnce({ choices: [{ type: "DOCUMENT", id: "doc-first", label: "合成材料第一版" }], nextCursors: { DOCUMENT: "next-doc", NOTE: null, CLIENT_ACTIVITY: null } });
    mocks.options.mockRejectedValueOnce(new Error("来源读取失败"));
    mocks.options.mockResolvedValueOnce({ choices: [{ type: "DOCUMENT", id: "doc-later", label: "更早合成材料" }], nextCursors: { DOCUMENT: null, NOTE: null, CLIENT_ACTIVITY: null } });
    render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "记录目标或指示" }));
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    await within(editor).findByRole("option", { name: "合成材料第一版" });
    fireEvent.change(within(editor).getByLabelText("内容 *"), { target: { value: "分页前写下的完整指示" } });
    fireEvent.change(within(editor).getByLabelText("来源说明 *"), { target: { value: "依据合成原件" } });
    fireEvent.change(within(editor).getByLabelText("关联来源"), { target: { value: "DOCUMENT:doc-first" } });
    fireEvent.click(within(editor).getByRole("button", { name: "更多材料" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("来源读取失败");
    fireEvent.click(within(editor).getByRole("button", { name: "重试" }));
    await within(editor).findByRole("option", { name: "更早合成材料" });
    expect(mocks.options.mock.calls.slice(1)).toEqual([["matter", { type: "DOCUMENT", cursor: "next-doc" }], ["matter", { type: "DOCUMENT", cursor: "next-doc" }]]);
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("分页前写下的完整指示");
    expect(within(editor).getByLabelText("关联来源")).toHaveValue("DOCUMENT:doc-first");
    fireEvent.change(within(editor).getByLabelText("关联来源"), { target: { value: "DOCUMENT:doc-later" } });
    mocks.save.mockRejectedValueOnce(new Error("响应丢失"));
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await within(editor).findByText("响应丢失");
    const firstKey = mocks.save.mock.calls[0][0].requestKey;
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ requestKey: firstKey, sourceDocumentId: "doc-later", content: "分页前写下的完整指示" });
  });

  it("翻页失败不退首或保留旧正文，重试原位置，上一页重新授权读取", async () => {
    view = { ...view, hasMore: true, nextCursor: "next-records" };
    mocks.page.mockRejectedValueOnce(new Error("分页位置已失效"));
    mocks.page.mockResolvedValueOnce({ ...view, records: [{ ...record, id: "older", content: "更早合成记录" }], hasMore: false, nextCursor: null });
    mocks.page.mockResolvedValueOnce({ ...view, records: [] });
    render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "更多目标与指示" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("分页位置已失效");
    expect(screen.queryByText(record.content!)).not.toBeInTheDocument();
    expect(mocks.page).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新读取记录" }));
    await screen.findByText("更早合成记录");
    expect(mocks.page.mock.calls.slice(0, 2)).toEqual([["matter", "next-records"], ["matter", "next-records"]]);
    fireEvent.click(screen.getByRole("button", { name: "目标与指示上一页" }));
    await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith("matter", undefined));
    expect(await screen.findByText("尚未记录目标或指示。")).toBeInTheDocument();
    expect(screen.queryByText(record.content!)).not.toBeInTheDocument();
  });

  it("旧分页请求不得覆盖刷新后权限收紧的首批结果", async () => {
    let resolve: (value: MatterContextView) => void = () => undefined;
    mocks.page.mockImplementationOnce(() => new Promise<MatterContextView>(done => { resolve = done; }));
    view = { ...view, hasMore: true, nextCursor: "next-records" };
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "更多目标与指示" }));
    rendered.rerender(<MatterContextSection matterId="matter" view={{ ...view, canWrite: false, records: [], hasMore: false, nextCursor: null }} />);
    await act(async () => { resolve(view); });
    expect(screen.queryByText(record.content!)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记录目标或指示" })).not.toBeInTheDocument();
  });

  it("关闭再开同一来源不会接收旧请求，新资格失败载荷立即隐藏已读正文", async () => {
    let settle: (value: { type: "CLIENT_ACTIVITY"; label: string; content: string; href: null }) => void = () => undefined;
    mocks.source.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const trigger = screen.getByRole("button", { name: "查看客户目标第 2 版的来源：客户沟通记录" });
    fireEvent.click(trigger);
    const first = await screen.findByRole("dialog", { name: "客户目标第 2 版的来源" });
    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(trigger);
    const current = await screen.findByRole("dialog", { name: "客户目标第 2 版的来源" });
    await within(current).findByText("合成来源正文");
    await act(async () => { settle({ type: "CLIENT_ACTIVITY", label: "旧请求", content: "迟到的旧来源正文", href: null }); });
    expect(within(current).queryByText("迟到的旧来源正文")).not.toBeInTheDocument();
    expect(within(current).getByText("合成来源正文")).toBeInTheDocument();
    expect(mocks.source.mock.calls).toEqual([["matter", "record"], ["matter", "record"]]);
    rendered.rerender(<MatterContextSection matterId="matter" view={null} error="已无权读取事项上下文" />);
    expect(within(current).queryByText("合成来源正文")).not.toBeInTheDocument();
    expect(within(current).getByRole("alert")).toHaveTextContent("已无权读取事项上下文");
    mocks.source.mockRejectedValueOnce(new Error("来源已不可读取"));
    fireEvent.click(within(current).getByRole("button", { name: "重新读取来源" }));
    await within(current).findByText("来源已不可读取");
    expect(within(current).queryByText("合成来源正文")).not.toBeInTheDocument();
  });

  it("关闭再开同一历史不会接收旧请求，新来源受限载荷使缓存正文失效", async () => {
    let settle: (value: { records: ContextRecordView[]; nextBeforeVersion: null }) => void = () => undefined;
    mocks.history.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const trigger = screen.getByRole("button", { name: "查看客户目标记录的历史版本" });
    fireEvent.click(trigger);
    const first = await screen.findByRole("dialog", { name: "客户目标的历史版本" });
    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(trigger);
    const current = await screen.findByRole("dialog", { name: "客户目标的历史版本" });
    await within(current).findByText("历史合成目标");
    await act(async () => { settle({ records: [{ ...record, content: "迟到的旧历史正文" }], nextBeforeVersion: null }); });
    expect(within(current).queryByText("迟到的旧历史正文")).not.toBeInTheDocument();
    expect(within(current).getByText("历史合成目标")).toBeInTheDocument();
    const restricted = { ...record, readable: false, content: null, reason: null, sourceDescription: null, source: { ...record.source!, id: null, label: null, available: false }, canRevise: false, canConfirm: false };
    rendered.rerender(<MatterContextSection matterId="matter" view={{ ...view, records: [restricted] }} />);
    expect(within(current).queryByText("历史合成目标")).not.toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledTimes(2);
    mocks.history.mockResolvedValueOnce({ records: [restricted], nextBeforeVersion: null });
    fireEvent.click(within(current).getByRole("button", { name: "重新读取历史版本" }));
    await within(current).findByText("关联来源已不可读取，记录正文暂不显示。");
    expect(within(current).queryByText("历史合成目标")).not.toBeInTheDocument();
  });

  it("历史继续读取遭撤权时清掉此前只读正文，新载荷之后的迟到结果不能重新发布", async () => {
    mocks.history.mockResolvedValueOnce({ records: [{ ...record, content: "已加载历史正文" }], nextBeforeVersion: 2 });
    let rejectRead: (error: Error) => void = () => undefined;
    mocks.history.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "查看客户目标记录的历史版本" }));
    const history = await screen.findByRole("dialog", { name: "客户目标的历史版本" });
    await within(history).findByText("已加载历史正文");
    fireEvent.click(within(history).getByRole("button", { name: "查看更早版本" }));
    await act(async () => { rejectRead(new Error("已无权读取记录")); });
    expect(within(history).queryByText("已加载历史正文")).not.toBeInTheDocument();
    expect(within(history).getByRole("alert")).toHaveTextContent("已无权读取记录");

    let settle: (value: { records: ContextRecordView[]; nextBeforeVersion: null }) => void = () => undefined;
    mocks.history.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    fireEvent.click(within(history).getByRole("button", { name: "重新读取历史版本" }));
    rendered.rerender(<MatterContextSection matterId="matter" view={null} error="当前读取资格已失效" />);
    await act(async () => { settle({ records: [{ ...record, content: "资格失效前开始的迟到正文" }], nextBeforeVersion: null }); });
    expect(within(history).queryByText("资格失效前开始的迟到正文")).not.toBeInTheDocument();
    expect(within(history).getByRole("alert")).toHaveTextContent("当前读取资格已失效");
  });

  it("读取载荷失效不清掉编辑草稿或其原提交标识", async () => {
    mocks.save.mockRejectedValueOnce(new Error("保存响应丢失"));
    mocks.save.mockRejectedValueOnce(new Error("当前无权维护记录"));
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "记录目标或指示" }));
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    fireEvent.change(within(editor).getByLabelText("内容 *"), { target: { value: "仍待处理的编辑草稿" } });
    fireEvent.change(within(editor).getByLabelText("来源说明 *"), { target: { value: "合成指示依据" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await within(editor).findByText("保存响应丢失");
    const requestKey = mocks.save.mock.calls[0][0].requestKey;
    rendered.rerender(<MatterContextSection matterId="matter" view={null} error="当前读取资格已失效" />);
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("仍待处理的编辑草稿");
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await within(editor).findByText("当前无权维护记录");
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ requestKey, content: "仍待处理的编辑草稿", sourceDescription: "合成指示依据" });
  });
});
