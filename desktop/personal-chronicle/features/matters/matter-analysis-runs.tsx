"use client"

import { useState } from "react"
import Link from "@/features/shell/workspace-link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ObservationValues, type FactObservation } from "./fact-observation"
import { CaseGroupingPanel } from "./case-grouping-panel"
import { MatterCandidateAdoption, type AdoptionTarget, type CandidatePick, type SavedAdoption } from "./matter-candidate-adoption"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import type { ObservationEventHint } from "../../../../src/lib/evidence/chronology-assessment"
import type { MatterInputCoverageView, MatterAnalysisPlan } from "../../../../src/lib/ai/input-coverage"

const states = { QUEUED: "排队中", DISPATCHED: "正在分析", READY: "候选已生成", FAILED: "分析失败", UNCERTAIN: "结果未确认", ADOPTED: "已采用" }
const rejectionLabels = {
  SCHEMA: "字段结构无效", RANGE: "超出授权片段", SOURCE: "引文或字段未能回读", DUPLICATE: "同一出处和字段重复",
} as const
type Rejection = { index: number; fragment?: number; reason: keyof typeof rejectionLabels }
type Run = { id: string; model: string; createdAt: string; state: keyof typeof states; rangeCount: number; authorizedCharacters: number;
  receipt: { sentCharacters?: number; usage?: { inputTokens: number; outputTokens: number }; error?: string; localRecords?: number; skippedFields?: number; rejected?: Rejection[] } | null }
type RunDetail = Run & {
  sources: { name: string; version: number; location: string; start: number; end: number }[]
  candidates: { fragment: number; data: FactObservation["data"]; hint?: ObservationEventHint }[]
  canAdopt: boolean
  caseAdoptions: { index: number; evidenceItemId: string; revision: number }[]
}
type Destination = { model: string; origin: string }
type RunList = { destination: Destination | null; runs: Run[]; nextCursor: string | null }
const number = (value: number) => value.toLocaleString("zh-CN")
const runDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
})
const active = (run: Run | undefined) => run?.state === "QUEUED" || run?.state === "DISPATCHED"

