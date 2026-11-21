"use client"

import { ProcedureActions, type ProcedureInfo } from "./case-management"
import Link from "@/features/shell/workspace-link"
import { useSearchParams } from "@/kit/framework"
import { useState } from "react"
import { BriefcaseBusiness, CalendarIcon, ChevronDown, ChevronRight, CircleCheckIcon, CircleIcon, CircleOffIcon, Ellipsis, FileText, Plus, SearchIcon, SignalHighIcon, SignalLowIcon, TriangleAlertIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { LegalTaskTable } from "@/features/tasks/legal-task-table"
import { TaskBoardLane } from "@/features/tasks/task-board-lane"
import { TaskCardFrame } from "@/features/tasks/task-card"
import { TaskViewToggle, type TaskView } from "@/features/tasks/task-view-toggle"
import { StatusBadge } from "@/kit/ui-patterns/status-badge"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Task = {
  id: string; title: string; description: string | null; dueAt: string | null; priority: number
  stageId: string | null; stageName: string | null; procedureTitle: string | null
  state: "OPEN" | "DONE" | "CANCELLED"; assignee: string; revision: number; waitingFor?: string; blockingCount: number
}
type Procedure = ProcedureInfo & {
  id: string; name: string; typeLabel: string; statusLabel: string; stages: { id: string; name: string }[]
  jurisdiction: string | null; lead: string | null; acceptedAt: string | null; concludedAt: string | null
  deadlines: { id: string; title: string; dueLabel: string; completed: boolean; confirmStatus?: "CONFIRMED" | "PENDING" | "ADJUSTED" }[]
  hearings: { id: string; title: string; startsAt: string }[]
}
export type TaskData = {
  tasks: Task[]; untracked: { id: string; stageId?: string | null; title: string; completed: boolean; stageName: string | null }[]
  procedures: Procedure[]; canWrite: boolean; procedureTypes: Record<string,string>
}
const states = { OPEN: "待办", DONE: "已办结", CANCELLED: "已取消" }
const lanes = {
  OPEN: { icon: CircleIcon, tone: "text-foreground/70" },
  DONE: { icon: CircleCheckIcon, tone: "text-success" },
  CANCELLED: { icon: CircleOffIcon, tone: "text-muted-foreground" },
}
const priorities = [
  { icon: SignalLowIcon, label: "普通", tone: "text-muted-foreground" },
  { icon: SignalHighIcon, label: "优先", tone: "text-foreground" },
  { icon: TriangleAlertIcon, label: "紧急", tone: "text-destructive" },
]
const businessTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })

const dateOnly = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" })
const taskDate = (value: string | null) => value ? businessTime.format(new Date(value)) : "未安排"

type TaskWorkspaceProps = { matterId: string; data: TaskData; reload: () => void }

export function TaskWorkspace(props: TaskWorkspaceProps) {
  const params = useSearchParams()
  return <ProgramTasks key={params.toString()} {...props}
    procedureId={params.get("program")} target={params.get("task")}
    initialScope={params.get("scope") ?? "all"} initialQuery={params.get("q") ?? ""}
    initialLayout={params.get("layout") === "table" ? "table" : "board"} />
}

