"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/components/ui/toast"
import type { TimelineEventReference, TimelineLevel } from "../../../../src/lib/matters/timeline-levels"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import Link from "@/features/shell/workspace-link"
import { Input } from "@/components/ui/input"
import { ChronologySelect } from "./chronology-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { InlineLoading, WorkspaceLoading } from "@/kit/ui-patterns/workspace-loading"
import type { ProgramTrack } from "./fact-trace"
import { EvidenceReview } from "./evidence-review"
import { MatterAnalysisHistorySheet } from "./matter-analysis-runs"
import { CaseChronology, kinds, relations, type EvidenceNote as Item, type EventDate } from "./case-chronology"
import { evidenceViews, type EvidenceView } from "./sections"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type FormOptions = { canWrite: boolean; documents: { id: string; name: string; version: number; isPdf: boolean; pageCount: number | null; hasIdentity: boolean }[] }
type Action = "create" | "revise" | "link" | "unlink"
type Editing = { action: Action; item?: Item }
export function EvidencePage({ matterId, view = "claims", item }: { matterId: string; view?: EvidenceView; item?: string }) {
  const title = evidenceViews.find(([key]) => key === view)![1]
  if (view === "analysis" || view === "graph") return <EvidenceNotes matterId={matterId} title={view === "graph" ? "案情图谱" : title} analysis={view === "analysis"} item={item} />
  return <EvidenceReview matterId={matterId} title={title} initialIssue={item} hearing={view === "hearing"}
    intro={view === "claims" ? <ClaimRegistration matterId={matterId} /> : undefined} />
}

