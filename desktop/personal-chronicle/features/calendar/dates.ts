import { DATA_NOW } from "@/lib/clock"

/**
 * Calendar dates are plain "YYYY-MM-DD" keys computed in UTC, so the month
 * grid and every event land on the same day in every time zone.
 */

const DAY = 24 * 3600 * 1000

export function toKey(date: Date): string {
  return date.toISOString().split("T")[0]
}

export function fromKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

export function addDays(key: string, days: number): string {
  return toKey(new Date(fromKey(key).getTime() + days * DAY))
}

export function isCivilDay(key: unknown): key is string {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key < "0001-01-01") return false
  const date = fromKey(key)
  return Number.isFinite(date.getTime()) && toKey(date) === key
}

export function beijingDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

/** The demo's today: Tuesday 20 October 2026. */
export const TODAY = toKey(DATA_NOW)

export interface MonthCursor {
  year: number
  /** 0 to 11. */
  month: number
}

export function monthOf(key: string): MonthCursor {
  const date = fromKey(key)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

export function shiftMonth(cursor: MonthCursor, by: number): MonthCursor {
  const index = cursor.year * 12 + cursor.month + by
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 }
}

export function inMonth(key: string, cursor: MonthCursor): boolean {
  const { year, month } = monthOf(key)
  return year === cursor.year && month === cursor.month
}

function firstOfMonth(cursor: MonthCursor): Date {
  const date = new Date(0)
  date.setUTCFullYear(cursor.year, cursor.month, 1)
  return date
}

/** The same day in another month, clamped to that month's last day. */
export function offsetMonthDay(key: string, offset: number): string {
  const target = shiftMonth(monthOf(key), offset)
  const first = firstOfMonth(target)
  const next = new Date(first)
  next.setUTCMonth(first.getUTCMonth() + 1)
  const lastDay = fromKey(addDays(toKey(next), -1)).getUTCDate()
  return addDays(toKey(first), Math.min(dayOfMonth(key), lastDay) - 1)
}

/** Six weeks of keys, Monday first, covering the month. */
export function monthGrid(cursor: MonthCursor): string[] {
  const first = firstOfMonth(cursor)
  const offset = (first.getUTCDay() + 6) % 7
  const start = addDays(toKey(first), -offset)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
const dayTitle = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
const dayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })

export function formatMonth(cursor: MonthCursor): string {
  return monthTitle.format(firstOfMonth(cursor))
}

export function formatDay(key: string): string {
  return dayTitle.format(fromKey(key))
}

export function formatDayShort(key: string): string {
  return dayShort.format(fromKey(key))
}

export function dayOfMonth(key: string): number {
  return fromKey(key).getUTCDate()
}

/** "HH:MM" to minutes since midnight. */
export function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number)
  return hours * 60 + mins
}

export function duration(start: string, end: string): string {
  return formatMinutes(minutes(end) - minutes(start))
}

/** 90 to "1h 30m". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return hours && mins ? `${hours}h ${mins}m` : hours ? `${hours}h` : `${mins}m`
}
