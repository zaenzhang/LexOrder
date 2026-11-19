"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FixedSourcePreview, type FixedSource } from "./fixed-source-preview"
import { evidenceEndpoint, readPersonal } from "./personal-client"

export const kinds = { FACT: "事实", CLAIM: "当事人陈述", ANALYSIS: "分析", ISSUE: "争点", TODO_VERIFY: "待核实" }
export const relations = { SUPPORTS: "支持", REBUTS: "反驳", CONTEXT: "背景" }
export type EventDate = { precision: "EXACT" | "RANGE" | "UNKNOWN"; start: string | null; end: string | null; text: string | null }
type Source = {
  id: string; documentId: string | null; documentName: string | null; documentVersion: number | null
  relation: keyof typeof relations | null; legacy: boolean; status: string; locationLabel: string | null
}
export type EvidenceNote = {
  id: string; kind: keyof typeof kinds; title: string; content: string; revision: number; confirmedAt: string | null
  restricted: boolean; canEdit: boolean; sources: Source[]; eventDate: EventDate | null
}

const views = [["timeline", "时间轴"], ["matrix", "对照矩阵"], ["narrative", "事实经过"]] as const
const matrixPageSize = 8
type Selection = { itemId: string; revision: number; sourceId?: string }

function dateLabel(item: EvidenceNote) {
  if (item.restricted) return "来源受限"
  const date = item.eventDate
  return [date?.start, date?.end].filter(Boolean).join(" 至 ") || date?.text || "时间未明"
}

