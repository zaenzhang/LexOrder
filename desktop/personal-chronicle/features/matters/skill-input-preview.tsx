"use client"

import { useEffect, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { SkillCommissionDesk, signoffRequest, type CommissionRange } from "./skill-commission-desk"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { commissionItemLabels, readPersonal, workspaceEndpoint, type CommissionFollowUp, type CommissionIssue } from "./personal-client"

import type { MatterInputCoverageView } from "../../../../src/lib/ai/input-coverage"

import { MatterAnalysisRuns } from "./matter-analysis-runs"

export function SkillInputPreview({ matterId, researchId, issue, followUp, factAnalysis, documentIds, close }: { matterId: string; factAnalysis?: boolean; researchId?: string; issue?: CommissionIssue; followUp?: CommissionFollowUp; documentIds: string[]; close(): void }) {
  const [coverage, setCoverage] = useState<MatterInputCoverageView>()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Record<string, CommissionRange>>({})
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState("")
  const [commission, setCommission] = useState<{ id: string; baseResearchId: string }>()
  const [researchedAt] = useState(() => new Date().toISOString())
  const canCreate = !factAnalysis && !!(researchId || issue)

  useEffect(() => {
    const controller = new AbortController()
    readPersonal<MatterInputCoverageView>(workspaceEndpoint, {
      method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview-skill-input", data: { matterId, documents: documentIds.map(documentId => ({ documentId })), ...(factAnalysis ? { purpose: "FACT_ANALYSIS" } : {}) } }),
    }).then(result => { if (!controller.signal.aborted) setCoverage(result) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, documentIds, factAnalysis, attempt])

  function refresh() {
    setCoverage(undefined)
    setSelected({})
    setCreateError("")
    setError("")
    setAttempt(value => value + 1)
  }

  const ranges = Object.values(selected)
  const characters = ranges.reduce((sum, item) => sum + item.end - item.start, 0)
  const invalid = ranges.length > 80 || new Set(ranges.map(item => item.documentId)).size > 8 || characters > 36_000 ||
    ranges.some(item => item.end <= item.start || item.end - item.start > 6000)

  function choose(key: string, value?: CommissionRange) {
    setSelected(previous => {
      const next = { ...previous }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    setCreateError("")
    setRequestKey(crypto.randomUUID())
  }
  async function create() {
    if ((!researchId && !issue) || !ranges.length || invalid || busy) return
    setBusy(true)
    setCreateError("")
    try {
      const input = researchId ? { action: "create-signoff", researchId, ...(followUp ? { followUp } : {}) } : { action: "create-issue-signoff", issue, researchedAt }
      setCommission(await signoffRequest<{ id: string; baseResearchId: string }>({ ...input, matterId, requestKey, ranges }))
    } catch (cause) { setCreateError(cause instanceof Error ? cause.message : "委托保存失败。") }
    finally { setBusy(false) }
  }

  if (commission) return <SkillCommissionDesk matterId={matterId} scope={{ kind: "research", id: commission.baseResearchId }} initialId={commission.id} close={close} />

  return <Sheet open onOpenChange={open => { if (!open && !busy) close() }}>
    <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl motion-reduce:transition-none">
      <SheetHeader>
        <SheetTitle>{factAnalysis ? "案情分析分段预检" : followUp ? "补件复核 · " + commissionItemLabels[followUp.kind] : "委托材料预检"}</SheetTitle>
        <SheetDescription>检查所选固定版本的文本覆盖。预检本身不会调用模型。</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-5">
        {error && <div role="alert" className="flex flex-wrap items-center gap-3">{error}
          <Button size="sm" variant="outline" onClick={refresh}>重试</Button>
        </div>}
        {!coverage && !error && <p role="status">正在检查记录的材料版本和解析范围…</p>}
        {coverage && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm">
            {coverage.summary.selectedDocuments} 份固定版本
            {!factAnalysis && " · 可纳入 " + coverage.summary.preparedChars.toLocaleString("zh-CN") + " 字符"}
            {coverage.summary.unavailableDocuments > 0 && " · " + coverage.summary.unavailableDocuments + " 份当前不可查看"}
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>刷新预检</Button>
          </div>
          {factAnalysis && <MatterAnalysisRuns matterId={matterId} coverage={coverage} />}
          <ul className="divide-y border-y">
            {coverage.items.map((item, index) => <li key={item.documentId} className="py-3">
              {item.status === "UNAVAILABLE" ? <p className="text-sm text-muted-foreground">第 {index + 1} 份材料当前不可查看。</p>
                : <Collapsible>
                  <CollapsibleTrigger render={<Button variant="ghost" className="group h-auto w-full justify-between whitespace-normal text-start" />}>
                    <span className="min-w-0 break-all">{item.documentName} · V{item.documentVersion}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{item.processing.label}
                      <ChevronDownIcon aria-hidden className="size-3.5 group-data-panel-open:rotate-180" />
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-2 px-2 pt-2 text-sm">
                    {factAnalysis
                      ? <p>已提取文本 {item.preparation.availableChars.toLocaleString("zh-CN")} 字符</p>
                      : <p>预检范围 {item.preparation.preparedChars.toLocaleString("zh-CN")} 字符
                        {item.preparation.unpreparedChars > 0 && " · 另有 " + item.preparation.unpreparedChars.toLocaleString("zh-CN") + " 字符未纳入"}
                      </p>}
                    {item.issues.filter(issue => !factAnalysis || issue.code !== "PREPARATION_BUDGET").map(issue => <p key={issue.code} className="text-muted-foreground">{issue.label} · {issue.detail}</p>)}
                    {!factAnalysis && item.preparation.ranges.length > 0 && <ul className="list-disc ps-5">
                      {item.preparation.ranges.map(range => {
                        const key = item.documentId + "/" + range.anchorId
                        const chosen = selected[key]
                        const selectable = canCreate && item.run && item.preparation.canPrepare
                        return <li key={range.anchorId} className="py-1">
                          {selectable && item.run ? <>
                            <label className="flex items-center gap-2">
                              <Checkbox checked={!!chosen} disabled={busy} onCheckedChange={checked => choose(key, checked ? {
                                documentId: item.documentId, parseRunId: item.run!.id, anchorId: range.anchorId,
                                start: range.start, end: Math.min(range.end, range.start + 6000),
                              } : undefined)} />
                              {range.locationLabel} · {range.end - range.start} 字符
                            </label>
                            {chosen && range.end - range.start > 6000 && <div className="mt-2 flex flex-wrap gap-2">
                              <label>起始偏移<Input type="number" min={range.start} max={chosen.end - 1} value={chosen.start}
                                disabled={busy} onChange={event => { if (event.target.value !== "" && Number(event.target.value) >= range.start) choose(key, { ...chosen, start: Number(event.target.value) }) }} /></label>
                              <label>结束偏移<Input type="number" min={chosen.start + 1} max={range.end} value={chosen.end}
                                disabled={busy} onChange={event => { if (event.target.value !== "" && Number(event.target.value) <= range.end) choose(key, { ...chosen, end: Number(event.target.value) }) }} /></label>
                            </div>}
                          </> : <>{range.locationLabel} · {range.end - range.start} 字符</>}
                        </li>
                      })}
                    </ul>}
                    {!factAnalysis && item.preparation.omittedRangeCount > 0 && <p className="text-muted-foreground">另有 {item.preparation.omittedRangeCount} 个范围未展开。</p>}
                  </CollapsibleContent>
                </Collapsible>}
            </li>)}
          </ul>
          {canCreate && <div className="grid gap-2 rounded-lg border p-3">
            <p className="text-sm">{followUp ? commissionItemLabels[followUp.kind] + " · 补件" : "对照签收与验收"} · 已选 {ranges.length} 个片段，共 {characters.toLocaleString("zh-CN")} 字符</p>
            {invalid && <p role="alert" className="text-sm text-destructive">选材上限为 8 份、80 个片段、36,000 字符。单片段需为 1 至 6,000 字符。</p>}
            {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
            <Button className="justify-self-start" size="sm" disabled={busy || invalid || !ranges.length} onClick={() => void create()}>
              {busy ? "正在保存…" : "固定范围并创建委托"}
            </Button>
          </div>}
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
