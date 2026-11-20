"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ChronologySelect } from "./chronology-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { ObservationRelation } from "../../../../src/lib/evidence/observation-participants"
import { amountNatures, dateRoles, relationLabels, statements, type FactObservation } from "./fact-observation"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import { sourceOffset } from "./source-selection"

type Span = { start: number; end: number }
type Relation = Omit<ObservationRelation, "text">
type Draft = {
  statement: keyof typeof statements
  date?: { role: keyof typeof dateRoles; span: Span }
  excerpt?: Span
  amount?: { nature: keyof typeof amountNatures; span: Span; unitSpan?: Span }
  participants: { span: Span }[]
  relations: Relation[]
}
type RelationDraft = { value: Relation; index?: number }
export type ObservationSaved = { revision: number; observationId: string }

function editDraft(observation?: FactObservation): Draft {
  const data = observation?.data
  return {
    statement: data?.statement ?? "RECORD",
    excerpt: data?.excerpt?.span,
    date: data?.date && { role: data.date.role, span: data.date.span },
    amount: data?.amount && { nature: data.amount.nature, span: data.amount.span, unitSpan: data.amount.unitSpan },
    participants: data?.participants?.map(({ span }) => ({ span })) ?? [],
    relations: data?.relations?.map(({ kind, from, to, span }) => ({ kind, from, to, span })) ?? [],
  }
}

