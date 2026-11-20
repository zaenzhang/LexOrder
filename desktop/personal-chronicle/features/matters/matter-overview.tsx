"use client"

import Link from "@/features/shell/workspace-link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightIcon, CalendarDaysIcon, GavelIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { EditCase, type CaseBasic } from "./case-management"
import { kinds, relations, type EvidenceNote } from "./case-chronology"
import { ContextRecords, type ContextData } from "./matter-context"
import { MatterFolder } from "./matter-folder"

export type OverviewData = {
  title?: string; internalCode?: string; statusLabel?: string; categoryLabel?: string; cause?: string; owner?: string; client?: string
  claimAmount?: string | number; editor?: CaseBasic | null; canUpload?: boolean
  procedures?: { id: string; label: string }[]
  parties?: { id: string; name: string; label: string }[]
  deadline?: { title: string; date: string; procedureId: string; overdue: boolean }
  evidence?: EvidenceNote[]
  brief?: { serviceScope: string | null; deliverables: string | null; nextActions: { id: string; title: string; dueAt: string | null }[]; context: ContextData }
}

const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" })
const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" })
const views = ["time", "funds", "parties", "matrix"] as const
type OverviewView = typeof views[number]

function pinnedView(key: string): OverviewView | null {
  if (typeof window === "undefined") return null
  const value = localStorage.getItem(key)
  return views.find(view => view === value) ?? null
}

