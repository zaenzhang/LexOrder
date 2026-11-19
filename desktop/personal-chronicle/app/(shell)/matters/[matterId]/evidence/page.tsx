import { notFound } from "next/navigation"
import { EvidenceReview } from "@/features/matters/evidence-review"

export const metadata = { title: "争点证据对照" }

export default async function Page({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params
  if (!/^c[a-z0-9]{24,}$/.test(matterId)) notFound()
  return <EvidenceReview key={matterId} matterId={matterId} />
}
