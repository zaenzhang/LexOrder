"use client"

import { PageHeader } from "@/kit/ui-patterns/page-header"
import { evidenceEndpoint, readPersonal } from "./personal-client"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { FileText, Pin, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FactReviewForm } from "./fact-review-form"
import { FixedSourcePreview, type FixedSource } from "./fixed-source-preview"
import { usePinnedSources } from "./matter-session"

type Source = { id: string; relation: "SUPPORTS" | "REBUTS" | "CONTEXT" | null; status: string; documentName: string | null; documentVersion: number | null; locationLabel: string | null; superseded?: boolean; legacy?: boolean }
export type Issue = { id: string; revision: number; title: string; content: string; confirmedAt: string | null; restricted: boolean; canEdit: boolean; sources: Source[] }
type Tab = { key: string; issue: Issue; source: Source; pinned: boolean }
const tabKey = (item: Issue, source: Source) => JSON.stringify([item.id, item.revision, source.id])
const groups = [{ title: "支持证据", relation: "SUPPORTS" }, { title: "反证", relation: "REBUTS" }, { title: "背景材料", relation: "CONTEXT" }] as const

function readIssues(matterId: string, signal: AbortSignal) {
  return readPersonal<{ issues: Issue[] }>(`${evidenceEndpoint}?matter=${encodeURIComponent(matterId)}`, { signal })
}

