"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowUpRightIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { evidenceEndpoint, readPersonal, type Matter } from "./personal-client"

const href = (matter: Matter) => `/matters/${matter.id}/evidence`
const columns: DataColumn<Matter>[] = [
  { id: "title", header: "案件", cell: row => <Link className="font-medium hover:underline" href={`/matters/${row.id}/overview`}>{row.title}</Link> },
  { id: "internalCode", header: "案号", cell: row => <span className="text-muted-foreground">{row.internalCode || "—"}</span> },
  { id: "open", header: " ", cell: row => <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={href(row)} />} aria-label={`打开${row.title}的争点证据对照`}>查看争点 <ArrowUpRightIcon data-icon="inline-end" /></Button> },
]

export function MattersPage() {
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState({ search: "", page: 1 })
  const [result, setResult] = useState<{ matters: Matter[]; hasMore: boolean }>()
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ q: query.search, page: String(query.page) })
    readPersonal<{ matters: Matter[]; hasMore: boolean }>(`${evidenceEndpoint}?${params}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [query])

  function load(search: string, page: number) {
    setError("")
    setResult(undefined)
    setQuery({ search, page })
  }

  return <section className="flex flex-col gap-5">
    <PageHeader title="案件总览" description="搜索已有案件，打开独立的案件工作空间。" />
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); load(draft.trim(), 1) }}>
      <Input className="w-full max-w-xs" aria-label="搜索案件" placeholder="案件名称或案号" value={draft} onChange={event => setDraft(event.target.value)} />
      <Button variant="outline" type="submit"><SearchIcon data-icon="inline-start" />搜索</Button>
    </form>
    {error ? <div className="flex items-center gap-2" role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => load(query.search, query.page)}>重试</Button></div> :
      <DataTable columns={columns} rows={result?.matters} getRowId={row => row.id} loading={!result}
        sort={[]} onSortChange={() => {}} label="案件列表" empty={<p className="text-sm text-muted-foreground">没有匹配的案件。</p>} />}
    {result && (query.page > 1 || result.hasMore) ? <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={query.page === 1} onClick={() => load(query.search, query.page - 1)}>上一页</Button>
      <Button size="sm" variant="outline" disabled={!result.hasMore} onClick={() => load(query.search, query.page + 1)}>下一页</Button>
    </div> : null}
  </section>
}
