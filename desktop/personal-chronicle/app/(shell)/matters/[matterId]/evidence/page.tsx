import { useParams, useSearchParams } from "react-router"
import NotFound from "@/app/not-found"
import { EvidencePage } from "@/features/matters/evidence-notes"

export const metadata = { title: "争点证据对照" }

export default function Page() {
  const { matterId = "" } = useParams()
  const searchParams = Object.fromEntries(useSearchParams()[0])
  const query = searchParams
  if (!/^c[a-z0-9]{24,}$/.test(matterId)) return <NotFound />
  const item = typeof query.item === "string" && /^c[a-z0-9]{24,}$/.test(query.item) ? query.item : undefined
  return <EvidencePage key={matterId + (item ?? "")} matterId={matterId} item={item} />
}
