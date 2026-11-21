import { Navigate, useSearchParams } from "react-router"

import { OverviewPage } from "@/features/overview/overview-page"

export default function Page() {
  const [query] = useSearchParams()
  if (import.meta.env.MODE !== "demo" && query.get("template") !== "1") {
    return <Navigate to="/practice/today" replace />
  }
  return <OverviewPage />
}
