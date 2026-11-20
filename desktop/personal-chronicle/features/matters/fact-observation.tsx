import type { ReactNode } from "react"
import { markedText } from "./fixed-source-preview"
import type { DateValue, EvidenceObservationView } from "../../../../src/lib/evidence/observation-contract"
import type { ObservationRelation } from "../../../../src/lib/evidence/observation-participants"

export const statements = { RECORD: "材料记载", PARTY_STATEMENT: "当事人陈述", COURT_FINDING: "法院认定" } satisfies Record<FactObservation["data"]["statement"], string>
export const dateRoles = { OCCURRENCE: "发生", AGREEMENT: "约定", SIGNATURE: "落款", FILING: "提交", SERVICE: "送达" } satisfies Record<NonNullable<FactObservation["data"]["date"]>["role"], string>
export const amountNatures = {
  ACTUAL_TRANSFER: "实际交付", AGREED_PRINCIPAL: "约定本金", CLAIMED_RELIEF: "诉请金额", BALANCE: "余额", OTHER: "金额",
} satisfies Record<NonNullable<FactObservation["data"]["amount"]>["nature"], string>

export type FactObservation = EvidenceObservationView

function numberLabel(value: string) {
  const [whole, fraction] = value.split(".")
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : "." + fraction)
}

export const relationLabels = {
  PAYS_TO: "付款", LENDS_TO: "出借", DELIVERS_TO: "交付", GUARANTEES_FOR: "保证",
  REPRESENTS: "代理", CONTRACTS_WITH: "签约", EMPLOYS: "雇用", OTHER: "其他关系",
} satisfies Record<ObservationRelation["kind"], string>

export type DisplayRelation = Pick<ObservationRelation, "from" | "to" | "kind"> & { quote: string }

export function ObservationParticipants({ names, relations, detailed = false, collapseNames = false }: {
  names?: string[]; relations?: DisplayRelation[]; detailed?: boolean; collapseNames?: boolean
}) {
  if (!names?.length) return null
  const allNamesInRelations = collapseNames && names.every((_, index) =>
    relations?.some(link => link.from === index + 1 || link.to === index + 1))
  return <span className="grid min-w-0 gap-1">
    {!allNamesInRelations && <span className="break-words"><span className="text-muted-foreground">参与人</span> {names.join("、")}</span>}
    {relations?.map(link => <span className="grid min-w-0 gap-0.5" key={link.kind + "/" + link.from + "/" + link.to}>
      <span className="break-words">{names[link.from - 1]} · {relationLabels[link.kind]} → {names[link.to - 1]}</span>
      {detailed && <span className="whitespace-pre-wrap break-words text-muted-foreground">原文「{link.quote}」</span>}
    </span>)}
  </span>
}

export function observationDateLabel(value: DateValue) {
  if (value.precision === "EXACT") return value.day
  if (value.precision === "MONTH") return value.month
  if (value.precision === "RANGE") return value.start + " 至 " + value.end
  return "日期待核"
}

type ObservedAmount = NonNullable<NonNullable<FactObservation["data"]["amount"]>["value"]>

export function observationAmountLabel(value: ObservedAmount) {
  return numberLabel(value.value) + " " + (value.currency === "CNY" ? "元" : value.currency)
}

export function ObservationValues({ observation, detailed = false, sourceActions }: {
  observation: FactObservation; detailed?: boolean; sourceActions?: { date?: ReactNode; amount?: ReactNode }
}) {
  const { statement, excerpt, date, amount, participants, relations } = observation.data
  return <span className="grid min-w-0 gap-1 text-start">
    {!sourceActions && <span className="font-medium">{statements[statement]}</span>}
    {!sourceActions && excerpt && <span className="whitespace-pre-wrap break-words">「{excerpt.text}」</span>}
    {date && <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{dateRoles[date.role]}{sourceActions ? "日期" : ""}</span>{" "}
      <span className="min-w-0 break-words tabular-nums">{observationDateLabel(date.value)}</span>
      {sourceActions?.date && <span className="ms-auto">{sourceActions.date}</span>}
      {detailed && <span className="basis-full break-words text-muted-foreground">原文「{date.text}」</span>}
    </span>}
    {amount && <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{amountNatures[amount.nature]}</span>{" "}
      <span className="min-w-0 break-words tabular-nums">{amount.value ? observationAmountLabel(amount.value) : "金额待核"}</span>
      {sourceActions?.amount && <span className="ms-auto">{sourceActions.amount}</span>}
      {detailed && <span className="basis-full break-words text-muted-foreground">原文「{amount.text}」</span>}
    </span>}
    <ObservationParticipants names={participants?.map(person => person.text)}
      relations={relations?.map(({ from, to, kind, text }) => ({ from, to, kind, quote: text }))} detailed={detailed} collapseNames={Boolean(sourceActions)} />
  </span>
}

