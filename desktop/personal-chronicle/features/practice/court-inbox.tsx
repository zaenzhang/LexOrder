"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, FileText, Inbox, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal, type Matter } from "@/features/matters/personal-client"
import { courtInboxEndpoint, CourtCandidateReview, type CourtCandidate, type CourtProcedure } from "./court-candidate"
import { chinaDate } from "./data"

type InboxSummary = { id: string; title: string; receivedAt: string; processed: boolean; matterTitle: string | null }
type InboundFile = { id: string; name: string; state: string; documentId: string | null; mime: string; analysisState: string; analysisError: string | null }
type Item = { id: string; text: string; note: string | null; receivedAt: string; processed: boolean
  matter: { id: string; title: string; code: string } | null; files: InboundFile[]; procedures: CourtProcedure[]; suggestions: CourtCandidate[]
}
type Receipt = { count?: number; duplicates?: number; filedFiles?: number; warning?: string; warnings?: string[]
  saved?: string[]; skippedDuplicates?: string[]; failed?: { name: string; message: string }[]
  results?: { state?: string; suggestionCount?: number }[]
}
const analysisStates = { PENDING: "未整理", ANALYZING: "整理中", ANALYZED: "已整理", FAILED: "整理失败", NEEDS_OCR: "需要 OCR 或人工核对" }

export function CourtInbox({ matterId, initialRecord, fromToday }: { matterId?: string; initialRecord?: string; fromToday?: boolean } = {}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState(initialRecord)
  const [paste, setPaste] = useState(false)
  const [batch, setBatch] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const scope: Record<string, string> = matterId ? { matter: matterId } : {}
  const catalog = useQuery({
    queryKey: ["court-inbox", "list", matterId],
    queryFn: ({ signal }) => readPersonal<{ items: InboxSummary[] }>(courtInboxEndpoint + "?" + new URLSearchParams({ ...scope, view: "list" }), { signal }),
    retry: false,
  })
  const activeId = selected ?? catalog.data?.items[0]?.id
  const record = useQuery({
    queryKey: ["court-inbox", "record", matterId, activeId],
    queryFn: ({ signal }) => readPersonal<{ items: Item[] }>(courtInboxEndpoint + "?" + new URLSearchParams({ ...scope, record: activeId! }), { signal }),
    enabled: !!activeId, retry: false,
  })
  const item = record.data?.items[0]

  async function submit(body: object | FormData, action: string) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const receipt = await readPersonal<Receipt>(courtInboxEndpoint, body instanceof FormData ? { method: "POST", body } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (action === "paste") {
        setNotice("已登记 " + ((receipt.count || 0) - (receipt.duplicates || 0)) + " 条，重复 " + (receipt.duplicates || 0) + " 条。")
        setPaste(false)
      } else if (action === "decide") setNotice(["已保存律师决定。", ...(receipt.warnings ?? [])].join(" "))
      else if (action === "analyze") setNotice(receipt.results?.some(result => result.state === "ANALYZED")
        ? "整理完成，请逐项核对候选及来源。" : "整理未完成，请查看原件状态。")
      else if (action === "finish") setNotice("已标记这条来件办理完成。")
      else setNotice([action === "upload" ? "已补传 " + (receipt.saved?.length || 0) + " 件，重复 " + (receipt.skippedDuplicates?.length || 0) + " 件。"
        : "", "本次入卷 " + (receipt.filedFiles || 0) + " 件。", receipt.warning].filter(Boolean).join(" "))
      if (receipt.failed?.length) setError(receipt.failed.map(f => f.name + " · " + f.message).join("；"))
      await Promise.all([client.invalidateQueries({ queryKey: ["court-inbox"] }), client.invalidateQueries({ queryKey: ["practice"] })])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "处理失败，请重新核对来件。")
      if (action === "decide") void record.refetch()
    } finally { setBusy(false) }
  }

  usePageLoading(catalog.isPending)
  const status = <>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}</>
  return <section className="grid min-w-0 gap-4">
    <PageHeader className="sm:items-center [&_h1]:text-[1.75rem]" title="法院来件" description={matterId ? item?.matter?.title ?? "本案法院材料" : "待归案及已登记来件"} actions={<>
      {fromToday && <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/practice/today" />}>返回今日办理</Button>}
      {matterId && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={"/matters/" + matterId + "/materials"} />}>返回案卷材料</Button>}
      {matterId
        ? <Button size="sm" nativeButton={false} render={<Link href="/practice/operations/court-inbox" />}>接收与归卷</Button>
        : <Button size="sm" onClick={() => { setError(""); setNotice(""); setPaste(true) }}><Plus data-icon="inline-start" />登记来件</Button>}
    </>} />
    {!paste && status}
    {catalog.error && <p role="alert" className="text-sm text-destructive">{catalog.error.message}</p>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(13rem,0.95fr)_minmax(0,3fr)]">
      <Card className="min-w-0">
        <CardContent className="grid max-h-[calc(100dvh-15rem)] min-h-40 gap-5 overflow-y-auto">
          {catalog.isPending && <InlineLoading label="正在读取目录…" />}
          {catalog.data && [false, true].map(done => {
            const rows = catalog.data.items.filter(row => row.processed === done)
            return <section className="grid gap-1" key={String(done)}>
              <div className="flex items-center justify-between px-1 py-1.5"><h2 className="font-semibold">{done ? "已办理" : "待核对"}</h2><Badge variant="secondary">{rows.length}</Badge></div>
              {rows.length ? <ul className="divide-y">
                {rows.map(row => <li key={row.id} className="py-1">
                  <button type="button" disabled={busy} aria-current={activeId === row.id ? true : undefined}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-muted aria-current:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => { setSelected(row.id); setError(""); setNotice("") }}>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">{row.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{chinaDate(row.receivedAt)}{!matterId && row.matterTitle && " · " + row.matterTitle}</span>
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>)}
              </ul> : <p className="px-1 py-2 text-xs text-muted-foreground">没有{done ? "已办理" : "待核对"}的来件。</p>}
            </section>
          })}
        </CardContent>
      </Card>
      {item ? <InboxRecord key={item.id} item={item} busy={busy} submit={submit} /> : <Card>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="size-4" aria-hidden />
          {record.error ? <span role="alert">{record.error.message}</span>
            : activeId ? record.isPending ? <InlineLoading label="正在打开来件…" /> : "来件已变化或不在当前案件。"
              : catalog.isPending ? <InlineLoading label="正在读取来件…" /> : "当前没有来件。"}
        </CardContent>
      </Card>}
    </div>
    <Sheet open={paste} onOpenChange={open => { if (!open && !busy) setPaste(false) }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>登记法院来件</SheetTitle></SheetHeader>
        <div className="grid gap-4 px-4 pb-4 text-sm">{status}
          <form className="grid gap-3" onSubmit={event => {
            event.preventDefault()
            void submit({ action: "paste", rawText: new FormData(event.currentTarget).get("text"), batch }, "paste")
          }}>
            <label className="grid gap-1.5">来件原文<Textarea name="text" required maxLength={8000} disabled={busy} /></label>
            <label className="flex items-center gap-2"><Checkbox checked={batch} disabled={busy} onCheckedChange={setBatch} />按空行拆分多条</label>
            <Button disabled={busy}>登记</Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  </section>
}

