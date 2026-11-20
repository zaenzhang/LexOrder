"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import type { ObservationEventHint } from "../../../../src/lib/evidence/chronology-assessment"
import { chronologyCategories } from "./fact-assessment"
import type { adoptMatterObservationsSchema } from "../../../../src/lib/evidence/case-adoption"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Adoption = z.input<typeof adoptMatterObservationsSchema>
export type AdoptionTarget = { id: string; title: string; revision: number; canEdit: boolean }
export type CandidatePick = Adoption["chosen"][number] & { source: string; quote: string; hint?: ObservationEventHint }
export type SavedAdoption = { id: string; revision: number }

export function MatterCandidateAdoption({ matterId, picks, targets, refreshTargets, setSaving, remove, onSaved }: {
  matterId: string; picks: CandidatePick[]; targets?: AdoptionTarget[]
  refreshTargets?(): void; setSaving(saving: boolean): void; remove(pick: CandidatePick): void; onSaved(saved: SavedAdoption): void
}) {
  const [mode, setMode] = useState<"new" | "existing">("new")
  const [target, setTarget] = useState<AdoptionTarget>()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [category, setCategory] = useState<ObservationEventHint["category"]>()
  const [kind, setKind] = useState<ObservationEventHint["kind"]>("TODO_VERIFY")
  const hint = picks[0]?.hint
  const lastRequest = useRef<{ intent: string; id: string }>(null)
  const items = useQuery({
    queryKey: ["chronicle", "case-adoption-targets", matterId], enabled: mode === "existing" && !targets, retry: false,
    queryFn: ({ signal }) => readPersonal<{ items: AdoptionTarget[] }>(workspaceEndpoint + "?" +
      new URLSearchParams({ matter: matterId, section: "evidence-items" }), { signal }),
  })
  const options = (targets ?? items.data?.items ?? []).filter(item => item.canEdit)
  const save = useMutation({
    mutationFn: (data: Adoption) => readPersonal<SavedAdoption>(workspaceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "adopt-matter-observations", data }),
    }),
    onSettled: () => setSaving(false),
    onSuccess: onSaved,
  })

  function submit() {
    const selection: Adoption["target"] | undefined = mode === "new"
      ? { type: "new", kind, title, content, chronologyCategory: category }
      : target && { type: "existing", evidenceItemId: target.id, expectedRevision: target.revision }
    if (!selection) return
    const data = { matterId, target: selection, chosen: picks.map(({ runId, index }) => ({ runId, index })) }
    const intent = JSON.stringify(data)
    if (lastRequest.current?.intent !== intent) lastRequest.current = { intent, id: crypto.randomUUID() }
    setSaving(true)
    save.mutate({ ...data, requestId: lastRequest.current.id })
  }

  return <form aria-label="采用候选" className="grid gap-3 rounded-lg border bg-card p-3"
    onSubmit={event => { event.preventDefault(); submit() }}>
    <h3 className="text-sm font-semibold">已选 {picks.length} 条候选 · {new Set(picks.map(pick => pick.runId)).size} 批</h3>
    <ul className="max-h-36 divide-y overflow-y-auto">{picks.map(pick =>
      <li key={pick.runId + ":" + pick.index} className="flex items-start justify-between gap-2 py-1 text-xs">
        <div className="min-w-0 space-y-1"><p>{pick.quote}</p><p className="text-muted-foreground">{pick.source}</p></div>
        <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => remove(pick)}>移除</Button>
      </li>)}</ul>
    <NativeSelect aria-label="采用到" value={mode} disabled={save.isPending} onChange={event => {
      setMode(event.target.value === "existing" ? "existing" : "new")
      save.reset()
    }}>
      <NativeSelectOption value="new">记录新的待核要点</NativeSelectOption>
      <NativeSelectOption value="existing">追加到已有要点</NativeSelectOption>
    </NativeSelect>
    {mode === "new" ? <>
      {hint && <Button type="button" size="xs" variant="outline" className="w-fit" disabled={save.isPending} onClick={() => {
        setTitle(hint.title); setCategory(hint.category); setKind(hint.kind)
        if (!content) setContent(picks.map(pick => pick.source + "：「" + pick.quote + "」").join("\n").slice(0, 5000))
      }}>填入 AI 建议，逐项核对</Button>}
      <div className="flex flex-wrap gap-2">
        <NativeSelect aria-label="要点性质" value={kind} disabled={save.isPending} onChange={event => setKind(event.target.value as typeof kind)}>
          <NativeSelectOption value="TODO_VERIFY">待核实</NativeSelectOption><NativeSelectOption value="FACT">事实</NativeSelectOption>
          <NativeSelectOption value="CLAIM">当事人主张</NativeSelectOption>
        </NativeSelect>
        <NativeSelect aria-label="归入事件分类" value={category ?? ""} disabled={save.isPending}
          onChange={event => setCategory((event.target.value || undefined) as typeof category)}>
          <NativeSelectOption value="">未指定分类</NativeSelectOption>
          {Object.entries(chronologyCategories).map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <Input aria-label="要点标题" placeholder="要点标题" required maxLength={200} value={title}
        disabled={save.isPending} onChange={event => setTitle(event.target.value)} />
      <Textarea aria-label="律师整理" placeholder="律师整理的事实记载或待核问题" required maxLength={5000} value={content}
        disabled={save.isPending} onChange={event => setContent(event.target.value)} />
    </> : <>
      {!targets && items.isPending && <p role="status" className="text-xs">正在读取本案要点…</p>}
      {items.error && <p role="alert" className="text-xs text-destructive">{items.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="min-w-0 grow" aria-label="已有要点" value={target?.id ?? ""} disabled={save.isPending}
          onChange={event => setTarget(options.find(item => item.id === event.target.value))}>
          <NativeSelectOption value="">{options.length ? "请选择要点" : "暂无可编辑要点"}</NativeSelectOption>
          {options.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.title} · V{item.revision}</NativeSelectOption>)}
        </NativeSelect>
        {(items.error || save.error) && <Button type="button" variant="outline" size="sm" onClick={() => {
          setTarget(undefined)
          save.reset()
          if (targets) refreshTargets?.()
          else void items.refetch()
        }}>重读要点</Button>}
      </div>
    </>}
    {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    <Button type="submit" size="sm" className="justify-self-end" disabled={save.isPending ||
      (mode === "new" ? !title.trim() || !content.trim() : !target)}>
      {save.isPending ? "正在保存…" : "保存到要点"}
    </Button>
  </form>
}