function ProgramTasks({ matterId, data, reload, procedureId, target, initialScope, initialQuery, initialLayout }: TaskWorkspaceProps & {
  procedureId: string | null; target: string | null; initialScope: string; initialQuery: string; initialLayout: TaskView
}) {
  const [editing, setEditing] = useState<Task | "new" | null>(null)
  const [scope, setScope] = useState(initialScope)
  const [query, setQuery] = useState(initialQuery)
  const [layout, setLayout] = useState(initialLayout)
  const [status, setStatus] = useState("")
  const [workingId, setWorkingId] = useState("")
  const current = data.procedures.find(proc => proc.id === procedureId)
  const programPath = `/matters/${matterId}/tasks`
  const returnFilters = {
    ...(current ? { program: current.id } : {}), ...(scope !== "all" ? { scope } : {}),
    ...(query ? { q: query } : {}), ...(layout === "table" ? { layout } : {}),
  }
  const stages = current?.stages ?? []
  const stageIds = new Set(stages.map(stage => stage.id))
  const allStages = data.procedures.flatMap(proc => proc.stages.map(stage => ({ id: stage.id, name: proc.name + " · " + stage.name })))
  const normalized = query.trim().toLocaleLowerCase()
  const tasks = data.tasks.filter(item => {
    if (target) return item.id === target && (!current || stageIds.has(item.stageId ?? ""))
    const inProgram = current ? stageIds.has(item.stageId ?? "") : !item.stageId
    return inProgram && (scope === "all" || item.stageId === scope) && item.title.toLocaleLowerCase().includes(normalized)
  })
  const untracked = target ? [] : data.untracked.filter(item =>
    (current ? stageIds.has(item.stageId ?? "") : !item.stageId)
    && (scope === "all" || item.stageId === scope) && item.title.toLocaleLowerCase().includes(normalized)
  )

  function materialHref(stageId?: string | null, taskId?: string) {
    return { pathname: `/matters/${matterId}/materials`,
      query: { ...returnFilters, ...(stageId ? { stage: stageId } : {}), ...(taskId ? { task: taskId } : {}) } }
  }

  async function complete(task: Task) {
    if (workingId) return
    setWorkingId(task.id)
    setStatus("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete-task", matterId, id: task.id, revision: task.revision }) })
      setStatus("任务已办结。")
      reload()
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "任务办结失败。") }
    finally { setWorkingId("") }
  }

  if (procedureId && !current) return <>
    <PageHeader title="程序与任务" actions={<Button size="sm" variant="outline" nativeButton={false}
      render={<Link href={programPath} />}>全部程序</Button>} />
    <p role="alert" className="text-sm">程序不可查看。</p>
  </>

  const showBoard = !!current || !!target || data.tasks.some(task => !task.stageId) || data.untracked.some(task => !task.stageId)
  const caseNewTask = data.canWrite && (!current || stages.length > 0)
  return <div className="grid min-w-0 gap-4">
    <PageHeader title={current?.name ?? "程序与任务"} description={current
      ? [current.typeLabel === current.name ? undefined : current.typeLabel, current.statusLabel, current.handlingAgency ?? "办理机构未登记", current.caseNumber ?? "案号未登记"].filter(Boolean).join(" · ")
      : "本案已登记的程序"} actions={<>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={current ? programPath : "/practice/schedule"} />}>
        {current ? "全部程序" : "查看日程"}
      </Button>
      {!current && data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} reload={reload} />}
      {caseNewTask && <Button size="sm" variant={current ? "default" : "outline"} onClick={() => setEditing("new")}>
        <Plus data-icon="inline-start" />{current ? "新建任务" : "新建案级任务"}
      </Button>}
    </>} />
    {!current && !target && <Card>
      <CardHeader><CardTitle>本案程序</CardTitle></CardHeader>
      <CardContent>
        {data.procedures.length === 0 ? <p className="text-sm text-muted-foreground">暂无程序。</p> :
          <ul className="divide-y">{data.procedures.map(proc => <li key={proc.id}>
            <Link href={{ pathname: programPath, query: { program: proc.id } }}
              className="flex min-w-0 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-primary"><BriefcaseBusiness className="size-4" /></span>
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="break-words text-sm font-medium">{proc.name}</span>
                <span className="text-xs text-muted-foreground">{proc.statusLabel} · {proc.stages.length} 个办理环节 · {proc.hearings.length} 条庭期记录 · {proc.deadlines.length} 项期限</span>
              </span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">进入程序<ChevronRight className="size-4" /></span>
            </Link>
          </li>)}</ul>}
      </CardContent>
    </Card>}
    {target && <Button className="justify-self-start" variant="outline" size="sm" nativeButton={false}
      render={<Link href={{ pathname: programPath, query: returnFilters }} />}>{Object.keys(returnFilters).length ? "返回任务筛选" : "查看本案全部任务"}</Button>}
    {showBoard && <div className={current
      ? "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"
      : "grid min-w-0 gap-4"}>
      <section className={current ? "min-w-0 rounded-xl px-2 pt-4 sm:px-5" : "min-w-0 rounded-xl border bg-card px-4 pt-4"}>
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{current ? "律师准备任务" : target ? "任务" : "案级任务"}</h2>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {current && <span className="text-xs text-muted-foreground">{stages.length} 个办理环节</span>}
            {!target && <TaskViewToggle chinese value={layout} onChange={setLayout} />}
          </div>
        </header>
        <div className="@container grid min-w-0 gap-4 pb-4">
          {!target && <div className="flex flex-wrap items-center gap-2">
            {current && <label className="flex items-center gap-2 text-xs text-muted-foreground">办理环节
              <NativeSelect value={scope} onChange={event => setScope(event.target.value)}>
                <NativeSelectOption value="all">全部环节</NativeSelectOption>
                {stages.map(stage => <NativeSelectOption key={stage.id} value={stage.id}>{stage.name}</NativeSelectOption>)}
                {scope !== "all" && !stageIds.has(scope) && <NativeSelectOption disabled value={scope}>环节不可查看</NativeSelectOption>}
              </NativeSelect>
            </label>}
            <InputGroup className="ms-auto w-52 max-w-full">
              <InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon>
              <InputGroupInput aria-label="搜索任务" placeholder={current ? "搜索当前程序任务" : "搜索案级任务"} maxLength={150}
                value={query} onChange={event => setQuery(event.target.value)} />
            </InputGroup>
          </div>}
          {status && <p role="status" className="text-sm">{status}</p>}
          {!target && layout === "board" ? <div className="grid gap-3 @min-[480px]:grid-cols-3">
            {(Object.keys(states) as Task["state"][]).map(state => {
              const entries = tasks.filter(task => task.state === state)
              return <TaskBoardLane key={state} label={states[state]} count={entries.length} {...lanes[state]}
                className="min-h-36" onAdd={state === "OPEN" && caseNewTask ? () => setEditing("new") : undefined} addLabel="新建待办任务">
                {entries.length === 0 ? <p className="flex h-24 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">暂无任务</p> :
                  <ul className="flex flex-col gap-2">{entries.map(task => <li key={task.id}>
                    <ProgramTaskCard task={task} href={materialHref(task.stageId, task.id)} edit={data.canWrite && task.state === "OPEN" ? () => setEditing(task) : undefined}
                      complete={() => void complete(task)} busy={!!workingId} />
                  </li>)}</ul>}
              </TaskBoardLane>
            })}
          </div> : <LegalTaskTable rows={tasks} label="程序任务清单" href={task => materialHref(task.stageId, task.id)}
            context={taskScope} summary={target ? task => task.description : undefined} waiting={task => task.waitingFor}
            priority={task => <TaskPriority task={task} showLabel />} assignee={task => task.assignee}
            actions={task => data.canWrite && task.state === "OPEN" ? <TaskActionMenu task={task} busy={!!workingId}
              edit={() => setEditing(task)} complete={() => void complete(task)} /> : null}
            empty={target ? "任务已不存在或不可查看。" : "当前范围没有任务。"} />}
          {untracked.length > 0 && <ul className="divide-y">{untracked.map(task => <li key={task.id} className="py-2 text-sm">
            {task.title}<span className="ms-2 text-muted-foreground">责任记录待核对</span>
          </li>)}</ul>}
          {current && stages.length > 0 && <Collapsible className="border-t pt-3">
            <CollapsibleTrigger className="group flex items-center gap-2 rounded-sm px-1 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
              <ChevronRight className="size-4 group-data-panel-open:hidden" /><ChevronDown className="hidden size-4 group-data-panel-open:block" />按环节查看材料
            </CollapsibleTrigger>
            <CollapsibleContent><ul className="divide-y pt-2">{stages.map(stage => <li key={stage.id}>
              <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" href={materialHref(stage.id)}>
                <FileText className="size-4 text-primary" />{stage.name}<ChevronRight className="ms-auto size-4" />
              </Link>
            </li>)}</ul></CollapsibleContent>
          </Collapsible>}
        </div>
      </section>
      {current && <aside className="grid min-w-0 gap-3" aria-label="程序与法院日期">
        <Card>
          <CardHeader><CardTitle>程序信息</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <dl className="divide-y">{[
              ["办理机构", current.handlingAgency], ["案号", current.caseNumber], ["管辖地区", current.jurisdiction],
              ["主办律师", current.lead], ["实际受理", current.acceptedAt && dateOnly.format(new Date(current.acceptedAt))],
              ["实际终结", current.concludedAt && dateOnly.format(new Date(current.concludedAt))],
            ].map(([label, value]) => <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 py-2">
              <dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value ?? "未登记"}</dd>
            </div>)}</dl>
            {data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} procedure={current} reload={reload} controls={["edit", "stage"]} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2"><CardTitle>庭期</CardTitle>
            {data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} procedure={current} reload={reload} controls={["hearing"]} />}
          </CardHeader>
          <CardContent className="text-sm">
            {current.hearings.length ? <ul className="divide-y">{current.hearings.map(row => <li className="flex flex-wrap justify-between gap-1 py-2" key={row.id}>
              <span className="font-medium">{row.title}</span><span className="text-muted-foreground">{businessTime.format(new Date(row.startsAt))}</span>
            </li>)}</ul> : <p className="text-muted-foreground">暂无庭期记录。</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2"><CardTitle>法律期限</CardTitle>
            {data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} procedure={current} reload={reload} controls={["deadline"]} />}
          </CardHeader>
          <CardContent className="text-sm">
            {current.deadlines.length ? <ul className="divide-y">{current.deadlines.map(row => <li className="flex flex-wrap justify-between gap-1 py-2" key={row.id}>
              <span className="font-medium">{row.title}</span><span className="text-muted-foreground">{row.dueLabel} · {row.confirmStatus === "PENDING" ? "待确认" : row.completed ? "已办结" : "未办结"}</span>
            </li>)}</ul> : <p className="text-muted-foreground">暂无法律期限。</p>}
          </CardContent>
        </Card>
      </aside>}
    </div>}
    {editing !== null && <TaskEditor matterId={matterId} stages={editing === "new" ? stages : allStages}
      initialStageId={stageIds.has(scope) ? scope : ""} requireStage={!!current && editing === "new"} task={editing === "new" ? null : editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setStatus("任务已保存。"); reload() }} />}
  </div>
}

