import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeroData, ScheduleItem } from "@/server/dashboard/actions";

const mock = vi.hoisted(() => ({ hero: vi.fn(), schedule: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ user: { id: "dashboard-reviewer", role: "LAWYER" } }) }));
vi.mock("@/lib/notifications/email", () => ({ isEmailConfigured: () => true }));
vi.mock("@/components/dashboard/conflict-search-button", () => ({ ConflictSearchButton: () => null }));
vi.mock("@/components/dashboard/revenue-chart", () => ({ RevenueChart: () => null }));
vi.mock("@/components/dashboard/category-chart", () => ({ CategoryChart: () => null }));
vi.mock("@/components/dashboard/client-source-card", () => ({ ClientSourceCard: () => null }));
vi.mock("@/components/dashboard/work-queue-card", () => ({ WorkQueueCard: () => null }));
vi.mock("@/components/dashboard/alerts-list", () => ({ loadAlerts: async () => [] }));
vi.mock("@/server/dashboard/actions", () => ({
  getDashboardHeroData: mock.hero,
  getDashboardSchedule: mock.schedule,
  getDashboardRevenueTrend: async () => [],
  getDashboardCategoryDistribution: async () => [],
  getDashboardWorkQueue: mock.queue,
  getDashboardOverdueReceivables: async () => null,
  getDashboardClientSources: async () => []
}));

import DashboardPage from "@/app/(app)/page";

const hero: HeroData = {
  todayDeadlineCount: 0, weekHearingCount: 0, nearTermCount: 0, overdueDeadlineCount: 0, pendingSealCount: 0,
  focus: null
};
const focus: NonNullable<HeroData["focus"]> = {
  title: "合成期限焦点", matter: "合成期限案件", internalCode: "LL-TEST-0001", procedure: "一审",
  dueAt: new Date("2026-12-06T00:00:00+08:00"), duePrecision: "DATE", overdue: false, daysLeft: 20, href: "/matters/LL-TEST-0001"
};
const hearing: ScheduleItem = {
  id: "hearing-1", type: "hearing", title: "合成开庭", date: "11月17日", weekday: "周二", time: "09:00",
  matter: "开庭所属案件", matterId: "hearing-matter", matterCode: "LL-TEST-0002", clientName: null, daysUntil: 1
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.hero.mockResolvedValue(hero);
  mock.schedule.mockResolvedValue([]);
  mock.queue.mockResolvedValue({ approvals: [], tasks: [], approvalTotal: 0 });
});
afterEach(cleanup);

// 仅检查异步取数完成后的页面组合；不替代 Next Server Component 或浏览器验收。
describe("首页期限焦点组合", () => {
  it("未知审批时间仍计入待办总数，但不计入超时紧急数量", async () => {
    mock.queue.mockResolvedValue({ approvals: [{ waitDays: null }, { waitDays: 2 }], tasks: [], approvalTotal: 2 });
    render(await DashboardPage());
    expect(screen.getByText("待我审批 · 1 件等待超 2 天")).toBeVisible();
    expect(screen.queryByText("待我审批 · 2 件等待超 2 天")).not.toBeInTheDocument();
  });
  it("日程预览只有开庭时，仍使用独立期限的内容和案件链接", async () => {
    mock.schedule.mockResolvedValue([hearing]);
    mock.hero.mockResolvedValue({ ...hero, focus });
    render(await DashboardPage());
    const card = screen.getByRole("link", { name: /今日焦点/ });
    expect(card).toHaveAttribute("href", focus.href);
    expect(within(card).getByText(focus.title)).toBeVisible();
    expect(within(card).getByText("20")).toBeVisible();
    expect(within(card).queryByText(hearing.title)).not.toBeInTheDocument();
  });

  it("只有开庭而没有期限时显示期限空态，仍能进入日程", async () => {
    mock.schedule.mockResolvedValue([hearing]);
    render(await DashboardPage());
    const card = screen.getByRole("link", { name: /今日焦点/ });
    expect(card).toHaveAttribute("href", "/schedule");
    expect(within(card).getByText("暂无未完成期限")).toBeVisible();
    expect(within(card).queryByText(/未来 30 天/)).not.toBeInTheDocument();
    expect(within(card).queryByText(hearing.title)).not.toBeInTheDocument();
    expect(screen.getByText("开庭 · 合成开庭")).toBeVisible();
  });

  it.each([[-1, "天 · 已逾期"], [0, "天 · 今天到期"]])("期限剩余 %s 天时显示对应状态", async (daysLeft, label) => {
    mock.hero.mockResolvedValue({ ...hero, focus: { ...focus, daysLeft, overdue: Number(daysLeft) < 0 } });
    render(await DashboardPage());
    expect(within(screen.getByRole("link", { name: /今日焦点/ })).getByText(label)).toBeVisible();
  });
  it("当天已过的准确午夜明确显示逾期而非零天尚未到期", async () => {
    mock.hero.mockResolvedValue({ ...hero, focus: { ...focus, dueAt: new Date("2026-11-16T00:00:00+08:00"), duePrecision: "DATETIME", daysLeft: 0, overdue: true } });
    render(await DashboardPage());
    const card = screen.getByRole("link", { name: /今日焦点/ });
    expect(within(card).getByText("已逾期")).toBeVisible();
    expect(card).toHaveTextContent("2026-11-16 00:00");
    expect(card).not.toHaveTextContent("今天到期");
  });

});
