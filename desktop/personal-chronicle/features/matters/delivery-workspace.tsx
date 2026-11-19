"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

const statusNames = { PREPARED: "已准备", EXPORTED: "已导出，未登记发送", SENT: "已登记发送", UNAVAILABLE: "记录暂不可查看" }
const eventNames = { EXPORTED: "导出", SENT: "实际送出", RECEIVED: "收悉", REPLIED: "客户回复", CONTENT_CONFIRMED: "客户确认内容", SEND_CORRECTION: "发送更正" }
type Kind = keyof typeof eventNames
export type DeliverySummary = { id: string; purpose: string | null; recipientName: string | null; state: keyof typeof statusNames; itemCount: number }
type Options = {
  canPrepare: boolean
  documents: { id: string; name: string; version: number; canDeliver: boolean; blockedReason: string | null; needsSourceDeclaration?: boolean }[]
  clients: { id: string; name: string; contact: string }[]
}
type Detail = {
  id: string; purpose: string; recipientName: string; recipientContact: string; disclosureScope: string; unresolvedItems: string; canWrite: boolean
  supersedesId: string | null
  items: { id: string; documentId: string; documentName: string; documentVersion: number; newerVersionAvailable: boolean }[]
  events: { id: string; kind: Kind; occurredAt: string; recordedAt: string; actorName: string; channel: string | null; note: string | null;
    proofDocumentId: string | null; proofName: string | null; proofUnavailable: boolean; correctsEventId: string | null }[]
}
const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })
const localInputTime = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(" ", "T")
const download = (id: string) => materialUrl("/api/documents/" + id + "/download")
function post<T>(payload: unknown) {
  return readPersonal<T>(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
}

export function DeliveryWorkspace({ matterId, rows, reload }: { matterId: string; rows: DeliverySummary[]; reload: () => void }) {
  const [options, setOptions] = useState<Options>()
  const [optionsError, setOptionsError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [active, setActive] = useState("")
  const [priorId, setPriorId] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    readPersonal<Options>(workspaceEndpoint + "?" + new URLSearchParams({ section: "delivery", matter: matterId, options: "1" }), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setOptions(value) })
      .catch(cause => { if (!controller.signal.aborted) setOptionsError(cause.message) })
    return () => controller.abort()
  }, [matterId, attempt])
  return <Card><CardHeader><CardTitle>交付记录</CardTitle></CardHeader><CardContent className="grid gap-3">
    {options?.canPrepare && <Button className="justify-self-start" size="sm" onClick={() => { setPriorId(null); setActive("new") }}>准备交付</Button>}
    {optionsError && <div role="alert" className="flex items-center gap-2 text-sm">{optionsError}<Button size="sm" variant="outline" onClick={() => { setOptionsError(""); setAttempt(n => n + 1) }}>重新读取材料选项</Button></div>}
    {!rows.length && <p className="text-sm text-muted-foreground">暂无交付记录。</p>}
    <ul className="divide-y">{rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div><p className="text-sm font-medium">{row.purpose ?? "不可查看的清单"}</p><p className="text-xs text-muted-foreground">{[row.recipientName, statusNames[row.state], row.itemCount + " 份材料"].filter(Boolean).join(" · ")}</p></div>
      {row.state !== "UNAVAILABLE" && <Button size="sm" variant="outline" onClick={() => setActive(row.id)}>查看清单</Button>}
    </li>)}</ul>
    {active === "new" && options && <PrepareDelivery matterId={matterId} options={options} priorId={priorId} onClose={() => setActive("")} onSaved={id => { setActive(id); reload() }} />}
    {active && active !== "new" && <DeliveryDetail key={active} matterId={matterId} id={active} options={options} reload={reload} onClose={() => setActive("")}
      onPrepare={() => { setPriorId(active); setActive("new") }} />}
  </CardContent></Card>
}

