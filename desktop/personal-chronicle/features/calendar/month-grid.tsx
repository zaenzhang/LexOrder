"use client"

import { useEffect, useMemo, useRef } from "react"

import { cn } from "@/lib/utils"

import type { CalendarEvent } from "./data"
import { addDays, dayOfMonth, formatDay, inMonth, isCivilDay, monthGrid, offsetMonthDay, TODAY, WEEKDAYS, type MonthCursor } from "./dates"
import { CALENDAR_BY_ID, sortEvents, useCalendar } from "./store"

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

type GridEvent = { id: string; date: string; title: string; start: string | null; calendar: string; dot: string; chip: string }
const cnDay = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" })

/**
 * The month: six Monday-first weeks. Each day is one button (arrow keys move
 * between days, Page Up and Page Down change month, double-click creates an
 * event). A grid wider than 672px lists up to three events per day; a narrower one shows dots.
 */
export function MonthGrid({ events, onCreate }: { events: CalendarEvent[]; onCreate: (date: string) => void }) {
  const cursor = useCalendar((state) => state.cursor)
  const selected = useCalendar((state) => state.selected)
  const selectDay = useCalendar((state) => state.selectDay)
  const rendered = useMemo(() => sortEvents(events).map(event => {
    const { dot, chip } = CALENDAR_BY_ID[event.calendar]
    return { ...event, dot, chip }
  }), [events])
  return <CalendarMonthGrid events={rendered} cursor={cursor} selected={selected} today={TODAY} selectDay={selectDay} onCreate={onCreate} />
}

export function CalendarMonthGrid({ events, cursor, selected, today, selectDay, onCreate, chinese = false }: {
  events: GridEvent[]; cursor: MonthCursor; selected: string; today: string;
  selectDay: (day: string) => void; onCreate?: (day: string) => void; chinese?: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  const days = useMemo(() => monthGrid(cursor), [cursor])
  const byDay = useMemo(() => {
    const map = new Map<string, GridEvent[]>()
    for (const event of events) {
      map.set(event.date, [...(map.get(event.date) ?? []), event])
    }
    return map
  }, [events])
  // The roving tab stop: the selected day if it is on screen, otherwise the 1st.
  const tabStop = days.includes(selected) ? selected : days.find((key) => inMonth(key, cursor) && dayOfMonth(key) === 1)

  // After an arrow key moves the selection, keep focus on the newly selected day.
  useEffect(() => {
    if (moved.current) {
      moved.current = false
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${selected}"]`)?.focus()
    }
  }, [selected, cursor])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = KEY_STEPS[event.key]
    const months = event.key === "PageUp" ? -1 : event.key === "PageDown" ? 1 : 0
    if (!step && !months) {
      return
    }
    event.preventDefault()
    moved.current = true
    const base = days.includes(selected) ? selected : (tabStop ?? selected)
    selectDay(step ? addDays(base, step) : offsetMonthDay(base, months))
  }

  return (
    <div className="@container flex flex-col">
      <div className="grid grid-cols-7 border-b" aria-hidden>
        {(chinese ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] : WEEKDAYS).map((day) => (
          <div key={day} className="px-2 py-2 text-center text-[11px] font-medium tracking-wide text-muted-foreground uppercase @2xl:ps-3 @2xl:text-start">
            <span className="@md:hidden">{chinese ? day.slice(-1) : day.slice(0, 1)}</span>
            <span className="hidden @md:inline">{day}</span>
          </div>
        ))}
      </div>
      <div ref={grid} className="grid grid-cols-7 [&>*:nth-child(7n)]:border-e-0 [&>*:nth-last-child(-n+7)]:border-b-0" onKeyDown={onKeyDown} role="group" aria-label={chinese ? "月历日期" : "Days"}>
        {days.map((key) => {
          const dayEvents = byDay.get(key) ?? []
          const outside = !inMonth(key, cursor)
          const isToday = key === today
          const isSelected = key === selected
          const shown = dayEvents.slice(0, 3)
          const unavailable = chinese && !isCivilDay(key)
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              tabIndex={key === tabStop ? 0 : -1}
              disabled={unavailable}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={chinese ? `${cnDay.format(new Date(key + "T00:00:00Z"))}，${dayEvents.length} 项安排`
                : `${formatDay(key)}${isToday ? ", today" : ""}, ${dayEvents.length === 0 ? "no events" : dayEvents.length === 1 ? "1 event" : `${dayEvents.length} events`}`}
              onClick={() => selectDay(key)}
              onDoubleClick={onCreate && (() => onCreate(key))}
              className={cn(
                "group/day relative flex h-14 min-w-0 flex-col items-center gap-1 border-e border-b p-1 text-start transition-colors outline-none hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @md:h-16 @2xl:h-auto @2xl:min-h-28 @2xl:items-stretch @2xl:p-1.5",
                outside && "bg-muted/30",
                isSelected && "bg-accent/60 hover:bg-accent/60"
              )}
            >
              <span
                className={cn(
                  "num flex size-7 shrink-0 items-center justify-center rounded-full text-xs @2xl:size-6",
                  outside ? "text-muted-foreground" : "text-foreground",
                  isSelected && !isToday && "bg-foreground text-background",
                  isToday && "bg-primary font-semibold text-primary-foreground"
                )}
              >
                {dayOfMonth(key)}
              </span>
              {/* Narrow grids (phones, or a tablet beside the sidebar): a dot per calendar with events that day. */}
              {dayEvents.length > 0 && (
                <span className="flex gap-0.5 @2xl:hidden" aria-hidden>
                  {[...new Map(dayEvents.map(event => [event.calendar, event])).values()].slice(0, 4).map(event => (
                    <span key={event.calendar} className={cn("size-1.5 rounded-full", event.dot, outside && "opacity-50")} />
                  ))}
                </span>
              )}
              <span className={cn("hidden min-w-0 flex-col gap-0.5 @2xl:flex", outside && "grayscale")} aria-hidden>
                {shown.map((event) => (
                  <span
                    key={event.id}
                    className={cn(
                      "relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md py-0.5 ps-2 pe-1.5 text-[11px] leading-4 before:absolute before:inset-y-0.5 before:start-0.5 before:w-0.5 before:rounded-full",
                      event.chip
                    )}
                  >
                    {event.start && <span className="num hidden shrink-0 text-muted-foreground 2xl:inline">{event.start}</span>}
                    <span className="truncate font-medium">{event.title}</span>
                  </span>
                ))}
                {dayEvents.length > shown.length && <span className="ps-2 text-[11px] text-muted-foreground">{chinese ? "另有 " + (dayEvents.length - shown.length) + " 项" : dayEvents.length - shown.length + " more"}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
