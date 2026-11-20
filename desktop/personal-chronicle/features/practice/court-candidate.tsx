"use client"

import Link from "@/features/shell/workspace-link"
import { useId, useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { readPersonal } from "@/features/matters/personal-client"
import { chinaDate } from "./data"

export const courtInboxEndpoint = "/api/personal/court-inbox"
const kindLabels = { HEARING: "庭期", DEADLINE: "法律期限", FIELD_CHANGE: "程序档案", MATTER_MATCH: "案件归属" } as const
const outcomes = { CREATED: "已新建", LINKED: "已关联", UPDATED: "已采用", UNCHANGED: "与现有记录一致", REJECTED: "未采用" } as const
export type CourtProcedure = { id: string; label: string; caseNumber: string | null }
type EventChoice = { mode: "CREATE"; procedureId: string; title: string; dateText: string; timeText: string | null }
  | { mode: "LINK"; procedureId: string; targetId: string; expectedTargetUpdatedAt: string; verifiedTime?: string }
export type CourtCandidate = {
  id: string; kind: keyof typeof kindLabels; status: "PENDING" | "ACCEPTED" | "REJECTED"; updatedAt: string
  fileId: string | null; page: number | null; excerpt: string | null; value: string | null; fieldKey: string | null; currentValue: string | null
  proposal: { procedure?: string; title?: string; day?: string; time?: string }
  result: { outcome: keyof typeof outcomes; type: string | null; target: string | null; program?: string; day?: string } | null
}
type Target = { id: string; title: string; at: string; duePrecision: string | null; updatedAt: string }
type Decision = (row: CourtCandidate, decision: "ACCEPTED" | "REJECTED", event?: EventChoice) => void

const dateDecisionModes = [
  { value: "LINK", label: "关联已有事项" },
  { value: "CREATE", label: "新建正式事项" },
] as const

const validDay = /^\d{4}-\d{2}-\d{2}$/
const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function CourtCandidateReview({ candidate, record, matter, procedures, busy, onDecide }: {
  candidate: CourtCandidate; record: string; matter?: string
  procedures: CourtProcedure[]; busy: boolean; onDecide: Decision
}) {
  return <div className="grid gap-3">
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{kindLabels[candidate.kind]}</h3>
        <Badge variant="outline">{candidate.status === "PENDING" ? "待核对" : candidate.status === "REJECTED" ? "未采用"
          : candidate.result ? outcomes[candidate.result.outcome] : "历史已采用"}</Badge>
      </div>
      {candidate.value && <p className="text-sm">{candidate.fieldKey && candidate.currentValue ? candidate.currentValue + " → " : ""}{candidate.value}</p>}
    </div>
    {candidate.status === "PENDING" ? <>
      {(candidate.kind === "HEARING" || candidate.kind === "DEADLINE") ? matter
        ? <DateDecision candidate={candidate} record={record} procedures={procedures} busy={busy} onDecide={onDecide} />
        : <p className="text-sm text-muted-foreground">请先核对所属案件，再确认日期。</p>
        : <Button size="sm" className="justify-self-start" disabled={busy || (candidate.kind === "FIELD_CHANGE" && !matter)} onClick={() => onDecide(candidate, "ACCEPTED")}>采用建议</Button>}
      <Button size="sm" variant="ghost" className="justify-self-start" disabled={busy} onClick={() => onDecide(candidate, "REJECTED")}>不采用此候选</Button>
    </> : <DecisionLinks candidate={candidate} matter={matter} />}
  </div>
}

function DecisionLinks({ candidate, matter }: { candidate: CourtCandidate; matter?: string }) {
  const result = candidate.result
  if (!result || !matter || !result.target) return null
  const { program, day, type, target } = result
  return <div className="flex flex-wrap gap-2">
    {program && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={"/matters/" + matter + "/tasks?program=" + program} />}>查看关联程序</Button>}
    {day && (type === "Hearing" || type === "Deadline") && <Button size="sm" variant="outline" nativeButton={false}
      render={<Link href={{ pathname: "/practice/schedule", query: { day, event: (type === "Hearing" ? "h-" : "d-") + target } }} />}>在日程查看</Button>}
  </div>
}

