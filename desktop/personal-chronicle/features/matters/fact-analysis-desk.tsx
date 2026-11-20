"use client"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import type { EvidenceNote } from "./case-chronology"
import { ObservationValues, type FactObservation } from "./fact-observation"
import type { FixedSource } from "./fixed-source-preview"
import { sourceOffset } from "./source-selection"
import { evidenceEndpoint, readPersonal, workspaceEndpoint } from "./personal-client"

const states = {
  QUEUED: "排队中", DISPATCHED: "分析中", READY: "待核对", FAILED: "分析失败", UNCERTAIN: "结果未确认", ADOPTED: "已采用",
}
const rejectionLabels = {
  SCHEMA: "字段结构无效", RANGE: "超出授权片段", SOURCE: "引文或字段未能回读", DUPLICATE: "同一出处和字段重复",
} as const
type Rejection = { index: number; fragment?: number; reason: keyof typeof rejectionLabels }
type Run = {
  id: string; model: string; state: keyof typeof states; stale: boolean; rangeCount: number; authorizedCharacters: number
  receipt: { sentCharacters?: number; usage?: { inputTokens: number; outputTokens: number }; error?: string; localRecords?: number; skippedFields?: number; rejected?: Rejection[] } | null
}
type RunDetail = Run & {
  sources: ({ name: string; version: number; location: string } & Span)[]
  candidates: { fragment: number; data: FactObservation["data"] }[]
  adoption: { chosen: number[] } | null
}
type RunList = { destination: { model: string; origin: string } | null; runs: Run[] }
type Span = { start: number; end: number }
type Excerpt = { text: string; ranges: Span[] }
const maxFragmentCharacters = 6000
const maxFragments = 8
const maxCharacters = 36_000

function SourceRangeEditor({ excerpt, disabled, capacity, onRanges }: {
  excerpt: Excerpt; disabled: boolean; capacity: number; onRanges(ranges: Span[]): void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const firstCharacter = useRef<HTMLInputElement>(null)
  const lastCharacter = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(!excerpt.ranges.length)
  const [error, setError] = useState("")
  const length = excerpt.ranges.reduce((total, range) => total + range.end - range.start, 0)
  const entireSource = length === excerpt.text.length && excerpt.ranges.length === 1

  function applyRange(start: number, end: number) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end > excerpt.text.length || end <= start || end - start > maxFragmentCharacters) {
      setError("请在原文范围内选择 1 至 6,000 字符。")
      return
    }
    if ((excerpt.text.codePointAt(start - 1) ?? 0) > 0xFFFF || (excerpt.text.codePointAt(end - 1) ?? 0) > 0xFFFF) {
      setError("所选范围截断了字符，请重新选择。")
      return
    }
    const previous = entireSource ? [] : excerpt.ranges
    if (previous.some(range => start < range.end && range.start < end)) {
      setError("此选区与已选片段重叠。")
      return
    }
    if (previous.length >= capacity) {
      setError("本批已选满 8 段，请先移除一段。")
      return
    }
    onRanges([...previous, { start, end }].sort((a, b) => a.start - b.start))
    setError("")
  }

  function applySelection() {
    if (!input.current) return
    const { selectionStart, selectionEnd } = input.current
    applyRange(sourceOffset(excerpt.text, selectionStart), sourceOffset(excerpt.text, selectionEnd))
  }

  return <details className="ms-6 mt-2 text-xs" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer">{excerpt.ranges.length
      ? "已选 " + excerpt.ranges.length + " 段 · " + length.toLocaleString("zh-CN") + " / " + excerpt.text.length.toLocaleString("zh-CN") + " 字符"
      : "请选择要发送的文字 · 原文共 " + excerpt.text.length.toLocaleString("zh-CN") + " 字符"}</summary>
    <div className="mt-2 grid gap-2">
      <Textarea ref={input} readOnly rows={6} className="max-h-48 resize-y overflow-auto [field-sizing:fixed]"
        aria-label="固定片段原文" value={excerpt.text} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={applySelection}>
          {entireSource ? "改用所选文字" : "添加所选文字"}
        </Button>
      </div>
      <details className="space-y-2">
        <summary className="cursor-pointer text-muted-foreground">输入起止位置</summary>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid w-28 gap-1">起始字符
            <Input ref={firstCharacter} type="number" min={1} max={excerpt.text.length} step={1} />
          </label>
          <label className="grid w-28 gap-1">结束字符
            <Input ref={lastCharacter} type="number" min={1} max={excerpt.text.length} step={1} />
          </label>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() =>
            applyRange((firstCharacter.current?.valueAsNumber ?? NaN) - 1, lastCharacter.current?.valueAsNumber ?? NaN)}>
            {entireSource ? "改用此范围" : "添加此范围"}
          </Button>
        </div>
      </details>
      {excerpt.ranges.length > 0 && <div className="grid gap-1">
        <span className="text-muted-foreground">本次拟发送的文字</span>
        <ul className="grid gap-2">
          {excerpt.ranges.map(range => <li key={range.start} className="grid gap-1 rounded-md bg-muted p-2">
            <div className="flex items-center justify-between gap-2">
              <span>第 {range.start + 1}–{range.end} 个字符</span>
              <Button size="xs" variant="ghost" disabled={disabled} aria-label={"移除第 " + (range.start + 1) + "–" + range.end + " 个字符"}
                onClick={() => { onRanges(excerpt.ranges.filter(item => item !== range)); setError("") }}>移除</Button>
            </div>
            <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{excerpt.text.slice(range.start, range.end)}</p>
          </li>)}
        </ul>
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  </details>
}