function Discard({ keep, leave }: { keep: () => void; leave: () => void }) {
  return <div role="alert" className="grid gap-2 text-sm">放弃未保存的交付内容？
    <div className="flex gap-2"><Button type="button" size="sm" onClick={keep}>继续填写</Button><Button type="button" size="sm" variant="outline" onClick={leave}>放弃修改</Button></div>
  </div>
}
function PrepareDelivery({ matterId, options, priorId, onClose, onSaved }: {
  matterId: string; options: Options; priorId: string | null; onClose: () => void; onSaved: (id: string) => void
}) {
  const [ids, setIds] = useState<string[]>([])
  const [clientId, setClientId] = useState("")
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      const result = await post<{ id: string }>({ action: "prepare-delivery", data: {
        matterId, requestKey: key, documentIds: ids,
        sourceDeclarations: ids.filter(id => form.has("origin-" + id)).map(id => ({ documentId: id, kind: form.get("origin-" + id) })),
        recipientClientId: clientId || null, recipientName: name, recipientContact: contact, purpose: form.get("purpose"),
        disclosureScope: form.get("scope"), unresolvedItems: form.get("unresolved"), supersedesId: priorId,
      } })
      onSaved(result.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "清单保存失败。") }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setDiscard(true); else onClose() } }}>
    <SheetContent className="overflow-y-auto sm:max-w-xl motion-reduce:transition-none"><SheetHeader><SheetTitle>{priorId ? "补发交付清单" : "准备交付"}</SheetTitle></SheetHeader>
      <form onSubmit={save} onChange={() => { setDirty(true); setDiscard(false); setKey(crypto.randomUUID()) }} className="grid gap-3 px-4 pb-4">
        <fieldset disabled={busy} className="grid gap-3 text-sm">
          <fieldset className="grid gap-2"><legend className="mb-2 font-medium">实际交付的材料版本</legend>
            {!options.documents.length && <p className="text-muted-foreground">本案暂无材料。</p>}
            {options.documents.map(doc => <div className="grid gap-1" key={doc.id}>
              <label className="flex items-start gap-2"><input type="checkbox" disabled={!doc.canDeliver} checked={ids.includes(doc.id)}
                onChange={e => setIds(e.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} />
                {ids.includes(doc.id) ? ids.indexOf(doc.id) + 1 + ". " : ""}{doc.name} · V{doc.version}{doc.blockedReason && " · " + doc.blockedReason}
              </label>
              {doc.needsSourceDeclaration && ids.includes(doc.id) && <label className="grid gap-1">确认「{doc.name}」的来源<NativeSelect required name={"origin-" + doc.id} defaultValue="">
                <NativeSelectOption value="">请选择来源</NativeSelectOption><NativeSelectOption value="EXTERNAL_ATTACHMENT">外部来源附件</NativeSelectOption>
                <NativeSelectOption value="TEAM_PRODUCED">办案成果</NativeSelectOption></NativeSelect></label>}
            </div>)}
          </fieldset>
          {options.clients.length > 0 && <label className="grid gap-1">关联委托客户<NativeSelect value={clientId} onChange={e => {
            setClientId(e.target.value); const client = options.clients.find(row => row.id === e.target.value); setName(client?.name ?? ""); setContact(client?.contact ?? "")
          }}><NativeSelectOption value="">其他接收人</NativeSelectOption>{options.clients.map(c => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></label>}
          <label className="grid gap-1">接收人<Input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="grid gap-1">实际联系方式或交接地点<Input required maxLength={500} value={contact} onChange={e => setContact(e.target.value)} /></label>
          <label className="grid gap-1">交付目的<Input required maxLength={300} name="purpose" /></label>
          <label className="grid gap-1">披露范围<Textarea required maxLength={2000} name="scope" /></label>
          <label className="grid gap-1">未决事项<Textarea maxLength={4000} name="unresolved" /></label>
          <Button type="submit" disabled={!ids.length || ids.length > 30}>{busy ? "正在保存…" : "保存固定清单"}</Button>
          {ids.length > 30 && <p role="alert">每份清单最多可选 30 份材料。</p>}
        </fieldset>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {discard && <Discard keep={() => setDiscard(false)} leave={onClose} />}
      </form>
    </SheetContent></Sheet>
}

function DeliveryDetail({ matterId, id, options, onClose, onPrepare, reload }: {
  matterId: string; id: string; options?: Options; onClose: () => void; onPrepare: () => void; reload: () => void
}) {
  const [detail, setDetail] = useState<Detail>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<Exclude<Kind, "EXPORTED"> | null>(null)
  const [discard, setDiscard] = useState(false)
  const [eventKey, setEventKey] = useState("")
  const [exportKey, setExportKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const controller = new AbortController()
    readPersonal<Detail>(workspaceEndpoint + "?" + new URLSearchParams({ section: "delivery", matter: matterId, record: id }), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDetail(value) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, id, refresh])

  function refreshAfterSave() { setDetail(undefined); setRefresh(n => n + 1); reload() }
  async function exportZip() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export-delivery", matterId, deliveryId: id, requestKey: exportKey }) })
      if (!response.ok) throw Error((await response.json().catch(() => null))?.error ?? "导出失败。")
      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = (response.headers.get("content-disposition")?.includes("filename*=UTF-8''")
        ? decodeURIComponent(response.headers.get("content-disposition")!.split("filename*=UTF-8''")[1]) : "交付材料.zip")
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
      setExportKey(crypto.randomUUID())
      refreshAfterSave()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败。") }
    finally { setBusy(false) }
  }

  async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!kind || busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      await post({ action: "record-delivery-event", matterId, data: { deliveryId: id, requestKey: eventKey, kind,
        occurredAt: String(fields.get("at")) + ":00+08:00", channel: fields.get("channel"), note: fields.get("note"),
        proofDocumentId: fields.get("proof") || null, correctsEventId: fields.get("corrects") || null } })
      setKind(null)
      refreshAfterSave()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "实际登记失败。") }
    finally { setBusy(false) }
  }
  const sent = detail?.events.some(event => event.kind === "SENT")
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (kind) setDiscard(true); else onClose() } }}>
    <SheetContent className="overflow-y-auto sm:max-w-xl motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{detail?.purpose ?? "固定交付清单"}</SheetTitle></SheetHeader>
      <div className="grid gap-3 px-4 pb-4 text-sm">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {!detail ? error ? <Button variant="outline" size="sm" onClick={() => { setError(""); setRefresh(n => n + 1) }}>重读清单</Button> : <p role="status">正在读取交付记录…</p> : <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">接收人</dt><dd className="break-words">{detail.recipientName}</dd>
            <dt className="text-muted-foreground">联系方式或交接地点</dt><dd className="break-words">{detail.recipientContact}</dd>
          </dl>
          <p className="whitespace-pre-wrap">披露范围 · {detail.disclosureScope}</p>
          {detail.unresolvedItems && <p className="whitespace-pre-wrap">未决事项 · {detail.unresolvedItems}</p>}
          {detail.supersedesId && <p className="text-muted-foreground">原清单编号 · {detail.supersedesId}</p>}
          <ol className="grid list-decimal gap-1 ps-5">{detail.items.map(item => <li key={item.id}>
            <a href={download(item.documentId)} download className="underline">{item.documentName} · V{item.documentVersion}</a>
            {item.newerVersionAvailable && <span className="ms-2 text-muted-foreground">已有较新版本</span>}
          </li>)}</ol>
          <h3 className="font-medium">发生记录</h3>
          {!detail.events.length && <p className="text-muted-foreground">暂无导出或实际交付登记。</p>}
          {detail.events.map(event => <div key={event.id} className="grid gap-1 border-b pb-2">
            <p className="font-medium">{eventNames[event.kind]}</p>
            <p>发生时间 · <time dateTime={event.occurredAt}>{time.format(new Date(event.occurredAt))}</time>（上海）</p>
            <p className="text-xs text-muted-foreground">{event.actorName} 登记于 <time dateTime={event.recordedAt}>{time.format(new Date(event.recordedAt))}</time>（上海）</p>
            {event.channel && <p>渠道 · {event.channel}</p>}
            {event.note && <p className="whitespace-pre-wrap">{event.note}</p>}
            {event.correctsEventId && <p className="text-xs">更正原登记 · {event.correctsEventId}</p>}
            {event.proofName && event.proofDocumentId && <a href={download(event.proofDocumentId)} download className="underline">凭据 · {event.proofName}</a>}
            {event.proofUnavailable && <p>凭据当前不可查看。</p>}
            {event.kind !== "EXPORTED" && !event.proofUnavailable && !event.proofDocumentId && <p className="text-muted-foreground">仅人工登记，未附凭据</p>}
          </div>)}
          {detail.canWrite && options?.canPrepare && !kind && <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportZip()}>导出固定材料</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onPrepare}>另建补发清单</Button>
            {(sent ? ["RECEIVED", "REPLIED", "CONTENT_CONFIRMED", "SEND_CORRECTION"] as const : ["SENT"] as const).map(next =>
              <Button key={next} size="sm" variant="outline" disabled={busy} onClick={() => { setError(""); setDiscard(false); setEventKey(crypto.randomUUID()); setKind(next) }}>
                登记{eventNames[next]}</Button>)}
          </div>}
          {kind && <form onSubmit={saveEvent} onChange={() => setEventKey(crypto.randomUUID())} className="grid gap-2">
            <fieldset disabled={busy} className="grid gap-2"><legend className="mb-2 font-medium">{eventNames[kind]}</legend>
              <label className="grid gap-1">实际发生时间（北京时间）<Input name="at" type="datetime-local" required defaultValue={localInputTime()} /></label>
              <label className="grid gap-1">渠道<Input name="channel" required={kind === "SENT" || kind === "SEND_CORRECTION"} maxLength={100} /></label>
              <label className="grid gap-1">实际发生情况或客户原意<Textarea name="note" required maxLength={8000} /></label>
              <label className="grid gap-1">凭据版本<NativeSelect name="proof" defaultValue=""><NativeSelectOption value="">未附凭据</NativeSelectOption>
                {options?.documents.map(doc => <NativeSelectOption key={doc.id} value={doc.id}>{doc.name} · V{doc.version}</NativeSelectOption>)}</NativeSelect></label>
              {kind === "SEND_CORRECTION" && <label className="grid gap-1">更正哪一条发送登记<NativeSelect name="corrects" required defaultValue="">
                <NativeSelectOption value="">请选择原登记</NativeSelectOption>{detail.events.filter(e => e.kind === "SENT" || e.kind === "SEND_CORRECTION").map(e => <NativeSelectOption key={e.id} value={e.id}>
                  {time.format(new Date(e.occurredAt))} · {e.note}</NativeSelectOption>)}</NativeSelect></label>}
              <div className="flex gap-2"><Button type="submit">{busy ? "正在保存…" : "登记实际发生情况"}</Button>
                <Button type="button" variant="ghost" onClick={() => setDiscard(true)}>取消</Button></div>
            </fieldset>
          </form>}
          {discard && <Discard keep={() => setDiscard(false)} leave={() => { setDiscard(false); setKind(null) }} />}
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
