"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { CaseCandidateRef } from "../../../../src/lib/evidence/case-adoption"
import type { CaseGroupingResult } from "../../../../src/lib/evidence/case-grouping"
import { amountNatures, dateRoles, observationDifferences, ObservationParticipants, statements, type DisplayRelation, type FactObservation } from "./fact-observation"
import type { CandidatePick } from "./matter-candidate-adoption"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type GroupMember = CaseCandidateRef & {
  observation: number
  source: { name: string; version: number; location: string }
  statement: FactObservation["data"]["statement"]
  contexts: string[]
  date?: Pick<NonNullable<FactObservation["data"]["date"]>, "role" | "value"> & { quote: string }
  amount?: Pick<NonNullable<FactObservation["data"]["amount"]>, "nature" | "value"> & { quote: string }
  participants?: string[]
  relations?: DisplayRelation[]
  adoptedItemId: string | null
}
type Preview = { characters: number; members: GroupMember[] }
const states = { QUEUED: "排队中", DISPATCHED: "正在归并", READY: "建议已生成", FAILED: "归并失败", UNCERTAIN: "调用结果未确认" }
type Run = {
  id: string; createdAt: string; model: string; state: keyof typeof states; candidateCount: number
  receipt: { sentCharacters?: number; usage?: { inputTokens: number; outputTokens: number }; error?: string } | null
}
type Detail = Run & { result: CaseGroupingResult | null; members: GroupMember[] }
type Destination = { model: string; origin: string }
const day = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
})
const active = (run?: Run) => run?.state === "QUEUED" || run?.state === "DISPATCHED"
const groupingReasons = {
  SHARED_REFERENCE: "共同编号或对象",
  RELATED_DESCRIPTION: "描述指向同一事项",
  DISPUTED_EVENT: "同一事项存在不同说法",
} satisfies Record<CaseGroupingResult["groups"][number]["reason"], string>
const caseCandidateKey = ({ runId, index }: CaseCandidateRef) => runId + ":" + index
const label = (member: GroupMember) => member.source.name + " · V" + member.source.version + " · " + member.source.location
const fields = (member: GroupMember) => [
  member.date && dateRoles[member.date.role] + "「" + member.date.quote + "」",
  member.amount && amountNatures[member.amount.nature] + "「" + member.amount.quote + "」",
].filter(Boolean).join(" · ")
const selectionLabel = (member: GroupMember) => [
  fields(member), member.participants?.join("、"),
].filter(Boolean).join(" · ")

function post<T>(action: string, data: object) {
  return readPersonal<T>(workspaceEndpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }),
  })
}

