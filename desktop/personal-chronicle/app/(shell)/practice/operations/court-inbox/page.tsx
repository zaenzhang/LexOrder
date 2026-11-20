import { useSearchParams } from "react-router"
import { CourtInbox } from "@/features/practice/court-inbox"

export default function CourtInboxPage() {
  const [searchParams] = useSearchParams()
  const record = searchParams.get("record")
  const initialRecord = record !== null && record.length <= 80 ? record : undefined
  return <CourtInbox key={initialRecord} initialRecord={initialRecord} fromToday={searchParams.get("from") === "today"} />
}
