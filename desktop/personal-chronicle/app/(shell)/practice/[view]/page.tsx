import { useParams, useSearchParams } from "react-router"
import NotFound from "@/app/not-found"
import { isClientTab } from "@/config/client-tabs"
import { ClientWorkspace } from "@/features/practice/client-intake"
import { DailyWork } from "@/features/practice/daily-work"
import { PersonalCalendar } from "@/features/practice/personal-calendar"
import { beijingDay, isCivilDay } from "@/features/calendar/dates"

export default function Page() {
  const { view = "" } = useParams()
  const searchParams = Object.fromEntries(useSearchParams()[0])
  if (isClientTab(view)) {
    return <ClientWorkspace view={view} creatingIntake={view === "intakes" && searchParams.create === "1"} />
  }
  if (view === "today") {
    const { taskView } = searchParams
    return <DailyWork key={view} view={view} todayTab={taskView === "waiting" || taskView === "done" ? taskView : "open"} />
  }
  if (view === "schedule") {
    const { day, event, from } = searchParams
    const initialDay = isCivilDay(day) ? day : undefined
    const initialEvent = typeof event === "string" && event.length <= 80 ? event : undefined
    return <PersonalCalendar key={JSON.stringify([initialDay, initialEvent])} today={beijingDay()}
      initialDay={initialDay} initialEvent={initialEvent} fromToday={from === "today"} />
  }
  if (view === "follow-ups") return <DailyWork key={view} view={view} />
  return <NotFound />
}
