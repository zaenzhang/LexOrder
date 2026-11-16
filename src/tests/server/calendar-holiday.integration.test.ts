// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("日历集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), requireWorkspaceConfiguration: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { listHolidays, saveHolidayBatch } from "@/server/calendar/holiday-actions";
import { adjustDeadlineForHolidays, holidayDateRange } from "@/lib/calendar/holidays";
import { shDayKey } from "@/lib/ui/sh-time";

const tag = `cal-${randomUUID().slice(0, 8)}`;
const userIds: string[] = [];

describe.skipIf(!databaseUrl)("W11 日历：真实 PostgreSQL 上海日期存取", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    await db.holiday.deleteMany({ where: { name: { startsWith: tag } } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("同上海日的已有时间戳更新不增行，新记录固定上海正午，列表和顺延一致", async () => {
    const user = await db.user.create({ data: { name: "合成日历管理员", email: `${randomUUID()}@example.invalid`,
      passwordHash: "disabled-test-only", role: "LAWYER", systemRole: "SUPER_ADMIN" } });
    userIds.push(user.id);
    vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, systemRole: user.systemRole }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
    const originalDate = new Date("2499-07-01T12:00:00.000Z");
    const original = await db.holiday.create({ data: { date: originalDate, name: `${tag}-原安排`, kind: "HOLIDAY" } });
    await saveHolidayBatch({ entries: [
      { date: "2499-07-01", name: `${tag}-放假`, kind: "HOLIDAY" },
      { date: "2499-07-02", name: `${tag}-上班`, kind: "WORKDAY" }
    ] });
    const updated = await db.holiday.findUniqueOrThrow({ where: { id: original.id } });
    expect(updated).toMatchObject({ date: originalDate, name: `${tag}-放假` });
    expect(await db.holiday.count({ where: { date: holidayDateRange("2499-07-01", "2499-07-01") } })).toBe(1);
    const added = await db.holiday.findUniqueOrThrow({ where: { date: new Date("2499-07-02T04:00:00.000Z") } });
    expect(added.kind).toBe("WORKDAY");
    const listed = (await listHolidays(2499)).rows.filter(row => row.name.startsWith(tag));
    expect(listed.map(row => shDayKey(row.date))).toEqual(["2499-07-01", "2499-07-02"]);
    expect(await adjustDeadlineForHolidays("2499-07-01")).toMatchObject({ status: "AVAILABLE", key: "2499-07-02", adjusted: true });
  }, 30_000);
});