export function CaseChronology({ matterId, items, onEdit }: {
  matterId: string; items: EvidenceNote[]; onEdit(item: EvidenceNote, action: "revise" | "link" | "unlink"): void
}) {
  const [view, setView] = useState<(typeof views)[number][0]>("timeline")
  const [selection, setSelection] = useState<Selection>()
  const [onlyPending, setOnlyPending] = useState(false)
  const [matrixPage, setMatrixPage] = useState(0)
  const rows = items.filter(item => !onlyPending || !item.confirmedAt)
    .sort((a, b) => (a.eventDate?.start ?? "9999").localeCompare(b.eventDate?.start ?? "9999"))
  const narrative = rows.filter(item => item.kind === "FACT" || item.kind === "CLAIM")
  const viewRows = view === "narrative" ? narrative : rows
  const selected = viewRows.find(item => item.id === selection?.itemId) ?? viewRows[0]
  const activeSource = selected && !selected.restricted && selection?.itemId === selected.id && selection.revision === selected.revision
    ? selected.sources.find(source => source.id === selection.sourceId && source.status === "AVAILABLE")
    : undefined

  function open(item: EvidenceNote, source?: Source) {
    setSelection({ itemId: item.id, revision: item.revision, sourceId: source?.id })
  }

  const lastPage = Math.max(0, Math.ceil(rows.length / matrixPageSize) - 1)
  const page = Math.min(matrixPage, lastPage)
  const matrixRows = rows.slice(page * matrixPageSize, (page + 1) * matrixPageSize)
  const columns = new Map<string, Source>()
  const matrix = view === "matrix" ? matrixRows.map(item => {
    const byDocument = new Map<string, Source[]>()
    if (!item.restricted) for (const source of item.sources) {
      if (source.status !== "AVAILABLE" || !source.documentId) continue
      columns.set(source.documentId, source)
      const entries = byDocument.get(source.documentId)
      if (entries) entries.push(source)
      else byDocument.set(source.documentId, [source])
    }
    return { item, byDocument }
  }) : []

  return <section aria-label="案件事实看板" className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="看板视图">
        {views.map(([value, label]) => <Button key={value} size="sm" variant={view === value ? "default" : "outline"}
          aria-pressed={view === value} onClick={() => {
            if (value === "matrix") setMatrixPage(Math.max(0, Math.floor(rows.findIndex(item => item.id === selected?.id) / matrixPageSize)))
            setView(value)
          }}>{label}</Button>)}
      </div>
      <label className="ml-auto flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyPending} onChange={event => { setOnlyPending(event.target.checked); setMatrixPage(0) }} />
        仅待核对
      </label>
    </div>

    {!viewRows.length ? <p className="text-sm text-muted-foreground">没有符合条件的记录。</p> :
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-3">
          {view === "timeline" && <Timeline rows={rows} selectedId={selected?.id} onSelect={open} />}
          {view === "matrix" && <>
            <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">各份材料与事实要点的出处对照</caption>
                <thead className="bg-muted/50"><tr>
                  <th scope="col" className="min-w-40 px-3 py-2">事实要点</th>
                  {Array.from(columns, ([id, source]) => <th key={id} scope="col" className="min-w-36 px-3 py-2">
                    {source.documentName} · V{source.documentVersion}
                  </th>)}
                </tr></thead>
                <tbody>{matrix.map(({ item, byDocument }) => <tr key={item.id} className={item.id === selected?.id ? "border-t bg-muted/40" : "border-t"}>
                  <th scope="row" className="px-3 py-2 align-top">
                    <Button size="sm" variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => open(item)}>{item.title}</Button>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">{dateLabel(item)}</p>
                  </th>
                  {Array.from(columns.keys(), id => <td key={id} className="px-3 py-2 align-top">
                    {item.restricted ? <span aria-label="来源受限">—</span> : byDocument.get(id)?.map(source => <Button key={source.id} size="sm" variant={activeSource?.id === source.id ? "secondary" : "ghost"}
                        className="h-auto whitespace-normal text-left" onClick={() => open(item, source)}>
                        {relations[source.relation ?? "CONTEXT"]} · {source.locationLabel ?? "原件"}
                      </Button>)}
                  </td>)}
                </tr>)}</tbody>
              </table>
            </div>
            {lastPage > 0 && <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setMatrixPage(page - 1)}>上一页</Button>
              <span className="text-xs text-muted-foreground">{page + 1} / {lastPage + 1}</span>
              <Button size="sm" variant="outline" disabled={page === lastPage} onClick={() => setMatrixPage(page + 1)}>下一页</Button>
            </div>}
          </>}
          {view === "narrative" && <Card><CardContent className="space-y-4 text-sm">
            {narrative.map(item => <article key={item.id} className="space-y-1 border-b pb-3 last:border-0">
              <Button size="sm" variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => open(item)}>{item.title}</Button>
              <p className="text-xs text-muted-foreground">{dateLabel(item)} · {kinds[item.kind]} · {item.confirmedAt ? "已核对" : "待核对"}</p>
              {!item.restricted && <p className="whitespace-pre-wrap break-words">{item.content}</p>}
              {!item.restricted && item.sources.filter(source => source.status === "AVAILABLE").map(source => <Button
                key={source.id} size="sm" variant="outline" className="mr-1 h-auto whitespace-normal text-left" onClick={() => open(item, source)}>
                {source.documentName} · V{source.documentVersion}
              </Button>)}
            </article>)}
          </CardContent></Card>}
        </div>

        {selected && <Card role="region" aria-label="要点与出处" className="min-w-0">
          <CardHeader><CardTitle className="break-words">{selected.title}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {kinds[selected.kind]} · {dateLabel(selected)} · V{selected.revision} · {selected.confirmedAt ? "已核对" : "待核对"}
            </p>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-3 text-sm">
            {selected.restricted ? <p>部分出处不可读。</p> : <>
              <p className="whitespace-pre-wrap break-words">{selected.content}</p>
              {selected.eventDate?.start && selected.eventDate.text && <p className="text-muted-foreground">原始时间表述 · {selected.eventDate.text}</p>}
              {selected.sources.map(source => <Button key={source.id} size="sm" disabled={source.status !== "AVAILABLE"}
                variant={source.id === activeSource?.id ? "secondary" : "outline"} className="h-auto justify-start whitespace-normal text-left"
                onClick={() => open(selected, source)}>
                {relations[source.relation ?? "CONTEXT"]} · {source.documentName ?? "来源不可用"}{source.documentVersion && " · V" + source.documentVersion}
                {source.locationLabel && " · " + source.locationLabel}
              </Button>)}
              {!selected.sources.length && <p className="text-muted-foreground">尚未关联出处。</p>}
              {activeSource && <ChronologySource key={JSON.stringify([selected.id, selected.revision, activeSource.id])}
                matterId={matterId} item={selected} source={activeSource} onClose={() => open(selected)} />}
              {selected.canEdit && <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={() => onEdit(selected, "revise")}>修订要点</Button>
                <Button size="sm" variant="outline" onClick={() => onEdit(selected, "link")}>关联来源</Button>
                {selected.sources.some(source => !source.legacy) && <Button size="sm" variant="ghost" onClick={() => onEdit(selected, "unlink")}>撤回来源关系</Button>}
              </div>}
            </>}
          </CardContent>
        </Card>}
      </div>}
  </section>
}

