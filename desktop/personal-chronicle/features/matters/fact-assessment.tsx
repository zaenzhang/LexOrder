import { useId, useState, type ReactNode, type RefObject } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { ChronologySelect } from "./chronology-select"
import type { ChronologyAssessment, ChronologyChange, ChronologyStage } from "../../../../src/lib/evidence/chronology-assessment"
import { TraceGroup } from "./chronology-trace"
import { amountNatures, dateRoles, observationAmountLabel, observationDateLabel, observationDifferences, statements, type FactObservation } from "./fact-observation"
import type { EvidenceNote } from "./case-chronology"
import { readPersonal, workspaceEndpoint } from "./personal-client"

export const chronologyCategories = {
  communication: "沟通往来", meeting: "会议与会谈", agreement: "协议或约定", payment: "款项往来",
  performance: "履行", notice: "通知与催告", decision: "决定与审批", procedure: "诉讼程序", other: "其他",
} satisfies Record<NonNullable<ChronologyAssessment["category"]>, string>

export const chronologyDisputes = {
  pending: "待定", undisputed: "无争议", disputed: "有争议",
} satisfies Record<NonNullable<ChronologyAssessment["dispute"]>, string>

export const partyDisputes = {
  pending: "当事人争议待确认", undisputed: "当事人无争议", disputed: "当事人有争议",
} satisfies Record<keyof typeof chronologyDisputes, string>

export const chronologyStages = {
  consultation: "接受咨询", discussion: "谈案", preparation: "庭前", hearing: "庭审时", afterHearing: "庭后", closed: "结案后",
} satisfies Record<ChronologyStage, string>

export function onlyPartyStatements(item: EvidenceNote) {
  const records = item.observations ?? []
  return records.length > 0 && records.every(record => record.data.statement === "PARTY_STATEMENT") &&
    item.sources.every(source => source.status !== "AVAILABLE" || records.some(record => record.sourceId === source.id))
}

export function FactAssessment({ item, inferredCategory, pending, grade, onChange, matrixOnly }: {
  item: EvidenceNote; inferredCategory: keyof typeof chronologyCategories; pending: boolean; grade?: ReactNode; matrixOnly?: boolean
  onChange?(change: ChronologyChange): void
}) {
  const fieldId = useId()
  const assessment = item.chronologyAssessment
  const disputeLabels = matrixOnly ? chronologyDisputes : { ...chronologyDisputes, pending: "待确认" }
  const disputeLabel = matrixOnly ? "争议状态" : "当事人争议"
  if (!item.canEdit || !onChange) return <div className="flex flex-wrap items-center gap-2">
    {assessment?.dispute && <Badge variant="outline">{disputeLabels[assessment.dispute]}</Badge>}{grade}
  </div>
  const labelClass = "text-xs @min-[18rem]/field-group:max-w-20 @min-[18rem]/field-group:shrink-0"
  const fields: { id: string; label: string; value: string; items: Record<string, string>; save(value: string): void }[] = [
    { id: "category", label: "事件分类", value: assessment?.category ?? "",
      items: { "": "建议 · " + chronologyCategories[inferredCategory], ...chronologyCategories },
      save: (value: string) => onChange({ kind: "category", value: (value || null) as keyof typeof chronologyCategories | null }) },
    { id: "nature", label: "事件性质", value: assessment?.nature ?? "",
      items: { "": "未标注", occurred: "已发生", planned: "约定或应当发生", estimated: "推定" },
      save: (value: string) => onChange({ kind: "nature", value: (value || null) as NonNullable<ChronologyAssessment["nature"]> | null }) },
    { id: "dispute", label: disputeLabel, value: assessment?.dispute ?? "pending", items: disputeLabels,
      save: (value: string) => onChange({ kind: "dispute", value: value as keyof typeof chronologyDisputes }) },
  ]
  return <fieldset aria-label="核对与标注" disabled={pending} className="grid min-w-0 gap-2.5">
    <FieldGroup className="gap-2">
      {fields.map(field => {
        const id = fieldId + "-" + field.id
        return <Field key={id} className="gap-1.5 @min-[18rem]/field-group:flex-row @min-[18rem]/field-group:items-center @min-[18rem]/field-group:gap-2">
          <FieldLabel htmlFor={id} className={labelClass}>{field.label}</FieldLabel>
          <ChronologySelect id={id} label={field.label} className="w-full" compact={!matrixOnly} value={field.value}
            disabled={pending} items={field.items} onChange={field.save} />
        </Field>
      })}
      {grade}
    </FieldGroup>
    <Field orientation="horizontal" className="border-y py-2">
      <Checkbox id={fieldId + "-adverse"} checked={Boolean(assessment?.adverse)} disabled={pending}
        aria-describedby={fieldId + "-adverse-help"} onCheckedChange={value => onChange({ kind: "adverse", value })} />
      <FieldContent>
        <FieldLabel htmlFor={fieldId + "-adverse"} className="text-xs">标为不利</FieldLabel>
        <FieldDescription id={fieldId + "-adverse-help"} className="text-xs">仅内部可见</FieldDescription>
      </FieldContent>
    </Field>
    <Button variant="outline" size="xs" className="justify-self-end" disabled={pending}
      onClick={() => onChange({ kind: "reviewed", value: !item.confirmedAt })}>
      {item.confirmedAt ? "改回待核对" : "标为已核对"}
    </Button>
  </fieldset>
}

