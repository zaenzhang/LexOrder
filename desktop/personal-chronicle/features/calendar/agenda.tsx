"use client"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import type { ReactNode } from "react"
import Link from "@/features/shell/workspace-link"
import { CalendarPlusIcon, CalendarX2Icon, MapPinIcon, MoreHorizontalIcon, Trash2Icon, UsersIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { MEMBERS } from "@/features/chat/data"
import { DATA_NOW } from "@/lib/clock"
import { cn } from "@/lib/utils"

import { CALENDARS, type CalendarEvent } from "./data"
import { duration, formatDay, formatMinutes, inMonth, minutes, TODAY } from "./dates"
import { CALENDAR_BY_ID, sortEvents, useCalendar } from "./store"

/** The demo clock: noon UTC on DATA_NOW. */
const NOW_MINUTES = DATA_NOW.getUTCHours() * 60 + DATA_NOW.getUTCMinutes()

function EventRow({ event }: { event: CalendarEvent }) {
  const remove = useCalendar((state) => state.remove)
  const restore = useCalendar((state) => state.restore)
  const calendar = CALENDAR_BY_ID[event.calendar]
  const past = event.date < TODAY || (event.date === TODAY && event.end !== null && minutes(event.end) <= NOW_MINUTES)
  const live = event.date === TODAY && event.start !== null && event.end !== null && minutes(event.start) <= NOW_MINUTES && minutes(event.end) > NOW_MINUTES
  return (
    <CalendarAgendaRow start={event.start} end={event.end} dot={calendar.dot} past={past}
      untimed="All day" title={<>{event.title}
        {live && <span className="ms-2 shrink-0 rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">Now</span>}
      </>}
      detail={<>
        <span>{calendar.title}</span>
        {event.start && event.end && <span className="num">{duration(event.start, event.end)}</span>}
        {event.location && <span className="inline-flex items-center gap-1"><MapPinIcon className="size-3" />{event.location}</span>}
        {event.attendees.length > 0 && <span className="inline-flex min-w-0 items-center gap-1"><UsersIcon className="size-3 shrink-0" />
          <span className="truncate">{event.attendees.map(id => MEMBERS[id]?.name.split(" ")[0]).join(", ")}</span></span>}
      </>}
      menu={<DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label={"Options for " + event.title} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => {
              remove(event.id)
              toast.add({ title: "Event deleted", description: event.title, actionProps: { children: "Undo", onClick: () => restore(event) } })
            }}><Trash2Icon />Delete event</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>} />
  )
}

/** The selected day's events, then the calendars you can show or hide. */
export function Agenda({ events, allEvents, onCreate }: { events: CalendarEvent[]; allEvents: CalendarEvent[]; onCreate: (date: string) => void }) {
  const selected = useCalendar((state) => state.selected)
  const cursor = useCalendar((state) => state.cursor)
  const hidden = useCalendar((state) => state.hidden)
  const toggleCalendar = useCalendar((state) => state.toggleCalendar)
  const dayEvents = sortEvents(events.filter((event) => event.date === selected))
  const timed = dayEvents.filter((event) => event.start && event.end)
  const booked = timed.reduce((sum, event) => sum + minutes(event.end as string) - minutes(event.start as string), 0)

  return <CalendarAgenda
    title={formatDay(selected)} caption={selected === TODAY ? "Today" : "Agenda"}
    totals={[["Events", dayEvents.length], ["Booked", formatMinutes(booked)]]}
    filters={CALENDARS.map(calendar => ({ ...calendar, visible: !hidden.includes(calendar.id),
      count: allEvents.filter(event => event.calendar === calendar.id && inMonth(event.date, cursor)).length,
      toggle: () => toggleCalendar(calendar.id),
    }))}
    onCreate={() => onCreate(selected)}
  >
    {dayEvents.map(event => <EventRow key={event.id} event={event} />)}
  </CalendarAgenda>
}

