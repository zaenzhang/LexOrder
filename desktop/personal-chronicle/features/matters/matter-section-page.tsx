"use client"

import { WorkspaceLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecordsWorkspace, type RecordsData } from "./records-workspace"
import { FinanceDesk } from "@/features/practice/finance-desk"
import { MatterOverview, type OverviewData } from "./matter-overview"
import { DocumentReviewDesk } from "./document-review-desk"
import { TemplateDrafts } from "./template-drafts"
import { SealWorkspace, type SealData } from "./seal-workspace"
import { DeliveryWorkspace, type DeliverySummary } from "./delivery-workspace"
import { TaskWorkspace, type TaskData } from "./task-workspace"
import { NewResearch, ResearchRevision } from "./research-revision"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal, workspaceEndpoint, type CommissionFollowUp, type CommissionIssue } from "./personal-client"
import { MaterialsWorkspace, type Material, type MaterialFilters, type MaterialStage } from "./materials-workspace"
import type { MatterSection } from "./sections"
import type { TaskMaterialReviewContext } from "../../../../src/server/tasks/material-review-contract"

type Index = OverviewData & RecordsData & {
  folders?: { id: string; name: string }[]
  documents?: Material[]
  canOrganizeMaterials?: boolean
  materialStage?: MaterialStage | null
  materialTask?: TaskMaterialReviewContext | null
  records?: { id: string; question: string | null; version: number; checkedAt: string | null; readable: boolean }[]
  canWrite?: boolean
  schedule?: TaskData
  items?: DeliverySummary[]
  entries?: { id: string; type: string; amount: string; occurredAt: string }[]
  sealWorkspace?: SealData
  stats?: { contractAmount: number; receivable: number; received: number; outstanding: number }
  nextCursor?: string | null
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="grid gap-3">{children}</CardContent></Card>
}