export type ComparisonField = "date" | "amount"

type ComparisonGroup = {
  field: ComparisonField
  label: string
  values: Map<string, FactObservation[]>
}

function recordComparisons(records: FactObservation[]) {
  const groups = new Map<string, ComparisonGroup>()

  function add(field: ComparisonField, category: string, label: string, value: string, record: FactObservation) {
    const key = field + "/" + category
    let group = groups.get(key)
    if (!group) {
      group = { field, label, values: new Map() }
      groups.set(key, group)
    }
    const entries = group.values.get(value)
    if (entries) entries.push(record)
    else group.values.set(value, [record])
  }

  for (const record of records) {
    const { date, amount } = record.data
    if (date && date.value.precision !== "UNKNOWN") {
      add("date", date.role, dateRoles[date.role] + "日期", observationDateLabel(date.value), record)
    }
    if (amount?.value) {
      const label = amountNatures[amount.nature]
      add("amount", amount.nature + "/" + amount.value.currency, amount.nature === "ACTUAL_TRANSFER" ? "实际交付金额" : label,
        observationAmountLabel(amount.value), record)
    }
  }
  return groups
}

export function FactRecordComparison({ item, panelRef, onOpenSource }: {
  item: EvidenceNote
  panelRef: RefObject<HTMLElement | null>
  onOpenSource(record: FactObservation, field: ComparisonField): void
}) {
  const groups = [...recordComparisons(item.observations ?? [])].flatMap(([key, group]) => {
    const records = [...group.values.values()].flat()
    const chosenId = group.field === "date" ? item.chronologyAssessment?.dateObservationId : item.chronologyAssessment?.amountObservationId
    const chosen = records.find(record => record.id === chosenId)
    return observationDifferences(records)[group.field] ? [{ ...group, key, chosen }] : []
  })
  if (!groups.length) return null
  const sources = new Map(item.sources.map(source => [source.id, source]))

  return <section ref={panelRef} aria-label="记载分歧" className="border-b px-3.5 pt-2 text-xs">
    <h3 className="font-medium text-warning-foreground">记载分歧</h3>
    <div className="divide-y">
      {groups.map(({ key, field, label, values, chosen }) => <div key={key} className="grid gap-2 py-2.5">
        <h4 className="font-medium">{label}</h4>
        <ul aria-label={label} className="grid gap-2">
          {[...values].map(([value, records]) => <li key={value} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium tabular-nums">{value}</span>
              {records.some(record => record === chosen) && <Badge variant="secondary">已采用</Badge>}
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap gap-x-2">
              {records.map(record => {
                const source = sources.get(record.sourceId)
                const name = source?.documentName ?? "来源不可用"
                const kind = record.data.statement === "RECORD" ? undefined : statements[record.data.statement]
                const adopted = record === chosen
                return <div key={record.id} className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5">
                  {source?.status === "AVAILABLE" ? <Button variant="ghost" size="xs"
                    data-comparison-source={field + "/" + record.id}
                    className="h-auto min-h-6 max-w-full justify-start whitespace-normal px-0 text-start underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                    aria-label={[value, name, kind, adopted && "采用出处", "查看原文"].filter(Boolean).join(" · ")}
                    onClick={() => onOpenSource(record, field)}>{name}</Button>
                    : <span className="max-w-full text-muted-foreground [overflow-wrap:anywhere]">{source?.documentName ? name + " · 不可读取" : name}</span>}
                  {kind && <span className="text-muted-foreground">{kind}</span>}
                  {adopted && records.length > 1 && <span className="text-muted-foreground">采用出处</span>}
                </div>
              })}
            </div>
          </li>)}
        </ul>
      </div>)}
    </div>
  </section>
}

