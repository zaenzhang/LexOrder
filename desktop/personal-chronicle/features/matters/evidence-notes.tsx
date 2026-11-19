"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { EvidenceReview } from "./evidence-review"
import { readPersonal, workspaceEndpoint } from "./personal-client"

const kinds = { FACT: "事实", CLAIM: "当事人陈述", ANALYSIS: "分析", ISSUE: "争点", TODO_VERIFY: "待核实" }
const relations = { SUPPORTS: "支持", REBUTS: "反驳", CONTEXT: "背景" }
type Kind = keyof typeof kinds
type Source = { id: string; documentName: string | null; documentVersion: number | null; relation: keyof typeof relations | null; legacy: boolean; status: string; locationLabel: string | null }
type EventDate = { precision: "EXACT" | "RANGE" | "UNKNOWN"; start: string | null; end: string | null; text: string | null }
type Item = { id: string; kind: Kind; title: string; content: string; revision: number; confirmedAt: string | null;
  restricted: boolean; canEdit: boolean; sources: Source[]; eventDate: EventDate | null }
type FormOptions = { canWrite: boolean; documents: { id: string; name: string; version: number; isPdf: boolean; pageCount: number | null; hasIdentity: boolean }[] }
type Action = "create" | "revise" | "link" | "unlink"
type Editing = { action: Action; item?: Item }
function when(row: Item) {
  const date = row.eventDate
  return [date?.start, date?.end].filter(Boolean).join(" 至 ") || date?.text || "时间未明"
}

export function EvidencePage({ matterId }: { matterId: string }) {
  return <Tabs defaultValue="compare">
    <TabsList aria-label="事实与争点视图"><TabsTrigger value="compare">争点证据对照</TabsTrigger><TabsTrigger value="notes">事实与要点</TabsTrigger></TabsList>
    <TabsContent value="compare"><EvidenceReview matterId={matterId}/></TabsContent>
    <TabsContent value="notes"><EvidenceNotes matterId={matterId}/></TabsContent>
  </Tabs>
}

function EvidenceNotes({ matterId }: { matterId: string }) {
  const [items, setItems] = useState<Item[]>()
  const [options, setOptions] = useState<FormOptions>()
  const [kind, setKind] = useState("")
  const [editing, setEditing] = useState<Editing>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    const endpoint = workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items" })
    Promise.all([readPersonal<{ items: Item[] }>(endpoint, { signal: controller.signal }),
      readPersonal<FormOptions>(endpoint + "&options=1", { signal: controller.signal })])
      .then(([rows, form]) => { if (!controller.signal.aborted) { setItems(rows.items); setOptions(form) } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, refresh])
  function reload() { setItems(undefined); setOptions(undefined); setError(""); setRefresh(value => value + 1) }
  const visible = items?.filter(item => !kind || kind === item.kind)
  return <section className="grid gap-4">
    <PageHeader title="事实与要点" actions={options?.canWrite ? <Button size="sm" onClick={() => setEditing({ action: "create" })}>记录要点</Button> : null} />
    <NativeSelect aria-label="要点性质" value={kind} onChange={e => setKind(e.target.value)}>
      <NativeSelectOption value="">全部性质</NativeSelectOption>{Object.entries(kinds).map(([id,label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
    </NativeSelect>
    {error ? <div role="alert" className="flex gap-2 text-sm">{error}<Button size="sm" variant="outline" onClick={reload}>重试</Button></div>
      : !visible ? <p role="status">正在读取要点…</p> : !visible.length && <p className="text-muted-foreground">没有符合条件的记录。</p>}
    {visible?.map(item => <Card key={item.id}><CardHeader><CardTitle>{item.title}</CardTitle>
      <p className="text-xs text-muted-foreground">{kinds[item.kind]} · {when(item)} · V{item.revision} · {item.confirmedAt ? "已核对" : "待核对"}</p></CardHeader>
      <CardContent className="grid gap-2 text-sm">{item.restricted ? <p>部分出处不可读。</p> : <>
        <p className="whitespace-pre-wrap">{item.content}</p>
        {item.eventDate?.start && item.eventDate.text && <p>原始时间表述 · {item.eventDate.text}</p>}
        {item.sources.map(source => <p key={source.id} className="text-xs text-muted-foreground">
          {relations[source.relation ?? "CONTEXT"]} · {source.documentName} · V{source.documentVersion} · {source.locationLabel}</p>)}
        {item.canEdit && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditing({ action: "revise", item })}>修订要点</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ action: "link", item })}>关联来源</Button>
          {item.sources.some(s => !s.legacy) && <Button size="sm" variant="ghost" onClick={() => setEditing({ action: "unlink", item })}>撤回来源关系</Button>}
        </div>}
      </>}</CardContent></Card>)}
    {editing && options && <EvidenceEditor editing={editing} options={options} matterId={matterId} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload() }} />}
  </section>
}