export function ObservationExcerpt({ data, sourceText }: { data: FactObservation["data"]; sourceText?: string | null }) {
  const fields = [data.date, data.amount].filter(entry => entry !== undefined)
  const excerpts = data.excerpt ? [data.excerpt] : []

  for (const entry of [...fields, ...data.relations ?? []]) {
    const { start, end } = entry.span
    if (excerpts.some(({ span }) => span.start <= start && span.end >= end)) continue

    // With field-only records, show their shared line when the fixed text matches the saved span.
    if (!data.excerpt && sourceText?.slice(start, end) === entry.text) {
      const lineStart = start === 0 ? 0 : sourceText.lastIndexOf("\n", start - 1) + 1
      const nextBreak = sourceText.indexOf("\n", end)
      const lineEnd = nextBreak < 0 ? sourceText.length : nextBreak
      if (lineEnd - lineStart <= 300) {
        excerpts.push({ span: { start: lineStart, end: lineEnd }, text: sourceText.slice(lineStart, lineEnd) })
        continue
      }
    }
    excerpts.push(entry)
  }

  if (!excerpts.length) return null
  return <div className="grid gap-1" aria-label="原文引文">
    {excerpts.map(({ text, span }) => {
      const marks = fields.filter(field => field.span.start >= span.start && field.span.end <= span.end)
        .map(field => ({ start: field.span.start - span.start, end: field.span.end - span.start }))
      return <blockquote key={span.start + "/" + span.end} className="whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed [overflow-wrap:anywhere]">
        {markedText(text, marks)}
      </blockquote>
    })}
  </div>
}

export function dateInterval(value: DateValue): { start: string; end: string } | undefined {
  switch (value.precision) {
    case "EXACT": return { start: value.day, end: value.day }
    case "RANGE": return { start: value.start, end: value.end }
    case "MONTH": {
      const [year, month] = value.month.split("-").map(Number)
      const end = new Date(value.month + "-01T00:00:00Z")
      end.setUTCFullYear(year, month, 0)
      return { start: value.month + "-01", end: end.toISOString().slice(0, 10) }
    }
  }
}

type ComparableObservation = { data: {
  date?: Pick<NonNullable<FactObservation["data"]["date"]>, "role" | "value">
  amount?: Pick<NonNullable<FactObservation["data"]["amount"]>, "nature" | "value">
} }

export function observationDifferences(observations: readonly ComparableObservation[]) {
  const dates = new Map<string, { start: string; end: string }>()
  const amounts = new Map<string, string>()
  let date = false
  let amount = false
  for (const { data: { date: entry, amount: money } } of observations) {
    const interval = entry && dateInterval(entry.value)
    if (entry && interval) {
      const known = dates.get(entry.role)
      if (!known) dates.set(entry.role, interval)
      else {
        const start = known.start > interval.start ? known.start : interval.start
        const end = known.end < interval.end ? known.end : interval.end
        if (start > end) date = true
        dates.set(entry.role, { start, end })
      }
    }
    if (money?.value) {
      const key = money.nature + ":" + money.value.currency
      const known = amounts.get(key)
      if (known !== undefined && known !== money.value.value) amount = true
      amounts.set(key, money.value.value)
    }
  }
  return { date, amount }
}

export function firstObservedDay(observations: readonly FactObservation[]) {
  return observations.reduce<string | undefined>((first, { data }) => {
    const value = data.date?.value
    const day = value?.precision === "EXACT" ? value.day : value?.precision === "RANGE" ? value.start : undefined
    return day && (!first || day < first) ? day : first
  }, undefined)
}