type LogEntry = { id: string; label: string; actor: string | null; time: string }

export function FactChangeLog({ matterId, item, showChanges, children }: {
  matterId: string; item: EvidenceNote; showChanges: boolean; children?: ReactNode
}) {
  return <TraceGroup label="变更记录" meta={"V" + item.revision}>
    <div className="grid gap-2 px-3.5 py-2 text-xs">
      {showChanges && <FactChanges matterId={matterId} item={item} />}
      {children}
    </div>
  </TraceGroup>
}

function FactChanges({ matterId, item }: { matterId: string; item: EvidenceNote }) {
  const query = useQuery({
    queryKey: ["chronicle", "fact-change-log", matterId, item.id, item.revision, item.level],
    queryFn: ({ signal }) => readPersonal<{ items: LogEntry[] }>(workspaceEndpoint + "?" + new URLSearchParams({
      matter: matterId, section: "evidence-items", changes: item.id,
    }), { signal }),
  })
  if (query.isPending) return <span>正在读取变更记录…</span>
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (!query.data.items.length) return <span>尚无变更记录。</span>
  return <ol className="divide-y">{query.data.items.map(entry => <li key={entry.id} className="py-1.5">
    <time dateTime={entry.time} className="me-2 tabular-nums text-muted-foreground">{new Date(entry.time).toLocaleString("zh-CN")}</time>
    {entry.actor && <span className="me-1.5">{entry.actor}</span>}{entry.label}
  </li>)}</ol>
}

