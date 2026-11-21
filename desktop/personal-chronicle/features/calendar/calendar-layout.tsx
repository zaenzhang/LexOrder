import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function CalendarLayout({ month, onToday, onChangeMonth, labels = { today: "Today", previous: "Previous month", next: "Next month" },
  previousDisabled, nextDisabled, children, agenda }: {
  month: string; onToday: () => void; onChangeMonth: (offset: -1 | 1) => void
  labels?: { today: string; previous: string; next: string }
  previousDisabled?: boolean; nextDisabled?: boolean
  children: ReactNode; agenda: ReactNode
}) {
  return <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <section aria-label={month} className="overflow-hidden rounded-2xl bg-card shadow-(--surface-shadow)">
      <div className="flex items-center gap-2 border-b px-3 py-2.5 md:px-4">
        <h2 className="font-heading text-base font-semibold tracking-tight md:text-lg" aria-live="polite">{month}</h2>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onToday}>{labels.today}</Button>
          <div className="flex items-center">
            <Button variant="outline" size="icon-sm" className="rounded-e-none" onClick={() => onChangeMonth(-1)}
              disabled={previousDisabled} aria-label={labels.previous}><ChevronLeftIcon className="rtl:rotate-180" /></Button>
            <Button variant="outline" size="icon-sm" className="-ms-px rounded-s-none" onClick={() => onChangeMonth(1)}
              disabled={nextDisabled} aria-label={labels.next}><ChevronRightIcon className="rtl:rotate-180" /></Button>
          </div>
        </div>
      </div>
      {children}
    </section>
    {agenda}
  </div>
}