function ProgramTaskCard({ task, href, edit, complete, busy }: {
  task: Task; href: React.ComponentProps<typeof Link>["href"]; edit?: () => void; complete: () => void; busy: boolean
}) {
  return <TaskCardFrame className="relative hover:ring-primary/30">
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{taskScope(task)}</span>
      <TaskPriority task={task} />
      {edit && <TaskActionMenu task={task} busy={busy} edit={edit} complete={complete} />}
    </div>
    <Link href={href} className={"line-clamp-2 break-words text-sm leading-snug font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-2 focus-visible:outline-ring" +
      (task.state === "OPEN" ? "" : " text-muted-foreground line-through decoration-muted-foreground/50")}>{task.title}</Link>
    <div className="flex flex-wrap items-center gap-1.5">
      {task.waitingFor && <StatusBadge tone="warning" className="h-5 px-1.5 text-[11px]">等待反馈</StatusBadge>}
      {task.blockingCount > 0 && <StatusBadge tone="muted" className="h-5 px-1.5 text-[11px]">{task.blockingCount} 项前置未完成</StatusBadge>}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums" aria-label={"计划完成 " + taskDate(task.dueAt)}>
        <CalendarIcon className="size-3 shrink-0" aria-hidden />{task.dueAt ? taskDate(task.dueAt) : "未安排"}
      </span>
    </div>
  </TaskCardFrame>
}

