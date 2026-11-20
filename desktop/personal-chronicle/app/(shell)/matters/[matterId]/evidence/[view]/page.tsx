import { useParams, useSearchParams } from "react-router"
import NotFound from "@/app/not-found"
import { EvidencePage } from "@/features/matters/evidence-notes"
import { evidenceViews } from "@/features/matters/sections"

export default function Page() {
  const { matterId = "", view = "" } = useParams()
  const searchParams = Object.fromEntries(useSearchParams()[0])
  const query = searchParams
  const section = evidenceViews.find(([key]) => key === view)
  if (!/^c[a-z0-9]{24,}$/.test(matterId) || !section || view === "claims") return <NotFound />
  const item = typeof query.item === "string" && /^c[a-z0-9]{24,}$/.test(query.item) ? query.item : undefined
  return <EvidencePage key={`${matterId}:${view}:${item ?? ""}`} matterId={matterId} view={section[0]} item={item} />
}
