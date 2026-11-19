import { OperationsDesk } from "@/features/practice/operations-desk"

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ matter?: string; section?: string }> }) {
  const { matter, section } = await searchParams
  const tab = section === "closure" || section === "preservation" ? section : "express"
  return <OperationsDesk key={matter + tab} matterId={matter} section={tab} />
}
