import { ResourcesDesk } from "@/features/practice/resources-desk"
import { useParams, useSearchParams } from "react-router"
import NotFound from "@/app/not-found"
import {
  CatalogPage,
  ContactsPage,
  ConflictPrecheck,
} from "@/features/practice/client-intake"
import { DailyWork } from "@/features/practice/daily-work"
import { PersonalCalendar } from "@/features/practice/personal-calendar"
import { beijingDay, isCivilDay } from "@/features/calendar/dates"

export default function Page() {
  const { view = "" } = useParams()
  const searchParams = Object.fromEntries(useSearchParams()[0])
  if (view === "clients") return <CatalogPage key={view} view={view} />
  if (view === "intakes") {
    const { create } = searchParams
    return <CatalogPage key={create === "1" ? "new-intake" : view} view={view} creatingIntake={create === "1"} />
  }
  if (view === "contacts") return <ContactsPage />
  if (view === "conflicts") return <ConflictPrecheck />
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
  if (view === "notifications") {
    const { notification } = searchParams
    return <DailyWork key={view} view={view} notification={notification} />
  }
  if (view === "follow-ups") return <DailyWork key={view} view={view} />
  if (
    view === "skills" ||
    view === "ai" ||
    view === "resources" ||
    view === "templates" ||
    view === "reports" ||
    view === "profile" ||
    view === "audit"
  )
    return <ResourcesDesk key={view} view={view} />
  return <NotFound />
}
