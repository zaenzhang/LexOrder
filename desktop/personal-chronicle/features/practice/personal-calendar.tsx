"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import Link from "@/features/shell/workspace-link"
import { useId, useMemo, useState, type FormEvent } from "react"
import { MapPin, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { CalendarAgenda, CalendarAgendaRow } from "@/features/calendar/agenda"
import { CalendarEventDialog } from "@/features/calendar/event-dialog"
import { CalendarLayout } from "@/features/calendar/calendar-layout"
import { CalendarMonthGrid } from "@/features/calendar/month-grid"
import { fromKey, isCivilDay, monthOf, offsetMonthDay, minutes } from "@/features/calendar/dates"
import { TaskResponsibilities } from "./task-responsibilities"
import { usePractice, writePractice } from "./data"

export const calendarKinds = {
  hearing: { label: "庭期", dot: "bg-chart-2", chip: "bg-chart-2/12 text-foreground before:bg-chart-2" },
  deadline: { label: "法律期限", dot: "bg-chart-3", chip: "bg-chart-3/15 text-foreground before:bg-chart-3" },
  task: { label: "内部任务", dot: "bg-primary", chip: "bg-primary/10 text-foreground before:bg-primary" },
  personal: { label: "个人安排", dot: "bg-success", chip: "bg-success/10 text-foreground before:bg-success" },
}
type Kind = keyof typeof calendarKinds
const kindKeys = Object.keys(calendarKinds) as Kind[]
const cnMonth = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", year: "numeric", month: "long" })
const cnDay = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" })
const cnDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })
export const longCalendarDate = (day: string) => cnDate.format(fromKey(day))

export type PersonalScheduleItem = {
  id: string; type: Kind; title: string; day: string; clock: string | null; end: string | null; when: string; completed: boolean
  matter: { id: string; title: string } | null; href?: string; procedure?: string | null; location?: string | null; sourceDocumentId?: string | null
}
type PersonalCalendarData = { items: PersonalScheduleItem[]; today: string; canWrite: boolean }
const emptyCalendar: PersonalScheduleItem[] = []
const eventOrder = (left: PersonalScheduleItem, right: PersonalScheduleItem) =>
  left.day.localeCompare(right.day) || (left.clock ?? "").localeCompare(right.clock ?? "") || left.id.localeCompare(right.id)

const agendaLabels = {
  region: "所选日期的日程", filters: "显示日历", create: "新建个人安排", createOnDay: "在该日新建个人安排",
  empty: "当天没有可见安排。", emptyDetail: "可选择其他日期或查看日历筛选。",
}

function DateRow({ item, onView }: { item: PersonalScheduleItem; onView: () => void }) {
  const kind = calendarKinds[item.type]
  return <CalendarAgendaRow start={item.clock} end={item.end?.length === 5 ? item.end : undefined}
    untimed={item.type === "personal" ? "全天" : "按日"} dot={kind.dot} title={item.title} past={item.completed}
    detail={<><span>{kind.label}</span>{item.matter && <span>{item.matter.title}</span>}
      {item.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{item.location}</span>}
      {item.end && item.end.length > 5 && <span>至 {item.end}</span>}
      {item.completed && <span>已结束</span>}</>}
    href={item.type === "task" ? item.href : undefined} onOpen={onView} />
}

