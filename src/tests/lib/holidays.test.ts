// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { holiday: { findMany: vi.fn(), count: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { ActionError } from "@/lib/action-error";
import {
  nextWorkdayKey, adjustDeadlineForHolidays, loadHolidayMap, hasHolidayConfig,
  holidayDateForKey, holidayDateRange, type HolidayMap
} from "@/lib/calendar/holidays";

const mk = (entries: Record<string, "HOLIDAY" | "WORKDAY">): HolidayMap =>
  new Map(Object.entries(entries).map(([key, kind]) => [key, { name: "测试假日", kind }]));
const row = (key: string, kind: "HOLIDAY" | "WORKDAY" = "HOLIDAY") => ({
  date: new Date(`${key}T12:00:00+08:00`), name: "测试假日", kind
});

beforeEach(() => vi.resetAllMocks());

describe("nextWorkdayKey", () => {
  it("工作日不顺延，普通周末顺延到周一", () => {
    expect(nextWorkdayKey("2026-07-01", mk({}))).toBe("2026-07-01");
    expect(nextWorkdayKey("2026-07-04", mk({}))).toBe("2026-07-06");
    expect(nextWorkdayKey("2026-07-05", mk({}))).toBe("2026-07-06");
  });

  it("连续放假后取首个非休假日，调休上班优先于周末", () => {
    expect(nextWorkdayKey("2026-10-01", mk({
      "2026-10-01": "HOLIDAY", "2026-10-02": "HOLIDAY", "2026-10-03": "HOLIDAY"
    }))).toBe("2026-10-05");
    expect(nextWorkdayKey("2026-09-26", mk({ "2026-09-26": "WORKDAY" }))).toBe("2026-09-26");
  });

  it("宿主夏令时切换不影响业务日顺延", () => {
    expect(nextWorkdayKey("2026-03-07", mk({}))).toBe("2026-03-09");
    expect(nextWorkdayKey("2026-10-31", mk({}))).toBe("2026-11-02");
  });

  it("检查第 30 个候选日；全部休假时明确失败，不回原日", () => {
    const map = mk(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
      `2026-07-${String(i + 1).padStart(2, "0")}`, "HOLIDAY"
    ])));
    expect(() => nextWorkdayKey("2026-07-01", map)).toThrow("连续 30 日未找到可用工作日");
    map.set("2026-07-30", { name: "调休", kind: "WORKDAY" });
    expect(nextWorkdayKey("2026-07-01", map)).toBe("2026-07-30");
  });

  it.each(["2026-02-30", "2026-13-01", "2026-2-01", "not-a-date"])("拒绝无效日期 %s", key => {
    expect(() => nextWorkdayKey(key, mk({}))).toThrow(ActionError);
  });
});

