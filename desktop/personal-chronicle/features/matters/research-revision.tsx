"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

const queryStatuses: Record<string, string> = { FULLTEXT: "全文", SUMMARY: "摘要", LINK: "链接", NONE: "无资料", READ: "已阅读", NOT_OBTAINED: "未取得", UNREAD: "未读",
  NO_MATCH: "未命中", NO_ACCESS: "无权访问", FAILED: "查询失败", SUPPORTS: "支持", REBUTS: "反向", CONTEXT: "背景" }
type Research = {
  id: string; version: number; checkedAt: string | null; checkNote: string | null; readable: boolean
  canCheck: boolean; canDraft: boolean; content: {
    question: string; jurisdiction: string; relevantDate: string; scope: string; rule: string; exceptions: string
    supportingAnalysis: string; opposingAnalysis: string; conclusion: string; unresolved: string; nextSteps: string; purpose: string; researchedAt: string
    queryLog: { query: string; location: string; access: string; outcome: string; notes: string }[]
  } | null
  issue: { title: string; content: string; revision: number; confirmedAt: string | null } | null
  sources: { relation: string; lawMetadata: { title: string; jurisdiction: string; authority: string; number: string; verification: string; effectiveFrom: string; effectiveTo: string; acquiredOn: string; acquiredVia: string; usageScope: string }; id: string; documentId: string; documentName: string; version: number; locationLabel: string; changed: boolean }[]
}

export function ResearchRevision({ matterId, recordId, onClose, onUpdated }: {
  matterId: string; recordId: string; onClose: () => void; onUpdated: () => void
}) {
  const [revision, setRevision] = useState<Research>()
  const [refresh, setRefresh] = useState(0)
  const [note, setNote] = useState("")
  const [draftKey] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<{ documentId: string; fileName: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [discard, setDiscard] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: "research", record: recordId })
    readPersonal<Research>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(row => { if (!controller.signal.aborted) setRevision(row) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, recordId, refresh])

  async function mutate(action: "check-research" | "draft-research") {
    if (!revision || busy) return
    setBusy(true)
    setError("")
    try {
      const payload = action === "check-research"
        ? { action, matterId, id: recordId, expectedVersion: revision.version, acknowledged: true, note: note.trim() }
        : { action, matterId, researchRevisionId: recordId, requestKey: draftKey }
      const result = await readPersonal<{ documentId: string; fileName: string }>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
      if (action === "draft-research") setDraft(result)
      else { setNote(""); setRevision(undefined); setRefresh(value => value + 1); onUpdated() }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。") }
    finally { setBusy(false) }
  }

  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (note) setDiscard(true); else onClose() } }}>
    <SheetContent className="overflow-y-auto sm:max-w-xl motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{revision?.content?.question || "研究修订"}</SheetTitle></SheetHeader>
      <div className="grid gap-4 px-4 pb-4 text-sm">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {!revision ? (error ? <Button variant="outline" onClick={() => { setError(""); setRefresh(value => value + 1) }}>重新读取</Button>
          : <p role="status">正在读取修订…</p>) : revision.content && revision.readable ? <>
          <p className="text-xs text-muted-foreground">第 {revision.version} 版 · {revision.checkedAt ? "已核对" : "待核对"}</p>
          <dl className="grid gap-3">{([
            ["研究目的", revision.content.purpose], ["法域", revision.content.jurisdiction], ["适用日期", revision.content.relevantDate],
            ["研究范围", revision.content.scope], ["适用规则", revision.content.rule], ["例外", revision.content.exceptions],
            ["支持分析", revision.content.supportingAnalysis], ["反向分析", revision.content.opposingAnalysis], ["结论", revision.content.conclusion],
            ["待核实", revision.content.unresolved], ["下一步", revision.content.nextSteps], ["核对记录", revision.checkNote],
          ] as const).filter(([,value]) => !!value).map(([label, value]) => <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd>
          </div>)}</dl>
          {revision.issue && <div className="grid gap-1"><h3 className="font-medium">采用的争点 · 修订 {revision.issue.revision}</h3>
            <p>{revision.issue.title} · {revision.issue.confirmedAt ? "已核对" : "待核对"}</p><p className="whitespace-pre-wrap">{revision.issue.content}</p></div>}
          <div className="grid gap-1"><h3 className="font-medium">查询与阅读</h3>
            {revision.content.queryLog.length ? revision.content.queryLog.map((item, index) => <p key={index} className="whitespace-pre-wrap">
              {[item.query, item.location, queryStatuses[item.access], queryStatuses[item.outcome], item.notes].filter(Boolean).join(" · ")}
            </p>) : <p className="text-muted-foreground">未记录查询过程。</p>}</div>
          {revision.sources.length > 0 && <div className="grid gap-1"><h3 className="font-medium">采用的材料版本</h3>
            {revision.sources.map(source => <div key={source.id} className="grid gap-1"><a className="underline" href={materialUrl("/api/documents/"+source.documentId+"/download")} download>
              {source.documentName} · V{source.version} · {source.locationLabel}{source.changed ? " · 已有新版本" : ""}
            </a><p className="text-xs text-muted-foreground">{[queryStatuses[source.relation], source.lawMetadata.title, source.lawMetadata.jurisdiction, source.lawMetadata.authority,
              source.lawMetadata.number, source.lawMetadata.effectiveFrom && "自 " + source.lawMetadata.effectiveFrom, source.lawMetadata.effectiveTo && "至 " + source.lawMetadata.effectiveTo,
              source.lawMetadata.acquiredOn, source.lawMetadata.acquiredVia, source.lawMetadata.usageScope, source.lawMetadata.verification === "CHECKED" ? "已核实" : "待核实"].filter(Boolean).join(" · ")}</p></div>)}
          </div>}
          {revision.canCheck && <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void mutate("check-research") }}>
            <label className="grid gap-1">核对结论和仍待核实项<Textarea required maxLength={2000} value={note} disabled={busy} onChange={e => { setNote(e.target.value); setDiscard(false) }} /></label>
            <Button type="submit" disabled={busy || !note.trim()}>确认已核对范围和来源</Button>
          </form>}
          {revision.canDraft && !draft && <Button variant="outline" disabled={busy} onClick={() => void mutate("draft-research")}>据此版本生成分析工作稿</Button>}
          {draft && <a className="underline" href={materialUrl("/api/documents/"+draft.documentId+"/download")} download>下载 {draft.fileName}</a>}
        </> : <p>当前无权查看该研究修订。</p>}
        {discard && <div role="alert" className="grid gap-1">放弃未保存的核对结论？
          <div className="flex gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>继续核对</Button><Button variant="ghost" onClick={onClose}>放弃修改</Button></div></div>}
      </div>
    </SheetContent>
  </Sheet>
}

