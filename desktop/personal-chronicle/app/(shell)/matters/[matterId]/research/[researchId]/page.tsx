import { notFound } from "next/navigation"
import { SavedResearchRevision } from "@/features/matters/research-revision"

export default async function Page({ params }: { params: Promise<{ matterId: string; researchId: string }> }) {
  const { matterId, researchId } = await params
  if (![matterId, researchId].every(id => /^c[a-z0-9]{24,}$/.test(id))) notFound()
  return <SavedResearchRevision key={researchId} matterId={matterId} recordId={researchId} />
}