function InboxRecord({ item, busy, submit }: {
  item: Item; busy: boolean; submit: (body: object | FormData, action: string) => Promise<void>
}) {
  const [candidateId, setCandidateId] = useState("")
  const [sourceId, setSourceId] = useState<string>()
  const candidate = item.suggestions.find(row => row.id === candidateId) ?? item.suggestions.find(row => row.status === "PENDING") ?? item.suggestions[0]
  const pending = item.suggestions.filter(row => row.status === "PENDING")
  const file = item.files.find(row => row.id === (sourceId ?? candidate?.fileId ?? item.files[0]?.id))
  const active = candidate
  const addFiles = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.set("smsId", item.id)
    void submit(form, "upload")
  }
  const state = file && analysisStates[file.analysisState as keyof typeof analysisStates]
  return <Card className="min-w-0">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><CardTitle className="break-words text-lg">{file?.name ?? "来件原文"}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{chinaDate(item.receivedAt)} · {item.matter?.title ?? "待确认案件"}</p></div>
        <Badge variant="secondary">{item.processed ? "已办理" : pending.length ? pending.length + " 项待核对" : "待办理"}</Badge>
      </div>
    </CardHeader>
    <CardContent className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(19rem,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.88fr)]">
      <section className="grid min-w-0 gap-3" aria-label="来件原文与附件">
        <h3 className="text-sm font-semibold">来件原文</h3>
        <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/35 p-3 text-sm">{item.text}</p>
        {item.files.length > 0 && <>
          <label className="grid gap-1.5 text-sm">附件
            <NativeSelect className="w-full" value={file?.id ?? ""} onChange={event => setSourceId(event.target.value)}>
              {item.files.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          {file && <div className="grid gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs"><FileText className="size-3.5" aria-hidden />
              <span>{file.documentId ? "已入卷固定原件" : "暂存原件"}{state && " · " + state}</span></div>
            {file.analysisError && <p className="text-xs text-muted-foreground">{file.analysisError}</p>}
            <CourtOriginal file={file} page={file.id === candidate?.fileId ? candidate?.page : undefined} />
            {!item.processed && file.analysisState !== "ANALYZED" && ["PENDING_REVIEW", "FILED"].includes(file.state) &&
              <Button size="sm" variant="outline" className="justify-self-start" disabled={busy}
                onClick={() => void submit({ action: "analyze", smsId: item.id, fileIds: [file.id] }, "analyze")}>整理当前附件</Button>}
          </div>}
        </>}
        {!item.processed && <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">补传附件</summary>
          <form className="mt-3 grid gap-2" onSubmit={addFiles}>
            <Input aria-label="选择附件" name="files" type="file" required disabled={busy} />
            <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={busy}>保存附件</Button>
          </form>
        </details>}
      </section>
      <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label="核对并登记">
        <h3 className="text-sm font-semibold">核对并登记</h3>
        {item.matter ? <div className="grid gap-1">
          <Link className="text-sm text-primary hover:underline" href={"/matters/" + item.matter.id + "/materials"}>{item.matter.code} · {item.matter.title}</Link>
          {!item.processed && item.files.some(row => row.state === "PENDING_REVIEW" && !row.documentId) && <Button variant="outline" size="sm" className="justify-self-start"
            disabled={busy} onClick={() => void submit({ action: "file", smsId: item.id }, "file")}>仅归卷，日期仍待核</Button>}
        </div> : !item.processed && <MatterPicker busy={busy} onSelect={matterId => void submit({ action: "match", smsId: item.id, matterId }, "match")} />}
        {active ? <>
          {item.suggestions.length > 1 && <label className="grid gap-1.5 text-sm">核对项
            <NativeSelect className="w-full" value={active.id} disabled={busy} onChange={event => { setCandidateId(event.target.value); setSourceId(undefined) }}>
              {item.suggestions.map(row => <NativeSelectOption key={row.id} value={row.id}>
                {(row.status === "PENDING" ? "待核对 · " : "已处理 · ") + (row.value || "来源建议")}
              </NativeSelectOption>)}
            </NativeSelect>
          </label>}
          {active.excerpt && <blockquote className="whitespace-pre-wrap break-words border-s-2 ps-2 text-xs text-muted-foreground">
            {active.page ? <p className="mb-1">来源第 {active.page} 页</p> : null}{active.excerpt}
          </blockquote>}
          <CourtCandidateReview key={active.id + ":" + active.updatedAt} candidate={active} record={item.id}
            matter={item.matter?.id} procedures={item.procedures} busy={busy} onDecide={(row, decision, event) => {
              setCandidateId(row.id)
              void submit({ action: "decide", smsId: item.id, expectedMatchedMatterId: item.matter?.id ?? null,
                decision, items: [{ id: row.id, expectedUpdatedAt: row.updatedAt, event }] }, "decide")
            }} />
        </> : <p className="text-sm text-muted-foreground">暂无整理候选。可阅读原件后在本案程序中人工登记。</p>}
        {!item.processed && !pending.length && <form className="grid gap-2 border-t pt-3 text-sm" onSubmit={event => {
          event.preventDefault()
          void submit({ action: "finish", id: item.id, note: String(new FormData(event.currentTarget).get("note") ?? "") }, "finish")
        }}>
          <label className="grid gap-1.5">处理说明<Textarea name="note" maxLength={500} disabled={busy} /></label>
          <Button variant="outline" size="sm" className="justify-self-start" disabled={busy}>标记已办理</Button>
        </form>}
        {item.note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.note}</p>}
      </section>
    </CardContent>
  </Card>
}