export function MatterAnalysisRuns({ matterId, coverage, targets, onAdopted, onOpenItem }: {
  matterId: string; coverage?: MatterInputCoverageView; targets?: AdoptionTarget[]; onAdopted?(): void; onOpenItem?(): void
}) {
  const [selected, setSelected] = useState<string>()
  const [excerptPick, setExcerptPick] = useState<{ runId: string; index: number; fragment: number }>()
  const [picks, setPicks] = useState<CandidatePick[]>([])
  const [draftGroup, setDraftGroup] = useState(0)
  const [committing, setCommitting] = useState(false)
  const [saved, setSaved] = useState<SavedAdoption>()
  const [pages, setPages] = useState<string[]>([])
  const cursor = pages.at(-1) ?? null
  const client = useQueryClient()
  const key = ["chronicle", "matter-analysis", matterId]
  const endpoint = workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items", analysis: "case" })
  const list = useQuery({
    queryKey: [...key, "list", cursor],
    queryFn: ({ signal }) => readPersonal<RunList>(cursor ? endpoint + "&runCursor=" + cursor : endpoint, { signal }), retry: false,
    refetchInterval: query => query.state.data?.runs.some(active) ? 2000 : false,
  })
  const detail = useQuery({
    queryKey: [...key, selected], enabled: !!selected, retry: false,
    queryFn: ({ signal }) => readPersonal<RunDetail>(endpoint + "&run=" + selected, { signal }),
    refetchInterval: query => active(query.state.data) ? 1500 : false,
  })
  const excerpt = useQuery({
    queryKey: [...key, excerptPick?.runId, "fragment", excerptPick?.fragment],
    enabled: !!excerptPick && excerptPick.runId === selected, retry: false,
    queryFn: ({ signal }) => readPersonal<{ text: string }>(endpoint + "&run=" + excerptPick!.runId + "&fragment=" + excerptPick!.fragment, { signal }),
  })
  const submit = useMutation({
    mutationFn: ({ destination, batch }: { destination: Destination; batch: MatterAnalysisPlan["batches"][number] }) => readPersonal<Run>(workspaceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start-matter-observation-run", data: { matterId, runId: crypto.randomUUID(), confirmed: true, ...destination,
        ranges: batch.ranges.map(({ documentId, parseRunId, anchorId, start, end }) => ({ documentId, parseRunId, anchorId, start, end })),
      } }),
    }),
    onSuccess: run => {
      setPages([])
      setSelected(run.id)
      void client.invalidateQueries({ queryKey: [...key, "list"] })
    },
  })
  const plan = coverage?.analysisPlan
  const materials = new Map(coverage?.items.flatMap(item => item.status === "AVAILABLE" ? [[item.documentId, item] as const] : []))
  const run = detail.data
  const destination = list.data?.destination
  const adopted = new Map(run?.caseAdoptions.map(entry => [entry.index, entry]))

  function remove({ runId, index }: CandidatePick) {
    setPicks(current => current.filter(pick => pick.runId !== runId || pick.index !== index))
  }

  function itemLink(id: string) {
    return "/matters/" + matterId + "/evidence/graph?item=" + id
  }

  return <section aria-label="案级分析批次" className="grid gap-3">
    {plan && <section aria-label="建议分析批次" className="grid gap-2">
      <p role="status" className="text-sm">{plan.batches.length} 个建议批次 · {number(plan.plannedCharacters)} 字符</p>
      {plan.unplannedCharacters > 0 && <p className="text-xs text-muted-foreground">另有 {number(plan.unplannedCharacters)} 字符超过本次预检的分段上限。</p>}
      {destination && <p className="text-sm">应用 AI · {destination.model} · {destination.origin}</p>}
      {list.data && !destination && plan.batches.length > 0 && <p className="text-sm text-muted-foreground">在「技能与模板 → 应用 AI」配置模型后可确认发送。</p>}
      {plan.batches.map((batch, index) => <Collapsible key={index} className="rounded-md border">
        <CollapsibleTrigger render={<Button variant="ghost" className="group h-auto w-full justify-between whitespace-normal text-start" />}>
          第 {index + 1} 批 · {batch.ranges.length} 段 · {number(batch.characters)} 字符
          <ChevronDownIcon aria-hidden className="size-3.5 group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 px-3 pb-2 pt-1">
          <ul className="grid gap-2 text-xs text-muted-foreground">
            {batch.ranges.map(range => {
              const material = materials.get(range.documentId)!
              return <li key={range.documentId + "/" + range.anchorId + "/" + range.start}>
                {material.documentName} · V{material.documentVersion} · {range.locationLabel} · 第 {range.start + 1}–{range.end} 个字符
              </li>
            })}
          </ul>
          {destination && <Button size="sm" className="justify-self-start" disabled={submit.isPending}
            onClick={() => submit.mutate({ destination, batch })}>确认发送第 {index + 1} 批</Button>}
        </CollapsibleContent>
      </Collapsible>)}
    </section>}
    {submit.error && <p className="text-sm text-destructive" role="alert">{submit.error.message}</p>}
    {list.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{list.error.message}</span><Button variant="outline" size="sm" onClick={() => void list.refetch()}>重试</Button>
    </div> : list.isPending ? <p role="status" className="text-sm">正在读取分析记录…</p>
      : list.data.runs.length ? <>
        <h3 className="text-sm font-semibold">分析记录</h3>
        <ul aria-label="本页分析批次" tabIndex={0} className="grid max-h-48 gap-1 overflow-y-auto p-0.5">{list.data.runs.map(entry => <li key={entry.id}>
          <Button variant="outline" className="w-full justify-between" aria-pressed={selected === entry.id}
            onClick={() => setSelected(entry.id)}>
            <span className="min-w-0 truncate">{runDate.format(new Date(entry.createdAt))} · {entry.model} · {entry.rangeCount} 段</span>
            <Badge variant="outline">{states[entry.state]}</Badge>
          </Button>
        </li>)}</ul>
        {(cursor || list.data.nextCursor) && <nav aria-label="分析记录分页" className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setPages(current => current.slice(0, -1))}>上一页</Button>
          <span className="text-xs text-muted-foreground">第 {pages.length + 1} 页</span>
          <Button variant="outline" size="sm" disabled={!list.data.nextCursor}
            onClick={() => setPages(current => [...current, list.data.nextCursor!])}>下一页</Button>
        </nav>}
      </> : !plan && <p className="text-sm text-muted-foreground">本案暂无分析记录。</p>}
    {selected && (detail.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{detail.error.message}</span><Button variant="outline" size="sm" onClick={() => void detail.refetch()}>重试</Button>
    </div> : run ? <div className="grid gap-3 rounded-md border p-3">
      <div className="space-y-1 text-xs text-muted-foreground">
        <Badge variant="outline">{states[run.state]}</Badge>
        <p>授权 {number(run.authorizedCharacters)} 字符
          {run.receipt?.sentCharacters != null && " · 已发送 " + number(run.receipt.sentCharacters) + " 字符"}</p>
        {run.receipt?.usage && <p>Token 输入 {number(run.receipt.usage.inputTokens)} · 输出 {number(run.receipt.usage.outputTokens)}</p>}
        {!!run.receipt?.localRecords && <p>本机规则读取 {run.receipt.localRecords} 条记载。</p>}
        {!!run.receipt?.skippedFields && <p>{run.receipt.skippedFields} 个可选字段未通过核对，已保留可定位原文。</p>}
        {!!run.receipt?.rejected?.length && <details>
          <summary className="cursor-pointer">{run.receipt.rejected.length} 条候选未通过校验</summary>
          <ul className="mt-1 list-inside list-disc">{run.receipt.rejected.map(entry => <li key={entry.index}>
            第 {entry.index + 1} 条{entry.fragment && " · 片段 " + entry.fragment} · {rejectionLabels[entry.reason]}
          </li>)}</ul>
        </details>}
        {run.state === "UNCERTAIN" && <p>此次调用结果未确认，请查看应用 AI 的调用记录。</p>}
        {run.state === "FAILED" && <p>未生成待核稿，请检查材料读取权限或应用 AI 的调用记录。</p>}
      </div>
      {run.state === "READY" && !run.candidates.length && <p className="text-sm">这批原文未提取到事实记载。</p>}
      <ul aria-label="本批候选" tabIndex={0} className="max-h-72 divide-y overflow-y-auto p-0.5">{run.candidates.map((candidate, index) => {
        const source = run.sources[candidate.fragment - 1]
        const sourceLabel = source.name + " · V" + source.version + " · " + source.location
        const used = adopted.get(index)
        const showingExcerpt = excerptPick?.runId === run.id && excerptPick.index === index
        const pick = { runId: run.id, index, source: sourceLabel, hint: candidate.hint,
          quote: [candidate.data.excerpt?.text, candidate.data.date?.text, candidate.data.amount?.text, candidate.data.participants?.map(person => person.text).join("、")]
            .filter(Boolean).join(" · ") }
        const checked = picks.some(entry => entry.runId === run.id && entry.index === index)
        return <li key={index} className="flex items-start gap-2 py-2 text-sm">
          {run.canAdopt && !used && <Checkbox className="mt-1" checked={checked} disabled={committing || (!checked && picks.length >= 80)}
            aria-label={"选择候选 " + (index + 1) + " " + pick.quote} onCheckedChange={value => {
              if (value) setPicks(current => [...current, pick])
              else remove(pick)
            }} />}
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="text-xs text-muted-foreground">{sourceLabel} · 第 {source.start + 1}–{source.end} 个字符</p>
            {candidate.hint && <p className="text-xs font-medium">建议 · {candidate.hint.title}</p>}
            <ObservationValues detailed observation={{ id: String(index), sourceId: "", revision: 1, data: candidate.data }} />
            <Button variant="link" size="sm" className="h-auto w-fit px-0" aria-expanded={showingExcerpt}
              onClick={() => setExcerptPick(showingExcerpt ? undefined : { runId: run.id, index, fragment: candidate.fragment })}>
              {showingExcerpt ? "收起固定片段" : "查看固定片段"}
            </Button>
            {showingExcerpt && (excerpt.error ? <p role="alert" className="text-xs text-destructive">{excerpt.error.message}</p>
              : excerpt.data ? <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">{excerpt.data.text}</blockquote>
                : <p role="status" className="text-xs">正在读取固定片段…</p>)}
            {used && <Link href={itemLink(used.evidenceItemId)} onClick={onOpenItem}
              className="w-fit text-xs text-primary underline-offset-4 hover:underline">已采用 · 要点 V{used.revision}</Link>}
          </div>
        </li>
      })}</ul>
    </div> : <p role="status" className="text-sm">正在读取批次…</p>)}
    <CaseGroupingPanel matterId={matterId} picks={picks} destination={destination} selectionLocked={committing}
      onChooseGroup={selection => { setPicks(selection); setDraftGroup(value => value + 1); setSaved(undefined) }} />
    {!!picks.length && <MatterCandidateAdoption key={draftGroup} setSaving={setCommitting} matterId={matterId} picks={picks} targets={targets} refreshTargets={onAdopted} remove={remove}
      onSaved={result => {
        setSaved(result)
        setPicks([])
        void client.invalidateQueries({ queryKey: key })
        void client.invalidateQueries({ queryKey: ["chronicle", "case-adoption-targets", matterId] })
        void client.invalidateQueries({ queryKey: ["chronicle", "case-grouping", matterId] })
        onAdopted?.()
      }} />}
    {saved && <p role="status" className="text-sm">候选已保存到要点 V{saved.revision}。{" "}
      <Link href={itemLink(saved.id)} onClick={onOpenItem} className="text-primary underline-offset-4 hover:underline">查看要点</Link>
    </p>}
  </section>
}

export function MatterAnalysisHistorySheet({ matterId, targets, close, onAdopted }: {
  matterId: string; targets?: AdoptionTarget[]; close(): void; onAdopted(): void
}) {
  return <Sheet open onOpenChange={open => { if (!open) close() }}>
    <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
      <SheetHeader className="shrink-0 border-b pe-12"><SheetTitle>案级分析记录</SheetTitle><SheetDescription>回查固定材料的分析结果和用量。</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3"><MatterAnalysisRuns matterId={matterId} targets={targets} onAdopted={onAdopted} onOpenItem={close} /></div>
    </SheetContent>
  </Sheet>
}
