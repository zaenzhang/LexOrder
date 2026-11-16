/** Existing holiday suggestions: explicit Shanghai dates, no silent recovery from database failure. */
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { shDateFromKey, shDayKey } from "@/lib/ui/sh-time";

export type HolidayMap = Map<string, { name: string; kind: "HOLIDAY" | "WORKDAY" }>;
const MAX_ROLL_DAYS = 30;

export async function loadHolidayMap(fromKey: string, toKey: string): Promise<HolidayMap> {
  const from = shDateFromKey(fromKey), until = new Date(shDateFromKey(toKey).getTime() + 86_400_000);
  let rows;
  try {
    rows = await prisma.holiday.findMany({ where: { date: { gte: from, lt: until } }, select: { date: true, name: true, kind: true } });
  } catch { throw new ActionError("放假安排读取失败，尚未计算建议日期；请重试或改为人工登记期限并注明依据"); }
  const map: HolidayMap = new Map();
  for (const row of rows) {
    const key = shDayKey(row.date);
    if (row.kind !== "HOLIDAY" && row.kind !== "WORKDAY") throw new ActionError("放假安排包含无效类型，请先核对日历配置");
    if (map.has(key)) throw new ActionError("同一天存在重复放假安排，请先核对日历配置");
    map.set(key, { name: row.name, kind: row.kind });
  }
  return map;
}

export async function hasHolidayConfig(): Promise<boolean> {
  try { return (await prisma.holiday.count({ take: 1 })) > 0; }
  catch { throw new ActionError("放假安排读取失败，请重试"); }
}

export function nextWorkdayKey(key: string, map: HolidayMap): string {
  const start = shDateFromKey(key);
  for (let index = 0; index <= MAX_ROLL_DAYS; index++) {
    const day = shDayKey(new Date(start.getTime() + index * 86_400_000));
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const entry = map.get(day), rest = entry ? entry.kind === "HOLIDAY" : weekday === 0 || weekday === 6;
    if (!rest) return day;
  }
  throw new ActionError("连续休假安排超过 30 日，无法给出建议日期，请人工核对");
}

export type AdjustedDeadline = { key: string; adjusted: boolean; fromKey?: string; reason?: string; calendarConfigured: boolean };
export async function adjustDeadlineForHolidays(dueKey: string): Promise<AdjustedDeadline> {
  const due = shDateFromKey(dueKey);
  // Load the whole scan window. An empty window is distinct from a failed read.
  const map = await loadHolidayMap(dueKey, shDayKey(new Date(due.getTime() + MAX_ROLL_DAYS * 86_400_000)));
  const adjustedKey = nextWorkdayKey(dueKey, map), calendarConfigured = map.size > 0;
  if (adjustedKey === dueKey) return { key: dueKey, adjusted: false, calendarConfigured };
  const hit = map.get(dueKey);
  return { key: adjustedKey, adjusted: true, fromKey: dueKey, calendarConfigured,
    reason: hit ? `${hit.name}（法定休假日）顺延` : "届满日为周末/休假日顺延" };
}
