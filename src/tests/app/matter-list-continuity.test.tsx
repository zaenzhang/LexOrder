import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { matterListEntryHref, matterListReturnHref } from "@/lib/matters/list-location";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));
vi.mock("@/app/(app)/intakes/_components/intake-wizard", () => ({ IntakeWizard: () => null }));
vi.mock("@/app/(app)/matters/_components/intakes-table", () => ({ IntakesTable: () => null }));
vi.mock("@/app/(app)/matters/_components/matters-table", () => ({
  MATTER_COLUMNS: [], MockupMattersTable: ({ listQuery }: { listQuery: string }) =>
    <a href={matterListEntryHref({ internalCode: "LL-2026-第1案" }, listQuery)}>合成案件</a>,
}));
import { MattersViewV4 } from "@/app/(app)/matters/_components/matters-view-v4";
const props: React.ComponentProps<typeof MattersViewV4> = {
  tab: "all", canCreateIntake: false, canExportMatters: true, clientOptions: [], colleagues: [],
  matterData: { items: [], total: 48, page: 3, pageSize: 12 },
  initialFilters: { search: "已生效搜索", category: "CIVIL_COMMERCIAL", scope: "mine", status: "closed",
    from: "2026-01-01", to: "2026-11-16", sortBy: "claimAmount", sortDir: "asc" },
};
describe("案件列表、导出与跨工作区返回", () => {
  it("导出使用当前生效条件而非尚未提交输入，回程另保留当前页", () => {
    render(<MattersViewV4 {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: "尚未提交" } });
    const exported = new URL(screen.getByRole("link", { name: "导出" }).getAttribute("href")!, "https://lexorder.invalid");
    expect(Object.fromEntries(exported.searchParams)).toEqual({ tab: "all", scope: "mine", search: "已生效搜索", category: "CIVIL_COMMERCIAL",
      status: "closed", from: "2026-01-01", to: "2026-11-16", sortBy: "claimAmount", sortDir: "asc" });
    const entry = new URL(screen.getByRole("link", { name: "合成案件" }).getAttribute("href")!, "https://lexorder.invalid");
    expect(entry.pathname).toBe("/matters/LL-2026-%E7%AC%AC1%E6%A1%88");
    const returned = new URL(matterListReturnHref(entry.searchParams.get("list"))!, "https://lexorder.invalid");
    expect(returned.searchParams.get("page")).toBe("3");
    returned.searchParams.delete("page"); expect(returned.searchParams.toString()).toBe(exported.searchParams.toString());
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