const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / 86400000

function Timeline({ rows, selectedId, onSelect }: {
  rows: EvidenceNote[]; selectedId?: string; onSelect(item: EvidenceNote): void
}) {
  const dated = rows.flatMap(item => item.eventDate?.start && !item.restricted ? [{
    item, start: dayNumber(item.eventDate.start), end: dayNumber(item.eventDate.end ?? item.eventDate.start),
  }] : [])
  const undated = rows.filter(item => !item.eventDate?.start || item.restricted)
  const first = dated[0]
  const last = dated.reduce((latest, event) => event.end > latest.end ? event : latest, first)
  const span = first ? Math.max(1, last.end - first.start) : 1
  const selectedVariant = (id: string) => id === selectedId ? "secondary" : "ghost"
  return <Card aria-label="时间轴事件"><CardContent className="grid gap-3">
    {first && <div className="flex justify-between gap-2 text-xs text-muted-foreground">
      <span>{first.item.eventDate?.start}</span><span>{last.item.eventDate?.end ?? last.item.eventDate?.start}</span>
    </div>}
    <ol className="grid gap-2">
      {dated.map(({ item, start, end }) => <li key={item.id} className="grid gap-1">
        <div className="relative mx-2 h-3" aria-hidden>
          <div className="absolute inset-x-0 top-1.5 border-t" />
          <span className="absolute top-0.5 h-2 min-w-2 -translate-x-1 rounded-full bg-primary"
            style={{ left: `${100 * (start - first.start) / span}%`, width: `${100 * (end - start) / span}%` }} />
        </div>
        <Button size="sm" variant={selectedVariant(item.id)} aria-pressed={selectedId === item.id}
          className="h-auto justify-between gap-3 whitespace-normal text-left"
          onClick={() => onSelect(item)}>
          <span className="break-words">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{dateLabel(item)}</span>
        </Button>
      </li>)}
    </ol>
    {undated.length > 0 && <div className="grid gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">时间未明与受限要点</h3>
      {undated.map(item => <Button key={item.id} size="sm" variant={selectedVariant(item.id)} aria-pressed={selectedId === item.id}
        className="h-auto justify-start whitespace-normal text-left" onClick={() => onSelect(item)}>{item.title}
        {item.restricted && <Badge variant="secondary">来源受限</Badge>}</Button>)}
    </div>}
  </CardContent></Card>
}

function ChronologySource({ matterId, item, source, onClose }: {
  matterId: string; item: EvidenceNote; source: Source; onClose(): void
}) {
  const [preview, setPreview] = useState<FixedSource>()
  const [error, setError] = useState("")
  const { id, revision } = item
  const sourceId = source.id
  useEffect(() => {
    const controller = new AbortController()
    readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ action: "open-evidence-source", matterId, evidenceItemId: id, revision, sourceId }),
    }).then(result => {
      if (controller.signal.aborted) return
      if (result.status === "AVAILABLE") setPreview(result)
      else setError("该出处当前不可用。")
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, id, revision, sourceId])

  return <section aria-label="固定出处" className="grid min-w-0 gap-3 rounded-md border p-3">
    <Button size="sm" variant="ghost" className="justify-self-end" onClick={onClose}>关闭出处</Button>
    {preview ? <FixedSourcePreview source={preview} /> : error ? <p role="alert">{error}</p> : <p role="status">正在打开出处…</p>}
  </section>
}