/**
 * 放假安排只参与既有期限建议，不改写人工填写或已经确认的日期。
 * 查询失败必须中止本次规则核对；未录入年度安排与已录入年度内无特殊安排分开。
 */
import dayjs from "dayjs";
import type { Prisma } from "@prisma/client";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { SH_TZ, shDayKey } from "@/lib/ui/sh-time";

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = "YYYY-MM-DD";
const SEARCH_DAYS = 30;
const CALENDAR_UNAVAILABLE = "放假安排暂时无法读取，本次未完成期限核对，请稍后重试；也可核对后人工录入期限";

export type HolidayMap = Map<string, { name: string; kind: "HOLIDAY" | "WORKDAY" }>;

/** 日期键的运算使用 UTC 载体，不把宿主机器的时区或夏令时带入业务日。 */
function calendarDay(key: string) {
  const date = dayjs.utc(`${key}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < "0001-01-01" || !date.isValid() || date.format(DATE_FORMAT) !== key) {
    throw new ActionError("放假安排日期无效，请填写有效的 YYYY-MM-DD 日期");
  }
  return date;
}

/** 新放假安排固定存为上海正午；DateTime 的日期归属与界面的上海日期一致。 */
export function holidayDateForKey(key: string): Date {
  calendarDay(key);
  return dayjs.tz(`${key}T12:00:00`, SH_TZ).toDate();
}

/** 按完整的上海业务日查询，不要求历史记录恰好存于某个正午时刻。 */
export function holidayDateRange(fromKey: string, toKey: string): { gte: Date; lte: Date } {
  calendarDay(fromKey);
  calendarDay(toKey);
  if (fromKey > toKey) throw new ActionError("放假安排的结束日期不得早于开始日期");
  return {
    gte: dayjs.tz(`${fromKey}T00:00:00`, SH_TZ).toDate(),
    lte: dayjs.tz(`${toKey}T23:59:59.999`, SH_TZ).toDate()
  };
}

/** 成功查询可以返回空表；数据库不可用不能被当作空配置。 */
export async function loadHolidayMap(fromKey: string, toKey: string, db: Pick<Prisma.TransactionClient, "holiday"> = prisma): Promise<HolidayMap> {
  const date = holidayDateRange(fromKey, toKey);
  let rows;
  try {
    rows = await db.holiday.findMany({
      where: { date },
      select: { date: true, name: true, kind: true }
    });
  } catch {
    throw new ActionError(CALENDAR_UNAVAILABLE);
  }
  const map: HolidayMap = new Map();
  for (const row of rows) {
    const key = shDayKey(row.date);
    if (map.has(key)) throw new ActionError(`${key} 有重复的放假安排，请管理员核对后重试`);
    if (row.kind !== "HOLIDAY" && row.kind !== "WORKDAY") {
      throw new ActionError(`${key} 的放假安排类型无效，请管理员核对后重试`);
    }
    map.set(key, { name: row.name, kind: row.kind });
  }
  return map;
}

/** false 只表示成功读取后无记录，不表示数据库或表不可用。 */
export async function hasHolidayConfig(): Promise<boolean> {
  try {
    return (await prisma.holiday.count({ take: 1 })) > 0;
  } catch {
    throw new ActionError(CALENDAR_UNAVAILABLE);
  }
}

/** 调休上班优先于周末；30 个候选日内无工作日就明确报错，不返回原休假日。 */
export function nextWorkdayKey(key: string, map: HolidayMap): string {
  let current = calendarDay(key);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const currentKey = current.format(DATE_FORMAT);
    const entry = map.get(currentKey);
    const weekend = current.day() === 0 || current.day() === 6;
    if (!(entry ? entry.kind === "HOLIDAY" : weekend)) return currentKey;
    current = current.add(1, "day");
  }
  throw new ActionError("连续 30 日未找到可用工作日，请管理员核对放假安排后重试");
}

export type AdjustedDeadline =
  | { status: "UNCONFIGURED"; missingYears: number[] }
  | { status: "AVAILABLE"; key: string; adjusted: boolean; fromKey?: string; reason?: string };

/**
 * 只核当前所需年份是否已有录入，不据此声称该年安排完整。
 * 无该年记录不给出顺延结果；读取故障抛错。调用方始终保留人工提交的 dueAt。
 */
export async function adjustDeadlineForHolidays(dueKey: string, db: Pick<Prisma.TransactionClient, "holiday"> = prisma): Promise<AdjustedDeadline> {
  const start = calendarDay(dueKey);
  const end = start.add(SEARCH_DAYS - 1, "day");
  // 读取搜索窗口所跨的完整年份，既覆盖全部候选日，也能区分窗口无安排与年度未录入。
  const map = await loadHolidayMap(`${start.format("YYYY")}-01-01`, `${end.format("YYYY")}-12-31`, db);
  const configuredYears = new Set([...map.keys()].map(key => Number(key.slice(0, 4))));
  if (!configuredYears.has(start.year())) return { status: "UNCONFIGURED", missingYears: [start.year()] };

  const adjustedKey = nextWorkdayKey(dueKey, map);
  const adjustedYear = Number(adjustedKey.slice(0, 4));
  if (!configuredYears.has(adjustedYear)) return { status: "UNCONFIGURED", missingYears: [adjustedYear] };
  if (adjustedKey === dueKey) return { status: "AVAILABLE", key: dueKey, adjusted: false };
  const hit = map.get(dueKey);
  return {
    status: "AVAILABLE",
    key: adjustedKey,
    adjusted: true,
    fromKey: dueKey,
    reason: hit ? `${hit.name}（法定休假日）顺延` : "届满日为周末/休假日顺延"
  };
}
