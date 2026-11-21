import { useParams } from "react-router"
import NotFound from "@/app/not-found"
import { SavedResearchRevision } from "@/features/matters/research-revision"

export default function Page() {
  const { matterId = "", researchId = "" } = useParams()
  if (![matterId, researchId].every(id => /^c[a-z0-9]{24,}$/.test(id))) return <NotFound />
  return <SavedResearchRevision key={researchId} matterId={matterId} recordId={researchId} />
}