describe("日历读取与上海存取日期", () => {
  it("新日期固定上海正午，查询覆盖完整上海业务日", () => {
    expect(holidayDateForKey("2026-07-01").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(holidayDateRange("2026-07-01", "2026-07-01")).toEqual({
      gte: new Date("2026-06-30T16:00:00.000Z"),
      lte: new Date("2026-07-01T15:59:59.999Z")
    });
  });

  it("读出的瞬时值按界面同一上海日期归属，和宿主时区无关", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: new Date("2026-09-30T20:00:00Z"), name: "国庆节", kind: "HOLIDAY" },
      { date: new Date("2026-09-26T12:00:00Z"), name: "上班", kind: "WORKDAY" }
    ]);
    const map = await loadHolidayMap("2026-09-01", "2026-12-31");
    expect(map.get("2026-10-01")).toEqual({ name: "国庆节", kind: "HOLIDAY" });
    expect(map.get("2026-09-26")?.kind).toBe("WORKDAY");
  });

  it("成功读取空表是有效空结果", async () => {
    db.holiday.findMany.mockResolvedValue([]);
    expect(await loadHolidayMap("2026-07-01", "2026-07-31")).toEqual(new Map());
    db.holiday.count.mockResolvedValue(0);
    expect(await hasHolidayConfig()).toBe(false);
    db.holiday.count.mockResolvedValue(1);
    expect(await hasHolidayConfig()).toBe(true);
  });

  it.each([{ code: "P2021" }, new Error("database unavailable")])("读取失败不能变成空表或未配置", async error => {
    db.holiday.findMany.mockRejectedValue(error);
    db.holiday.count.mockRejectedValue(error);
    await expect(loadHolidayMap("2026-07-01", "2026-07-31")).rejects.toThrow("暂时无法读取");
    await expect(hasHolidayConfig()).rejects.toThrow("暂时无法读取");
    await expect(adjustDeadlineForHolidays("2026-07-04")).rejects.toThrow(ActionError);
  });

  it("同一上海日的两条安排不能被静默覆盖", async () => {
    db.holiday.findMany.mockResolvedValue([
      row("2026-07-01"),
      { ...row("2026-07-01", "WORKDAY"), date: new Date("2026-07-01T12:00:00Z") }
    ]);
    await expect(loadHolidayMap("2026-07-01", "2026-07-31")).rejects.toThrow("有重复的放假安排");
  });

  it("未知安排类型不能被强行视作休假", async () => {
    db.holiday.findMany.mockResolvedValue([{ ...row("2026-07-01"), kind: "UNKNOWN" }]);
    await expect(loadHolidayMap("2026-07-01", "2026-07-31")).rejects.toThrow("类型无效");
  });
});

describe("adjustDeadlineForHolidays", () => {
  it("该年有录入但窗口内无特别安排，可核对普通工作日和周末", async () => {
    db.holiday.findMany.mockResolvedValue([row("2026-01-01")]);
    expect(await adjustDeadlineForHolidays("2026-07-01")).toEqual({ status: "AVAILABLE", key: "2026-07-01", adjusted: false });
    expect(await adjustDeadlineForHolidays("2026-07-04")).toMatchObject({ status: "AVAILABLE", key: "2026-07-06", adjusted: true });
  });

  it("年度未录入时不产出顺延日期，不能把普通周末计算当成已核对", async () => {
    db.holiday.findMany.mockResolvedValue([]);
    expect(await adjustDeadlineForHolidays("2026-07-04")).toEqual({ status: "UNCONFIGURED", missingYears: [2026] });
  });

  it("已录入放假日顺延并给出原因", async () => {
    db.holiday.findMany.mockResolvedValue([row("2026-10-01")]);
    expect(await adjustDeadlineForHolidays("2026-10-01")).toEqual({
      status: "AVAILABLE", key: "2026-10-02", adjusted: true, fromKey: "2026-10-01", reason: "测试假日（法定休假日）顺延"
    });
  });

  it("数据库读取覆盖全部 30 个候选日，不在第 15 天之后漏读安排", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`2026-07-${String(i + 1).padStart(2, "0")}`));
    db.holiday.findMany.mockImplementation(async ({ where: { date } }) =>
      rows.filter(row => row.date >= date.gte && row.date <= date.lte));
    expect(await adjustDeadlineForHolidays("2026-07-01")).toMatchObject({ status: "AVAILABLE", key: "2026-07-21", adjusted: true });
  });

  it("顺延实际跨年需要下一年度已有录入，未跨年不误报缺配置", async () => {
    db.holiday.findMany.mockResolvedValue([row("2026-12-31")]);
    expect(await adjustDeadlineForHolidays("2026-12-20")).toMatchObject({ status: "AVAILABLE", key: "2026-12-21" });
    expect(await adjustDeadlineForHolidays("2026-12-31")).toEqual({ status: "UNCONFIGURED", missingYears: [2027] });
    db.holiday.findMany.mockResolvedValue([row("2026-12-31"), row("2027-01-01"), row("2027-01-02", "WORKDAY")]);
    expect(await adjustDeadlineForHolidays("2026-12-31")).toMatchObject({ status: "AVAILABLE", key: "2027-01-02" });
  });
});