const englishAgenda = {
  region: "Agenda", filters: "Calendars", create: "Add event", createOnDay: "Add an event on this day",
  empty: "Nothing scheduled", emptyDetail: "A clear day. Add an event or pick another day.",
}

export function CalendarAgenda({ title, caption, totals, filters, onCreate, labels = englishAgenda, pending, children }: {
  title: string; caption: string; totals: [string, ReactNode][]
  filters: { id: string; title: string; dot: string; visible: boolean; count: number; toggle: () => void }[]
  onCreate?: () => void; labels?: typeof englishAgenda; pending?: boolean; children: ReactNode[]
}) {
  return <aside aria-label={labels.region} className="@container rounded-2xl bg-card p-4 shadow-(--surface-shadow) xl:sticky xl:top-20">
    <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_15rem] @2xl:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">{caption}</span>
            <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
          </div>
          {onCreate && <Button variant="outline" size="icon-sm" onClick={onCreate} aria-label={labels.createOnDay}><CalendarPlusIcon /></Button>}
        </div>
        <dl className="grid grid-cols-2 gap-2">{totals.map(([label, value]) => <div key={label} className="flex flex-col rounded-xl bg-muted/60 px-3 py-2">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="num text-xl font-semibold">{value}</dd>
        </div>)}</dl>
        {pending ? <InlineLoading label="正在读取日程…" />
          : children.length ? <ul className="-mx-2.5 flex flex-col gap-0.5">{children}</ul>
            : <Empty className="border border-dashed py-8">
              <EmptyHeader><EmptyMedia variant="icon"><CalendarX2Icon /></EmptyMedia>
                <EmptyTitle>{labels.empty}</EmptyTitle><EmptyDescription>{labels.emptyDetail}</EmptyDescription>
              </EmptyHeader>
              {onCreate && <EmptyContent><Button variant="outline" size="sm" onClick={onCreate}>
                <CalendarPlusIcon data-icon="inline-start" />{labels.create}
              </Button></EmptyContent>}
            </Empty>}
      </div>
      <div className="flex flex-col gap-4 @2xl:border-s @2xl:ps-6">
        <Separator className="@2xl:hidden" />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">{labels.filters}</legend>
          {filters.map(filter => <label key={filter.id} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-sm hover:bg-muted/50">
            <Checkbox checked={filter.visible} onCheckedChange={filter.toggle} />
            <span className={cn("size-2 rounded-full", filter.dot)} aria-hidden />
            <span className="flex-1">{filter.title}</span>
            <span className="num text-xs text-muted-foreground">{filter.count}</span>
          </label>)}
        </fieldset>
      </div>
    </div>
  </aside>
}

export function CalendarAgendaRow({ start, end, untimed, dot, title, detail, past, menu, href, onOpen }: {
  start: string | null; end?: string | null; untimed: string; dot: string; title: ReactNode
  detail: ReactNode; past?: boolean; menu?: ReactNode; href?: string; onOpen?: () => void
}) {
  const body = <>
    <span className="flex w-12 shrink-0 flex-col pt-0.5">
      {start ? <><span className="num text-sm font-medium">{start}</span>
        {end && <span className="num text-xs text-muted-foreground">{end}</span>}</>
      : <span className="text-xs font-medium text-muted-foreground">{untimed}</span>}
    </span>
    <span className={cn("w-0.5 shrink-0 self-stretch rounded-full", dot)} aria-hidden />
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="min-w-0 flex-1 text-sm font-medium text-pretty">{title}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{detail}</span>
    </span>
  </>
  const frame = cn("group/event relative flex w-full gap-3 rounded-xl p-2.5 text-start transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
    past && "[&_.font-medium]:text-muted-foreground")
  return <li>{href ? <Link className={frame} href={href}>{body}</Link> : onOpen
    ? <button type="button" className={frame} onClick={onOpen}>{body}</button> : <div className={frame}>{body}{menu}</div>}</li>
}