function Rows({ items, empty }: { items: { key: string; title: string; meta?: string; action?: React.ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return <ul className="divide-y">{items.map(item => <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title}</p>{item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}</div>{item.action}
  </li>)}</ul>
}

export function MatterSectionPage({ matterId, section, title, stage, taskId, reviewId, fromRecords, todayTab, scheduleDay, taskFilters, commissionResearchId, commissionIssue, commissionFollowUp, suggestedDocument, prepareDocument, factAnalysis, openMaterialUpload }: {
  matterId: string; section: Exclude<MatterSection, "evidence" | "archive" | "court">; title: string
  stage?: string; taskId?: string; reviewId?: string; fromRecords?: boolean; todayTab?: "open" | "waiting" | "done"; scheduleDay?: string; taskFilters?: Record<string, string>; commissionResearchId?: string; commissionIssue?: CommissionIssue; commissionFollowUp?: CommissionFollowUp; suggestedDocument?: string; prepareDocument?: string; factAnalysis?: boolean; openMaterialUpload?: boolean
}) {
  const [materialSelection, setMaterialSelection] = useState<string[]>(() => suggestedDocument ? [suggestedDocument] : [])
  const [result, setResult] = useState<{ scope: string; data: Index }>()
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState<MaterialFilters>({q:"", folder:"*", version:"all"})
  const [page, setPage] = useState<{ scope: string; cursor: string }>()
  const [failure, setFailure] = useState<{ scope: string; message: string }>()
  const [researchId, setResearchId] = useState("")
  const taskProgram = taskFilters?.program
  const scope = stage ?? ""
  const cursor = page?.scope === scope ? page.cursor : undefined
  const data = result?.scope === scope ? result.data : undefined
  const error = failure?.scope === scope ? failure.message : undefined

  useEffect(() => {
    if (section === "finance") return
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section })
    if (cursor) query.set("cursor", cursor)
    if (section === "materials") {
      query.set("limit", "20")
      for (const [key,value] of Object.entries(filters)) query.set(key,value)
      if (stage) query.set("stage", stage)
      if (taskId) query.set("task", taskId)
      if (taskProgram) query.set("program", taskProgram)
    }
    const timer = window.setTimeout(() => { void readPersonal<Index>(`${workspaceEndpoint}?${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setResult({ scope, data: value }); setFailure(undefined) } })
      .catch(error => { if (!controller.signal.aborted) {
        setFailure({ scope, message: error.message })
        if (section === "materials") setResult(undefined)
      } })
    }, section === "materials" && filters.q ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [matterId, section, refresh, cursor, filters, stage, scope, taskId, taskProgram])

  const nextCursor = data?.nextCursor
  const pages = data && (cursor || nextCursor) ? <div className="flex items-center gap-2">
    {cursor && <Button size="sm" variant="outline" onClick={() => { setFailure(undefined); setPage(undefined) }}>返回第一页</Button>}
    {nextCursor && <Button size="sm" variant="outline" onClick={() => { setFailure(undefined); setPage({ scope, cursor: nextCursor }) }}>下一页</Button>}
  </div> : null
  const switchStage = data?.materialStage ? null : data?.materialTask?.stageId
  return <section className="grid min-w-0 gap-5">
    {!(section === "tasks" && data?.schedule) && !((section === "materials" || section === "overview" || section === "records") && data) && <PageHeader title={title} actions={section === "delivery" && data
      ? <TemplateDrafts matterId={matterId} onGenerated={() => setRefresh(value => value + 1)} /> : undefined} />}
    {error ? <div role="alert" className="flex items-center gap-2"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setFailure(undefined); setRefresh(value => value + 1) }}>重试</Button></div> : null}
    {section !== "finance" && !error && !data ? <WorkspaceLoading label="正在读取案件…" /> : null}
    {section === "overview" && data && <MatterOverview matterId={matterId} data={data} reload={() => setRefresh(n => n + 1)} />}
    {section === "materials" && (taskId || taskProgram) && <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" nativeButton={false}
        render={<Link href={todayTab ? { pathname: "/practice/today", query: { taskView: todayTab } } : scheduleDay ? { pathname: "/practice/schedule", query: { day: scheduleDay } } : {
          pathname: `/matters/${matterId}/${fromRecords ? "records" : "tasks"}`, query: fromRecords ? undefined : taskFilters,
        }} />}>
        {todayTab ? "返回今日办理" : scheduleDay ? "返回工作日程" : fromRecords ? "返回办理记录" : taskId ? "返回任务列表" : "返回程序"}
      </Button>
      {data?.materialStage && <span className="text-sm text-muted-foreground">办理环节 · {data.materialStage.name}</span>}
      {(data?.materialStage || switchStage) && <Button size="sm" variant="ghost" nativeButton={false}
        render={<Link href={{ pathname: `/matters/${matterId}/materials`, query: { ...taskFilters, task: taskId,
          ...(switchStage ? { stage: switchStage } : {}), ...(reviewId ? { review: reviewId } : {}),
          ...(scheduleDay ? { from: "schedule", day: scheduleDay } : {}), ...(fromRecords ? { from: "records" } : {}), ...(todayTab ? { from: "today", taskView: todayTab } : {}),
          ...(commissionResearchId ? { research: commissionResearchId } : {}),
        } }} />}>{switchStage ? "仅看任务环节" : "查看全案材料"}</Button>}
    </div>}
    {section === "materials" && data ? <MaterialsWorkspace matterId={matterId} task={data.materialTask ?? undefined} reviewId={reviewId} commissionResearchId={commissionResearchId} commissionIssue={commissionIssue} commissionFollowUp={commissionFollowUp} openUpload={openMaterialUpload} factAnalysis={factAnalysis} stage={data.materialStage ?? undefined} documents={data.documents ?? []} folders={data.folders ?? []}
      filters={filters} onFilter={value => { setPage(undefined); setFilters(value) }} onUploaded={() => setRefresh(value => value + 1)}
      canOrganize={Boolean(data.canOrganizeMaterials)} selection={materialSelection} onSelectionChange={setMaterialSelection} pageNavigation={pages} /> : null}
    {section === "research" && data ? <Panel title="研究修订">{data.canWrite && <NewResearch matterId={matterId} onCreated={id => { setResearchId(id); setRefresh(value => value + 1) }} />}<Rows empty="暂无研究记录。" items={(data.records ?? []).map(row => ({
      key: row.id, title: row.readable ? row.question ?? "研究记录" : "研究内容不可用", meta: `V${row.version} · ${row.checkedAt ? "已核对" : "待核对"}`,
      action: row.readable || row.version > 1 ? <Button variant="outline" size="sm" onClick={() => setResearchId(row.id)}>查看修订</Button> : null,
    }))} /></Panel> : null}
    {section === "research" && researchId && <ResearchRevision key={researchId} matterId={matterId} recordId={researchId} onClose={() => setResearchId("")} onUpdated={() => setRefresh(value => value + 1)} onRevised={id => { setResearchId(id); setRefresh(value => value + 1) }} />}
    {section === "tasks" && data?.schedule && <TaskWorkspace matterId={matterId} data={data.schedule} reload={() => setRefresh(value => value + 1)} />}
    {section === "delivery" && data && <DocumentReviewDesk matterId={matterId} />}
    {section === "delivery" && data && <DeliveryWorkspace key={prepareDocument ?? "delivery"} matterId={matterId} rows={data.items ?? []}
      prepareDocument={prepareDocument} reload={() => setRefresh(value => value + 1)} />}
    {section === "records" && data && <RecordsWorkspace matterId={matterId} data={data} reload={() => setRefresh(n => n + 1)} />}
    {section === "finance" && <FinanceDesk key={matterId} matterId={matterId} />}
    {section === "seal" && data?.sealWorkspace && <SealWorkspace matterId={matterId} data={data.sealWorkspace} reload={() => setRefresh(value => value + 1)} />}
    {section !== "materials" && pages}
  </section>
}
