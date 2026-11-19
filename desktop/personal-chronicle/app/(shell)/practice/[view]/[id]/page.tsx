import { notFound } from "next/navigation"
import { ClientPage, IntakePage } from "@/features/practice/client-intake"

export default async function Page({
  params,
}: {
  params: Promise<{ view: string; id: string }>
}) {
  const { view, id } = await params
  if (!/^c[a-z0-9]{24,}$/.test(id)) notFound()
  if (view === "clients") return <ClientPage key={id} id={id} />
  if (view === "intakes") return <IntakePage key={id} id={id} />
  notFound()
}
