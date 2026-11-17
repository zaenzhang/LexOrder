import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRecordView, MatterBrief } from "@/lib/matters/context";

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/server/matters/context-actions", () => ({ getMatterBrief: mock.get }));

import { MatterBriefSection } from "@/app/(app)/matters/[id]/_components/matter-brief-section";

const matterId = "cmtestmatter00000000000001";
const when = "2026-11-16T01:00:00.000Z";

function record(overrides: Partial<ContextRecordView> = {}): ContextRecordView {
  return {
    id: "context-1", seriesId: "series-1", version: 2, kind: "GOAL", visibility: "MATTER",
    content: "合成客户希望及时完成交付", reason: "合成理由", sourceDescription: "合成面谈依据",
    source: { type: "NOTE", id: "note-1", label: "合成记录来源", available: true }, readable: true,
    occurredAt: when, createdAt: when, authorName: "合成律师", confirmationStatus: "PENDING",
    confirmedByName: null, confirmedAt: null, canRevise: false, canConfirm: false, ...overrides
  };
}

function brief(id = matterId): MatterBrief {
  return {
    matterId: id, serviceScope: "合成合同审查服务", deliverables: "合成审查意见",
    context: { canWrite: false, canReadFinance: false, canConfirm: false, records: [record()], hasMore: false, nextCursor: null },
    nextActions: [{ id: "task-1", title: "合成核对材料", dueAt: when, assigneeName: "合成律师", accepted: false }],
    deadlines: [{ id: "deadline-1", title: "合成提交期限", dueAt: when, duePrecision: "DATETIME", confirmationStatus: "ADJUSTED", assigneeName: null }],
    clientFollowUps: [{ id: "follow-up-1", clientId: "client-1", clientName: "合成客户", title: "合成联系客户", dueAt: when, assigneeName: "合成律师" }],
    recentClientActivities: [{ id: "activity-1", clientId: "client-1", clientName: "合成客户", channel: "PHONE", occurredAt: when }],
    businessTimeZone: "Asia/Shanghai",
    coverage: { tasksTruncated: true, deadlinesTruncated: false, clientFollowUpsTruncated: false, clientActivitiesTruncated: true }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { mock.get.mockReset(); });
afterEach(cleanup);

describe("事项摘要（组件环境）", () => {
  it("从现有授权服务加载实际记录，显示中文状态、上海时间和已有回查入口", async () => {
    const pending = deferred<MatterBrief>();
    mock.get.mockReturnValue(pending.promise);
    render(<MatterBriefSection matterId={matterId} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取事项摘要");
    expect(screen.getByRole("region", { name: "事项摘要" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { pending.resolve(brief()); });

    expect(mock.get).toHaveBeenCalledWith(matterId);
    expect(screen.getByText("合成合同审查服务")).toBeVisible();
    expect(screen.getByText("合成审查意见")).toBeVisible();
    expect(screen.getByText("合成客户希望及时完成交付")).toBeVisible();
    expect(screen.getByText("待确认")).toBeVisible();
    expect(screen.getByText("第 2 版")).toBeVisible();
    expect(screen.getByText(/2026-11-16 09:00 · 合成律师 · 待承接/)).toBeVisible();
    expect(screen.getByText(/2026-11-16 09:00 · 已人工调整/)).toBeVisible();
    expect(screen.getByText(/电话 · 2026-11-16 09:00/)).toBeVisible();
    expect(screen.getByText(/仅显示前 10 项待办任务/)).toBeVisible();
    expect(screen.getByText(/仅显示最近 5 次沟通/)).toBeVisible();
    expect(screen.getByRole("link", { name: "查看目标与指示" })).toHaveAttribute("href", "#matter-context");
    expect(screen.getByRole("link", { name: "查看日程" })).toHaveAttribute("href", "/schedule");
    expect(screen.getAllByRole("link", { name: "合成客户" })[0]).toHaveAttribute("href", "/clients/client-1");
    expect(screen.queryByRole("button", { name: /确认|编辑|生成/ })).not.toBeInTheDocument();
  });

  it("不显示受限来源或财务记录的正文、原因、来源说明与来源标签", async () => {
    const data = brief();
    data.context.records = [
      record({ readable: false, content: "受限正文", reason: "受限原因", sourceDescription: "受限来源说明" }),
      record({ id: "context-2", visibility: "FINANCE", content: "受限财务内容" }),
      record({ id: "context-3", content: "不可用来源正文", source: { type: "NOTE", id: "hidden", label: "受限来源标签", available: false } })
    ];
    mock.get.mockResolvedValue(data);
    render(<MatterBriefSection matterId={matterId} />);
    await screen.findByText("部分记录当前不可读取。");
    for (const text of ["受限正文", "受限原因", "受限来源说明", "受限财务内容", "不可用来源正文", "受限来源标签"]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(screen.getByText("暂无可显示的目标与指示。")).toBeVisible();
  });

  it("刷新即清除旧内容，失败明确报错且可重试，不回退到旧摘要", async () => {
    const refreshed = deferred<MatterBrief>();
    mock.get.mockResolvedValueOnce(brief()).mockReturnValueOnce(refreshed.promise);
    render(<MatterBriefSection matterId={matterId} />);
    await screen.findByText("合成客户希望及时完成交付");
    fireEvent.click(screen.getByRole("button", { name: "刷新摘要" }));
    expect(screen.queryByText("合成客户希望及时完成交付")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeVisible();
    await act(async () => { refreshed.reject(new Error("当前事项无权读取")); });
    expect(screen.getByRole("alert")).toHaveTextContent("摘要读取失败：当前事项无权读取");
    expect(screen.queryByText("合成审查意见")).not.toBeInTheDocument();

    const current = brief();
    current.context.records = [];
    current.serviceScope = "合成当前服务范围";
    mock.get.mockResolvedValueOnce(current);
    fireEvent.click(screen.getByRole("button", { name: "重试摘要" }));
    await screen.findByText("合成当前服务范围");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("合成客户希望及时完成交付")).not.toBeInTheDocument();
    expect(mock.get).toHaveBeenCalledTimes(3);
  });

  it("切换事项后忽略上一事项的迟到响应", async () => {
    const earlier = deferred<MatterBrief>();
    const current = deferred<MatterBrief>();
    const nextId = "cmtestmatter00000000000002";
    mock.get.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
    const { rerender } = render(<MatterBriefSection matterId={matterId} />);
    rerender(<MatterBriefSection matterId={nextId} />);
    const next = brief(nextId);
    next.serviceScope = "第二事项的服务范围";
    await act(async () => { current.resolve(next); });
    await act(async () => { earlier.resolve(brief()); });
    expect(screen.getByText("第二事项的服务范围")).toBeVisible();
    expect(screen.queryByText("合成合同审查服务")).not.toBeInTheDocument();
    expect(mock.get).toHaveBeenLastCalledWith(nextId);
  });

  it("同一事项服务端刷新后重新读取权限视图并丢弃旧内容", async () => {
    const refreshed = deferred<MatterBrief>();
    mock.get.mockResolvedValueOnce(brief()).mockReturnValueOnce(refreshed.promise);
    const { rerender } = render(<MatterBriefSection matterId={matterId} refreshKey="before" />);
    await screen.findByText("合成客户希望及时完成交付");
    rerender(<MatterBriefSection matterId={matterId} refreshKey="after" />);
    expect(screen.queryByText("合成客户希望及时完成交付")).not.toBeInTheDocument();
    const revoked = brief();
    revoked.context.records = [record({ readable: false, content: null, reason: null, sourceDescription: null, source: { type: "NOTE", id: null, label: null, available: false } })];
    await act(async () => { refreshed.resolve(revoked); });
    expect(screen.getByText("部分记录当前不可读取。")).toBeVisible();
    expect(screen.queryByText("合成客户希望及时完成交付")).not.toBeInTheDocument();
    expect(mock.get).toHaveBeenCalledTimes(2);
  });

  it("响应事项不匹配时拒绝展示并提供重试", async () => {
    mock.get.mockResolvedValue(brief("cmtestmatter00000000000002"));
    render(<MatterBriefSection matterId={matterId} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("事项摘要与当前事项不一致"));
    expect(screen.queryByText("合成合同审查服务")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试摘要" })).toBeEnabled();
  });
});
