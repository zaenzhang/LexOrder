"use client"

import { useState } from "react"
import Link from "@/features/shell/workspace-link"
import { useQuery } from "@tanstack/react-query"
import { Archive, CalendarDays, ChevronRight, MessageSquareText, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { DeliveryDetail, type DeliverySummary } from "./delivery-workspace"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Note = {
  id: string
  channel: string
  content: string
  author: string
  occurredAt: string
  updatedAt: string
  withWhom: string | null
  tags: string[]
  editable: boolean
}

export type RecordsData = {
  title?: string
  canWrite?: boolean
  canViewDelivery?: boolean
  notes?: Note[]
  events?: { id: string; title: string; occurredAt: string; taskReview?: { taskId: string; id: string } }[]
}

const labels = { communications: "沟通记录", progress: "案件进展", sent: "客户交付" }
const icons = { communications: MessageSquareText, progress: CalendarDays, sent: Archive }
const noteChannels = [["PHONE", "电话"], ["WECHAT", "微信"], ["EMAIL", "邮件"], ["MEETING", "会见"], ["COURT", "法院沟通"], ["OTHER", "其他"]] as const
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
const hour = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })

type RecordType = keyof typeof labels
type RecordEntry = {
  id: string
  type: RecordType
  occurredAt: string | null
  title: string
  meta?: string
  body?: string
  note?: Note
  unavailable?: boolean
  taskReview?: { taskId: string; id: string }
}

export function RecordsWorkspace({ matterId, data, reload }: { matterId: string; data: RecordsData; reload: () => void }) {
  const [tab, setTab] = useState("all")
  const [deliveryCursor, setDeliveryCursor] = useState<string>()
  const [selected, setSelected] = useState<RecordEntry>()
  const [editing, setEditing] = useState<Note | "new">()
  const [saved, setSaved] = useState(false)
  const cursor = tab === "sent" ? deliveryCursor : undefined
  const deliveries = useQuery({
    queryKey: ["personal", "record-deliveries", matterId, cursor],
    enabled: !!data.canViewDelivery && (tab === "sent" || tab === "all"),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ matter: matterId, section: "delivery", sent: "1" })
      if (cursor) query.set("cursor", cursor)
      return readPersonal<{ items: DeliverySummary[]; nextCursor: string | null }>(`${workspaceEndpoint}?${query}`, { signal })
    },
  })

  const notes: RecordEntry[] = (data.notes ?? []).map(note => ({
    id: note.id, type: "communications", occurredAt: note.occurredAt,
    title: [noteChannels.find(([value]) => value === note.channel)?.[1] ?? "沟通", note.withWhom].filter(Boolean).join(" · "),
    meta: [note.author, ...note.tags].filter(Boolean).join(" · "), body: note.content, note,
  }))
  const progress: RecordEntry[] = (data.events ?? []).map(event => ({ ...event, type: "progress" }))
  const sent: RecordEntry[] = (deliveries.data?.items ?? []).map(item => ({
    id: item.id, type: "sent", occurredAt: item.sentAt ?? null, title: item.purpose ?? "暂不可查看的交付清单",
    meta: item.state === "UNAVAILABLE" ? undefined : [item.recipientName, "已登记发送", item.itemCount + " 份材料"].filter(Boolean).join(" · "),
    unavailable: item.state === "UNAVAILABLE",
  }))
  const entries = tab === "communications" ? notes : tab === "progress" ? progress : tab === "sent" ? sent : [...notes, ...progress, ...sent]
  const time = (value: string | null) => value ? Date.parse(value) : -Infinity
  const groups = Map.groupBy(
    [...entries].sort((left, right) => time(right.occurredAt) - time(left.occurredAt)),
    record => record.occurredAt ? day.format(new Date(record.occurredAt)) : "日期未载"
  )
  const incoming = !!data.canViewDelivery && (tab === "all" || tab === "sent")
  return <div className="grid min-w-0 gap-4">
    <PageHeader title="办理记录" description={data.title && `${data.title} · 案件履历`} actions={data.canWrite &&
      <Button size="sm" onClick={() => { setSaved(false); setEditing("new") }}><Plus data-icon="inline-start" />记沟通</Button>} />
    {saved && <p role="status" className="text-sm text-muted-foreground">已保存办理记录。</p>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="办理记录类型" className="h-auto max-w-full flex-wrap justify-start">
        <TabsTrigger value="all" className="px-2.5">全部记录</TabsTrigger>
        <TabsTrigger value="communications" className="px-2.5">{labels.communications}</TabsTrigger>
        <TabsTrigger value="progress" className="px-2.5">{labels.progress}</TabsTrigger>
        {data.canViewDelivery && <TabsTrigger value="sent" className="px-2.5">{labels.sent}</TabsTrigger>}
      </TabsList>
      <TabsContent value={tab} className="grid gap-3">
        {incoming && deliveries.isPending && <p role="status" className="text-muted-foreground">正在读取客户交付…</p>}
        {incoming && deliveries.isError && <div role="alert" className="flex flex-wrap items-center gap-2">
          <p>{deliveries.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => void deliveries.refetch()}>重试读取交付</Button>
        </div>}
        {groups.size === 0 && (!incoming || deliveries.isSuccess) && <Card>
          <CardContent className="text-muted-foreground">暂无{tab === "all" ? "办理记录" : labels[tab as RecordType]}。</CardContent>
        </Card>}
        {groups.size > 0 && <div className="grid gap-3">
          {[...groups].map(([date, records]) => <Card key={date}>
            <CardHeader><CardTitle>{date}</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">{records.map(record => {
                const Icon = icons[record.type]
                const details = <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-primary"><Icon aria-hidden className="size-4" /></span>
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="font-semibold break-words">{record.title}</span>
                    {(record.meta || record.body || record.occurredAt) && <span className="line-clamp-2 break-words text-xs text-muted-foreground">
                      {[record.occurredAt && hour.format(new Date(record.occurredAt)), record.meta, record.body].filter(Boolean).join(" · ")}
                    </span>}
                  </span>
                  <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">{labels[record.type]}</Badge>
                </>
                return <li className="py-1" key={record.type + record.id}>
                  {record.taskReview ? <Link className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-start hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                    href={{ pathname: `/matters/${matterId}/materials`, query: { task: record.taskReview.taskId, review: record.taskReview.id, from: "records" } }}>
                    {details}<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link> : record.unavailable ? <div className="flex items-center gap-3 px-2 py-2">{details}</div> :
                    <button type="button" className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-start hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => setSelected(record)}>{details}<ChevronRight className="size-4 shrink-0 text-muted-foreground" /></button>}
                </li>
              })}</ul>
            </CardContent>
          </Card>)}
        </div>}
        {tab === "all" && (deliveries.data?.nextCursor || progress.length >= 50) && <p className="text-xs text-muted-foreground">
          {deliveries.data?.nextCursor && "此处显示首批客户交付，更多可在「客户交付」翻页。"}
          {progress.length >= 50 && "案件进展显示最近 50 条。"}
        </p>}
        {tab === "sent" && <div className="flex gap-2">
          {cursor && <Button size="sm" variant="outline" onClick={() => setDeliveryCursor(undefined)}>返回第一页</Button>}
          {deliveries.data?.nextCursor && <Button size="sm" variant="outline" onClick={() => setDeliveryCursor(deliveries.data?.nextCursor ?? undefined)}>下一页</Button>}
        </div>}
      </TabsContent>
    </Tabs>
    {selected?.type === "sent" && <DeliveryDetail key={selected.id} matterId={matterId} id={selected.id} onClose={() => setSelected(undefined)} />}
    {selected && selected.type !== "sent" && <Sheet open onOpenChange={open => { if (!open) setSelected(undefined) }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>{selected.title}</SheetTitle><SheetDescription>
          {[selected.occurredAt && day.format(new Date(selected.occurredAt)), selected.meta].filter(Boolean).join(" · ")}
        </SheetDescription></SheetHeader>
        <div className="grid gap-4 px-4 pb-4">
          {selected.body && <p className="whitespace-pre-wrap break-words">{selected.body}</p>}
          {selected.note?.editable && <Button size="sm" variant="outline" className="justify-self-start" onClick={() => {
            setEditing(selected.note)
            setSelected(undefined)
            setSaved(false)
          }}>编辑记录</Button>}
        </div>
      </SheetContent>
    </Sheet>}
    {editing && <NoteEditor matterId={matterId} note={editing === "new" ? undefined : editing}
      onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setSaved(true); reload() }} />}
  </div>
}

