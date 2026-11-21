import { useParams } from "react-router"
import NotFound from "@/app/not-found"
import { DocumentWorkbench } from "@/features/matters/document-review-desk"

export const metadata = { title: "文书工作台" }

export default function Page() {
  const { matterId = "", documentId = "" } = useParams()
  if (![matterId, documentId].every(value => /^c[a-z0-9]{24,}$/.test(value))) return <NotFound />
  return <DocumentWorkbench key={documentId} matterId={matterId} id={documentId} />
}
