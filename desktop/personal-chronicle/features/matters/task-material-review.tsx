"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import type {
  TaskMaterialReviewContext, TaskReviewDetail, TaskReviewHistory, TaskReviewOption,
} from "../../../../src/server/tasks/material-review-contract"

const dateTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })
export type ReviewContext = { matterId: string; task: TaskMaterialReviewContext; onSaved: (id: string) => void }
export type ReviewDraftState = { dirty: boolean; busy: boolean }
export const blankReviewDraft = { dirty: false, busy: false }

function historyUrl(matterId: string, taskId: string, args?: Record<string, string>) {
  return new URLSearchParams({ section: "task-material-reviews", matter: matterId, task: taskId, ...args })
}

export function TaskMaterialReviewForm({ matterId, task, ids, onSaved, onDraftState, onCancel }: ReviewContext & {
  ids: string[]; onDraftState: (state: ReviewDraftState) => void; onCancel: () => void
}) {
  const [content, setContent] = useState("")
  const [pages, setPages] = useState<Record<string, number>>({})
  const [requestKey] = useState(() => crypto.randomUUID())
  const [revision] = useState(task.reviewRevision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const dirty = content.length > 0 || Object.keys(pages).length > 0
  useEffect(() => onDraftState({ dirty, busy }), [onDraftState, dirty, busy])
  const options = useQuery({
    queryKey: ["task-review-options", matterId, task.id, ids],
    retry: false, refetchOnMount: "always",
    queryFn: ({ signal }) => {
      const query = historyUrl(matterId, task.id)
      ids.forEach(id => query.append("document", id))
      return readPersonal<TaskReviewOption[]>(workspaceEndpoint + "?" + query, { signal })
    },
  })
  const sources = options.isSuccess && !options.isFetching ? options.data : undefined

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !sources || !content.trim() || revision === null) return
    setBusy(true)
    setError("")
    try {
      const result = await readPersonal<{ id: string }>(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-task-material-review", matterId, taskId: task.id, requestKey,
          taskRevision: revision, content, sources: sources.map(row => ({ documentId: row.id, page: pages[row.id] ?? null })),
        }) })
      onSaved(result.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "核对意见暂未保存。")
    } finally {
      setBusy(false)
    }
  }

  return <form className="grid gap-3" onSubmit={save}>
    <fieldset className="grid gap-3" disabled={busy}>
      <label className="grid gap-1.5 text-sm font-medium">
        核对意见
        <Textarea className="min-h-32 font-normal" autoFocus maxLength={2000} required placeholder="哪些材料相互印证？还需补核什么？"
          value={content} onChange={event => setContent(event.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">引用 {ids.length} 份固定版本。已知 PDF 页码可选填。</p>
      {options.isFetching && <p role="status" className="text-sm text-muted-foreground">正在核对选中文件…</p>}
      {options.isError && <div role="alert" className="grid gap-2 text-sm">
        <p>{options.error.message}</p><Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => void options.refetch()}>重新读取材料</Button>
      </div>}
      {sources && <ul className="max-h-52 overflow-y-auto divide-y rounded-lg border">
        {sources.map(source => <li key={source.id} className="grid min-w-0 gap-2 px-3 py-2 text-sm">
          <span className="flex items-start gap-2"><FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="break-all">{source.name} · V{source.version}</span>
          </span>
          {source.pdfPages && <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            页码（1–{source.pdfPages}）
            <Input className="w-24" type="number" aria-label={source.name + "页码"} min={1} max={Math.min(10000, source.pdfPages)}
              value={pages[source.id] ?? ""} onChange={event => {
                const page = event.currentTarget.valueAsNumber
                setPages(previous => {
                  const next = { ...previous }
                  if (Number.isNaN(page)) delete next[source.id]
                  else next[source.id] = page
                  return next
                })
              }} />
          </label>}
        </li>)}
      </ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!sources || !content.trim() || revision === null}>
          {busy ? "正在保存…" : "保存核对记录"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </fieldset>
  </form>
}

export function DiscardTaskReview({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return <div role="alert" className="grid gap-2 rounded-lg border bg-muted p-3 text-sm">
    <p>放弃本次未保存的核对意见？</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onKeep}>继续编辑</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>放弃意见</Button>
    </div>
  </div>
}

export function TaskMaterialReviewSheet({ context, documents, onClose }: {
  context: ReviewContext; documents: string[]; onClose: () => void
}) {
  const [draftState, setDraftState] = useState<ReviewDraftState>(blankReviewDraft)
  const [discard, setDiscard] = useState(false)
  function requestClose() {
    if (draftState.busy) return
    if (draftState.dirty) setDiscard(true)
    else onClose()
  }
  return <Sheet open onOpenChange={open => { if (!open) requestClose() }}>
    <SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>记录核对意见</SheetTitle><SheetDescription>{context.task.title}</SheetDescription></SheetHeader>
      <div className="grid gap-3 px-4 pb-4">
        <TaskMaterialReviewForm {...context} ids={documents} onDraftState={setDraftState} onCancel={requestClose} />
        {discard && <DiscardTaskReview onKeep={() => setDiscard(false)} onDiscard={onClose} />}
      </div>
    </SheetContent>
  </Sheet>
}

export function TaskMaterialReviewHistory({ matterId, task, initialRecord, onClose }: {
  matterId: string; task: TaskMaterialReviewContext; initialRecord: string | null; onClose: () => void
}) {
  const [cursor, setCursor] = useState<string>()
  const [selected, setSelected] = useState(initialRecord)
  const [reading, setReading] = useState<string>()
  const history = useQuery({
    queryKey: ["task-review-history", matterId, task.id, cursor], retry: false, refetchOnMount: "always",
    queryFn: ({ signal }) => readPersonal<TaskReviewHistory>(workspaceEndpoint + "?" + historyUrl(matterId, task.id, cursor ? { cursor } : undefined), { signal }),
  })
  const detail = useQuery({
    queryKey: ["task-review-detail", matterId, task.id, selected], enabled: !!selected, retry: false, refetchOnMount: "always",
    queryFn: ({ signal }) => readPersonal<TaskReviewDetail>(workspaceEndpoint + "?" + historyUrl(matterId, task.id, { record: selected! }), { signal }),
  })
  const active = detail.isSuccess && !detail.isFetching && detail.data.state === "AVAILABLE" ? detail.data : null
  const original = active?.sources.find(source => source.documentId === reading)

  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[57rem] motion-reduce:transition-none">
      <SheetHeader><SheetTitle>核对记录</SheetTitle><SheetDescription>{task.title}</SheetDescription></SheetHeader>
      <div className="grid items-start gap-3 px-4 pb-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>历史记录</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {history.isFetching && <p role="status" className="text-muted-foreground">正在读取核对记录…</p>}
            {history.isError && <p role="alert">{history.error.message}</p>}
            {history.isError && <Button size="sm" variant="outline" onClick={() => void history.refetch()}>重试</Button>}
            {history.isSuccess && !history.isFetching && history.data.items.length === 0 && <p className="text-muted-foreground">暂无核对记录。</p>}
            {history.isSuccess && !history.isFetching && <ul className="divide-y">
              {history.data.items.map(row => <li key={row.id}>
                <Button size="sm" variant="ghost" aria-pressed={selected === row.id} onClick={() => { setReading(undefined); setSelected(row.id) }}
                  className="flex h-auto w-full justify-between gap-2 whitespace-normal px-2 py-2 text-start aria-pressed:bg-muted">
                  <span className="grid min-w-0 break-words">
                    <span>{dateTime.format(new Date(row.createdAt))}</span>
                    <span className="text-xs text-muted-foreground">{row.author} · {row.sourceCount} 份材料</span>
                  </span><ChevronRight className="size-4 shrink-0" />
                </Button>
              </li>)}
            </ul>}
            {cursor && <Button size="sm" variant="outline" onClick={() => setCursor(undefined)}>返回第一页</Button>}
            {history.data?.nextCursor && !history.isFetching && <Button size="sm" variant="outline" onClick={() => setCursor(history.data.nextCursor ?? undefined)}>下一页</Button>}
          </CardContent>
        </Card>
        <div className="grid min-w-0 gap-3">
          {!selected && <p className="text-sm text-muted-foreground">选择一条历史记录查看意见和引用材料。</p>}
          {selected && detail.isFetching && <p role="status" className="text-sm text-muted-foreground">正在核验记录和原件…</p>}
          {selected && detail.isError && <div role="alert" className="grid gap-2">
            <p>{detail.error.message}</p><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>重试</Button>
          </div>}
          {selected && detail.isSuccess && !detail.isFetching && detail.data.state === "UNAVAILABLE" &&
            <p role="status" className="text-sm">关联的固定材料已撤回或不可查看，意见及引用暂不可读取。</p>}
          {active && <Card>
            <CardHeader><CardTitle>已保存意见</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-xs text-muted-foreground">{active.author} · {dateTime.format(new Date(active.createdAt))}</p>
              <p className="whitespace-pre-wrap break-words">{active.content}</p>
              <ul className="divide-y border-t">
                {active.sources.map(source => <li key={source.documentId}>
                  <Button size="sm" variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-start aria-pressed:bg-muted"
                    aria-pressed={source.documentId === reading}
                    onClick={() => setReading(source.documentId)}>
                    <FileText data-icon="inline-start" /><span className="break-all">{source.name} · V{source.version} · {source.page ? "第 " + source.page + " 页" : "整份原件"}</span>
                  </Button>
                </li>)}
              </ul>
            </CardContent>
          </Card>}
          {original && <Card>
            <CardHeader><CardTitle>{original.name} · V{original.version}</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {original.previewUrl && <iframe key={original.documentId} className="h-80 w-full rounded-md border" src={original.previewUrl} title="核对意见引用原文" />}
              <Button size="sm" variant="outline" className="justify-self-start" nativeButton={false}
                render={<a href={original.downloadUrl} download />}>下载固定版本</Button>
            </CardContent>
          </Card>}
        </div>
      </div>
    </SheetContent>
  </Sheet>
}
