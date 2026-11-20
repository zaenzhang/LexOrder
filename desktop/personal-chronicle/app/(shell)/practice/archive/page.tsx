import Link from "@/features/shell/workspace-link"
import { ArchiveWorkspace } from "@/features/practice/archive-workspace"

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ matter?: string }> }) {
  const { matter } = await searchParams
  return matter ? <ArchiveWorkspace key={matter} matterId={matter} /> : <Link className="underline" href="/practice/operations?section=closure">选择要办理归档的案件</Link>
}