export function MatterOverview({ matterId, data, reload }: { matterId: string; data: OverviewData; reload: () => void }) {
  const queryClient = useQueryClient()
  const [showDetails, setShowDetails] = useState(false)
  const storageKey = "lexorder:case-overview:" + matterId
  const [pinned, setPinned] = useState(() => pinnedView(storageKey))
  const [view, setView] = useState<OverviewView>(pinned ?? "time")
  const path = `/matters/${matterId}`
  const evidence = data.evidence ?? []
  const issues = evidence.filter(row => row.kind === "ISSUE").slice(0, 3)
  const dated = evidence.filter(row => row.eventDate?.start && !row.restricted)
    .sort((a, b) => a.eventDate!.start!.localeCompare(b.eventDate!.start!)).slice(-5)
  const actual = data.deadline
  const work = data.brief?.nextActions.slice(0, 4) ?? []
  const evidenceHref = (id: string, graph = false) => `${path}/evidence/${graph ? "graph" : "arguments"}?item=${id}`
  const titleLine = [data.categoryLabel, data.cause, data.client && `委托人 ${data.client}`].filter(Boolean).join(" · ")
  return <div className="grid min-w-0 gap-4">
    <PageHeader title="案件概览" description={titleLine || undefined} actions={<>
      {data.canUpload && <Button variant="outline" nativeButton={false} render={<Link href={path + "/materials?upload=1"} />}>
        <PlusIcon data-icon="inline-start" />补充材料
      </Button>}
      {data.brief?.context.canWrite && <Button nativeButton={false} render={<Link href={path + "/research"} />}>
        <SparklesIcon data-icon="inline-start" />委托技能
      </Button>}
    </>} />
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[var(--auth-panel)] px-5 py-5 text-[var(--auth-panel-foreground)]" aria-label="案件状态和期限">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs opacity-80">{data.internalCode}</p>
        <h2 className="break-words font-heading text-xl font-semibold">{data.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          {data.statusLabel && <Badge variant="secondary">{data.statusLabel}</Badge>}
          {data.procedures?.slice(0, 3).map(row => <Badge key={row.id} variant="secondary" render={<Link href={path + "/tasks?program=" + row.id} />}>{row.label}</Badge>)}
          {data.procedures && data.procedures.length > 3 && <Badge variant="secondary" render={<Link href={path + "/tasks"} />}>
            全部 {data.procedures.length} 个程序
          </Badge>}
        </div>
      </div>
      <div className="flex min-w-40 flex-col items-start gap-1">
        <p className="text-xs opacity-80">{actual?.overdue ? "待处理法律期限" : "最近法律期限"}</p>
        {actual ? <>
          <p className="font-semibold">{actual.date}</p>
          <Link className="break-words text-sm underline underline-offset-2" href={path + "/tasks?program=" + actual.procedureId}>{actual.title}</Link>
        </> : <p className="text-sm">暂无已确认期限</p>}
      </div>
    </section>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(15rem,1fr)]">
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 gap-3">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div><CardTitle className="text-lg">案情视图</CardTitle><p className="mt-1 text-xs text-muted-foreground">履行、款项与证据关系</p></div>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" aria-pressed={pinned === view} onClick={() => {
                if (pinned === view) { localStorage.removeItem(storageKey); setPinned(null) }
                else { localStorage.setItem(storageKey, view); setPinned(view) }
              }}>{pinned === view ? "取消固定" : "固定此视图"}</Button>
              <Button variant="link" size="sm" nativeButton={false} render={<Link href={path + "/evidence/graph"} />}>V8 案件事实看板</Button>
            </div>
          </CardHeader>
          <CardContent className="min-w-0">
            <Tabs value={view} onValueChange={setView} className="gap-4">
              <TabsList aria-label="案情视图" className="max-w-full flex-wrap">
                <TabsTrigger value="time">时间线</TabsTrigger>
                <TabsTrigger value="funds">款项对照</TabsTrigger>
                <TabsTrigger value="parties">关系图</TabsTrigger>
                <TabsTrigger value="matrix">证据矩阵</TabsTrigger>
              </TabsList>
              <TabsContent value="time" className="grid min-w-0 gap-3">
                <h3 className="font-medium">已登记事实经过</h3>
                {dated.length ? <ol className="grid min-w-0 grid-flow-col auto-cols-[minmax(7.5rem,1fr)] overflow-x-auto pt-2">
                  {dated.map(row => <li key={row.id} className="relative border-t border-primary/30 pt-3 pe-3 before:absolute before:-top-1 before:start-0 before:size-2 before:rounded-full before:bg-primary">
                    <Link href={evidenceHref(row.id, true)} className="grid gap-1 text-start hover:text-primary">
                      <time className="text-xs text-muted-foreground">{row.eventDate!.start}{row.eventDate?.end && row.eventDate.end !== row.eventDate.start ? " 至 " + row.eventDate.end : ""}</time>
                      <span className="break-words text-sm font-semibold">{row.title}</span>
                      <span className="text-xs text-muted-foreground">{kinds[row.kind]} · {row.confirmedAt ? "已核对" : "待核对"}</span>
                    </Link>
                  </li>)}
                </ol> : <p className="text-sm text-muted-foreground">暂无带日期的事实记录。</p>}
              </TabsContent>
              <TabsContent value="funds" className="grid gap-2 text-sm">
                <dl className="rounded-lg border bg-muted/30 p-3">
                  <dt className="text-muted-foreground">登记标的金额</dt><dd className="mt-1 text-lg font-semibold">{data.claimAmount == null ? "待登记" : currency.format(Number(data.claimAmount))}</dd>
                </dl>
                <p className="text-muted-foreground">标的金额按案件登记展示。分笔履行应核对付款凭据及相关争点。</p>
                <Button variant="link" size="sm" className="h-auto justify-self-start p-0" nativeButton={false} render={<Link href={path + "/evidence"} />}>核对事实与出处</Button>
              </TabsContent>
              <TabsContent value="parties" className="min-w-0">
                {data.parties?.length ? <div className="grid gap-3">
                  <div className="justify-self-center rounded-lg border border-primary/35 bg-accent px-3 py-2 text-sm font-medium">{data.title}</div>
                  <ul className="grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-3">
                    {data.parties.map(row => <li key={row.id} className="min-w-0 rounded-md border p-2 text-center text-sm">
                      <span className="block text-xs text-muted-foreground">{row.label}</span><span className="break-words">{row.name}</span>
                    </li>)}
                  </ul>
                </div> : <p className="text-sm text-muted-foreground">暂无已登记的当事人关系。</p>}
              </TabsContent>
              <TabsContent value="matrix" className="min-w-0">
                {issues.length ? <div className="overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead className="bg-muted/60 text-muted-foreground"><tr><th scope="col" className="p-2 text-start font-medium">争点</th><th scope="col" className="p-2 text-start font-medium">支持</th><th scope="col" className="p-2 text-start font-medium">反驳</th><th scope="col" className="p-2 text-start font-medium">背景</th></tr></thead>
                    <tbody>{issues.map(row => <tr className="border-b" key={row.id}><th scope="row" className="p-2 text-start font-medium"><Link className="hover:underline" href={evidenceHref(row.id)}>{row.title}</Link></th>
                      {(Object.keys(relations) as (keyof typeof relations)[]).map(kind => <td key={kind} className="p-2 text-start">{row.restricted ? "—" : row.sources.filter(s => s.status === "AVAILABLE" && s.relation === kind).length}</td>)}</tr>)}</tbody>
                  </table>
                </div> : <p className="text-sm text-muted-foreground">暂无可对照的争点。</p>}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <Card className="min-w-0 gap-3">
          <CardHeader><CardTitle className="text-lg">当前争点</CardTitle></CardHeader>
          <CardContent>
            {issues.length ? <ul className="divide-y">{issues.map(row => <li key={row.id}>
              <Link href={evidenceHref(row.id)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 hover:text-primary">
                <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"><GavelIcon aria-hidden className="size-4" /></span>
                <span className="min-w-0"><span className="block break-words text-sm font-semibold">{row.title}</span>
                  <span className="line-clamp-2 break-words text-xs text-muted-foreground">{row.restricted ? "部分出处不可读" : row.content}</span></span>
                <Badge variant={row.confirmedAt ? "secondary" : "outline"}>{row.confirmedAt ? "已核对" : "待核对"}</Badge>
              </Link>
            </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无已登记争点。</p>}
          </CardContent>
        </Card>
      </div>
      <aside className="grid min-w-0 gap-4" aria-label="案件下一步">
        <Card className="gap-3">
          <CardHeader><CardTitle className="text-lg">待我处理</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {work.length ? <ul className="divide-y">{work.map(row => <li key={row.id}><Link href={path + "/tasks?task=" + row.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-3 hover:text-primary">
              <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"><CalendarDaysIcon aria-hidden className="size-4" /></span>
              <span className="min-w-0"><span className="block break-words text-sm font-semibold">{row.title}</span>
                {row.dueAt && <span className="text-xs text-muted-foreground">计划完成 · {date.format(new Date(row.dueAt))}</span>}</span>
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </Link></li>)}</ul> : <p className="text-sm text-muted-foreground">本案暂无待办任务。</p>}
            <Link className="text-sm text-primary hover:underline" href="/practice/today">查看今日办理</Link>
          </CardContent>
        </Card>
        {data.brief?.context.canWrite && <Card className="gap-3">
          <CardHeader><CardTitle className="text-lg">本案技能</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Link className="text-sm font-medium hover:underline" href={path + "/research"}>从研究修订发起材料核对</Link>
            <Link className="text-sm text-primary hover:underline" href="/practice/skills">工具</Link>
          </CardContent>
        </Card>}
      </aside>
    </div>
    <details className="rounded-xl border bg-card p-4 text-sm" onToggle={event => setShowDetails(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">案件资料与文件夹</summary>
      {showDetails && <div className="mt-4 grid min-w-0 gap-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          {[["主办", data.owner], ["委托人", data.client], ["案由", data.cause]].filter(([, value]) => value).map(([label, value]) =>
            <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
        </dl>
        {data.editor && <div><EditCase editor={data.editor} reload={() => {
          reload()
          void queryClient.invalidateQueries({ queryKey: ["chronicle", "matter-identity", matterId] })
        }} /></div>}
        {data.brief && <div className="grid gap-2">
          {data.brief.serviceScope && <p>委托范围 · {data.brief.serviceScope}</p>}
          {data.brief.deliverables && <p>约定成果 · {data.brief.deliverables}</p>}
          <ContextRecords matterId={matterId} initial={data.brief.context} reload={reload} />
        </div>}
        <MatterFolder matterId={matterId} />
      </div>}
    </details>
  </div>
}