const pendingStates = new Set<Run["state"]>(["QUEUED", "DISPATCHED"])
const errors: Record<string, string> = {
  PERMISSION: "已选材料的授权有变，请重新核对。",
  STALE: "要点或分析方法已更新。本批次未发送，请重新确认材料范围。",
  PROVIDER: "应用 AI 请求失败，请检查「设置 → 应用 AI」中的配置和调用记录。",
  UNAVAILABLE: "应用 AI 当前不可用。",
  INVALID_RESULT: "模型返回的结构或原文引用未通过校验。",
  INTERRUPTED: "调用已中断，可能产生费用。重开此批次无需再次提交。",
}

export function FactAnalysisDesk({ matterId, item, onSaved }: {
  matterId: string; item: EvidenceNote; onSaved(): void
}) {
  const [open, setOpen] = useState(false)
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button size="xs" variant="outline" />}>
      <Sparkles data-icon="inline-start" aria-hidden />分析记载
    </SheetTrigger>
    {open && <SheetContent className="overflow-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>分析记载</SheetTitle>
        <SheetDescription>{item.title} · 要点 V{item.revision}</SheetDescription>
      </SheetHeader>
      <AnalysisBody matterId={matterId} item={item} onSaved={() => { setOpen(false); onSaved() }} />
    </SheetContent>}
  </Sheet>
}

