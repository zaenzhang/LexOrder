import { useSearchParams } from "react-router"
import Link from "@/features/shell/workspace-link"
import { ArchiveWorkspace } from "@/features/practice/archive-workspace"

export default function ArchivePage() {
  const [searchParams] = useSearchParams()
  const matter = searchParams.get("matter")
  return matter ? <ArchiveWorkspace key={matter} matterId={matter} /> : <Link className="underline" href="/practice/operations?section=closure">选择要办理归档的案件</Link>
}
