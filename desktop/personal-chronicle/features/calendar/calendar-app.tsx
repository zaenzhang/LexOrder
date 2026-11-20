"use client"

import { PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/kit/ui-patterns/page-header"

import { CalendarLayout } from "./calendar-layout"
import { Agenda } from "./agenda"
import { formatMonth, inMonth, TODAY } from "./dates"
import { EventDialog } from "./event-dialog"
import { MonthGrid } from "./month-grid"
import { useCalendar } from "./store"

/**
 * Calendar: the month grid with the selected day's agenda beside it (below
 * it under 1280px). Events, filters and the selection live in ./store.
 */
export function CalendarApp() {
  const allEvents = useCalendar((state) => state.events)
  const hidden = useCalendar((state) => state.hidden)
  const cursor = useCalendar((state) => state.cursor)
  const selected = useCalendar((state) => state.selected)
  const goToMonth = useCalendar((state) => state.goToMonth)
  const goToToday = useCalendar((state) => state.goToToday)
  const [dialog, setDialog] = useState({ open: false, date: TODAY, session: 0 })

  const events = useMemo(() => allEvents.filter((event) => !hidden.includes(event.calendar)), [allEvents, hidden])
  const monthCount = events.filter((event) => inMonth(event.date, cursor)).length
  const create = (date: string) => setDialog((current) => ({ open: true, date, session: current.session + 1 }))

  return (
    <>
      <PageHeader
        title="Calendar"
        description={
          <>
            <span className="num">{monthCount}</span> events in {formatMonth(cursor)}. Times in UTC.
          </>
        }
        actions={
          <Button onClick={() => create(selected)}>
            <PlusIcon data-icon="inline-start" />
            New event
          </Button>
        }
      />
      <CalendarLayout month={formatMonth(cursor)} onToday={goToToday} onChangeMonth={goToMonth}
        agenda={<Agenda events={events} allEvents={allEvents} onCreate={create} />}>
        <MonthGrid events={events} onCreate={create} />
      </CalendarLayout>
      <EventDialog open={dialog.open} date={dialog.date} session={dialog.session} onOpenChange={(open) => setDialog((current) => ({ ...current, open }))} />
    </>
  )
}
