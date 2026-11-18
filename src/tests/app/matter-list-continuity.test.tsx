import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { matterListEntryHref, matterListReturnHref } from "@/lib/matters/list-location";
const { replace, push } = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));
vi.mock("@/app/(app)/intakes/_components/intake-wizard", () => ({ IntakeWizard: () => null }));
vi.mock("@/app/(app)/matters/_components/intakes-table", () => ({ IntakesTable: () => null }));
import { MattersViewV4 } from "@/app/(app)/matters/_components/matters-view-v4";
import type { MatterRow } from "@/app/(app)/matters/_components/matters-table";
const matter: MatterRow = {
  id: "test-id", internalCode: "LL-2026-第1案", title: "合成案件", status: "CLOSED",
  primaryClient: null, owner: null, cause: null, claimAmount: 0, ourStanding: null,
  procedures: [{ id: "procedure-1", type: "CIVIL", caseNumber: null, status: "ACTIVE", engagement: "INFORMATIONAL",
    concludedAt: null, customLabel: "合成程序", deadlines: [{ title: "未授权期限", dueAt: new Date("2000-02-01") }] }],
  _count: { procedures: 1 }, canReadSchedule: false
} as MatterRow;
const props: React.ComponentProps<typeof MattersViewV4> = {
  tab: "all", canCreateIntake: false, canExportMatters: true, clientOptions: [], colleagues: [],
  matterData: { items: [matter], total: 48, page: 3, pageSize: 12 },
  initialFilters: { search: "已生效搜索", category: "CIVIL_COMMERCIAL", scope: "mine", status: "closed",
    from: "2026-01-01", to: "2026-11-16", sortBy: "claimAmount", sortDir: "asc" },
};
describe("案件列表、导出与跨工作区返回", () => {
  beforeEach(() => { replace.mockClear(); push.mockClear(); });

  it("分页保留服务端筛选条件，日期草稿须应用才提交并回到首页", async () => {
    render(<MattersViewV4 {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: "尚未提交" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const page = new URL(replace.mock.lastCall![0], "https://lexorder.invalid");
    expect(page.searchParams.get("page")).toBe("4");
    expect(page.searchParams.get("from")).toBe("2026-01-01");
    expect(page.searchParams.get("scope")).toBe("mine");
    expect(page.searchParams.get("search")).toBe("已生效搜索");

    replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /收案日期/ }));
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText("起"), { target: { value: "2026-02-01" } });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "应用" }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const applied = new URL(replace.mock.lastCall![0], "https://lexorder.invalid");
    expect(applied.searchParams.get("from")).toBe("2026-02-01");
    expect(applied.searchParams.get("to")).toBe("2026-11-16");
    expect(applied.searchParams.has("page")).toBe(false);
  });

  it("筛选已应用的范围可以换回全部，并清除团队条件和旧页码", async () => {
    render(<MattersViewV4 {...props} initialFilters={{ ...props.initialFilters, scope: "team", teamId: "team-1" }}
      readableTeams={[{ id: "team-1", name: "团队一" }]} />);
    fireEvent.click(screen.getByRole("combobox", { name: "范围" }));
    fireEvent.click(await screen.findByRole("option", { name: /全部可见/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const applied = new URL(replace.mock.lastCall![0], "https://lexorder.invalid");
    expect(applied.searchParams.has("scope")).toBe(false);
    expect(applied.searchParams.has("teamId")).toBe(false);
    expect(applied.searchParams.has("page")).toBe(false);
  });

  it("缩减结果后仍可以从过期的分页地址前往最后有效页", () => {
    render(<MattersViewV4 {...props} matterData={{ items: [], total: 13, page: 5, pageSize: 12 }} />);
    expect(screen.getByText("第 5 页无结果 · 共 13 件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "前往最后一页" }));
    const target = new URL(replace.mock.lastCall![0], "https://lexorder.invalid");
    expect(target.searchParams.get("page")).toBe("2");
    expect(target.searchParams.get("status")).toBe("closed");
  });

  it("导出使用当前生效条件而非尚未提交输入，回程另保留当前页", () => {
    render(<MattersViewV4 {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: "尚未提交" } });
    const exported = new URL(screen.getByRole("link", { name: "导出" }).getAttribute("href")!, "https://lexorder.invalid");
    expect(Object.fromEntries(exported.searchParams)).toEqual({ tab: "all", scope: "mine", search: "已生效搜索", category: "CIVIL_COMMERCIAL",
      status: "closed", from: "2026-01-01", to: "2026-11-16", sortBy: "claimAmount", sortDir: "asc" });
    const entry = new URL(screen.getByRole("link", { name: /合成案件/ }).getAttribute("href")!, "https://lexorder.invalid");
    expect(entry.pathname).toBe("/matters/LL-2026-%E7%AC%AC1%E6%A1%88");
    const returned = new URL(matterListReturnHref(entry.searchParams.get("list"))!, "https://lexorder.invalid");
    expect(returned.searchParams.get("page")).toBe("3");
    returned.searchParams.delete("page"); expect(returned.searchParams.toString()).toBe(exported.searchParams.toString());
  });
  it("案件表格保留打开详情的路径和可读字段，隐藏未授权的期限", () => {
    render(<MattersViewV4 {...props} />);
    const table = screen.getByRole("grid");
    expect(within(table).getByText("无日程查看权限")).toBeVisible();
    expect(screen.queryByText("未授权期限")).not.toBeInTheDocument();
    expect(within(table).getByText(/¥0/)).toBeVisible();
    const link = within(table).getByRole("link", { name: /合成案件/ });
    fireEvent.click(within(table).getByText("未关联客户"));
    expect(push).toHaveBeenCalledExactlyOnceWith(link.getAttribute("href"));
  });
  it("没有完整案件导出资格时不显示导出入口", () => {
    render(<MattersViewV4 {...props} canExportMatters={false} />);
    expect(screen.queryByRole("link", { name: "导出" })).not.toBeInTheDocument();
  });
  it.each(["returnTo=https://example.invalid", "new=1", "page=0", "page=1&page=2", "tab=all&sortBy=archivedAt", "tab=active&status=closed"])("显式无效列表位置拒绝：%s", query => {
    expect(matterListReturnHref(query)).toBeNull();
  });
  it("没有列表来源是正常直接进入，不构造其他对象来源", () => {
    expect(matterListReturnHref(null)).toBe("/matters");
    expect(matterListEntryHref({ internalCode: "LL-2026-A" })).toBe("/matters/LL-2026-A");
  });
});