export function FactDirections({ item, items, pending, onOpen, onChange }: {
  item: EvidenceNote; items: EvidenceNote[]; pending: boolean
  onOpen(item: EvidenceNote, source?: EvidenceNote["sources"][number]): void
  onChange?(change: ChronologyChange): void
}) {
  const [editing, setEditing] = useState(false)
  const [targetId, setTargetId] = useState("")
  const [sourceId, setSourceId] = useState("")
  const [label, setLabel] = useState("")
  const [quote, setQuote] = useState("")
  const targets = items.filter(other => other.id !== item.id && !other.restricted)
  const anchored = item.sources.filter(source => source.hasAnchor && source.status === "AVAILABLE")
  const writable = item.canEdit && onChange && anchored.length > 0 && targets.length > 0
  const outgoing = (item.chronologyAssessment?.directions ?? []).flatMap(direction => {
    const target = targets.find(candidate => candidate.id === direction.targetId)
    const source = anchored.find(candidate => candidate.id === direction.sourceId)
    return target && source ? [{ direction, from: item, to: target, next: target, source }] : []
  })
  const incoming = targets.flatMap(from => (from.chronologyAssessment?.directions ?? []).flatMap(direction => {
    const source = from.sources.find(candidate => candidate.status === "AVAILABLE" && candidate.id === direction.sourceId)
    return source && direction.targetId === item.id ? [{ direction, from, to: item, next: from, source }] : []
  }))
  const visible = [...outgoing, ...incoming]
  if (!visible.length && !writable) return null
  return <TraceGroup label="材料写明的指向" count={visible.length}>
    <div className="grid gap-2 px-3.5 py-2 text-xs">
      {visible.map(({ direction, from, next, source }) => <div key={direction.id} className="grid gap-1 rounded-md border p-2">
        <div className="flex flex-wrap items-center gap-1">
          <span>{direction.label} →</span>
          <Button variant="link" size="xs" className="h-auto whitespace-normal px-0 text-left" onClick={() => onOpen(next)}>{next.title}</Button>
        </div>
        <blockquote className="break-words text-muted-foreground">「{direction.quote}」</blockquote>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="link" size="xs" className="h-auto whitespace-normal px-0 text-left" onClick={() => onOpen(from, source)}>
            {source.documentName} · V{source.documentVersion} · {source.locationLabel}
          </Button>
          {from.id === item.id && item.canEdit && onChange && <Button variant="ghost" size="xs" disabled={pending}
            onClick={() => onChange({ kind: "removeDirection", value: direction.id })}>移除指向</Button>}
        </div>
      </div>)}
      {writable && !editing && <Button size="xs" variant="outline" className="w-fit" onClick={() => setEditing(true)}>添加材料指向</Button>}
      {writable && editing && <form className="grid gap-2" onSubmit={event => {
        event.preventDefault()
        if (targetId && sourceId && label.trim() && quote.trim()) onChange({ kind: "addDirection", value: { targetId, sourceId, label, quote } })
      }}>
        <ChronologySelect label="指向的事件" value={targetId || null} onChange={setTargetId} className="w-full"
          placeholder="选择指向的事件" items={targets.map(target => ({ value: target.id, label: target.title }))} />
        <ChronologySelect label="来源定位" value={sourceId || null} onChange={setSourceId} className="w-full"
          placeholder="选择固定出处" items={anchored.map(source => ({
            value: source.id, label: source.documentName + " · V" + source.documentVersion + " · " + source.locationLabel,
          }))} />
        <Input aria-label="指向说明" placeholder="指向说明" value={label} maxLength={80} onChange={event => setLabel(event.target.value)} />
        <Textarea aria-label="指向所据引文" placeholder="逐字填写固定出处中的引文" value={quote} rows={2} maxLength={300} onChange={event => setQuote(event.target.value)} />
        <div className="flex gap-1">
          <Button type="submit" size="xs" disabled={!targetId || !sourceId || !label.trim() || !quote.trim() || pending}>保存指向</Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
        </div>
      </form>}
    </div>
  </TraceGroup>
}

export function FactReviewQueue({ items, onOpen }: { items: EvidenceNote[]; onOpen(item: EvidenceNote): void }) {
  const [open, setOpen] = useState(false)
  const entries = items.filter(item => !item.restricted && item.kind !== "CLAIM").flatMap(item => {
    const records = item.observations ?? []
    const assessment = item.chronologyAssessment
    const differences = observationDifferences(records)
    const adoptedDate = records.some(record => record.id === assessment?.dateObservationId)
    const adoptedAmount = records.some(record => record.id === assessment?.amountObservationId)
    const labels = [
      differences.date && !adoptedDate && "日期冲突",
      differences.amount && !adoptedAmount && "金额冲突",
      onlyPartyStatements(item) && !item.confirmedAt && "仅有当事人陈述",
      records.some(record => record.data.date?.value.precision === "UNKNOWN") && !item.confirmedAt && "日期待核",
    ].filter((value): value is string => Boolean(value))
    return labels.map(label => ({ item, label }))
  })
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button variant={entries.length ? "default" : "outline"} size="xs" />} aria-label={entries.length + " 项待核对"}>
      {entries.length} 项待核对
    </SheetTrigger>
    <SheetContent className="overflow-y-auto">
      <SheetHeader><SheetTitle>待核对</SheetTitle><SheetDescription>查看记载差异与原文，逐项采用或保留分歧。</SheetDescription></SheetHeader>
      <div className="grid gap-2 px-4 pb-4">
        {entries.length ? entries.map(({ item, label }) => <Button key={item.id + label} variant="outline" size="sm"
          className="h-auto justify-start whitespace-normal text-start"
          onClick={() => { setOpen(false); onOpen(item) }}>
          <span>{item.title}</span><Badge variant="secondary">{label}</Badge>
        </Button>) : <p className="text-sm text-muted-foreground">没有待核对的来源差异。</p>}
      </div>
    </SheetContent>
  </Sheet>
}