export function ObservationEditor({ matterId, evidenceItemId, expectedRevision, sourceId, sourceLabel, original,
  observation, returnFocus, close, onSaved }: {
  matterId: string; evidenceItemId: string; expectedRevision: number; sourceId: string; sourceLabel: string; original: string
  observation?: FactObservation; returnFocus: HTMLElement | null
  close(): void; onSaved(saved: ObservationSaved): void
}) {
  const [draft, setDraft] = useState(() => editDraft(observation))
  const [relation, setRelation] = useState<RelationDraft>()
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const submission = useRef<{ intent: string; id: string }>(null)
  const inFlight = useRef(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(editDraft(observation))
  const quote = (span: Span) => original.slice(span.start, span.end)

  function mark(apply: (span: Span) => void) {
    const text = input.current
    if (!text || text.selectionStart === text.selectionEnd) {
      setError("请先在固定原文中选中文字。")
      return
    }
    const span = { start: sourceOffset(original, text.selectionStart), end: sourceOffset(original, text.selectionEnd) }
    if (!quote(span).trim()) {
      setError("所选引文不能为空。")
      return
    }
    setError("")
    apply(span)
  }

  function addParticipant(span: Span) {
    if (span.end - span.start > 100 || draft.participants.some(person => span.start < person.span.end && span.end > person.span.start)) {
      setError("参与人的引用不能重叠，每个名称最多 100 字符。")
      return
    }
    setDraft(current => ({ ...current, participants: [...current.participants, { span }] }))
  }

  function removeParticipant(index: number) {
    const number = index + 1
    if (draft.relations.some(link => link.from === number || link.to === number)) {
      setError("请先移除引用此参与人的关系。")
      return
    }
    setDraft(current => ({
      ...current,
      participants: current.participants.filter((_, i) => i !== index),
      relations: current.relations.map(link => ({
        ...link, from: link.from > number ? link.from - 1 : link.from, to: link.to > number ? link.to - 1 : link.to,
      })),
    }))
    setError("")
  }

  function keepRelation() {
    if (!relation) return
    const { value: link, index } = relation
    const from = draft.participants[link.from - 1]?.span
    const to = draft.participants[link.to - 1]?.span
    if (!from || !to || link.from === link.to || link.span.start > Math.min(from.start, to.start) || link.span.end < Math.max(from.end, to.end)) {
      setError("请选择两个不同的参与人，且关系引文须覆盖两端。")
      return
    }
    if (draft.relations.some((entry, i) => i !== index && entry.kind === link.kind && entry.from === link.from && entry.to === link.to)) {
      setError("此关系已添加。")
      return
    }
    setDraft(current => ({ ...current, relations: index === undefined
      ? [...current.relations, link] : current.relations.map((entry, i) => i === index ? link : entry) }))
    setRelation(undefined)
    setError("")
  }

  async function save() {
    if (inFlight.current || relation || !dirty || (!draft.excerpt && !draft.date && !draft.amount && !draft.participants.length)) return
    const { participants, relations, ...fields } = draft
    const data = { evidenceItemId, expectedRevision, sourceId, supersedesId: observation?.id,
      observation: { ...fields, ...(participants.length && { participants }), ...(relations.length && { relations }) } }
    const intent = JSON.stringify(data)
    if (submission.current?.intent !== intent) submission.current = { intent, id: crypto.randomUUID() }
    inFlight.current = true
    setSaving(true)
    setError("")
    try {
      const result = await readPersonal<ObservationSaved>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record-evidence-observation", matterId, data: { ...data, requestKey: submission.current.id } }),
      })
      onSaved(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存未完成，请重试。")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const canSave = dirty && !relation && Boolean(draft.excerpt || draft.date || draft.amount || draft.participants.length)
  const participantOptions = draft.participants.map(({ span }, index) => ({ value: String(index + 1), label: quote(span) }))

  return <Sheet open onOpenChange={next => { if (!next && !inFlight.current) close() }}>
    <SheetContent finalFocus={() => returnFocus} className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
      <SheetHeader className="shrink-0 border-b pe-12">
        <SheetTitle>{observation ? "修订记载" : "新增记载"}</SheetTitle>
        <SheetDescription>{sourceLabel} · 要点 V{expectedRevision}{observation && " · 记载 V" + observation.revision}</SheetDescription>
      </SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <fieldset disabled={saving} className="grid min-w-0 gap-4">
            <section aria-label="引用标注" className="grid min-w-0 gap-2">
              <p className="text-xs text-muted-foreground">在原文中选中文字，标记为相应字段。保存时会按固定版本核对。</p>
              <Textarea ref={input} readOnly rows={6} aria-label="记载的固定原文" value={original}
                className="max-h-48 resize-y overflow-auto [field-sizing:fixed]" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="xs" variant="outline" onClick={() => mark(span => {
                  if (span.end - span.start > 300) { setError("原文记载最多 300 字符。"); return }
                  setDraft(current => ({ ...current, excerpt: span }))
                })}>设为原文记载</Button>
                <Button type="button" size="xs" variant="outline"
                  onClick={() => mark(span => setDraft(current => ({ ...current, date: { role: current.date?.role ?? "OCCURRENCE", span } })))}>设为日期</Button>
                <Button type="button" size="xs" variant="outline"
                  onClick={() => mark(span => setDraft(current => ({ ...current, amount: { ...current.amount, nature: current.amount?.nature ?? "OTHER", span } })))}>设为金额</Button>
                <Button type="button" size="xs" variant="outline" disabled={!draft.amount}
                  onClick={() => mark(span => setDraft(current => ({ ...current, amount: { ...current.amount!, unitSpan: span } })))}>设为金额单位</Button>
                <Button type="button" size="xs" variant="outline" disabled={!!relation || draft.participants.length >= 12}
                  onClick={() => mark(addParticipant)}>添加参与人</Button>
                <Button type="button" size="xs" variant="outline" disabled={draft.participants.length < 2 || (!relation && draft.relations.length >= 12)}
                  onClick={() => mark(span => {
                    if (span.end - span.start > 600) {
                      setError("关系引文最多 600 字符。")
                      return
                    }
                    setRelation(current => ({ index: current?.index,
                      value: { ...(current?.value ?? { kind: "OTHER", from: 0, to: 0 }), span } }))
                  })}>{relation ? "替换关系引文" : "引用为关系"}</Button>
              </div>
            </section>

            <div className="grid gap-1 text-xs">
              <span>记载性质</span>
              <ChronologySelect label="记载性质" className="w-full" items={statements} value={draft.statement} disabled={saving}
                onChange={value => setDraft(current => ({ ...current, statement: value as Draft["statement"] }))} />
            </div>
            {draft.excerpt && <div className="grid gap-1 rounded-md border p-2 text-xs">
              <p className="break-words">原文记载「{quote(draft.excerpt)}」</p>
              <Button type="button" size="xs" variant="ghost" className="w-fit"
                onClick={() => setDraft(current => ({ ...current, excerpt: undefined }))}>移除原文记载</Button>
            </div>}
            {draft.date && <div className="grid gap-1 rounded-md border p-2 text-xs">
              <p className="break-words">日期「{quote(draft.date.span)}」</p>
              <div className="flex flex-wrap items-center gap-2">
                <ChronologySelect label="日期性质" items={dateRoles} value={draft.date.role} disabled={saving}
                  onChange={value => setDraft(current => ({ ...current, date: { ...current.date!, role: value as keyof typeof dateRoles } }))} />
                <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(current => ({ ...current, date: undefined }))}>移除日期</Button>
              </div>
            </div>}
            {draft.amount && <div className="grid gap-1 rounded-md border p-2 text-xs">
              <p className="break-words">金额「{quote(draft.amount.span)}」</p>
              {draft.amount.unitSpan && <div className="flex flex-wrap items-center gap-2">
                <p className="break-words">单位「{quote(draft.amount.unitSpan)}」</p>
                <Button type="button" size="xs" variant="ghost" onClick={() =>
                  setDraft(current => ({ ...current, amount: { ...current.amount!, unitSpan: undefined } }))}>移除单位</Button>
              </div>}
              <div className="flex flex-wrap items-center gap-2">
                <ChronologySelect label="金额性质" items={amountNatures} value={draft.amount.nature} disabled={saving}
                  onChange={value => setDraft(current => ({ ...current, amount: { ...current.amount!, nature: value as keyof typeof amountNatures } }))} />
                <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(current => ({ ...current, amount: undefined }))}>移除金额</Button>
              </div>
            </div>}
            {!!draft.participants.length && <ul aria-label="参与人" className="grid gap-1">
              {draft.participants.map(({ span }, index) => <li key={span.start} className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 text-xs">
                <span className="min-w-0 break-words">{quote(span)}</span>
                <Button type="button" size="xs" variant="ghost" disabled={!!relation} aria-label={"移除参与人 " + quote(span)}
                  onClick={() => removeParticipant(index)}>移除参与人</Button>
              </li>)}
            </ul>}
            {!!draft.relations.length && <ul aria-label="关系" className="grid gap-1">
              {draft.relations.map((link, index) => <li key={link.kind + "/" + link.from + "/" + link.to} className="grid gap-1 rounded-md border p-2 text-xs">
                <p className="break-words">{quote(draft.participants[link.from - 1].span)} · {relationLabels[link.kind]} → {quote(draft.participants[link.to - 1].span)}</p>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">原文「{quote(link.span)}」</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="xs" variant="ghost" disabled={!!relation} onClick={() => setRelation({ value: link, index })}>修改关系</Button>
                  <Button type="button" size="xs" variant="ghost" disabled={!!relation}
                    onClick={() => setDraft(current => ({ ...current, relations: current.relations.filter((_, i) => i !== index) }))}>移除关系</Button>
                </div>
              </li>)}
            </ul>}
            {relation && <section aria-label="关系编辑" className="grid min-w-0 gap-2 rounded-md border p-2.5 text-xs">
              <p className="whitespace-pre-wrap break-words">关系引文「{quote(relation.value.span)}」</p>
              <div className="flex flex-wrap gap-2">
                <ChronologySelect label="关系起点" value={relation.value.from ? String(relation.value.from) : null}
                  placeholder="选择起点" items={participantOptions}
                  onChange={value => setRelation({ ...relation, value: { ...relation.value, from: Number(value) } })} />
                <ChronologySelect label="关系类别" value={relation.value.kind} items={relationLabels}
                  onChange={value => setRelation({ ...relation, value: { ...relation.value, kind: value as Relation["kind"] } })} />
                <ChronologySelect label="关系终点" value={relation.value.to ? String(relation.value.to) : null}
                  placeholder="选择终点" items={participantOptions}
                  onChange={value => setRelation({ ...relation, value: { ...relation.value, to: Number(value) } })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="xs" variant="outline" onClick={keepRelation}>应用关系</Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => { setRelation(undefined); setError("") }}>取消关系编辑</Button>
              </div>
            </section>}
          </fieldset>
        </div>
        <div className="grid gap-2 border-t px-4 py-3">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={close}>取消</Button>
            <Button type="submit" size="sm" disabled={saving || !canSave}>{saving ? "正在保存…" : "保存记载"}</Button>
          </div>
        </div>
      </form>
    </SheetContent>
  </Sheet>
}