export function EvidenceReview({ matterId }: { matterId: string }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [issueId, setIssueId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<Tab>()
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<FixedSource>()
  const [sourceError, setSourceError] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState("")
  const [editing, setEditing] = useState<Issue>()
  const issueRequest = useRef<AbortController | null>(null)
  const sourceRequest = useRef<{ key: string } | null>(null)
  const pins = usePinnedSources()
  const restored = useRef(false)
  const issue = issues.find(item => item.id === issueId)

  async function open(tab: Tab) {
    const request = { key: tab.key }
    sourceRequest.current = request
    setActive(tab); setVisible(true); setPreview(undefined); setSourceError("")
    setTabs(rows => rows.some(row => row.key === tab.key) ? rows : [...rows.filter(row => row.pinned), tab])
    try {
      const result = await readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open-evidence-source", matterId, evidenceItemId: tab.issue.id, revision: tab.issue.revision, sourceId: tab.source.id }),
      })
      if (sourceRequest.current !== request) return
      if (result.status === "AVAILABLE") setPreview(result)
      else setSourceError("该出处当前不可用。")
    } catch (error) {
      if (sourceRequest.current === request) setSourceError(error instanceof Error ? error.message : "无法打开出处。")
    }
  }

  function receiveIssues(fresh: Issue[]) {
    setIssues(fresh)
    const available = new Map<string, Tab>()
    for (const item of fresh) {
      for (const source of item.sources) {
        if (item.restricted || source.status !== "AVAILABLE") continue
        const key = tabKey(item, source)
        available.set(key, { key, issue: item, source, pinned: true })
      }
    }
    const pinned = (pins.current.get(matterId) ?? []).flatMap(key => available.get(key) ?? [])
    pins.current.set(matterId, pinned.map(tab => tab.key))
    if (!restored.current) {
      restored.current = true
      setTabs(pinned)
      const resume = pinned.at(-1)
      if (resume) {
        setIssueId(resume.issue.id)
        void open(resume)
        return
      }
    } else {
      const updateTab = (tab: Tab) => {
        const next = available.get(tab.key)
        return next && { ...next, pinned: tab.pinned }
      }
      setTabs(rows => rows.flatMap(tab => updateTab(tab) ?? []))
      setActive(tab => tab && updateTab(tab))
      if (sourceRequest.current && !available.has(sourceRequest.current.key)) {
        sourceRequest.current = null
        setVisible(false)
        setPreview(undefined)
        setSourceError("")
      }
    }
    setIssueId(current => fresh.some(item => item.id === current) ? current : fresh[0]?.id ?? "")
  }

  const receiveInitialIssues = useEffectEvent(receiveIssues)
  useEffect(() => {
    const controller = new AbortController()
    issueRequest.current = controller
    void readIssues(matterId, controller.signal)
      .then(({ issues }) => { if (!controller.signal.aborted) receiveInitialIssues(issues) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => issueRequest.current?.abort()
  }, [matterId])

  async function refreshIssues() {
    issueRequest.current?.abort()
    const controller = new AbortController()
    issueRequest.current = controller
    const { issues } = await readIssues(matterId, controller.signal)
    controller.signal.throwIfAborted()
    receiveIssues(issues)
    return issues
  }

  async function confirmIssue() {
    if (!issue) return
    setConfirmPending(true); setConfirmStatus("")
    try {
      await readPersonal(evidenceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm-issue", matterId, evidenceItemId: issue.id, expectedRevision: issue.revision, confirm: true }),
      })
      setConfirmOpen(false)
      setConfirmStatus("本版已核对。")
      await refreshIssues()
    } catch (error) {
      setConfirmStatus(error instanceof Error ? error.message : "无法确认本版。")
    } finally { setConfirmPending(false) }
  }

  function chooseIssue(next: string) {
    if (next === issueId) return
    sourceRequest.current = null
    setIssueId(next)
    setConfirmStatus("")
    setTabs(rows => rows.filter(tab => tab.pinned))
    setActive(tabs.find(tab => tab.pinned))
    setPreview(undefined)
    setVisible(false)
  }

  function togglePin(tab: Tab) {
    const changed = { ...tab, pinned: !tab.pinned }
    const rows = tabs.map(row => row.key === tab.key ? changed : row)
    pins.current.set(matterId, rows.filter(row => row.pinned).map(row => row.key))
    setActive(changed)
    setTabs(rows)
  }

  function sourceButton(source: Source, item: Issue) {
    const key = tabKey(item, source)
    return <Button variant="ghost" key={source.id} className="h-auto min-w-0 justify-start py-2 text-left whitespace-normal"
      disabled={source.status !== "AVAILABLE"} onClick={() => void open(tabs.find(tab => tab.key === key) ?? { key, issue: item, source, pinned: false })}>
      <FileText aria-hidden />
      <span className="min-w-0 break-words">{source.documentName ?? "来源不可用"}{source.documentVersion ? ` · V${source.documentVersion}` : ""}{source.locationLabel ? ` · ${source.locationLabel}` : ""}</span>
      {source.superseded ? <Badge variant="secondary">引用旧版</Badge> : null}
    </Button>
  }

  return <section className="flex min-w-0 flex-col gap-5">
    <PageHeader title="争点证据对照" />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取案卷…</p> : null}
    {!loading && !error ? <>
      <div className="flex flex-wrap gap-2">{issues.length > 1 ? issues.map(item => <Button key={item.id} variant={item.id === issueId ? "default" : "outline"} size="sm" onClick={() => chooseIssue(item.id)}>{item.title}</Button>) : null}
      {active && !visible ? <Button variant="outline" size="sm" onClick={() => void open(active)}>展开出处</Button> : null}</div>
      {!issue ? <p className="text-sm text-muted-foreground">该案暂无争点。</p> : null}
      {issue ? <div className={visible ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]" : "grid min-w-0 gap-4"}>
        <Card className="min-w-0 self-start">
          <CardHeader><CardTitle>{issue.title}</CardTitle><div className="text-xs text-muted-foreground">修订 V{issue.revision} · {issue.confirmedAt ? "已核对" : "待核对"}</div></CardHeader>
          <CardContent className="grid gap-4">
            {issue.canEdit && !issue.restricted && !issue.confirmedAt ? <div>
              <AlertDialog open={confirmOpen} onOpenChange={open => { if (!confirmPending) setConfirmOpen(open) }}>
                <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>核对本版</AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认已核对本版？</AlertDialogTitle>
                    <AlertDialogDescription>本次确认记录到争点的 V{issue.revision} 修订。</AlertDialogDescription>
                  </AlertDialogHeader>
                  {confirmStatus ? <p role="alert" className="text-sm text-destructive">{confirmStatus}</p> : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={confirmPending}>取消</AlertDialogCancel>
                    <Button disabled={confirmPending} onClick={() => void confirmIssue()}>确认已核对</Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div> : null}
            {!confirmOpen && confirmStatus ? <p role="status" className="text-sm">{confirmStatus}</p> : null}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{issue.restricted ? "部分出处不可用，争点内容已隐藏。" : issue.content}</p>
            {issue.canEdit && !issue.restricted && issue.sources.some(source => !source.legacy && source.status === "AVAILABLE" && source.relation) &&
              <Button size="sm" variant="outline" onClick={() => setEditing(issue)}>记录取舍并形成研究</Button>}
            {groups.map(group => {
              const sources = issue.sources.filter(source => (source.relation ?? "CONTEXT") === group.relation)
              return <section key={group.relation} className="grid gap-1 rounded-lg border p-3"><h3 className="text-sm font-medium">{group.title}</h3>{sources.length ? sources.map(source => sourceButton(source, issue)) : <p className="text-xs text-muted-foreground">暂无材料</p>}</section>
            })}
          </CardContent>
        </Card>
        {visible && active ? <Card className="min-w-0" aria-label="案卷出处">
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>案卷出处</CardTitle><Button variant="ghost" size="icon-sm" aria-label="收起出处" onClick={() => { sourceRequest.current = null; setVisible(false); setPreview(undefined) }}><X aria-hidden /></Button></div></CardHeader>
          <CardContent className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-wrap gap-1" aria-label="出处页签">{tabs.map(tab => <Button key={tab.key} size="sm" variant={tab.key === active.key ? "secondary" : "ghost"} aria-pressed={tab.key === active.key} onClick={() => void open(tab)}>{tab.pinned ? <Pin aria-hidden /> : null}{tab.source.documentName} · V{tab.source.documentVersion}</Button>)}</div>
            {active.issue.id !== issue.id ? <p className="text-xs text-muted-foreground">关联争点：{active.issue.title}</p> : null}
            <div><Button variant="outline" size="sm" onClick={() => togglePin(active)}><Pin aria-hidden />{active.pinned ? "取消固定" : "固定页签"}</Button></div>
            {sourceError ? <p role="alert" className="text-sm text-destructive">{sourceError}</p> : null}
            {!preview && !sourceError ? <p role="status" className="text-sm text-muted-foreground">正在打开出处…</p> : null}
            {preview && <FixedSourcePreview source={preview} />}
          </CardContent>
        </Card> : null}
      </div> : null}
    </> : null}
    {editing && <FactReviewForm matterId={matterId} issue={editing} current={issues.find(item => item.id === editing.id)}
      onReload={refreshIssues} onClose={() => setEditing(undefined)} />}
  </section>
}