function NoteEditor({ matterId, note, onClose, onSaved }: { matterId: string; note?: Note; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState(note?.content ?? "")
  const [channel, setChannel] = useState(note?.channel ?? "OTHER")
  const [saving, setSaving] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState("")
  const dirty = content !== (note?.content ?? "") || channel !== (note?.channel ?? "OTHER")
  function requestClose() {
    if (!saving) {
      if (dirty) setDiscard(true)
      else onClose()
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const entry = { matterId, channel, content: content.trim() }
      await readPersonal(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? {
          ...entry, action: "update-note", id: note.id, expectedUpdatedAt: note.updatedAt,
          occurredAt: note.occurredAt, withWhom: note.withWhom ?? undefined, tags: note.tags,
        } : { ...entry, action: "create-note" }) })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。")
    } finally {
      setSaving(false)
    }
  }

  return <Sheet open onOpenChange={open => { if (!open) requestClose() }}>
    <SheetContent className="overflow-y-auto">
      <SheetHeader><SheetTitle>{note ? "编辑沟通记录" : "记沟通"}</SheetTitle><SheetDescription>归入当前案件的办理记录</SheetDescription></SheetHeader>
      <form className="grid gap-3 px-4 pb-4" onSubmit={save} onChange={() => setDiscard(false)}>
        <fieldset disabled={saving} className="grid gap-3">
          <label className="grid gap-1.5">沟通方式
            <NativeSelect value={channel} onChange={event => setChannel(event.target.value)}>
              {noteChannels.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1.5">办理内容
            <Textarea className="min-h-36" value={content} onChange={event => setContent(event.target.value)} maxLength={5000} required placeholder="记录本次沟通内容" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!content.trim()}>{saving ? "正在保存…" : note ? "保存修改" : "保存记录"}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={requestClose}>取消</Button>
          </div>
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {discard && <div role="alert" className="grid gap-2">放弃未保存的内容？
          <div className="flex gap-2">
            <Button size="sm" type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button>
            <Button size="sm" type="button" variant="ghost" onClick={onClose}>放弃修改</Button>
          </div>
        </div>}
      </form>
    </SheetContent>
  </Sheet>
}