export function NewResearch({ matterId, onCreated }: { matterId: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [key, setKey] = useState("")
  const [at, setAt] = useState("")
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      const created = await readPersonal<{id: string}>(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-research", matterId, requestKey: key, researchedAt: at, ...Object.fromEntries(fields) }) })
      setOpen(false)
      onCreated(created.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。") }
    finally { setBusy(false) }
  }
  return <>
    <Button size="sm" className="justify-self-start" onClick={() => { setError(""); setDirty(false); setDiscard(false); setKey(crypto.randomUUID()); setAt(new Date().toISOString()); setOpen(true) }}>新建研究记录</Button>
    {open && <Sheet open onOpenChange={next => { if (!next && !busy) { if (dirty) setDiscard(true); else setOpen(false) } }}>
      <SheetContent className="overflow-y-auto motion-reduce:transition-none">
        <SheetHeader><SheetTitle>新建研究记录</SheetTitle></SheetHeader>
        <form className="grid gap-3 px-4 pb-4" onSubmit={save} onChange={() => { setDirty(true); setDiscard(false); setKey(crypto.randomUUID()) }}>
          <fieldset disabled={busy} className="grid gap-3 text-sm">
            <label className="grid gap-1">研究问题<Input required maxLength={300} name="question" /></label>
            <label className="grid gap-1">研究范围<Textarea name="scope" maxLength={5000} /></label>
            <label className="grid gap-1">初步结论<Textarea name="conclusion" maxLength={15000} /></label>
            <label className="grid gap-1">仍待核实<Textarea name="unresolved" maxLength={10000} /></label>
            <Button type="submit">{busy ? "正在保存…" : "保存研究修订"}</Button>
          </fieldset>
          {error && <p role="alert">{error}</p>}
          {discard && <div role="alert" className="grid gap-1 text-sm">放弃未保存的研究？
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>放弃修改</Button></div></div>}
        </form>
      </SheetContent>
    </Sheet>}
  </>
}