export function CaseGroupingPanel({ matterId, picks, destination, selectionLocked, onChooseGroup }: {
  matterId: string; picks: CandidatePick[]; destination?: Destination | null; selectionLocked: boolean
  onChooseGroup(picks: CandidatePick[]): void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [pages, setPages] = useState<string[]>([])
  const cache = useQueryClient()
  const cursor = pages.at(-1)
  const key = ["chronicle", "case-grouping", matterId] as const
  const endpoint = workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items", analysis: "grouping" })
  const list = useQuery({
    queryKey: [...key, "list", cursor], enabled: open,
    queryFn: ({ signal }) => readPersonal<{ runs: Run[]; nextCursor: string | null; maxCandidates: number }>(cursor
      ? endpoint + "&groupingCursor=" + cursor : endpoint, { signal }), retry: false,
    refetchInterval: query => open && query.state.data?.runs.some(active) ? 2000 : false,
  })
  const detail = useQuery({
    queryKey: [...key, selected], enabled: open && !!selected, retry: false,
    queryFn: ({ signal }) => readPersonal<Detail>(endpoint + "&groupingRun=" + selected, { signal }),
    refetchInterval: query => open && active(query.state.data) ? 2000 : false,
  })
  const preview = useMutation({
    mutationFn: ({ refs }: { refs: CaseCandidateRef[]; signature: string; groupingId: string }) =>
      post<Preview>("preview-case-grouping", { matterId, selected: refs }),
  })
  const queue = useMutation({
    mutationFn: ({ reviewed, destination }: { reviewed: NonNullable<typeof preview.variables>; destination: Destination }) =>
      post<Run>("start-case-grouping", { matterId, selected: reviewed.refs, groupingId: reviewed.groupingId, confirmed: true, ...destination }),
    onSuccess: run => {
      setPages([])
      setSelected(run.id)
      preview.reset()
      void cache.invalidateQueries({ queryKey: [...key, "list"] })
    },
  })

  const refs = picks.map(({ runId, index }) => ({ runId, index }))
  const signature = refs.map(caseCandidateKey).sort().join("|")
  const reviewed = preview.variables?.signature === signature ? preview.variables : undefined
  const maxCandidates = list.data?.maxCandidates
  const canPreview = maxCandidates != null && refs.length >= 2 && refs.length <= maxCandidates
  const run = detail.data

  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
    <CollapsibleTrigger render={<Button variant="ghost" className="group h-auto w-full justify-between text-start" />}>
      归并建议 <ChevronDownIcon aria-hidden className="size-3.5 group-data-panel-open:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="grid gap-3 px-3 pb-3 pt-1">
      {picks.length < 2 && <p className="text-xs text-muted-foreground">勾选至少两条待核候选，可检查哪些记载可能涉及同一事项。</p>}
      {maxCandidates != null && picks.length > maxCandidates && <p className="text-xs text-muted-foreground">单次建议最多 {maxCandidates} 条，请先缩小范围。</p>}
      {canPreview && <Button variant="outline" size="sm" className="justify-self-start" disabled={selectionLocked || preview.isPending || queue.isPending}
        onClick={() => { queue.reset(); preview.mutate({ refs, signature, groupingId: crypto.randomUUID() }) }}>
        {preview.isPending ? "正在准备摘要…" : "核对归并范围"}
      </Button>}
      {reviewed && preview.error && <p role="alert" className="text-sm text-destructive">{preview.error.message}</p>}
      {reviewed && preview.data && <div className="grid gap-2 rounded-md border p-2 text-sm">
        <p>{preview.data.members.length} 条候选 · {preview.data.characters.toLocaleString("zh-CN")} 字符</p>
        <p className="text-xs text-muted-foreground">发送下方字段和固定片段内的短上下文。归并建议保存后由律师取舍。</p>
        <ul aria-label="将发送的候选摘要" tabIndex={0} className="max-h-56 divide-y overflow-y-auto">
          {preview.data.members.map(member => <li key={caseCandidateKey(member)} className="grid gap-1 py-1 text-xs">
            <p className="font-medium">{label(member)}</p>
            <p>{[statements[member.statement], fields(member)].filter(Boolean).join(" · ")}</p>
            <ObservationParticipants names={member.participants} relations={member.relations} detailed />
            {member.contexts.map(context => <blockquote key={context} className="whitespace-pre-wrap break-words text-muted-foreground">{context}</blockquote>)}
          </li>)}
        </ul>
        {destination ? <>
          <p className="break-words text-xs text-muted-foreground">{destination.model} · {destination.origin}</p>
          <Button size="sm" className="justify-self-end" disabled={selectionLocked || queue.isPending}
            onClick={() => queue.mutate({ reviewed, destination })}>{queue.isPending ? "正在提交…" : "确认发送摘要"}</Button>
        </> : <p className="text-xs text-muted-foreground">在「设置 → 应用 AI」配置模型后可确认发送。</p>}
        {queue.error && <p role="alert" className="text-xs text-destructive">{queue.error.message}</p>}
      </div>}

      {list.error ? <div role="alert" className="flex flex-wrap items-center gap-1 text-xs">{list.error.message}
        <Button variant="outline" size="sm" onClick={() => void list.refetch()}>重试</Button>
      </div> : list.isPending ? <p role="status" className="text-xs">正在读取归并记录…</p> : list.data.runs.length ? <>
        <ul aria-label="归并记录" tabIndex={0} className="grid max-h-40 gap-1 overflow-y-auto p-0.5">{list.data.runs.map(entry => <li key={entry.id}>
          <Button variant="outline" className="w-full justify-between" aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
            <span className="min-w-0 truncate">{day.format(new Date(entry.createdAt))} · {entry.candidateCount} 条 · {entry.model}</span>
            <Badge variant="outline">{states[entry.state]}</Badge>
          </Button>
        </li>)}</ul>
        {(cursor || list.data.nextCursor) && <nav aria-label="归并记录分页" className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setPages(current => current.slice(0, -1))}>上一页</Button>
          <span className="text-xs text-muted-foreground">第 {pages.length + 1} 页</span>
          <Button variant="outline" size="sm" disabled={!list.data.nextCursor}
            onClick={() => setPages(current => [...current, list.data.nextCursor!])}>下一页</Button>
        </nav>}
      </> : <p className="text-xs text-muted-foreground">本案暂无归并记录。</p>}

      {selected && (detail.error ? <p role="alert" className="text-xs text-destructive">{detail.error.message}</p>
        : run ? <GroupingResult run={run} selectionLocked={selectionLocked} onChooseGroup={onChooseGroup} />
          : <p role="status" className="text-xs">正在读取归并结果…</p>)}
    </CollapsibleContent>
  </Collapsible>
}

