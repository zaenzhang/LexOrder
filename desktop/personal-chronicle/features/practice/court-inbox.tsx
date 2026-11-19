"use client"

import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { materialUrl, readPersonal, type Matter } from "@/features/matters/personal-client"

type Item = { id: string; text: string; note: string | null; receivedAt: string; processed: boolean; matter: { id: string; title: string; code: string } | null;
  files: { id: string; name: string; state: string; documentId: string | null }[] }
type Receipt = { count?: number; duplicates?: number; filedFiles?: number; warning?: string; saved?: string[]; skippedDuplicates?: string[]; failed?: {name:string;message:string}[] }
const endpoint = "/api/personal-runtime/court-inbox"

export function CourtInbox() {
  const [items, setItems] = useState<Item[]>()
  const [state, setState] = useState("unprocessed")
  const [selected, setSelected] = useState("")
  const [paste, setPaste] = useState(false)
  const [batch, setBatch] = useState(false)
  const [query, setQuery] = useState("")
  const [matters, setMatters] = useState<Matter[]>([])
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const item = items?.find(r => r.id === selected)

  useEffect(() => {
    const c = new AbortController()
    readPersonal<{ items: Item[] }>(endpoint + "?state=" + state, { signal: c.signal }).then(r => {
      if (!c.signal.aborted) setItems(r.items)
    }).catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [state, revision])
  useEffect(() => {
    if (!item || item.matter || item.processed) return
    const c = new AbortController()
    const t = window.setTimeout(() => { readPersonal<{ matters: Matter[] }>("/api/personal-runtime/practice-operations?q=" + encodeURIComponent(query), { signal: c.signal })
      .then(r => { if (!c.signal.aborted) setMatters(r.matters) }).catch(e => { if (!c.signal.aborted) setError(e.message) }) }, 160)
    return () => { c.abort(); window.clearTimeout(t) }
  }, [item, query])

  async function submit(body: object | FormData, action: string) {
    if (busy) return
    setBusy(true); setError(""); setNotice("")
    try {
      const receipt = await readPersonal<Receipt>(endpoint, body instanceof FormData ? { method: "POST", body } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const message = action === "paste" ? "已登记 " + ((receipt.count || 0) - (receipt.duplicates || 0)) + " 条，重复 " + (receipt.duplicates || 0) + " 条。"
        : action === "upload" ? "已补传 " + (receipt.saved?.length || 0) + " 件，重复 " + (receipt.skippedDuplicates?.length || 0) + " 件，已入卷 " + (receipt.filedFiles || 0) + " 件。"
        : action === "finish" ? "已记录处理结果。" : "本次入卷 " + (receipt.filedFiles || 0) + " 件。"
      setNotice([message, receipt.warning].filter(Boolean).join(" "))
      if (receipt.failed?.length) setError(receipt.failed.map(f => f.name + " · " + f.message).join("；"))
      if (action === "paste") { setPaste(false); setState("unprocessed") }
      if (action === "finish") setSelected("")
      setRevision(n => n + 1)
    } catch (e) { setError(e instanceof Error ? e.message : "处理失败，请重新核对来件。") } finally { setBusy(false) }
  }
  function addFiles(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("smsId", selected)
    void submit(form, "upload")
  }
  const status = <>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}</>
  return <section className="grid gap-4"><PageHeader title="法院来件" /><div className="flex flex-wrap gap-2">
    <Button onClick={() => { setError(""); setNotice(""); setPaste(true) }}>登记来件</Button>
    {[["unprocessed","待处理"],["processed","已处理"]].map(([v,text]) => <Button key={v} variant={state===v?"secondary":"ghost"} onClick={() => { if (v!==state) {setItems(undefined);setState(v)} }}>{text}</Button>)}</div>
    {!paste && !item && status}
    {!items && !error && <p role="status">正在读取来件…</p>}
    {items?.length === 0 && <p className="text-sm text-muted-foreground">暂无此状态的来件。</p>}
    <ul className="divide-y">{items?.map(r => <li key={r.id} className="grid gap-1 py-3"><Button variant="link" className="h-auto justify-self-start whitespace-normal px-0 text-start" onClick={() => { setSelected(r.id); setQuery(""); setMatters([]); setError(""); setNotice("") }}>{r.text.slice(0,100)}</Button>
      <span className="text-xs text-muted-foreground">{new Date(r.receivedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})} · {r.matter?.title || "待确认案件"} · {r.files.length} 个附件</span></li>)}</ul>
    <Sheet open={paste || !!item} onOpenChange={v => { if (!v && !busy) { setPaste(false); setSelected("") } }}><SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{paste ? "登记法院来件" : "办理来件"}</SheetTitle></SheetHeader><div className="grid gap-4 px-4 pb-4 text-sm">{status}
        {paste && <form className="grid gap-3" onSubmit={e => {e.preventDefault(); void submit({ action:"paste",rawText:new FormData(e.currentTarget).get("text"),batch },"paste")}}>
          <label>来件原文<Textarea name="text" required maxLength={8000} disabled={busy} /></label>
          <label className="flex gap-2 items-center"><Checkbox checked={batch} disabled={busy} onCheckedChange={setBatch} />按空行拆分多条</label><Button disabled={busy}>登记</Button></form>}
        {item && <><p className="whitespace-pre-wrap">{item.text}</p>
          {item.matter ? <Link href={'/matters/'+item.matter.id+'/materials'} className="underline">{item.matter.code} · {item.matter.title}</Link> : !item.processed && <div className="grid gap-1"><Input placeholder="搜索要关联的案件" aria-label="搜索要关联的案件" value={query} onChange={e => {setQuery(e.target.value);setMatters([])}} />
            {matters.map(m => <Button key={m.id} variant="outline" disabled={busy} onClick={() => submit({action:"match",smsId:item.id,matterId:m.id},"match")}>归入 {m.internalCode} · {m.title}</Button>)}</div>}
          {item.files.length>0 && <ul>{item.files.map(f=><li key={f.id}>{f.documentId ? <a className="underline" href={materialUrl("/api/documents/"+f.documentId+"/download")} download>{f.name} · 已入卷版本</a> : f.name+" · 待入卷"}</li>)}</ul>}
          {!item.processed && <><form onSubmit={addFiles} className="grid gap-2"><label>补传附件<Input name="files" required type="file" disabled={busy} /></label><Button variant="outline" disabled={busy}>保存附件</Button></form>
            {item.matter && item.files.some(f=>!f.documentId) && <Button variant="outline" disabled={busy} onClick={() => submit({action:"file",smsId:item.id},"file")}>继续入卷</Button>}
            <form className="grid gap-2" onSubmit={e=>{e.preventDefault();void submit({action:"finish",id:item.id,note:String(new FormData(e.currentTarget).get("note")||"")},"finish")}}>
              <label>处理说明<Textarea name="note" maxLength={500} disabled={busy} /></label><Button disabled={busy}>标记已处理</Button></form></>}
          {item.note && <p role="status" className="whitespace-pre-wrap">{item.note}</p>}</>}
      </div></SheetContent></Sheet>
  </section>
}
