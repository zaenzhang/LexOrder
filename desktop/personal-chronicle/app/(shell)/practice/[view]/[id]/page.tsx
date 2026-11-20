import { useParams } from "react-router"
import NotFound from "@/app/not-found"
import { ClientPage, IntakePage } from "@/features/practice/client-intake"

export default function Page() {
  const { view = "", id = "" } = useParams()
  if (!/^c[a-z0-9]{24,}$/.test(id)) return <NotFound />
  if (view === "clients") return <ClientPage key={id} id={id} />
  if (view === "intakes") return <IntakePage key={id} id={id} />
  return <NotFound />
}