function EvidenceEditor({ editing: { action, item }, matterId, options, onClose, onSaved }: {
  editing: Editing; options: FormOptions; matterId: string; onClose: () => void; onSaved: () => void
}) {
  const [precision, setPrecision] = useState(item?.eventDate?.precision ?? "UNKNOWN")
  const [docId, setDocId] = useState("")
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState("")
  const textForm = action === "create" || action === "revise"
  const choice = options.documents.find(doc => doc.id === docId)
  const title = { create: "记录要点", revise: "修订要点", link: "关联材料版本", unlink: "撤回来源关系" }[action]
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    const revision = { evidenceItemId: item?.id, expectedRevision: item?.revision }
    const text = { title: fields.get("title"), content: fields.get("content"), kind: fields.get("kind"), eventDate: {
      precision, start: fields.get("start") || null, end: fields.get("end") || null, text: fields.get("timeText") || null,
    } }
    const page = fields.get("page") ? Number(fields.get("page")) : null
    const payload = {
      create: { ...text, matterId, requestKey: key, sourceDocumentId: docId || null, sourceRelation: fields.get("relation") ?? "CONTEXT", sourcePage: page },
      revise: { ...revision, ...text }, link: { ...revision, documentId: docId, page, relation: fields.get("relation") },
      unlink: { ...revision, sourceId: fields.get("source") },
    }[action]
    setBusy(true); setError("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action + "-evidence", matterId, data: payload }) })
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。") }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setDiscard(true); else onClose() } }}>
    <SheetContent className="overflow-y-auto motion-reduce:transition-none"><SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
      <form className="grid gap-3 px-4 pb-4 text-sm" onSubmit={save} onChange={() => { setDirty(true); setDiscard(false); setKey(crypto.randomUUID()) }}>
        <fieldset className="grid gap-3" disabled={busy}>
          {textForm && <>
            <label className="grid gap-1">性质<NativeSelect name="kind" defaultValue={item?.kind ?? "TODO_VERIFY"}>{Object.entries(kinds).map(([id,label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}</NativeSelect></label>
            <label className="grid gap-1">标题<Input name="title" defaultValue={item?.title} required maxLength={200} /></label>
            <label className="grid gap-1">内容<Textarea name="content" defaultValue={item?.content} required maxLength={5000} /></label>
            <label className="grid gap-1">发生日期精度<NativeSelect value={precision} onChange={e => setPrecision(e.target.value as EventDate["precision"])}>
              <NativeSelectOption value="UNKNOWN">时间未明</NativeSelectOption><NativeSelectOption value="EXACT">精确日期</NativeSelectOption><NativeSelectOption value="RANGE">日期区间</NativeSelectOption>
            </NativeSelect></label>
            {precision !== "UNKNOWN" && <label className="grid gap-1">{precision === "RANGE" ? "起始日" : "发生日"}<Input required name="start" type="date" defaultValue={item?.eventDate?.start ?? ""} /></label>}
            {precision === "RANGE" && <label className="grid gap-1">结束日<Input required name="end" type="date" defaultValue={item?.eventDate?.end ?? ""} /></label>}
            <label className="grid gap-1">原始时间表述<Input name="timeText" maxLength={500} defaultValue={item?.eventDate?.text ?? ""} /></label>
          </>}
          {(action === "create" || action === "link") && <>
            <label className="grid gap-1">来源材料版本<NativeSelect value={docId} required={action === "link"} onChange={e => setDocId(e.target.value)}>
              <NativeSelectOption value="">{action === "link" ? "请选择材料" : "暂未关联"}</NativeSelectOption>
              {options.documents.map(doc => <NativeSelectOption disabled={!doc.hasIdentity} key={doc.id} value={doc.id}>{doc.name} · V{doc.version}</NativeSelectOption>)}
            </NativeSelect></label>
            {docId && <label className="grid gap-1">来源关系<NativeSelect name="relation" defaultValue="CONTEXT">{Object.entries(relations).map(([id,label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}</NativeSelect></label>}
            {choice?.isPdf && <label className="grid gap-1">已知页码<Input key={docId} name="page" type="number" min={1} max={choice.pageCount ?? 10000} /></label>}
          </>}
          {action === "unlink" && <label className="grid gap-1">选择要撤回的来源关系<NativeSelect name="source" required defaultValue=""><NativeSelectOption value="">请选择来源</NativeSelectOption>
            {item?.sources.filter(s => !s.legacy).map(source => <NativeSelectOption key={source.id} value={source.id}>{source.documentName} · V{source.documentVersion} · {source.locationLabel} · {relations[source.relation ?? "CONTEXT"]}</NativeSelectOption>)}
          </NativeSelect></label>}
          <Button type="submit">{busy ? "正在保存…" : title}</Button>
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {discard && <div role="alert" className="grid gap-2">放弃未保存的修改？<div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button><Button type="button" variant="ghost" onClick={onClose}>放弃修改</Button></div></div>}
      </form>
    </SheetContent>
  </Sheet>
}
