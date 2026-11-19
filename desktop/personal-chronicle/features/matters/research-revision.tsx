"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ResearchArtifact, researchAnalysis, type ResearchAnalysis } from "./research-artifact"
import { FixedSourcePreview, type FixedSource } from "./fixed-source-preview"
import { evidenceEndpoint, materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

const queryStatuses: Record<string, string> = { FULLTEXT: "全文", SUMMARY: "摘要", LINK: "链接", NONE: "无资料", READ: "已阅读", NOT_OBTAINED: "未取得", UNREAD: "未读",
  NO_MATCH: "未命中", NO_ACCESS: "无权访问", FAILED: "查询失败", SUPPORTS: "支持", REBUTS: "反向", CONTEXT: "背景" }
type Research = {
  id: string; current: boolean; version: number; checkedAt: string | null; checkNote: string | null; readable: boolean
  canRevise: boolean; canCheck: boolean; canDraft: boolean; content: ResearchAnalysis & {
    question: string; jurisdiction: string; relevantDate: string; scope: string; purpose: string; researchedAt: string
    queryLog: { query: string; location: string; access: string; outcome: string; notes: string }[]
  } | null
  issue: { title: string; content: string; revision: number; confirmedAt: string | null; changed: boolean; confirmationChanged: boolean; sources: { id: string; documentName: string | null; documentVersion: number | null; locationLabel: string | null; relation: string | null }[] } | null
  sources: { relation: string; lawMetadata: { title: string; jurisdiction: string; authority: string; number: string; verification: string; effectiveFrom: string; effectiveTo: string; acquiredOn: string; acquiredVia: string; usageScope: string }; id: string; documentId: string; documentName: string; version: number; locationLabel: string; changed: boolean }[]
}

export function SavedResearchRevision({ matterId, recordId }: { matterId: string; recordId: string }) {
  const router = useRouter()
  return <ResearchRevision key={recordId} matterId={matterId} recordId={recordId}
    onClose={() => router.replace(`/matters/${matterId}/research`)}
    onRevised={id => router.replace(`/matters/${matterId}/research/${id}`)} />
}

type RevisionIndex = { records: { id: string; version: number; checkedAt: string | null; readable: boolean }[]; nextVersion: number | null }

export function ResearchRevision({ matterId, recordId, onClose, onUpdated, onRevised }: {
  matterId: string; recordId: string; onClose: () => void; onUpdated?: () => void; onRevised: (id: string) => void
}) {
  const [revision, setRevision] = useState<Research>()
  const [refresh, setRefresh] = useState(0)
  const [openedSource, setOpenedSource] = useState("")
  const sourceButtonPrefix = useId()
  const [edit, setEdit] = useState<{ analysis: ResearchAnalysis; requestKey: string }>()
  const editDirty = Boolean(edit && revision?.content && Object.entries(edit.analysis).some(
    ([key, value]) => value !== revision.content?.[key as keyof ResearchAnalysis],
  ))
  const [history, setHistory] = useState<RevisionIndex>()
  async function loadHistory(before?: number) {
    setBusy(true); setError("")
    try {
      const query = new URLSearchParams({ matter: matterId, research: recordId })
      if (before) query.set("before", String(before))
      const next = await readPersonal<RevisionIndex>(evidenceEndpoint + "?" + query)
      setHistory(old => before && old ? { ...next, records: [...old.records, ...next.records] } : next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取历史修订。") }
    finally { setBusy(false) }
  }
  const [note, setNote] = useState("")
  const [draftKey] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<{ documentId: string; fileName: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [discard, setDiscard] = useState<"close" | "edit" | null>(null)
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
      else { setNote(""); setRevision(undefined); setRefresh(value => value + 1); onUpdated?.() }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。") }
    finally { setBusy(false) }
  }

  async function saveAnalysis(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!revision?.canRevise || !edit || !editDirty || busy) return
    setBusy(true)
    setError("")
    try {
      const result = await readPersonal<{ id: string }>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise-research", matterId, supersedesId: revision.id,
          expectedVersion: revision.version, requestKey: edit.requestKey, analysis: edit.analysis }),
      })
      setEdit(undefined)
      setDiscard(null)
      onRevised(result.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存研究修订失败。")
    } finally {
      setBusy(false)
    }
  }

  function closeSource() {
    setOpenedSource("")
    document.getElementById(sourceButtonPrefix + openedSource)?.focus()
  }

  const sources = [
    ...revision?.issue?.sources.map(source => ({
      id: source.id, relation: source.relation, detail: [source.documentName, source.documentVersion && "V" + source.documentVersion, source.locationLabel].filter(Boolean).join(" · "),
      metadata: "",
    })) ?? [],
    ...revision?.sources.map(source => ({
      id: source.id, relation: source.relation,
      detail: `${source.documentName} · V${source.version} · ${source.locationLabel}${source.changed ? " · 已有新版本" : ""}`,
      metadata: [source.lawMetadata.title, source.lawMetadata.jurisdiction, source.lawMetadata.authority,
        source.lawMetadata.number, source.lawMetadata.effectiveFrom && "自 " + source.lawMetadata.effectiveFrom,
        source.lawMetadata.effectiveTo && "至 " + source.lawMetadata.effectiveTo, source.lawMetadata.acquiredOn,
        source.lawMetadata.acquiredVia, source.lawMetadata.usageScope,
        source.lawMetadata.verification === "CHECKED" ? "已核实" : "待核实"].filter(Boolean).join(" · "),
    })) ?? [],
  ]

  return <Sheet open onOpenChange={open => {
    if (!open && !busy) {
      if (note || editDirty) setDiscard("close")
      else onClose()
    }
  }}>
    <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-5xl motion-reduce:transition-none">
      <SheetHeader className="border-b pr-14">
        <SheetTitle className="break-words">{revision?.content?.question || "研究修订"}</SheetTitle>
        {revision && <p className="text-xs text-muted-foreground">第 {revision.version} 版 · {revision.checkedAt ? "已核对" : "待核对"}{!revision.current ? " · 历史修订" : ""}</p>}
      </SheetHeader>
      <div className="grid gap-4 p-4 text-sm sm:p-5">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {revision && <div className="flex flex-wrap items-center gap-2">
          {revision.readable && revision.content && revision.canRevise && !edit && <Button size="sm" disabled={busy || Boolean(note)} onClick={() => {
            if (!revision.content) return
            setError("")
            setDiscard(null)
            setEdit({ analysis: researchAnalysis(revision.content), requestKey: crypto.randomUUID() })
          }}>编辑成果</Button>}
          {(revision.version > 1 || !revision.current) && <Button size="sm" variant="outline" disabled={busy || Boolean(edit)} onClick={() => void loadHistory()}>查看修订历史</Button>}
        </div>}
        {history && <div className="grid gap-2 rounded-lg border p-3">
          {history.records.map(row => <div key={row.id}>
            {row.id !== recordId && row.readable && !note && !busy && !edit
              ? <Link className="underline" href={`/matters/${matterId}/research/${row.id}`}>查看第 {row.version} 版</Link> : `第 ${row.version} 版`}
            {row.id === recordId ? " · 正在查看" : ""} · {row.readable ? (row.checkedAt ? "已核对" : "待核对") : "来源受限"}
          </div>)}
          {history.nextVersion && <Button size="sm" variant="outline" className="justify-self-start" disabled={busy || Boolean(edit)}
            onClick={() => void loadHistory(history.nextVersion!)}>更早修订</Button>}
        </div>}
        {discard && <div role="alert" className="grid gap-2 rounded-lg border p-3">
          {discard === "edit" ? "放弃未保存的成果修改？" : "放弃未保存的修改并关闭？"}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDiscard(null)}>继续编辑</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              if (discard === "close") onClose()
              else { setEdit(undefined); setDiscard(null); setError("") }
            }}>放弃修改</Button>
          </div>
        </div>}
        {!revision ? (error ? <Button variant="outline" onClick={() => { setError(""); setRefresh(value => value + 1) }}>重新读取</Button>
          : <p role="status">正在读取修订…</p>) : revision.content && revision.readable ? (
          <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <form onSubmit={saveAnalysis}>
                <fieldset disabled={busy} className="min-w-0">
                  <ResearchArtifact analysis={edit?.analysis ?? revision.content}
                    onChange={edit ? analysis => { setEdit({ analysis, requestKey: crypto.randomUUID() }); setDiscard(null) } : undefined}>
                    {edit && <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={!editDirty || busy}>{busy ? "保存中…" : "保存新修订"}</Button>
                      <Button type="button" variant="outline" onClick={() => {
                        if (editDirty) setDiscard("edit")
                        else { setEdit(undefined); setError("") }
                      }}>取消编辑</Button>
                    </div>}
                  </ResearchArtifact>
                </fieldset>
              </form>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">研究范围与查询记录</summary>
                <dl className="mt-3 grid gap-3">{([
                  ["研究目的", revision.content.purpose], ["法域", revision.content.jurisdiction], ["适用日期", revision.content.relevantDate],
                  ["研究范围", revision.content.scope], ["核对记录", revision.checkNote],
                ] as const).filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd>
                </div>)}</dl>
                <h3 className="mt-3 font-medium">查询与阅读</h3>
                {revision.content.queryLog.length ? revision.content.queryLog.map((item, index) => <p key={index} className="mt-1 whitespace-pre-wrap break-words">
                  {[item.query, item.location, queryStatuses[item.access], queryStatuses[item.outcome], item.notes].filter(Boolean).join(" · ")}
                </p>) : <p className="text-muted-foreground">未记录查询过程。</p>}
              </details>
              {!edit && revision.canCheck && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void mutate("check-research") }}>
                <label className="grid gap-1">核对结论和仍待核实项<Textarea required maxLength={2000} value={note} disabled={busy}
                  onChange={event => { setNote(event.target.value); setDiscard(null) }} /></label>
                <Button type="submit" disabled={busy || !note.trim()}>确认已核对范围和来源</Button>
              </form>}
              {!edit && revision.canDraft && !draft && <Button variant="outline" disabled={busy} onClick={() => void mutate("draft-research")}>据此版本生成分析工作稿</Button>}
              {draft && <a className="block underline" href={materialUrl("/api/documents/"+draft.documentId+"/download")} download>下载 {draft.fileName}</a>}
            </div>
            <aside aria-label="证据与原文" className="grid min-w-0 gap-4 rounded-xl border bg-muted/30 p-4">
              <h3 className="font-semibold">证据与原文</h3>
              {openedSource && <ResearchSourcePanel key={openedSource} matterId={matterId} researchId={revision.id} sourceId={openedSource} onClose={closeSource} />}
              {revision.issue && <details>
                <summary className="cursor-pointer font-medium">采用的争点 · 修订 {revision.issue.revision}</summary>
                <p className="mt-2">{revision.issue.title} · {revision.issue.confirmedAt ? "采用时已核对" : "采用时待核对"}</p>
                {(revision.issue.changed || revision.issue.confirmationChanged) && <p className="text-muted-foreground">当前争点已有变化，以下为本研究保存时的记载。</p>}
                <p className="whitespace-pre-wrap break-words">{revision.issue.content}</p>
              </details>}
              {([["SUPPORTS", "支持依据"], ["REBUTS", "反向依据"], ["CONTEXT", "背景资料"]] as const).map(([relation, label]) => {
                const entries = sources.filter(source => (source.relation ?? "CONTEXT") === relation)
                if (!entries.length && relation === "CONTEXT") return null
                return <section aria-label={label} key={relation} className="grid gap-1">
                  <h4 className="font-medium">{label}</h4>
                  {entries.length ? entries.map(source => <div key={source.id}>
                    <Button variant="link" className="h-auto justify-start whitespace-normal break-words text-left"
                      id={sourceButtonPrefix + source.id} aria-expanded={openedSource === source.id}
                      onClick={() => { if (openedSource === source.id) closeSource(); else setOpenedSource(source.id) }}>{source.detail || "查看固定出处"}</Button>
                    {source.metadata && <p className="break-words text-xs text-muted-foreground">{source.metadata}</p>}
                  </div>) : <p className="text-muted-foreground">尚未记录。</p>}
                </section>
              })}
            </aside>
          </div>
        ) : <p>当前无权查看该研究修订。</p>}
      </div>
    </SheetContent>
  </Sheet>
}
function ResearchSourcePanel({ matterId, researchId, sourceId, onClose }: {
  matterId: string; researchId: string; sourceId: string; onClose: () => void
}) {
  const panel = useRef<HTMLElement>(null)
  const [source, setSource] = useState<FixedSource>()
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ action: "open-research-source", matterId, researchId, sourceId }),
    }).then(result => {
      if (controller.signal.aborted) return
      if (result.status === "AVAILABLE") setSource(result)
      else setError("此修订所引原件当前不可用。")
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, researchId, sourceId])
  useEffect(() => { panel.current?.focus() }, [])
  return <section ref={panel} tabIndex={-1} aria-label="固定版本出处" className="grid gap-3 rounded-lg border bg-card p-3">
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-medium">固定版本出处</h4>
      <Button size="sm" variant="ghost" onClick={onClose}>关闭原文</Button>
    </div>
    {source ? <FixedSourcePreview source={source} />
      : error ? <p role="alert">{error}</p> : <p role="status">正在打开出处…</p>}
  </section>
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
