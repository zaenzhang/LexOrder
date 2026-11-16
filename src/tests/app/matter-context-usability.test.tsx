import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRecordView, MatterContextView } from "@/lib/matters/context";

const mocks = vi.hoisted(() => ({ options: vi.fn(), history: vi.fn(), source: vi.fn(), save: vi.fn(), confirm: vi.fn(), ask: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/matters/context-actions", () => ({
  getMatterContextSourceOptions: mocks.options, getMatterContextHistory: mocks.history,
  getMatterContextSource: mocks.source, recordMatterContext: mocks.save, confirmMatterContextRecord: mocks.confirm,
}));
import { MatterContextSection } from "@/app/(app)/matters/[id]/_components/matter-context-section";

let record: ContextRecordView;
let view: MatterContextView;
beforeEach(() => {
  vi.resetAllMocks();
  record = {
    id: "record", seriesId: "record-series", version: 2, kind: "GOAL", visibility: "MATTER",
    content: "本条合成目标：补齐交付资料后再作决定", reason: null, sourceDescription: "合成沟通记录",
    source: { type: "CLIENT_ACTIVITY", id: "activity", label: "客户沟通记录", available: true }, readable: true,
    occurredAt: "2026-11-16T08:00:00Z", createdAt: "2026-11-16T08:00:00Z", authorName: "合成记录人",
    confirmationStatus: "PENDING", confirmedByName: null, confirmedAt: null, canRevise: true, canConfirm: true,
  };
  view = { canWrite: true, canReadFinance: false, canConfirm: true, hasMore: false, records: [record] };
  mocks.options.mockResolvedValue({ choices: [], truncated: false });
  mocks.history.mockResolvedValue({ records: [{ ...record, id: "old-record", version: 1, content: "历史合成目标" }], nextBeforeVersion: null });
  mocks.source.mockResolvedValue({ type: "CLIENT_ACTIVITY", label: "客户沟通记录", content: "合成来源正文", href: null });
  mocks.ask.mockResolvedValue(false);
});
afterEach(cleanup);

describe("目标与指示的明确动作与焦点", () => {
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
});
