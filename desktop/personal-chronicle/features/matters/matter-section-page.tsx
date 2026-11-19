"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { MatterFolder } from "./matter-folder"
import { FinanceDesk } from "@/features/practice/finance-desk"
import { ContextRecords, type ContextData } from "./matter-context"
import { EditCase, type CaseBasic } from "./case-management"
import { DocumentReviewDesk } from "./document-review-desk"
import { TemplateDrafts } from "./template-drafts"
import { SealWorkspace, type SealData } from "./seal-workspace"
import { DeliveryWorkspace, type DeliverySummary } from "./delivery-workspace"
import { TaskWorkspace, type TaskData } from "./task-workspace"
import { NewResearch, ResearchRevision } from "./research-revision"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import { MaterialsWorkspace, type Material, type MaterialFilters } from "./materials-workspace"
import type { MatterSection } from "./sections"

type Note = { id: string; channel: string; content: string; author: string; occurredAt: string; updatedAt: string; withWhom: string | null; tags: string[]; editable: boolean }
type Index = {
  title?: string; internalCode?: string; status?: string; statusLabel?: string; category?: string; cause?: string; owner?: string; client?: string; claimAmount?: string
  folders?: { id: string; name: string }[]
  documents?: Material[]
  records?: { id: string; question: string | null; version: number; checkedAt: string | null; readable: boolean }[]
  editor?: CaseBasic | null
  canWrite?: boolean
  schedule?: TaskData
  brief?: { serviceScope: string | null; deliverables: string | null; nextActions: { id: string; title: string; dueAt: string | null }[]
    context: ContextData
  }
  items?: DeliverySummary[]
  notes?: Note[]
  events?: { id: string; title: string; occurredAt: string }[]
  entries?: { id: string; type: string; amount: string; occurredAt: string }[]
  sealWorkspace?: SealData
  stats?: { contractAmount: number; receivable: number; received: number; outstanding: number }
  nextCursor?: string | null
}

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value))
  : "—"
const contextKinds: Record<string, string> = { GOAL: "客户目标", CONSTRAINT: "约束", INSTRUCTION: "客户指示", OPTION: "备选方案", DECISION: "决定" }
const money = (value: number | string | undefined) => value == null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value))
const noteChannels = [["PHONE", "电话"], ["WECHAT", "微信"], ["EMAIL", "邮件"], ["MEETING", "会见"], ["COURT", "法院沟通"], ["OTHER", "其他"]] as const

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="grid gap-3">{children}</CardContent></Card>
}

