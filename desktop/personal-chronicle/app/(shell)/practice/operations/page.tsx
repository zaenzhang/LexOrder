import { useSearchParams } from "react-router"
import { OperationsDesk } from "@/features/practice/operations-desk"

export default function OperationsPage() {
  const [searchParams] = useSearchParams()
  const matter = searchParams.get("matter") ?? undefined
  const section = searchParams.get("section")
  const tab = section === "closure" || section === "preservation" ? section : "express"
  return <OperationsDesk key={matter + tab} matterId={matter} section={tab} />
}