function DateDecision({ candidate, record, procedures, busy, onDecide }: {
  candidate: CourtCandidate; record: string; procedures: CourtProcedure[]; busy: boolean; onDecide: Decision
}) {
  const fieldId = useId()
  const { proposal } = candidate
  const existingProgram = procedures.find(p => p.id === proposal.procedure)
  const [procedureId, setProcedureId] = useState<string | null>(existingProgram?.id ?? null)
  const [mode, setMode] = useState<EventChoice["mode"] | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState("")
  const [verified, setVerified] = useState(false)
  const hearing = candidate.kind === "HEARING"
  const proposedTime = typeof proposal.time === "string" && validTime.test(proposal.time) ? proposal.time : ""
  const [time, setTime] = useState(proposedTime)
  const [timedDeadline, setTimedDeadline] = useState(!hearing && !!proposedTime)
  const query = useQuery({
    queryKey: ["court-targets", record, candidate.id, candidate.updatedAt, procedureId, search],
    queryFn: ({ signal }) => readPersonal<{ targets: Target[]; truncated: boolean }>(courtInboxEndpoint + "?" + new URLSearchParams({
      view: "targets", record, suggestion: candidate.id, procedure: procedureId!, q: search,
    }), { signal }),
    enabled: mode === "LINK" && !!procedureId,
    retry: false,
  })
  const procedureOptions = procedures.map(row => ({
    value: row.id,
    label: row.caseNumber ? row.label + " · " + row.caseNumber : row.label,
  }))
  const targetOptions = query.data?.targets.map(row => ({
    value: row.id,
    label: row.title + " · " + (row.duePrecision === "DATE" ? chinaDate(row.at).split(" ")[0] : chinaDate(row.at)),
  })) ?? []
  const target = query.data?.targets.find(row => row.id === targetId)
  const needsLinkTime = hearing && !proposedTime
  const timed = hearing || timedDeadline
  const canSubmit = !busy && !!procedureId && verified && (mode === "CREATE"
    ? !timed || validTime.test(time)
    : mode === "LINK" && !!target && (!needsLinkTime || validTime.test(time)))
  const btn = mode === "LINK" ? "确认关联已有事项" : "确认登记" + (hearing ? "庭期" : "期限")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || !procedureId) return
    if (mode === "LINK" && target) {
      onDecide(candidate, "ACCEPTED", { mode, procedureId, targetId: target.id, expectedTargetUpdatedAt: target.updatedAt,
        ...(needsLinkTime ? { verifiedTime: time } : {}) })
    } else if (mode === "CREATE") {
      const fields = new FormData(event.currentTarget)
      const dateText = String(fields.get("day"))
      const title = String(fields.get("title")).trim()
      if (title && validDay.test(dateText)) onDecide(candidate, "ACCEPTED", { mode, procedureId, title, dateText, timeText: timed ? time : null })
    }
  }

  return <form onSubmit={submit} className="grid gap-3 text-sm">
    <Field className="gap-1.5">
      <FieldLabel htmlFor={fieldId + "-program"}>所属程序</FieldLabel>
      <Select modal={false} items={procedureOptions} value={procedureId} disabled={busy || !procedures.length} onValueChange={value => {
        setProcedureId(value); setMode(null); setTargetId(null); setVerified(false)
      }}>
        <SelectTrigger id={fieldId + "-program"} className="w-full min-w-0"><SelectValue placeholder="请选择本案程序" /></SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>{procedureOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    {!procedures.length && <p className="text-xs text-muted-foreground">请先在本案程序中登记实际代理的程序。</p>}
    <Field className="gap-1.5">
      <FieldLabel htmlFor={fieldId + "-mode"}>处理方式</FieldLabel>
      <Select modal={false} items={dateDecisionModes} value={mode} disabled={busy || !procedureId} onValueChange={value => {
        setMode(value); setTargetId(null); setVerified(false)
      }}>
        <SelectTrigger id={fieldId + "-mode"} className="w-full min-w-0"><SelectValue placeholder="请选择处理方式" /></SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>{dateDecisionModes.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    {mode === "CREATE" && <>
      <label className="grid gap-1.5">事项标题<Input name="title" required maxLength={200} defaultValue={proposal.title ?? ""} disabled={busy} onChange={() => setVerified(false)} /></label>
      <label className="grid gap-1.5">实际日期<Input name="day" type="date" required defaultValue={proposal.day ?? ""} disabled={busy} onChange={() => setVerified(false)} /></label>
      {!hearing && <label className="flex items-center gap-2"><Checkbox checked={timedDeadline} disabled={busy}
        onCheckedChange={value => { setTimedDeadline(value); setVerified(false) }} />原件载有具体时刻</label>}
    </>}
    {(mode === "CREATE" && timed || mode === "LINK" && needsLinkTime) && <label className="grid gap-1.5">实际时刻（北京时间）
      <Input type="time" required value={time} disabled={busy} onChange={event => { setTime(event.target.value); setVerified(false) }} />
    </label>}
    {mode === "LINK" && <div className="grid gap-2">
      <div className="flex gap-2"><Input aria-label="查找同日已有事项" placeholder="按标题找同日事项" disabled={busy}
        value={filter} onChange={event => setFilter(event.target.value)} />
        <Button type="button" variant="outline" size="sm" disabled={busy || query.isFetching} onClick={() => {
          setTargetId(null)
          setVerified(false)
          const value = filter.trim()
          if (search === value) void query.refetch()
          else setSearch(value)
        }}>查找</Button></div>
      {query.isPending && <p role="status" className="text-xs text-muted-foreground">正在读取已有事项…</p>}
      {query.error && <p role="alert" className="text-xs text-destructive">{query.error.message}</p>}
      {query.data && (targetOptions.length ? <Field className="gap-1.5">
        <FieldLabel htmlFor={fieldId + "-target"}>同日已有事项</FieldLabel>
        <Select modal={false} items={targetOptions} value={targetId} disabled={busy} onValueChange={value => {
          setTargetId(value); setVerified(false)
        }}>
          <SelectTrigger id={fieldId + "-target"} className="w-full min-w-0"><SelectValue placeholder="请选择核过的事项" /></SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>{targetOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select>
      </Field> : <p className="text-xs text-muted-foreground">所选程序在来源日期没有符合条件的事项。</p>)}
      {query.data?.truncated && <p className="text-xs text-muted-foreground">只显示前 100 项，请按标题缩小范围。</p>}
    </div>}
    {mode && <>
      <label className="flex items-start gap-2"><Checkbox className="mt-0.5" checked={verified} disabled={busy}
        onCheckedChange={setVerified} />已按原件核对本案、程序和时间</label>
      <Button className="justify-self-start" size="sm" type="submit" disabled={!canSubmit}>{btn}</Button>
    </>}
  </form>
}