function Rows({ items, empty }: { items: { key: string; title: string; meta?: string; action?: React.ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return <ul className="divide-y">{items.map(item => <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title}</p>{item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}</div>{item.action}
  </li>)}</ul>
}

export function MatterSectionPage({ matterId, section, title }: { matterId: string; section: Exclude<MatterSection, "evidence">; title: string }) {
  const [data, setData] = useState<Index>()
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState<MaterialFilters>({q:"", folder:"*", version:"all"})
  const [cursor, setCursor] = useState<string>()
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [editing, setEditing] = useState<Note>()
  const [channel, setChannel] = useState("OTHER")
  const [saving, setSaving] = useState(false)
  const [writeStatus, setWriteStatus] = useState("")
  const [researchId, setResearchId] = useState("")

  useEffect(() => {
    if (section === "finance") return
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section })
    if (cursor) query.set("cursor", cursor)
    if (section === "materials") {
      for (const [key,value] of Object.entries(filters)) query.set(key,value)
    }
    const timer = window.setTimeout(() => { void readPersonal<Index>(`${workspaceEndpoint}?${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData(value); setError("") } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    }, section === "materials" && filters.q ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [matterId, section, refresh, cursor, filters])

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setWriteStatus("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? {
          action: "update-note", id: editing.id, expectedUpdatedAt: editing.updatedAt,
          occurredAt: editing.occurredAt, withWhom: editing.withWhom ?? undefined, tags: editing.tags,
          matterId, channel, content: note.trim(),
        } : { action: "create-note", matterId, channel, content: note.trim() }) })
      setNote("")
      setEditing(undefined)
      setChannel("OTHER")
      setRefresh(value => value + 1)
      setWriteStatus("已保存办理记录。")
    } catch (error) {
      setWriteStatus(error instanceof Error ? error.message : "保存失败。")
    } finally { setSaving(false) }
  }

  return <section className="grid min-w-0 gap-5">
    <PageHeader title={section === "overview" && data?.title ? data.title : title} description={section === "overview" ? data?.internalCode : undefined} actions={section === "overview" && data?.editor ? <EditCase editor={data.editor} reload={() => setRefresh(n => n + 1)}/> : undefined} />
    {error ? <div role="alert" className="flex items-center gap-2"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setError(""); setRefresh(value => value + 1) }}>重试</Button></div> : null}
    {section !== "finance" && !error && !data ? <p role="status" className="text-sm text-muted-foreground">正在读取案件…</p> : null}
    {section === "overview" && data ? <Panel title="案件基本信息"><dl className="grid gap-4 sm:grid-cols-2">
      {([["状态", data.statusLabel], ["案由", data.cause], ["主办", data.owner], ["委托人", data.client], ["标的金额", money(data.claimAmount)]]).map(([label,value]) =>
        <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm">{value || "—"}</dd></div>)}
    </dl></Panel> : null}
    {(section === "overview" || section === "materials") && data && <MatterFolder matterId={matterId} />}
    {section === "overview" && data?.brief && <Panel title="事项摘要">
      {data.brief.serviceScope && <p className="text-sm">委托范围 · {data.brief.serviceScope}</p>}
      {data.brief.deliverables && <p className="text-sm">约定成果 · {data.brief.deliverables}</p>}
      <h3 className="text-sm font-medium">下一步工作</h3><Rows empty="暂无待办任务。" items={data.brief.nextActions.map(item => ({
        key: item.id, title: item.title, meta: item.dueAt ? date(item.dueAt) : undefined,
      }))} />
      <ContextRecords matterId={matterId} initial={data.brief.context} reload={() => setRefresh(n => n + 1)}/>
      <h3 className="text-sm font-medium">近期目标、指示与决定</h3><Rows empty="暂无可查看的记录。" items={data.brief.context.records.filter(item => item.readable && item.content && (!item.source || item.source.available)).slice(0, 5).map(item => ({
        key: item.id, title: item.content!, meta: (contextKinds[item.kind] ?? item.kind) + " · " + (item.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"),
      }))} />
    </Panel>}
    {section === "materials" && data ? <MaterialsWorkspace matterId={matterId} documents={data.documents ?? []} folders={data.folders ?? []} filters={filters} onFilter={value => { setCursor(undefined); setFilters(value) }} onUploaded={() => setRefresh(value => value + 1)} /> : null}
    {section === "research" && data ? <Panel title="研究修订">{data.canWrite && <NewResearch matterId={matterId} onCreated={id => { setResearchId(id); setRefresh(value => value + 1) }} />}<Rows empty="暂无研究记录。" items={(data.records ?? []).map(row => ({
      key: row.id, title: row.readable ? row.question ?? "研究记录" : "研究内容不可用", meta: `V${row.version} · ${row.checkedAt ? "已核对" : "待核对"}`,
      action: row.readable || row.version > 1 ? <Button variant="outline" size="sm" onClick={() => setResearchId(row.id)}>查看修订</Button> : null,
    }))} /></Panel> : null}
    {section === "research" && researchId && <ResearchRevision key={researchId} matterId={matterId} recordId={researchId} onClose={() => setResearchId("")} onUpdated={() => setRefresh(value => value + 1)} onRevised={id => { setResearchId(id); setRefresh(value => value + 1) }} />}
    {section === "tasks" && data?.schedule && <TaskWorkspace matterId={matterId} data={data.schedule} reload={() => setRefresh(value => value + 1)} />}
    {section === "delivery" && data && <TemplateDrafts matterId={matterId} onGenerated={() => setRefresh(value => value + 1)} />}
    {section === "delivery" && data && <DocumentReviewDesk key={matterId} matterId={matterId} />}
    {section === "delivery" && data && <DeliveryWorkspace matterId={matterId} rows={data.items ?? []} reload={() => setRefresh(value => value + 1)} />}
    {section === "records" && data ? <Tabs defaultValue="communications">
      <TabsList aria-label="办理记录类型">
        <TabsTrigger value="communications">沟通记录（{data.notes?.length ?? 0}）</TabsTrigger>
        <TabsTrigger value="progress">案件进展（{data.events?.length ?? 0}）</TabsTrigger>
      </TabsList>
      <TabsContent value="communications">
      <Panel title="沟通记录">
        <form className="grid gap-3" onSubmit={saveNote}>
          <NativeSelect aria-label="沟通方式" value={channel} onChange={event => setChannel(event.target.value)}>
            {noteChannels.map(([value,label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
          </NativeSelect>
          <Textarea aria-label="办理内容" value={note} onChange={event => setNote(event.target.value)} maxLength={5000} required placeholder="记录本次沟通内容" />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !note.trim()}>{saving ? "正在保存…" : editing ? "保存修改" : "保存记录"}</Button>
            {editing ? <Button type="button" variant="ghost" disabled={saving}
              onClick={() => { setEditing(undefined); setNote(""); setChannel("OTHER"); setWriteStatus("") }}>取消编辑</Button> : null}
          </div>
          {writeStatus ? <p role="status" className="text-sm">{writeStatus}</p> : null}
        </form>
        <Rows empty="暂无沟通记录。" items={(data.notes ?? []).map(row => ({
          key: row.id, title: row.content, meta: [noteChannels.find(([key]) => key === row.channel)?.[1], row.author, date(row.occurredAt)].filter(Boolean).join(" · "),
          action: row.editable ? <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(row); setNote(row.content); setChannel(row.channel); setWriteStatus("") }}>编辑记录</Button> : null,
        }))} />
      </Panel>
      </TabsContent>
      <TabsContent value="progress"><Panel title="案件进展"><Rows empty="暂无案件进展。" items={(data.events ?? []).map(row => ({ key: row.id, title: row.title, meta: date(row.occurredAt) }))} /></Panel>
      </TabsContent>
    </Tabs> : null}
    {section === "finance" && <FinanceDesk key={matterId} matterId={matterId} />}
    {section === "seal" && data?.sealWorkspace && <SealWorkspace matterId={matterId} data={data.sealWorkspace} reload={() => setRefresh(value => value + 1)} />}
    {data && (cursor || data.nextCursor) ? <div className="flex gap-2">
      {cursor ? <Button size="sm" variant="outline" onClick={() => { setError(""); setData(undefined); setCursor(undefined) }}>返回第一页</Button> : null}
      {data.nextCursor ? <Button size="sm" variant="outline" onClick={() => { setError(""); setData(undefined); setCursor(data.nextCursor ?? undefined) }}>下一页</Button> : null}
    </div> : null}
  </section>
}
