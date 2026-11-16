// @vitest-environment node
/** Shanghai calendar arithmetic: fixtures are actual instants, independent of process TZ. */
import { describe, expect, it } from "vitest";
import type { DeadlinePeriodUnit } from "@prisma/client";
import { shDateFromKey, shDayKey } from "@/lib/ui/sh-time";
import {
  computeDeadlineDate,
  periodLabel,
  buildDeadlineBasis,
  HOLIDAY_NOTE
} from "@/lib/deadline-rules";

const d = (key: string) => shDateFromKey(key);
const keyOf = (date: Date) => shDayKey(date);

describe("computeDeadlineDate", () => {
  it("按日期限：开始之日不计入，到期日＝触发日＋N 日（民诉法第八十五条）", () => {
    expect(keyOf(computeDeadlineDate(d("2026-07-01"), 15, "DAYS"))).toBe("2026-07-16");
    expect(keyOf(computeDeadlineDate(d("2026-07-01"), 10, "DAYS"))).toBe("2026-07-11");
    // 跨月
    expect(keyOf(computeDeadlineDate(d("2026-01-25"), 15, "DAYS"))).toBe("2026-02-09");
  });
  it("按月/年：到期月对应日；无对应日取月末（月末钳制）", () => {
    expect(keyOf(computeDeadlineDate(d("2026-01-15"), 6, "MONTHS"))).toBe("2026-07-15");
    expect(keyOf(computeDeadlineDate(d("2026-03-10"), 3, "MONTHS"))).toBe("2026-06-10");
    expect(keyOf(computeDeadlineDate(d("2026-01-31"), 1, "MONTHS"))).toBe("2026-02-28");
    expect(keyOf(computeDeadlineDate(d("2028-01-31"), 1, "MONTHS"))).toBe("2028-02-29");
    expect(keyOf(computeDeadlineDate(d("2026-08-31"), 6, "MONTHS"))).toBe("2027-02-28");
    expect(keyOf(computeDeadlineDate(d("2026-07-04"), 2, "YEARS"))).toBe("2028-07-04");
    // 闰日到期年非闰 → 取 2 月末（二十年最长保护期一类场景）
    expect(keyOf(computeDeadlineDate(d("2028-02-29"), 1, "YEARS"))).toBe("2029-02-28");
  });
  it("同一上海日的实际时刻得到同一到期日", () => {
    const withTime = new Date(shDateFromKey("2026-07-01").getTime() + 5 * 3_600_000);
    expect(keyOf(computeDeadlineDate(withTime, 15, "DAYS"))).toBe("2026-07-16");
  });
  it("容器与浏览器处于不同宿主时区时不改上海日历结果", () => {
    const old = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        expect(keyOf(computeDeadlineDate(new Date("2026-07-01T16:10:00Z"), 15, "DAYS"))).toBe("2026-07-17");
        expect(computeDeadlineDate(d("2026-01-31"), 1, "MONTHS").toISOString()).toBe("2026-02-27T16:00:00.000Z");
      }
    } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
  });
  it("非正整数期限拒绝", () => {
    const invalid: Array<[number, DeadlinePeriodUnit]> = [[0, "DAYS"], [-5, "DAYS"], [1.5, "DAYS"]];
    for (const [v, unit] of invalid) {
      expect(() => computeDeadlineDate(d("2026-07-01"), v, unit)).toThrow();
    }
  });
  it("P2-4 新增规则口径抽查：三年时效与二十年保护期", () => {
    expect(keyOf(computeDeadlineDate(d("2024-03-15"), 3, "YEARS"))).toBe("2027-03-15");
    expect(keyOf(computeDeadlineDate(d("2006-09-21"), 20, "YEARS"))).toBe("2026-09-21");
  });
});

describe("periodLabel / buildDeadlineBasis", () => {
  it("标签与依据文本（含顺延提示）", () => {
    expect(periodLabel(15, "DAYS")).toBe("15 日");
    expect(periodLabel(6, "MONTHS")).toBe("6 个月");
    expect(periodLabel(3, "YEARS")).toBe("3 年");
    const basis = buildDeadlineBasis({
      legalBasis: "《民事诉讼法》第八十五条",
      triggerLabel: "判决书送达之日",
      triggerDate: d("2026-07-01"),
      periodValue: 15,
      periodUnit: "DAYS"
    });
    expect(basis).toContain("《民事诉讼法》第八十五条");
    expect(basis).toContain("2026-07-01");
    expect(basis).toContain(HOLIDAY_NOTE);
  });
});
