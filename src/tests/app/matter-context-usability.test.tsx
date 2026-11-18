import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRecordView, MatterContextView } from "@/lib/matters/context";

const mocks = vi.hoisted(() => ({ options: vi.fn(), history: vi.fn(), source: vi.fn(), exact: vi.fn(), save: vi.fn(), confirm: vi.fn(), ask: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@douyinfe/semi-ui", async (load) => ({ ...await load<typeof import("@douyinfe/semi-ui")>(), Toast: { success: vi.fn(), error: vi.fn() }, Notification: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/matters/context-actions", () => ({
  getMatterContextSourceOptions: mocks.options, getMatterContextHistory: mocks.history,
  getMatterContextSource: mocks.source, getMatterContextRecord: mocks.exact, recordMatterContext: mocks.save, confirmMatterContextRecord: mocks.confirm,
}));
import { MatterContextSection } from "@/app/(app)/matters/[id]/_components/matter-context-section";

let record: ContextRecordView;
let view: MatterContextView;
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/matters/MATTER-1");
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
  mocks.exact.mockResolvedValue({ ...record, id: "cmtestrecord00000000000001", kind: "INSTRUCTION", version: 1,
    content: "合成客户动态所指旧版", confirmationStatus: "CONFIRMED", confirmedAt: "2026-11-15T08:00:00Z", confirmedByName: "合成核对人", canRevise: false, canConfirm: false });
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
    const backdrop = editor.closest(".semi-modal-wrap");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
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

  it("直接读取当前列表外确切旧版，来源Esc返回本版；关闭只清本路径定位", async () => {
    const recordId = "cmtestrecord00000000000001";
    const back = `/clients/cmtestclient00000000000001?tab=history&historyCursor=opaque-page&rowId=CONTEXT:${recordId}`;
    window.history.replaceState(null, "", `/matters/MATTER-1?${new URLSearchParams({ view: "archive", procedure: "procedure-a", stage: "stage-a", document: "document-a", contextRecord: recordId, contextReturnTo: back })}`);
    render(<MatterContextSection matterId="matter" view={view} />);
    const exact = await screen.findByRole("dialog", { name: "客户指示记录（第 1 版）" });
    expect(mocks.exact).toHaveBeenCalledWith("matter", recordId);
    expect(within(exact).getByText("合成客户动态所指旧版")).toBeInTheDocument();
    expect(within(exact).getByText("已核对")).toBeInTheDocument();
    expect(within(exact).getByRole("link", { name: "返回客户动态" }).getAttribute("href")).toContain("historyCursor=opaque-page");
    expect(mocks.history).not.toHaveBeenCalled();
    const trigger = within(exact).getByRole("button", { name: "查看客户指示第 1 版的来源：客户沟通记录" });
    fireEvent.click(trigger);
    const source = await screen.findByRole("dialog", { name: "客户指示第 1 版的来源" });
    await within(source).findByText("合成来源正文");
    fireEvent.keyDown(source, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.keyDown(exact, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const remaining = new URLSearchParams(window.location.search);
    expect(remaining.has("contextRecord")).toBe(false); expect(remaining.has("contextReturnTo")).toBe(false);
    expect(Object.fromEntries(remaining)).toEqual({ view: "archive", procedure: "procedure-a", stage: "stage-a", document: "document-a" });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("目标切换与关闭都使旧精确读取失效，不显示另一个修订", async () => {
    let resolveOld!: (value: ContextRecordView) => void;
    mocks.exact.mockImplementationOnce(() => new Promise<ContextRecordView>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ...record, id: "record-b", content: "只显示B的正文" });
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=record-a");
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=record-b");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    await screen.findByText("只显示B的正文");
    await act(async () => resolveOld({ ...record, id: "record-a", content: "不得显示的A迟到正文" }));
    expect(screen.queryByText("不得显示的A迟到正文")).not.toBeInTheDocument();
    let resolveClosed!: (value: ContextRecordView) => void;
    mocks.exact.mockImplementationOnce(() => new Promise<ContextRecordView>(resolve => { resolveClosed = resolve; }));
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=record-c");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(within(screen.getByRole("dialog", { name: "查看指定记录" })).getByRole("button", { name: "关闭" }));
    await act(async () => resolveClosed({ ...record, id: "record-c", content: "关闭后不得出现的正文" }));
    expect(screen.queryByText("关闭后不得出现的正文")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("重复定位或读取失权只显示错误，立即遮蔽原记录与嵌套来源", async () => {
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=cmtestrecord00000000000001");
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const exact = await screen.findByRole("dialog", { name: "客户指示记录（第 1 版）" });
    fireEvent.click(within(exact).getByRole("button", { name: "查看客户指示第 1 版的来源：客户沟通记录" }));
    await screen.findByText("合成来源正文");
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=cmtestrecord00000000000001&contextRecord=other");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    expect(screen.queryByText("合成客户动态所指旧版")).not.toBeInTheDocument();
    expect(screen.queryByText("合成来源正文")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("记录位置无效");
    expect(mocks.exact).toHaveBeenCalledTimes(1);
    mocks.exact.mockRejectedValueOnce(new Error("这条记录不存在或已无权读取"));
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=unavailable");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不存在或已无权读取");
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("新服务端payload使原来源关闭，返回仍打开的精确记录标题", async () => {
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=cmtestrecord00000000000001");
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    const exact = await screen.findByRole("dialog", { name: "客户指示记录（第 1 版）" });
    fireEvent.click(within(exact).getByRole("button", { name: "查看客户指示第 1 版的来源：客户沟通记录" }));
    await screen.findByText("合成来源正文");
    mocks.exact.mockRejectedValueOnce(new Error("原来源已撤回"));
    rendered.rerender(<MatterContextSection matterId="matter" view={{ ...view, records: [] }} />);
    expect(screen.queryByText("合成来源正文")).not.toBeInTheDocument();
    await screen.findByText("原来源已撤回");
    await waitFor(() => expect(screen.getByRole("heading", { name: "查看指定记录" })).toHaveFocus());
  });

  it("精确链接到达不重挂当前草稿，保存失败及关闭确认保持原行为", async () => {
    let rejectSave!: (reason: Error) => void;
    mocks.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const rendered = render(<MatterContextSection matterId="matter" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "记录目标或指示" }));
    const editor = await screen.findByRole("dialog", { name: "记录目标或指示" });
    fireEvent.change(within(editor).getByLabelText("内容 *"), { target: { value: "必须保留的编辑输入" } });
    fireEvent.change(within(editor).getByLabelText("来源说明 *"), { target: { value: "合成电话" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    window.history.replaceState(null, "", "/matters/MATTER-1?contextRecord=cmtestrecord00000000000001");
    rendered.rerender(<MatterContextSection matterId="matter" view={view} />);
    await waitFor(() => expect(mocks.exact).toHaveBeenCalledOnce());
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "客户指示记录（第 1 版）" })).not.toBeInTheDocument();
    await act(async () => rejectSave(new Error("合成保存失败")));
    expect(within(editor).getByLabelText("内容 *")).toHaveValue("必须保留的编辑输入");
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce());
    expect(editor).toBeInTheDocument();
    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(await screen.findByRole("dialog", { name: "客户指示记录（第 1 版）" })).toBeInTheDocument();
  });
});
