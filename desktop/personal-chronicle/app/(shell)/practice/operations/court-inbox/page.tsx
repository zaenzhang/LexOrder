import { CourtInbox } from "@/features/practice/court-inbox"

export default async function CourtInboxPage({ searchParams }: { searchParams: Promise<{ record?: string; from?: string }> }) {
  const { record, from } = await searchParams
  const initialRecord = typeof record === "string" && record.length <= 80 ? record : undefined
  return <CourtInbox key={initialRecord} initialRecord={initialRecord} fromToday={from === "today"} />
}
