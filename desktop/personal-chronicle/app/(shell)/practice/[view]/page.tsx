import { ResourcesDesk } from "@/features/practice/resources-desk"
import { notFound } from "next/navigation"
import {
  CatalogPage,
  ContactsPage,
  ConflictPrecheck,
} from "@/features/practice/client-intake"
import { DailyWork } from "@/features/practice/daily-work"

export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>
}) {
  const { view } = await params
  if (view === "clients" || view === "intakes")
    return <CatalogPage key={view} view={view} />
  if (view === "contacts") return <ContactsPage />
  if (view === "conflicts") return <ConflictPrecheck />
  if (
    view === "today" ||
    view === "schedule" ||
    view === "follow-ups" ||
    view === "notifications"
  )
    return <DailyWork key={view} view={view} />
  if (
    view === "resources" ||
    view === "templates" ||
    view === "reports" ||
    view === "profile" ||
    view === "audit"
  )
    return <ResourcesDesk key={view} view={view} />
  notFound()
}
