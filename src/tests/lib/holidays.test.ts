// @vitest-environment node
/** Holiday suggestions distinguish empty configuration, explicit workdays and failed reads. */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({ db: { holiday: { findMany: vi.fn(), count: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { nextWorkdayKey, adjustDeadlineForHolidays, loadHolidayMap, hasHolidayConfig, type HolidayMap } from "@/lib/calendar/holidays";
import { shDateFromKey } from "@/lib/ui/sh-time";

const mk = (entries: Record<string, "HOLIDAY" | "WORKDAY">): HolidayMap => {
  const m: HolidayMap = new Map();
  for (const [k, kind] of Object.entries(entries)) m.set(k, { name: "测试假日", kind });
  return m;
};

describe("nextWorkdayKey（纯日历逻辑）", () => {
  it("工作日不顺延", () => {
    // 2026-07-01 是周三
    expect(nextWorkdayKey("2026-07-01", mk({}))).toBe("2026-07-01");
  });
  it("普通周末顺延到周一", () => {
    // 2026-07-04 周六 → 07-06 周一
    expect(nextWorkdayKey("2026-07-04", mk({}))).toBe("2026-07-06");
    // 2026-07-05 周日 → 07-06
    expect(nextWorkdayKey("2026-07-05", mk({}))).toBe("2026-07-06");
  });
  it("放假日顺延；跨放假日连休顺延到首个非休假日", () => {
    // 10-01（周四）起放假三天，10-02/03 也是放假日 → 顺延到 10-04（周日）？→ 周日也休 → 10-05 周一
    expect(nextWorkdayKey("2026-10-01", mk({ "2026-10-01": "HOLIDAY", "2026-10-02": "HOLIDAY", "2026-10-03": "HOLIDAY" }))).toBe("2026-10-05");
  });
  it("调休上班日（WORKDAY）不视为休假日——周末上班可作届满日", () => {
    // 2026-09-26 周六，国务院安排调休上班
    expect(nextWorkdayKey("2026-09-26", mk({ "2026-09-26": "WORKDAY" }))).toBe("2026-09-26");
  });
});

describe("adjustDeadlineForHolidays（配置与读取失败分开）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("已配置：届满日在放假日 → 顺延并给出原因", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: shDateFromKey("2026-10-01"), name: "国庆节", kind: "HOLIDAY" }
    ]);
    const r = await adjustDeadlineForHolidays("2026-10-01");
    expect(r.adjusted).toBe(true);
    expect(r.key).toBe("2026-10-02"); // 仅 10-01 放假：10-02（周五）为下一工作日
  });

  it("未命中安排的工作日：原样返回", async () => {
    db.holiday.findMany.mockResolvedValue([]);
    const r = await adjustDeadlineForHolidays("2026-07-01");
    expect(r).toEqual({ key: "2026-07-01", adjusted: false, calendarConfigured: false });
  });

  it("表缺失或连接故障不能被视为未配置", async () => {
    db.holiday.findMany.mockRejectedValue(new Error("synthetic database failure"));
    db.holiday.count.mockRejectedValue(new Error("synthetic database failure"));
    await expect(adjustDeadlineForHolidays("2026-10-01")).rejects.toThrow("放假安排读取失败");
    await expect(hasHolidayConfig()).rejects.toThrow("放假安排读取失败");
  });
  it("扫描与加载使用相同的 30 日窗口，超过可判断范围明确拒绝", async () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({ date: new Date(shDateFromKey("2026-10-01").getTime() + index * 86_400_000), name: "合成长假", kind: "HOLIDAY" }));
    db.holiday.findMany.mockResolvedValue(entries);
    expect((await adjustDeadlineForHolidays("2026-10-01")).key).toBe("2026-10-21");
    expect(db.holiday.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { date: { gte: shDateFromKey("2026-10-01"), lt: shDateFromKey("2026-11-01") } } }));
    const allRest = mk(Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`2026-10-${String(index + 1).padStart(2, "0")}`, "HOLIDAY"])));
    expect(() => nextWorkdayKey("2026-10-01", allRest)).toThrow("超过 30 日");
  });
});

describe("loadHolidayMap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("读出的安排按上海日历日键入表", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: shDateFromKey("2026-10-01"), name: "国庆节", kind: "HOLIDAY" },
      { date: shDateFromKey("2026-09-26"), name: "上班", kind: "WORKDAY" }
    ]);
    const m = await loadHolidayMap("2026-09-01", "2026-12-31");
    expect(m.get("2026-10-01")).toEqual({ name: "国庆节", kind: "HOLIDAY" });
    expect(m.get("2026-09-26")?.kind).toBe("WORKDAY");
  });
});
