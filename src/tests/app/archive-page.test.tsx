import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mocks = vi.hoisted(() => ({ list: vi.fn(), page: vi.fn(), session: vi.fn() }));
vi.mock("@/server/archive/actions", () => ({ listArchivedMatters: mocks.list }));
vi.mock("@/server/archive/borrow", () => ({ listArchivePageData: mocks.page }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/app/(app)/archive/_components/borrow-panel", () => ({ BorrowPanel: ({ canApply }: { canApply: boolean }) => <div data-testid="borrow">{canApply ? "借阅申请可用" : "归档台账资格"}</div> }));
import ArchivePage from "@/app/(app)/archive/page";

const matter = { id: "matter-one", title: "合成归档事项", internalCode: "ARCHIVE-G07", firmCaseNo: "合成所内号", category: "CIVIL_COMMERCIAL", primaryClient: { name: "合成委托方" } };
const record = { id: "archive-one", archiveNo: "归档-1", summary: "合成归档", completedAt: null, closedReason: null, archivedAt: new Date("2026-11-17T01:00:00.000Z"),
  archivedBy: "合成经办人", archivedById: "owner", missingItems: [], materialSnapshotVerified: true, matter };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner", role: "LAWYER", systemRole: "MEMBER" } });
  mocks.page.mockResolvedValue({ hasArchiveRead: true, borrows: { mine: [], pending: [] } });
  mocks.list.mockResolvedValue({ items: [record, { ...record, id: "archive-supplement", archiveNo: "归档-补充" }], recordTotal: 205, nextCursor: "next-current" });
});
afterEach(cleanup);

describe("G07 归档总览的记录口径与返回", () => {
  it("真实总数与本页条数分别显示，同案两记录仍用各自archiveId导出，URL保查询", async () => {
    render(await ArchivePage({ searchParams: Promise.resolve({ q: " 合成案号 ", cursor: "current-page" }) }));
    expect(mocks.list).toHaveBeenCalledWith({ query: "合成案号", cursor: "current-page" });
    expect(screen.getByText("205")).toBeInTheDocument();
    expect(screen.getByText(/归档记录.*含补充归档.*本页 2 条/)).toBeInTheDocument();
    const rows = within(screen.getByRole("grid")).getAllByRole("row"); expect(rows).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "ZIP" }).map(link => link.getAttribute("href"))).toEqual([
      "/api/archive/matter-one/export?archiveId=archive-one", "/api/archive/matter-one/export?archiveId=archive-supplement",
    ]);
    const next = new URL(screen.getByRole("link", { name: "下一页归档记录" }).getAttribute("href")!, "https://example.invalid");
    expect(next.searchParams.get("q")).toBe("合成案号"); expect(next.searchParams.get("cursor")).toBe("next-current");
    const first = new URL(screen.getByRole("link", { name: "回到第一页" }).getAttribute("href")!, "https://example.invalid");
    expect(first.searchParams.get("q")).toBe("合成案号"); expect(first.searchParams.has("cursor")).toBe(false);
    const input = screen.getByLabelText("归档号、案号或案件名称"); expect(input).toHaveValue("合成案号");
    const form = input.closest("form")!; expect(form).toHaveAttribute("method", "get"); expect(form.querySelector('[name="cursor"]')).toBeNull();
  });

  it("非法游标明确失败并提供保查询的重查入口，不伪装无记录", async () => {
    mocks.list.mockRejectedValue(new ActionError("归档查找位置已失效，请从第一页重新查找"));
    render(await ArchivePage({ searchParams: Promise.resolve({ q: "合成", cursor: "invalid" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("位置已失效");
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.queryByText("暂无已批准归档记录")).not.toBeInTheDocument();
    expect(new URL(screen.getByRole("link", { name: "从第一页查找" }).getAttribute("href")!, "https://example.invalid").searchParams.get("q")).toBe("合成");
  });

  it("重复位置参数拒绝读取；非ALL台账资格只保留原借阅入口", async () => {
    const first = render(await ArchivePage({ searchParams: Promise.resolve({ q: "合成", cursor: ["one", "two"] }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("条件或位置无效"); expect(mocks.list).not.toHaveBeenCalled();
    first.unmount(); mocks.page.mockResolvedValue({ hasArchiveRead: false, borrows: { mine: [], pending: [] } });
    render(await ArchivePage({ searchParams: Promise.resolve({ q: "合成", cursor: "ledger-cursor" }) }));
    expect(mocks.list).not.toHaveBeenCalled(); expect(screen.getByTestId("borrow")).toHaveTextContent("借阅申请可用");
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.queryByLabelText("归档号、案号或案件名称")).not.toBeInTheDocument();
    expect(screen.queryByText(/归档记录.*条/)).not.toBeInTheDocument();
  });
});