function AnalysisBody({ matterId, item, onSaved }: { matterId: string; item: EvidenceNote; onSaved(): void }) {
  const [list, setList] = useState<RunList>()
  const [runId, setRunId] = useState<string>()
  const [run, setRun] = useState<RunDetail>()
  const [excerpts, setExcerpts] = useState<Record<string, Excerpt>>({})
  const [chosen, setChosen] = useState<number[]>([])
  const [loadingSource, setLoadingSource] = useState<string>()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const intent = useRef<{ content: string; id: string }>(null)
  const endpoint = workspaceEndpoint + "?" + new URLSearchParams({ section: "evidence-items", matter: matterId, analysis: item.id })
  const eligible = item.sources.filter(source => source.hasAnchor && source.status === "AVAILABLE")
  const ranges = eligible.flatMap(source => (excerpts[source.id]?.ranges ?? []).map(range => ({ sourceId: source.id, ...range })))
  const selected = Object.values(excerpts)
  const characters = ranges.reduce((sum, range) => sum + range.end - range.start, 0)
  const incomplete = selected.some(excerpt => !excerpt.ranges.length)
  const canSubmit = ranges.length > 0 && ranges.length <= maxFragments && !incomplete && characters <= maxCharacters

  useEffect(() => {
    const controller = new AbortController()
    readPersonal<RunList>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setList(data)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [endpoint])

  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const data = await readPersonal<RunDetail>(endpoint + "&run=" + runId, { signal: controller.signal })
        if (controller.signal.aborted) return
        setRun(data)
        setList(previous => previous && { ...previous, runs: previous.runs.map(entry => entry.id === data.id
          ? { ...entry, state: data.state, stale: data.stale, receipt: data.receipt } : entry) })
        if (pendingStates.has(data.state)) timer = setTimeout(poll, 1600)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取待核批次。")
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [endpoint, runId])

  function openRun(id: string) {
    setError(""); setChosen([]); setRun(undefined); setRunId(id)
  }

  async function selectSource(sourceId: string) {
    setError("")
    if (excerpts[sourceId]) {
      const next = { ...excerpts }
      delete next[sourceId]
      setExcerpts(next)
      return
    }
    setLoadingSource(sourceId)
    try {
      const source = await readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open-evidence-source", matterId, evidenceItemId: item.id, revision: item.revision, sourceId }),
      })
      if (source.status !== "AVAILABLE" || !source.text) { setError("此来源暂时没有可分析的固定文本。"); return }
      const text = source.text
      const ranges = text.length <= maxFragmentCharacters ? [{ start: 0, end: text.length }] : []
      setExcerpts(previous => ({ ...previous, [sourceId]: { text, ranges } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开固定片段。") }
    finally { setLoadingSource(undefined) }
  }

  async function start() {
    if (!list?.destination || !canSubmit) return
    const data = { matterId, evidenceItemId: item.id, expectedRevision: item.revision, ...list.destination, ranges, confirmed: true }
    const content = JSON.stringify(data)
    if (intent.current?.content !== content) intent.current = { content, id: crypto.randomUUID() }
    setSending(true); setError("")
    try {
      const ready = await readPersonal<Run>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-evidence-observation-run", data: { ...data, runId: intent.current.id } }),
      })
      setList(previous => previous && { ...previous, runs: [ready, ...previous.runs.filter(entry => entry.id !== ready.id)] })
      intent.current = null
      openRun(ready.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法安排本次分析。") }
    finally { setSending(false) }
  }

  async function adopt() {
    if (!run || run.state !== "READY" || run.stale || !chosen.length) return
    setSending(true); setError("")
    try {
      await readPersonal(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt-evidence-observation-run", data: {
          matterId, evidenceItemId: item.id, expectedRevision: item.revision, runId: run.id, chosen,
        } }),
      })
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存未完成，请重新核对。") }
    finally { setSending(false) }
  }

  return <div className="grid gap-4 px-4 pb-4">
    {error && <p role="alert" className="rounded-md border bg-muted/45 p-3 text-sm">{error}</p>}
    {runId ? <>
      <Button variant="outline" size="sm" className="justify-self-start" disabled={sending} onClick={() => { setRunId(undefined); setError("") }}>返回批次</Button>
      {!run && !error && <InlineLoading label="正在读取待核批次…" />}
      {run && <>
        <div className="grid gap-1 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{states[run.state]}</Badge><span>{run.model}</span></div>
          <p className="text-xs text-muted-foreground">{run.rangeCount} 段 · 授权 {run.authorizedCharacters} 字符
            {run.receipt?.sentCharacters !== undefined && " · 已读取 " + run.receipt.sentCharacters + " 字符"}</p>
          {run.receipt?.usage && <p className="text-xs text-muted-foreground">输入 {run.receipt.usage.inputTokens} tokens · 输出 {run.receipt.usage.outputTokens} tokens</p>}
        {!!run.receipt?.localRecords && <p>本机规则读取 {run.receipt.localRecords} 条记载。</p>}
        {!!run.receipt?.skippedFields && <p>{run.receipt.skippedFields} 个可选字段未通过核对，已保留可定位原文。</p>}
        {!!run.receipt?.rejected?.length && <details>
          <summary className="cursor-pointer">{run.receipt.rejected.length} 条候选未通过校验</summary>
          <ul className="mt-1 list-inside list-disc">{run.receipt.rejected.map(entry => <li key={entry.index}>
            第 {entry.index + 1} 条{entry.fragment && " · 片段 " + entry.fragment} · {rejectionLabels[entry.reason]}
          </li>)}</ul>
        </details>}
          {run.receipt?.error && <p>{errors[run.receipt.error] ?? "该批次需重新核对。"}</p>}
          {run.stale && run.state === "READY" && <p>当前要点有新修订，此批次可回查。</p>}
        </div>
        {run.state === "READY" && !run.candidates.length && <p className="text-sm text-muted-foreground">已选片段中没有提取到相关事实记载。</p>}
        {run.candidates.length > 0 && <ol className="grid gap-2">
          {run.candidates.map((candidate, index) => {
            const source = run.sources[candidate.fragment - 1]
            return <li key={index} className="grid gap-2 rounded-lg border p-3">
              <label className="flex items-start gap-2">
                {run.state === "READY" && !run.stale && <Checkbox checked={chosen.includes(index)} disabled={sending}
                  onCheckedChange={value => setChosen(previous => value ? [...previous, index] : previous.filter(id => id !== index))} />}
                <span className="min-w-0 break-words text-xs font-medium">{source.name} · V{source.version} · {source.location} · 第 {source.start + 1}–{source.end} 个字符</span>
                {run.adoption?.chosen.includes(index) && <Badge variant="secondary">已采用</Badge>}
              </label>
              <div className="text-xs"><ObservationValues detailed observation={{ id: String(index), sourceId: "", revision: 1, data: candidate.data }} /></div>
            </li>
          })}
        </ol>}
        {run.state === "READY" && !run.stale && run.candidates.length > 0 &&
          <Button className="justify-self-end" disabled={sending || !chosen.length} onClick={() => void adopt()}>采用选中记载{chosen.length ? "（" + chosen.length + "）" : ""}</Button>}
      </>}
    </> : <>
      {!list && !error && <InlineLoading label="正在读取分析记录…" />}
      {list?.destination && item.canEdit && <section aria-label="选择分析片段" className="grid gap-3">
        <p className="text-sm">模型 {list.destination.model} · {list.destination.origin}</p>
        {eligible.length ? <ul className="grid gap-2">
          {eligible.map(source => {
            const excerpt = excerpts[source.id]
            return <li key={source.id} className="rounded-md border p-2.5">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={!!excerpt} disabled={!!loadingSource || sending || (!excerpt && (selected.length >= maxFragments || ranges.length >= maxFragments))}
                  onCheckedChange={() => void selectSource(source.id)} />
                <span className="min-w-0 break-words">{source.documentName} · V{source.documentVersion} · {source.locationLabel}</span>
              </label>
              {loadingSource === source.id && <p role="status" className="mt-2 text-xs">正在打开固定片段…</p>}
              {excerpt && <SourceRangeEditor excerpt={excerpt} disabled={sending}
                capacity={maxFragments - ranges.length + excerpt.ranges.length} onRanges={next =>
                  setExcerpts(previous => ({ ...previous, [source.id]: { text: excerpt.text, ranges: next } }))} />}
            </li>
          })}
        </ul> : <p className="text-sm text-muted-foreground">请选择并关联已解析的案卷出处。</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            已选 {ranges.length} / {maxFragments} 段 · {characters.toLocaleString("zh-CN")} / {maxCharacters.toLocaleString("zh-CN")} 字符
            {characters > maxCharacters && " · 超出字数上限"}
            {incomplete && " · 尚有来源未选文字"}
          </p>
          <Button disabled={sending || !!loadingSource || !canSubmit} onClick={() => void start()}>确认送出并分析</Button>
        </div>
      </section>}
      {list && !list.destination && <p className="rounded-md border bg-muted/40 p-3 text-sm">请在「设置 → 应用 AI」设置模型。已保存的批次仍可读取。</p>}
      {list?.runs.length ? <section aria-label="分析批次" className="grid gap-2">
        <h3 className="text-sm font-medium">分析批次</h3>
        {list.runs.map(entry => <Button key={entry.id} variant="outline" className="h-auto justify-between py-2 text-left" onClick={() => openRun(entry.id)}>
          <span>{entry.model} · {entry.rangeCount} 段</span><Badge variant="outline">{states[entry.state]}</Badge>
        </Button>)}
      </section> : null}
    </>}
  </div>
}