function CourtOriginal({ file, page }: { file: InboundFile; page?: number | null }) {
  const isPdf = file.mime === "application/pdf"
  const inline = isPdf || ["image/png", "image/jpeg", "image/webp", "text/plain"].includes(file.mime)
  const temp = courtInboxEndpoint + "?file=" + file.id
  const permanent = file.documentId && "/api/documents/" + file.documentId
  const downloadable = permanent ? permanent + "/download" : temp
  const preview = permanent ? permanent + "/download?inline=1" : temp
  return <>
    {inline && <iframe title="来件附件原文" className="h-80 w-full rounded-md border bg-background xl:h-96"
      src={preview + (isPdf && page ? "#page=" + page : "")} />}
    <a href={downloadable} download className="text-sm text-primary hover:underline">下载{permanent ? "固定版本" : "暂存原件"}</a>
  </>
}

function MatterPicker({ busy, onSelect }: { busy: boolean; onSelect: (matter: string) => void }) {
  const [input, setInput] = useState("")
  const [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["court-match", search],
    queryFn: ({ signal }) => readPersonal<{ matters: Matter[] }>("/api/personal/practice-operations?q=" + encodeURIComponent(search), { signal }),
    enabled: !!search, retry: false,
  })
  return <form className="grid gap-2" onSubmit={event => { event.preventDefault(); setSearch(input.trim()) }}>
    <label className="grid gap-1.5 text-sm">归入案件
      <Input placeholder="输入案件名称或编号" value={input} onChange={event => setInput(event.target.value)} disabled={busy} /></label>
    <Button variant="outline" size="sm" className="justify-self-start" disabled={busy || !input.trim()}>搜索案件</Button>
    {query.error && <p role="alert" className="text-xs text-destructive">{query.error.message}</p>}
    {query.data?.matters.map(m => <Button key={m.id} variant="secondary" size="sm" type="button" disabled={busy}
      className="h-auto min-h-7 justify-start whitespace-normal text-start" onClick={() => onSelect(m.id)}>归入 {m.internalCode} · {m.title}</Button>)}
    {query.data?.matters.length === 0 && <p className="text-xs text-muted-foreground">未找到可关联案件。</p>}
  </form>
}