export function PersonalCalendar({ today, initialDay, initialEvent, fromToday }: {
  today: string; initialDay?: string; initialEvent?: string; fromToday?: boolean
}) {
  const [selected, setSelected] = useState(initialDay ?? today)
  const [hidden, setHidden] = useState<Kind[]>([])
  const [createAt, setCreateAt] = useState<string>()
  const [record, setRecord] = useState(initialEvent)
  const [showTasks, setShowTasks] = useState(false)
  const month = selected.slice(0, 7)
  const result = usePractice<PersonalCalendarData>("schedule", { month, grid: "1" })
  usePageLoading(result.isPending && month === (initialDay ?? today).slice(0, 7))
  const events = result.data?.items ?? emptyCalendar
  const visible = useMemo(() => events.filter(item => !hidden.includes(item.type)).sort(eventOrder), [events, hidden])
  const agenda = visible.filter(item => item.day === selected)
  const monthItems = events.filter(item => item.day.startsWith(month + "-"))
  const rendered = useMemo(() => visible.map(item => ({
    id: item.id, date: item.day, title: item.title, start: item.clock,
    calendar: item.type, dot: calendarKinds[item.type].dot, chip: calendarKinds[item.type].chip,
  })), [visible])
  const active = events.find(item => item.id === record)
  const title = cnMonth.format(fromKey(month + "-01"))
  const canWrite = result.data?.canWrite === true
  const rightNow = result.data?.today ?? today
  const booked = agenda.reduce((sum, item) => {
    if (!item.clock || item.end?.length !== 5) return sum
    return sum + Math.max(0, minutes(item.end) - minutes(item.clock))
  }, 0)

  function appointmentSaved(day: string) {
    setCreateAt(undefined)
    toast.add({ type: "success", title: "已保存个人安排" })
    setHidden(current => current.filter(kind => kind !== "personal"))
    if (day.slice(0, 7) === month) void result.refetch()
    setSelected(day)
  }

  return <section className="grid min-w-0 gap-4">
    <PageHeader title="工作日程" description={title + (result.data ? " · " + visible.filter(item => item.day.startsWith(month + "-")).length + " 项可见安排" : "") + " · 北京时间"}
      actions={<>
        {fromToday && <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/practice/today" />}>返回今日办理</Button>}
        <Button size="sm" variant="outline" onClick={() => setShowTasks(true)}>跨案任务</Button>
        {canWrite && <Button onClick={() => setCreateAt(selected)}><Plus data-icon="inline-start" />新建个人安排</Button>}
      </>} />
    {result.error && <div role="alert" className="flex items-center gap-2 text-sm">{result.error.message}<Button size="sm" variant="outline" onClick={() => void result.refetch()}>重试</Button></div>}
    {record && !active && result.isSuccess && <p role="status" className="text-sm text-muted-foreground">该安排已变化或不可查看，请从月历重新选择。</p>}
    <CalendarLayout month={title} labels={{ today: "今天", previous: "上个月", next: "下个月" }}
      onToday={() => setSelected(rightNow)} onChangeMonth={offset => setSelected(offsetMonthDay(selected, offset))}
      previousDisabled={month === "0001-01"} nextDisabled={month === "9999-12"}
      agenda={<CalendarAgenda title={cnDay.format(fromKey(selected))} caption={selected === rightNow ? "今天" : "当日议程"}
        labels={agendaLabels}
        totals={[["安排", result.isPending ? "—" : agenda.length], ["已排时长", result.isPending ? "—" : booked + " 分钟"]]}
        filters={kindKeys.map(kind => ({ id: kind, title: calendarKinds[kind].label, dot: calendarKinds[kind].dot,
          visible: !hidden.includes(kind), count: monthItems.filter(item => item.type === kind).length,
          toggle: () => setHidden(current => current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind]),
        }))}
        onCreate={canWrite ? () => setCreateAt(selected) : undefined} pending={result.isPending}
      >
        {agenda.map(item => <DateRow key={item.id} item={item} onView={() => setRecord(item.id)} />)}
      </CalendarAgenda>}>
      <CalendarMonthGrid chinese cursor={monthOf(selected)} today={rightNow}
        selected={selected} events={rendered} selectDay={day => { if (isCivilDay(day)) setSelected(day) }}
        onCreate={canWrite ? day => { if (isCivilDay(day)) setCreateAt(day) } : undefined} />
    </CalendarLayout>
    {showTasks && <Sheet open onOpenChange={open => { if (!open) setShowTasks(false) }}>
      <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader><SheetTitle>跨案任务责任板</SheetTitle><SheetDescription>查看负责的跨案任务与状态</SheetDescription></SheetHeader>
        <div className="px-4 pb-4"><TaskResponsibilities /></div>
      </SheetContent>
    </Sheet>}
    {active && <Sheet open onOpenChange={open => { if (!open) setRecord(undefined) }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>{active.title}</SheetTitle><SheetDescription>{calendarKinds[active.type].label}</SheetDescription></SheetHeader>
        <div className="grid gap-3 px-4 pb-4 text-sm">
          <p className="flex flex-wrap items-center gap-2">{active.when}{active.end && "–" + active.end}
            {active.type === "personal" && active.clock === null && <Badge variant="secondary">全天</Badge>}
            {active.completed && <Badge variant="secondary">已结束</Badge>}
          </p>
          {active.matter && <p>{active.matter.title}{active.procedure && " · " + active.procedure}</p>}
          {active.location && <p>{active.location}</p>}
          {active.sourceDocumentId && <Button size="sm" variant="outline" className="justify-self-start" nativeButton={false}
            render={<a href={"/api/documents/" + active.sourceDocumentId + "/download"} download />}>下载期限来源</Button>}
          {active.href && <Button size="sm" variant="outline" className="justify-self-start" nativeButton={false}
            render={<Link href={active.href} />}>{active.procedure ? "进入关联程序" : "进入关联事项"}</Button>}
        </div>
      </SheetContent>
    </Sheet>}
    {createAt && <AppointmentForm date={createAt} close={() => setCreateAt(undefined)} onSaved={appointmentSaved} />}
  </section>
}

function AppointmentForm({ date, close, onSaved }: { date: string; close: () => void; onSaved: (day: string) => void }) {
  const id = useId()
  const [allDay, setAllDay] = useState(true)
  const [requestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    const day = String(fields.get("day"))
    const startMinute = allDay ? null : minutes(String(fields.get("start")))
    const endMinute = allDay ? null : minutes(String(fields.get("end")))
    if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
      setError("结束时间须晚于开始时间。")
      return
    }
    setBusy(true)
    setError("")
    try {
      await writePractice({ action: "create-calendar-entry", requestKey, title: fields.get("title"), day, startMinute, endMinute })
      onSaved(day)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。")
    } finally {
      setBusy(false)
    }
  }

  return <CalendarEventDialog open onOpenChange={open => {
    if (!open && !busy) {
      if (dirty) setDiscard(true)
      else close()
    }
  }} title="新建个人安排" description="时间按北京时间填写。" form={id} submit="保存安排" cancel="取消" busy={busy}>
    <form id={id} onSubmit={save} onChange={() => { setDirty(true); setDiscard(false) }}>
      <FieldGroup className="gap-4">
        <Field><FieldLabel htmlFor={id + "-title"}>标题</FieldLabel><Input id={id + "-title"} name="title" maxLength={100} required autoFocus disabled={busy} /></Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field><FieldLabel htmlFor={id + "-day"}>日期</FieldLabel>
            <Input id={id + "-day"} name="day" type="date" required defaultValue={date} min="0001-01-01" max="9999-12-31" disabled={busy} />
          </Field>
          <Field orientation="horizontal" className="h-8 w-fit"><Switch id={id + "-all-day"} checked={allDay} disabled={busy}
            onCheckedChange={value => { setAllDay(value); setDirty(true); setDiscard(false) }} /><FieldLabel htmlFor={id + "-all-day"}>全天</FieldLabel></Field>
        </div>
        {!allDay && <div className="grid grid-cols-2 gap-4">
          <Field><FieldLabel htmlFor={id + "-start"}>开始时间</FieldLabel><Input id={id + "-start"} name="start" type="time" defaultValue="10:00" required disabled={busy} /></Field>
          <Field><FieldLabel htmlFor={id + "-end"}>结束时间</FieldLabel><Input id={id + "-end"} name="end" type="time" defaultValue="10:30" required disabled={busy} /></Field>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {discard && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>有未保存的安排。</span><Button type="button" size="sm" variant="outline" onClick={close}>放弃修改</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDiscard(false)}>继续编辑</Button>
        </div>}
      </FieldGroup>
    </form>
  </CalendarEventDialog>
}
