import { notFound } from "next/navigation"
import { MatterSectionPage } from "@/features/matters/matter-section-page"
import { matterSections } from "@/features/matters/sections"

export default async function Page({ params }: { params: Promise<{ matterId: string; section: string }> }) {
  const { matterId, section } = await params
  const match = matterSections.find(([key]) => key === section)
  if (!/^c[a-z0-9]{24,}$/.test(matterId) || !match || match[0] === "evidence") notFound()
  return <MatterSectionPage key={`${matterId}:${section}`} matterId={matterId} section={match[0]} title={match[1]} />
}
