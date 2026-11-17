// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, session, closedHearingIds, customMatterFilter } = vi.hoisted(() => ({
  db: {
    deadline: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    hearing: { findMany: vi.fn(), count: vi.fn() },
    sealRequest: { count: vi.fn() }
  },
  session: { user: { id: "dashboard-reviewer", role: "LAWYER" } },
  closedHearingIds: vi.fn(),
  customMatterFilter: vi.fn(() => ({ members: { some: { userId: "dashboard-reviewer" } } }))
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => session }));
vi.mock("@/lib/permissions", () => ({
  matterReadVisibilityFilter: () => ({ ownerId: "dashboard-reviewer" }),
  customMatterFilter,
  matterFinanceVisibilityFilter: vi.fn(),
  intakeReadVisibilityFilter: vi.fn()
}));
vi.mock("@/server/reminders/responsibility", () => ({ closedHearingIds }));
vi.mock("@/server/finance/facts", () => ({
  getFinanceFacts: vi.fn(), periodReceipts: vi.fn(), sumAmounts: vi.fn(), shMonthStart: vi.fn(), financeTrend: vi.fn()
}));

import { getDashboardHeroData, getDashboardSchedule } from "@/server/dashboard/actions";

const todayStart = new Date("2026-11-16T00:00:00+08:00");
const procedure = {
  type: "FIRST_INSTANCE",
  customLabel: null,
  matter: {
    id: "dashboard-matter", internalCode: "LL-TEST-0001", title: "合成期限案件",
    primaryClient: null, clientLinks: []
  }
};
const deadline = (dueAt: string) => ({ id: "deadline-1", title: "合成提交期限", dueAt: new Date(dueAt), duePrecision: null, procedure });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T10:00:00+08:00"));
  session.user.role = "LAWYER";
  db.deadline.findMany.mockResolvedValue([]);
  db.deadline.findFirst.mockResolvedValue(null);
  db.deadline.count.mockResolvedValue(0);
  db.hearing.findMany.mockResolvedValue([]);
  db.hearing.count.mockResolvedValue(0);
  db.sealRequest.count.mockResolvedValue(0);
  closedHearingIds.mockResolvedValue(["closed-hearing"]);
});

afterEach(() => { vi.useRealTimers(); });

describe("首页期限查询", () => {
  it("近期日程查询上海今日起完整30个日历日，覆盖第20天的期限", async () => {
    db.deadline.findMany.mockResolvedValue([deadline("2026-12-06T00:00:00+08:00")]);
    const items = await getDashboardSchedule();
    const range = { gte: todayStart, lt: new Date("2026-12-16T00:00:00+08:00") };
    expect(db.deadline.findMany.mock.calls[0][0].where).toMatchObject({ dueAt: range, completed: false });
    expect(db.hearing.findMany.mock.calls[0][0].where).toMatchObject({ startsAt: range, id: { notIn: ["closed-hearing"] } });
    expect(items).toMatchObject([{ id: "d-deadline-1", type: "deadline", daysUntil: 20 }]);
  });

  it("12场较早开庭占满预览时，独立焦点仍返回其后的未完成期限", async () => {
    db.hearing.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      id: `hearing-${index}`, title: "合成开庭", startsAt: new Date("2026-11-17T09:00:00+08:00"), procedure
    })));
    const due = deadline("2026-12-06T00:00:00+08:00");
    db.deadline.findMany.mockResolvedValue([due]);
    db.deadline.findFirst.mockResolvedValue(due);
    const [preview, hero] = await Promise.all([getDashboardSchedule(), getDashboardHeroData()]);
    expect(preview).toHaveLength(12);
    expect(preview.every(item => item.type === "hearing")).toBe(true);
    expect(hero.focus).toMatchObject({ title: due.title, daysLeft: 20, href: "/matters/LL-TEST-0001", procedure: "一审" });
    const query = db.deadline.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({
      completed: false,
      procedure: { engagement: "ENGAGED", matter: { deletedAt: null, ownerId: "dashboard-reviewer" } }
    });
    expect(query.orderBy).toEqual({ dueAt: "asc" });
  });

  it.each([
    ["2026-11-15T23:59:59+08:00", -1],
    ["2026-11-16T00:00:00+08:00", 0]
  ])("焦点和逾期计数按上海日期区分 %s", async (dueAt, daysLeft) => {
    db.deadline.findFirst.mockResolvedValue(deadline(dueAt));
    const hero = await getDashboardHeroData();
    expect(hero.focus).toMatchObject({ daysLeft });
    const ranges = db.deadline.count.mock.calls.slice(0, 2).map(([query]) => query.where.dueAt);
    expect(db.deadline.count.mock.calls[2][0].where.OR).toEqual([
      { duePrecision: "DATETIME", dueAt: { lt: new Date() } },
      { duePrecision: "DATE", dueAt: { lt: todayStart } },
      { duePrecision: null, dueAt: { lt: todayStart } },
    ]);
    expect(ranges).toEqual([
      { gte: todayStart, lt: new Date("2026-11-17T00:00:00+08:00") },
      { gte: todayStart, lt: new Date("2026-11-23T00:00:00+08:00") }
    ]);
  });

  it.each(["DATE", "DATETIME", null] as const)("当天午夜焦点与预览按 %s 真精度判断", async duePrecision => {
    const row = { ...deadline("2026-11-16T00:00:00+08:00"), duePrecision };
    db.deadline.findFirst.mockResolvedValue(row); db.deadline.findMany.mockResolvedValue([row]);
    const hero = await getDashboardHeroData(), preview = await getDashboardSchedule();
    expect(hero.focus).toMatchObject({ duePrecision, daysLeft: 0, overdue: duePrecision === "DATETIME" });
    expect(preview[0]).toMatchObject({ duePrecision, overdue: duePrecision === "DATETIME" });
    expect(preview[0].time).toBe(duePrecision === "DATETIME" ? "00:00" : undefined);
  });

  it("没有未完成期限时焦点为空，不取开庭代替", async () => {
    db.hearing.count.mockResolvedValue(1);
    expect((await getDashboardHeroData()).focus).toBeNull();
    expect(db.hearing.findMany).not.toHaveBeenCalled();
  });

  it("自定义角色的焦点、预览和期限计数保留相同可见性限制", async () => {
    session.user.role = "CUSTOM";
    await Promise.all([getDashboardSchedule(), getDashboardHeroData()]);
    const matter = {
      deletedAt: null, ownerId: "dashboard-reviewer",
      AND: [{ ownerId: "dashboard-reviewer" }, { members: { some: { userId: "dashboard-reviewer" } } }]
    };
    const queries = [
      db.deadline.findFirst.mock.calls[0][0], db.deadline.findMany.mock.calls[0][0], db.hearing.findMany.mock.calls[0][0],
      ...db.deadline.count.mock.calls.map(([query]) => query)
    ];
    for (const query of queries) expect(query.where.procedure).toEqual({ engagement: "ENGAGED", matter });
    expect(customMatterFilter).toHaveBeenCalledWith(session.user.id, undefined, "schedule.read", true);
  });
});