function GroupingResult({ run, selectionLocked, onChooseGroup }: { run: Detail; selectionLocked: boolean; onChooseGroup(picks: CandidatePick[]): void }) {
  const grouped = new Set(run.result?.groups.flatMap(group => group.members.map(member => member.observation)))
  const byNumber = new Map(run.members.map(member => [member.observation, member]))
  return <section aria-label="归并结果" className="grid gap-2 rounded-md border p-2 text-xs">
    <Badge variant="outline">{states[run.state]}</Badge>
    {run.receipt?.sentCharacters != null && <p>已发送 {run.receipt.sentCharacters.toLocaleString("zh-CN")} 字符</p>}
    {run.receipt?.usage && <p>Token 输入 {run.receipt.usage.inputTokens.toLocaleString("zh-CN")} · 输出 {run.receipt.usage.outputTokens.toLocaleString("zh-CN")}</p>}
    {run.state === "FAILED" && <p>可重新核对范围、材料资格和服务设置。</p>}
    {run.state === "UNCERTAIN" && <p>供方是否接受请求尚未确认。请查看应用 AI 的调用记录。</p>}
    {run.result && <>
      <p className="text-muted-foreground">未分组 {run.members.filter(member => !grouped.has(member.observation)).length} 条，可从原批次继续核对。</p>
      {run.result.groups.map((group, index) => {
        const rows = group.members.map(proof => ({ ...proof, member: byNumber.get(proof.observation)! }))
        const available = rows.filter(({ member }) => !member.adoptedItemId)
        const differences = observationDifferences(rows.map(({ member }) => ({ data: member })))
        return <section key={index} className="grid gap-2 rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium">{groupingReasons[group.reason]} · {rows.length} 条</h4>
            {differences.date && <Badge variant="outline">日期有分歧</Badge>}
            {differences.amount && <Badge variant="outline">金额有分歧</Badge>}
          </div>
          <ul className="divide-y">
            {rows.map(({ member, quote }) => <li key={caseCandidateKey(member)} className="grid gap-1 py-1">
              <p>{label(member)}{member.adoptedItemId && " · 已采用"}</p>
              <p>{[statements[member.statement], fields(member)].filter(Boolean).join(" · ")}</p>
              <ObservationParticipants names={member.participants} relations={member.relations} detailed />
              <p className="break-words text-muted-foreground">线索「{quote}」</p>
            </li>)}
          </ul>
          <Button variant="outline" size="sm" className="justify-self-start" disabled={selectionLocked || !available.length}
            onClick={() => onChooseGroup(available.map(({ member }) => ({
              runId: member.runId, index: member.index, source: label(member), quote: selectionLabel(member),
            })))}>用本组待核记载替换当前选择</Button>
        </section>
      })}
    </>}
  </section>
}
