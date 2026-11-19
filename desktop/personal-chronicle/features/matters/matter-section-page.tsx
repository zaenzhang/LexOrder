"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import { MaterialsWorkspace, type Material } from "./materials-workspace"
import type { MatterSection } from "./sections"

type Entry = { id: string; title: string; dueAt: string | null; completed: boolean }
type Note = { id: string; channel: string; content: string; author: string; occurredAt: string; updatedAt: string; withWhom: string | null; tags: string[]; editable: boolean }
type Index = {
  title?: string; internalCode?: string; status?: string; category?: string; cause?: string; owner?: string; client?: string; claimAmount?: string
  documents?: Material[]
  records?: { id: string; question: string | null; version: number; checkedAt: string | null; readable: boolean }[]
  procedures?: { id: string; name: string; deadlines: Entry[]; hearings: { id: string; startsAt: string }[]; stages: { id: string; name: string; tasks: Entry[] }[] }[]
  items?: { id: string; purpose: string | null; recipientName: string | null; createdAt: string; state: string; itemCount: number }[]
  notes?: Note[]
  events?: { id: string; title: string; occurredAt: string }[]
  entries?: { id: string; type: string; amount: string; occurredAt: string }[]
  seals?: { id: string; code: string; documentTitle: string; status: string; requestedAt: string }[]
  stats?: { contractAmount: number; receivable: number; received: number; outstanding: number }
  nextCursor?: string | null
}

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value))
  : "—"
const hearingTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })
const money = (value: number | string | undefined) => value == null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value))
const noteChannels = [["PHONE", "电话"], ["WECHAT", "微信"], ["EMAIL", "邮件"], ["MEETING", "会见"], ["COURT", "法院沟通"], ["OTHER", "其他"]] as const
const statuses: Record<string,string> = { OPEN: "在办", ACTIVE: "在办", ON_HOLD: "暂停", CLOSED: "结案", ARCHIVED: "已归档", PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", STAMPED: "已用印", CANCELLED: "已撤销", PREPARED: "已准备", SENT: "已送出", DELIVERED: "已交付", UNAVAILABLE: "不可查看", RECEIVABLE: "应收", RECEIVED: "实收", REFUND: "退款", COST: "费用", COMMISSION: "分成" }

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="grid gap-3">{children}</CardContent></Card>
}

function Rows({ items, empty }: { items: { key: string; title: string; meta?: string; action?: React.ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return <ul className="divide-y">{items.map(item => <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title}</p>{item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}</div>{item.action}
  </li>)}</ul>
}

function entryRows(items: Entry[]) {
  return items.map(item => ({ key: item.id, title: item.title, meta: `${date(item.dueAt)} · ${item.completed ? "完成" : "未完成"}` }))
}

export function MatterSectionPage({ matterId, section, title }: { matterId: string; section: Exclude<MatterSection, "evidence">; title: string }) {
  const [data, setData] = useState<Index>()
  const [refresh, setRefresh] = useState(0)
  const [cursor, setCursor] = useState<string>()
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [editing, setEditing] = useState<Note>()
  const [channel, setChannel] = useState("OTHER")
  const [saving, setSaving] = useState(false)
  const [writeStatus, setWriteStatus] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section })
    if (cursor) query.set("cursor", cursor)
    void readPersonal<Index>(`${workspaceEndpoint}?${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [matterId, section, refresh, cursor])

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
    <PageHeader title={section === "overview" && data?.title ? data.title : title} description={section === "overview" ? data?.internalCode : undefined} />
    {error ? <div role="alert" className="flex items-center gap-2"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setError(""); setRefresh(value => value + 1) }}>重试</Button></div> : null}
    {!error && !data ? <p role="status" className="text-sm text-muted-foreground">正在读取案件…</p> : null}
    {section === "overview" && data ? <Panel title="案件基本信息"><dl className="grid gap-4 sm:grid-cols-2">
      {([["状态", statuses[data.status ?? ""] ?? data.status], ["案由", data.cause], ["主办", data.owner], ["委托人", data.client], ["标的金额", money(data.claimAmount)]]).map(([label,value]) =>
        <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm">{value || "—"}</dd></div>)}
    </dl></Panel> : null}
    {section === "materials" && data ? <MaterialsWorkspace matterId={matterId} documents={data.documents ?? []} onUploaded={() => setRefresh(value => value + 1)} /> : null}
    {section === "research" && data ? <Panel title="研究修订"><Rows empty="暂无研究记录。" items={(data.records ?? []).map(row => ({
      key: row.id, title: row.readable ? row.question ?? "研究记录" : "研究内容不可用", meta: `V${row.version} · ${row.checkedAt ? "已核对" : "待核对"}`,
    }))} /></Panel> : null}
    {section === "tasks" && data ? (data.procedures?.length ? data.procedures.map(procedure => <Panel key={procedure.id} title={procedure.name}>
      <h3 className="text-sm font-semibold">期限与开庭</h3><Rows empty="暂无期限或开庭。" items={[...entryRows(procedure.deadlines), ...procedure.hearings.map(item => ({ key: item.id, title: "开庭", meta: hearingTime.format(new Date(item.startsAt)) }))]} />
      {procedure.stages.map(stage => <div key={stage.id}><h3 className="text-sm font-semibold">{stage.name}</h3><Rows empty="暂无环节任务。" items={entryRows(stage.tasks)} /></div>)}
    </Panel>) : <p className="text-sm text-muted-foreground">暂无案件程序。</p>) : null}
    {section === "delivery" && data ? <Panel title="交付记录"><Rows empty="暂无交付记录。" items={(data.items ?? []).map(row => ({
      key: row.id, title: row.purpose ?? "交付内容不可用", meta: [row.recipientName, statuses[row.state] ?? row.state, `${row.itemCount} 份材料`, date(row.createdAt)].filter(Boolean).join(" · "),
    }))} /></Panel> : null}
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
    {section === "finance" && data ? <>
      <Panel title="案款概况"><dl className="grid gap-4 sm:grid-cols-4">
        {([["合同金额", data.stats?.contractAmount], ["应收", data.stats?.receivable], ["已收", data.stats?.received], ["未收", data.stats?.outstanding]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-base font-medium">{money(value)}</dd></div>)}
      </dl></Panel>
      <Panel title="财务流水"><Rows empty="暂无财务流水。" items={(data.entries ?? []).map(row => ({ key: row.id, title: statuses[row.type] ?? row.type, meta: date(row.occurredAt), action: <Badge variant="outline">{money(row.amount)}</Badge> }))} /></Panel>
    </> : null}
    {section === "seal" && data ? <Panel title="用印申请"><Rows empty="暂无可查看的用印申请。" items={(data.seals ?? []).map(row => ({
      key: row.id, title: row.documentTitle, meta: `${row.code} · ${date(row.requestedAt)}`, action: <Badge variant="outline">{statuses[row.status] ?? row.status}</Badge>,
    }))} /></Panel> : null}
    {data && (cursor || data.nextCursor) ? <div className="flex gap-2">
      {cursor ? <Button size="sm" variant="outline" onClick={() => { setError(""); setData(undefined); setCursor(undefined) }}>返回第一页</Button> : null}
      {data.nextCursor ? <Button size="sm" variant="outline" onClick={() => { setError(""); setData(undefined); setCursor(data.nextCursor ?? undefined) }}>下一页</Button> : null}
    </div> : null}
  </section>
}