function ClaimRegistration({ matterId }: { matterId: string }) {
  const result = useQuery({
    queryKey: ["chronicle", "claim-registration", matterId],
    queryFn: ({ signal }) => readPersonal<{ request: string | null; counterclaim: string | null; amount: string | null; cause: string | null }>(
      workspaceEndpoint + "?" + new URLSearchParams({ section: "claim-registration", matter: matterId }), { signal }),
    retry: false,
  })
  return <Card className="gap-3">
    <CardHeader><CardTitle className="text-lg">案件登记的诉请</CardTitle></CardHeader>
    <CardContent className="grid gap-3 text-sm">
      {result.isPending && <p role="status">正在读取收案登记…</p>}
      {result.error && <p role="alert">{result.error.message} <Button size="sm" variant="outline" onClick={() => void result.refetch()}>重试</Button></p>}
      {result.data && <>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          {result.data.cause && <><dt className="text-muted-foreground">案由</dt><dd>{result.data.cause}</dd></>}
          {result.data.amount !== null && <><dt className="text-muted-foreground">标的金额</dt><dd>{Number(result.data.amount).toLocaleString("zh-CN", { style: "currency", currency: "CNY" })}</dd></>}
          <dt className="text-muted-foreground">诉请</dt><dd className="whitespace-pre-wrap break-words">{result.data.request || "收案登记暂无诉请内容。"}</dd>
          {result.data.counterclaim && <><dt className="text-muted-foreground">反诉</dt><dd className="whitespace-pre-wrap break-words">{result.data.counterclaim}</dd></>}
        </dl>
        {result.data.request && <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">以案卷中的正式诉辩材料和固定出处为准。</p>}
      </>}
    </CardContent>
  </Card>
}

function EvidenceNotes({ matterId, title, analysis, item }: { matterId: string; title: string; analysis: boolean; item?: string }) {
  const [workspace, setWorkspace] = useState<{ items: Item[]; canWrite: boolean }>()
  const [kind, setKind] = useState("")
  const [analysisHistoryOpen, setAnalysisHistoryOpen] = useState(false)
  const [editing, setEditing] = useState<Editing>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState("")
  const cache = useQueryClient()
  const programKey = ["chronicle", "chronology-programs", matterId] as const
  const programs = useQuery({
    queryKey: programKey,
    enabled: !analysis,
    queryFn: ({ signal }) => readPersonal<{ programs: ProgramTrack[] }>(
      workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items", programs: "1" }), { signal }),
    retry: false,
  })
  const grade = useMutation({
    mutationFn: ({ event, level }: { event: TimelineEventReference; level: TimelineLevel | null }) => readPersonal<{ level: TimelineLevel | null }>(workspaceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-timeline-grade", matterId, event, level }),
    }),
    onSuccess: ({ level }, { event }) => {
      if (event.kind === "fact") {
        setWorkspace(current => current && { ...current, items: current.items.map(item => item.id === event.id ? { ...item, level } : item) })
      } else {
        cache.setQueryData<{ programs: ProgramTrack[] }>(programKey, current => current && ({
          programs: current.programs.map(track => ({ ...track, events: track.events.map(row =>
            row.event.kind === event.kind && row.event.id === event.id ? { ...row, level } : row) })),
        }))
      }
    },
    onError: cause => toast.add({ title: "未能保存事件等级", description: cause.message, type: "error" }),
  })
  useEffect(() => {
    const controller = new AbortController()
    const endpoint = workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items", ...(analysis ? {} : { timeline: "1" }) })
    readPersonal<{ items: Item[]; canWrite: boolean }>(endpoint, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setWorkspace(data) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, refresh, analysis])
  function reload() { setWorkspace(undefined); setError(""); setRefresh(value => value + 1) }
  function refreshObservations() { setError(""); setRefresh(value => value + 1) }
  const visible = workspace?.items.filter(item => !kind || kind === item.kind)
  const loading = !visible || (!analysis && programs.isPending)

  return <section className="grid gap-4">
    <PageHeader title={title} description={analysis ? "按固定出处对照事实与争点" : "V8 案件事实看板"} actions={workspace ? <>
      {!analysis && <Button size="sm" variant="outline" onClick={() => setAnalysisHistoryOpen(true)}>案级分析记录</Button>}
      {!analysis && workspace.canWrite && <Link className={buttonVariants({ size: "sm", variant: "outline" })}
        href={"/matters/" + matterId + "/materials?prepare=analysis"}>准备案情分析</Link>}
      {workspace.canWrite && <Button size="sm" onClick={() => setEditing({ action: "create" })}>记录要点</Button>}
    </> : null} />
    {error ? <div role="alert" className="flex gap-2 text-sm">{error}<Button size="sm" variant="outline" onClick={reload}>重试</Button></div>
      : loading ? <WorkspaceLoading label="正在读取要点…" split timeline={!analysis} /> : null}
    {!analysis && programs.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      未能读取程序日期，案情事实仍可查看。<Button size="sm" variant="outline" onClick={() => void programs.refetch()}>重读程序日期</Button>
    </div>}
    <div hidden={loading || Boolean(error)} className="motion-safe:animate-rise">
      <CaseChronology key={item} matterId={matterId} items={visible ?? []} programs={programs.data?.programs} initialItem={item} matrixOnly={analysis} onObservationsSaved={refreshObservations}
        grading={analysis ? undefined : { canWrite: workspace?.canWrite === true, pending: grade.isPending,
          save: (event, level) => grade.mutate({ event, level }) }} filter={<ChronologySelect label="要点性质" items={{ "": "全部性质", ...kinds }} value={kind} onChange={setKind} />} onEdit={(item, action) => setEditing({ item, action })} />
    </div>
    {analysisHistoryOpen && <MatterAnalysisHistorySheet matterId={matterId} targets={workspace?.items}
      close={() => setAnalysisHistoryOpen(false)} onAdopted={() => setRefresh(value => value + 1)} />}
    {editing && <EvidenceEditor editing={editing} matterId={matterId} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload() }} />}
  </section>
}