const taskScope = (task: Task) => [task.procedureTitle, task.stageName ?? "案级任务"].filter(Boolean).join(" · ")

function TaskPriority({ task, showLabel }: { task: Task; showLabel?: boolean }) {
  const priority = priorities[task.priority] ?? priorities[0]
  return <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
    <priority.icon className={"size-3.5 shrink-0 " + priority.tone} aria-label={!showLabel ? priority.label + "优先级" : undefined} />
    {showLabel ? priority.label : null}
  </span>
}

function TaskActionMenu({ task, busy, edit, complete }: { task: Task; busy: boolean; edit: () => void; complete: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="relative z-10 text-muted-foreground"
      disabled={busy} aria-label={task.title + "的任务操作"} />}><Ellipsis /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={edit}>编辑</DropdownMenuItem>
      <DropdownMenuItem disabled={!!task.waitingFor || task.blockingCount > 0} onClick={complete}>办结</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

function TaskEditor({ matterId, stages, initialStageId, requireStage, task, onClose, onSaved }: {
  matterId: string; stages: { id: string; name: string }[]; initialStageId: string; requireStage: boolean; task: Task | null; onClose: () => void; onSaved: () => void
}) {
  const [requestKey, setKey] = useState(() => crypto.randomUUID())
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const due = form.get("due")
    setBusy(true)
    setError("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(task ? { action: "update-task", id: task.id, revision: task.revision }
            : { action: "create-task", requestKey, ...(due ? { dueAt: String(due) + ":00+08:00" } : {}) }),
          matterId, title: form.get("title"), description: form.get("description"), stageId: form.get("stageId"), priority: Number(form.get("priority")),
        }),
      })
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。") }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setDiscard(true); else onClose() } }}>
    <SheetContent className="motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{task ? "编辑任务" : "新建任务"}</SheetTitle><SheetDescription>当前案件的任务安排</SheetDescription></SheetHeader>
      <form onSubmit={save} onChange={() => { setDirty(true); setDiscard(false); setKey(crypto.randomUUID()) }} className="grid gap-3 px-4">
        <fieldset disabled={busy} className="grid gap-3">
          <label className="grid gap-1 text-sm">任务标题<Input name="title" defaultValue={task?.title} required maxLength={200} /></label>
          <label className="grid gap-1 text-sm">说明<Textarea name="description" defaultValue={task?.description ?? ""} maxLength={2000} /></label>
          <label className="grid gap-1 text-sm">所属环节<NativeSelect name="stageId" required={requireStage} defaultValue={task ? task.stageId ?? "" : initialStageId}><NativeSelectOption value="">{requireStage ? "请选择环节" : "案级任务"}</NativeSelectOption>
            {task?.stageId && !stages.some(row => row.id === task.stageId) && <NativeSelectOption value={task.stageId}>{task.stageName}（已停用）</NativeSelectOption>}
            {stages.map(stage => <NativeSelectOption key={stage.id} value={stage.id}>{stage.name}</NativeSelectOption>)}
          </NativeSelect></label>
          <label className="grid gap-1 text-sm">优先级<NativeSelect name="priority" defaultValue={String(task?.priority ?? 0)}><NativeSelectOption value="0">普通</NativeSelectOption><NativeSelectOption value="1">优先</NativeSelectOption><NativeSelectOption value="2">紧急</NativeSelectOption></NativeSelect></label>
          {!task && <label className="grid gap-1 text-sm">计划完成时间（北京时间）<Input name="due" type="datetime-local" /></label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit">{busy ? "正在保存…" : "保存任务"}</Button>
        </fieldset>
        {discard && <div role="alert" className="grid gap-2 text-sm">放弃未保存的任务？
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button><Button type="button" variant="ghost" onClick={onClose}>放弃修改</Button></div></div>}
      </form>
    </SheetContent>
  </Sheet>
}