function EvidenceEditor({ editing: { action, item }, matterId, onClose, onSaved }: {
  editing: Editing; matterId: string; onClose: () => void; onSaved: () => void
}) {
  const [precision, setPrecision] = useState(item?.eventDate?.precision ?? "UNKNOWN")
  const [docId, setDocId] = useState("")
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState("")
  const textForm = action === "create" || action === "revise"
  const takesDocument = action === "create" || action === "link"
  const options = useQuery({
    queryKey: ["chronicle", "evidence-editor-options", matterId],
    enabled: takesDocument,
    queryFn: ({ signal }) => readPersonal<FormOptions>(workspaceEndpoint + "?" + new URLSearchParams({
      matter: matterId, section: "evidence-items", options: "1",
    }), { signal }), retry: false, staleTime: 0, gcTime: 0,
  })
  const choice = options.data?.documents.find(doc => doc.id === docId)
  const title = { create: "记录要点", revise: "修订要点", link: "关联材料版本", unlink: "撤回来源关系" }[action]
  function markDirty() {
    setDirty(true)
    setDiscard(false)
    setKey(crypto.randomUUID())
  }
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
      <form className="grid gap-3 px-4 pb-4 text-sm" onSubmit={save} onChange={markDirty}>
        <fieldset className="grid gap-3" disabled={busy}>
          {textForm && <>
            <div className="grid gap-1"><span>性质</span>
              <ChronologySelect label="性质" name="kind" className="w-full" items={kinds} defaultValue={item?.kind ?? "TODO_VERIFY"}
                disabled={busy} onChange={markDirty} />
            </div>
            <label className="grid gap-1">标题<Input name="title" defaultValue={item?.title} required maxLength={200} /></label>
            <label className="grid gap-1">内容<Textarea name="content" defaultValue={item?.content} required maxLength={5000} /></label>
            <div className="grid gap-1"><span>发生日期精度</span>
              <ChronologySelect label="发生日期精度" value={precision} className="w-full" disabled={busy}
                items={{ UNKNOWN: "时间未明", EXACT: "精确日期", RANGE: "日期区间" }}
                onChange={value => { setPrecision(value as EventDate["precision"]); markDirty() }} />
            </div>
            {precision !== "UNKNOWN" && <label className="grid gap-1">{precision === "RANGE" ? "起始日" : "发生日"}<Input required name="start" type="date" defaultValue={item?.eventDate?.start ?? ""} /></label>}
            {precision === "RANGE" && <label className="grid gap-1">结束日<Input required name="end" type="date" defaultValue={item?.eventDate?.end ?? ""} /></label>}
            <label className="grid gap-1">原始时间表述<Input name="timeText" maxLength={500} defaultValue={item?.eventDate?.text ?? ""} /></label>
          </>}
          {takesDocument && <>
            {options.isPending && <InlineLoading label="正在读取可关联材料…" />}
            {options.error && <div role="alert" className="grid gap-2 text-xs">
              {options.error.message}<Button type="button" size="xs" variant="outline" onClick={() => void options.refetch()}>重试读取材料</Button>
            </div>}
            {options.data && !options.data.canWrite && <p role="alert">当前无法修改本案要点。</p>}
            <div className="grid gap-1"><span>来源材料版本</span>
              <ChronologySelect label="来源材料版本" value={action === "link" ? docId || null : docId} className="w-full" required={action === "link"}
                disabled={busy || !options.data?.canWrite} placeholder={action === "link" ? "请选择材料" : "暂未关联"}
                items={[
                  ...(action === "create" ? [{ value: "", label: "暂未关联" }] : []),
                  ...options.data?.documents.map(doc => ({ value: doc.id, label: doc.name + " · V" + doc.version, disabled: !doc.hasIdentity })) ?? [],
                ]}
                onChange={value => { setDocId(value); markDirty() }} />
            </div>
            {docId && <div className="grid gap-1"><span>来源关系</span>
              <ChronologySelect label="来源关系" name="relation" className="w-full" items={relations} defaultValue="CONTEXT"
                disabled={busy} onChange={markDirty} />
            </div>}
            {choice?.isPdf && <label className="grid gap-1">已知页码<Input key={docId} name="page" type="number" min={1} max={choice.pageCount ?? 10000} /></label>}
          </>}
          {action === "unlink" && <div className="grid gap-1"><span>选择要撤回的来源关系</span>
            <ChronologySelect label="选择要撤回的来源关系" name="source" required className="w-full"
              disabled={busy} placeholder="请选择来源" onChange={markDirty}
              items={item?.sources.filter(source => !source.legacy).map(source => ({
                value: source.id, label: [source.documentName, "V" + source.documentVersion, source.locationLabel, relations[source.relation ?? "CONTEXT"]].join(" · "),
              })) ?? []} />
          </div>}
          <Button type="submit" disabled={takesDocument && (!options.data?.canWrite || (action === "link" && !docId))}>{busy ? "正在保存…" : title}</Button>
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {discard && <div role="alert" className="grid gap-2">放弃未保存的修改？<div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button><Button type="button" variant="ghost" onClick={onClose}>放弃修改</Button></div></div>}
      </form>
    </SheetContent>
  </Sheet>
}
