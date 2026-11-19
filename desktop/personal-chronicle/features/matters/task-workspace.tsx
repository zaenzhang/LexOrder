"use client"

import { ProcedureActions, type ProcedureInfo } from "./case-management"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Task = {
  id: string; title: string; description: string | null; dueAt: string | null; priority: number
  stageId: string | null; stageName: string | null; procedureTitle: string | null
  state: "OPEN" | "DONE" | "CANCELLED"; assignee: string; revision: number; waitingFor?: string; blockingCount: number
}
type Procedure = ProcedureInfo & {
  id: string; name: string; stages: { id: string; name: string }[]
  deadlines: { id: string; title: string; dueLabel: string; completed: boolean }[]
  hearings: { id: string; title: string; startsAt: string }[]
}
export type TaskData = {
  tasks: Task[]; untracked: { id: string; stageId?: string | null; title: string; completed: boolean; stageName: string | null }[]
  procedures: Procedure[]; canWrite: boolean; procedureTypes: Record<string,string>
}
const states = { OPEN: "待办", DONE: "已办结", CANCELLED: "已取消" }
const businessTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })

export function TaskWorkspace({ matterId, data, reload }: { matterId: string; data: TaskData; reload: () => void }) {
  const target = useSearchParams().get("task")
  const [editing, setEditing] = useState<Task | "new" | null>(null)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [scope, setScope] = useState("all")
  const [status, setStatus] = useState("")
  const [workingId, setWorkingId] = useState("")
  const stages = data.procedures.flatMap(proc => proc.stages.map(stage => ({ id: stage.id, name: proc.name + " · " + stage.name })))
  const tasks = data.tasks.filter(item => target ? item.id === target : (includeClosed || item.state === "OPEN")
    && (scope === "all" || (item.stageId || "unassigned") === scope))
  const untracked = target ? [] : data.untracked.filter(item => (includeClosed || !item.completed)
    && (scope === "all" || (item.stageId || "unassigned") === scope))

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

  return <Tabs defaultValue="tasks">
    <TabsList aria-label="程序与任务视图"><TabsTrigger value="tasks">任务</TabsTrigger><TabsTrigger value="calendar">程序、期限与庭期</TabsTrigger></TabsList>
    <TabsContent value="tasks"><Card><CardHeader><CardTitle>案件任务</CardTitle></CardHeader><CardContent className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {target ? <Link className="text-sm underline" href={`/matters/${matterId}/tasks`}>查看本案全部任务</Link> : <>
        <NativeSelect aria-label="任务范围" value={scope} onChange={e => setScope(e.target.value)}>
          <NativeSelectOption value="all">全案</NativeSelectOption><NativeSelectOption value="unassigned">未归属环节</NativeSelectOption>
          {stages.map(s => <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} />含已结束</label></>}
        {data.canWrite && !target && <Button className="ms-auto" size="sm" onClick={() => setEditing("new")}>新建任务</Button>}
      </div>
      {status && <p role="status" className="text-sm">{status}</p>}
      {tasks.length === 0 && untracked.length === 0 && <p className="text-sm text-muted-foreground">当前范围没有任务。</p>}
      <ul className="divide-y">{tasks.map(task => <li key={task.id} className="flex flex-wrap items-center gap-2 py-2">
        <div className="me-auto grid gap-1">
          <p className="font-medium">{task.title}</p>
          {task.description && <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
          <p className="text-xs text-muted-foreground">{[task.procedureTitle, task.stageName ?? "事项级任务", task.assignee, task.dueAt && businessTime.format(new Date(task.dueAt))].filter(Boolean).join(" · ")}</p>
          {task.waitingFor && <p className="text-xs">等待 {task.waitingFor}</p>}
          {task.blockingCount > 0 && <p className="text-xs">{task.blockingCount} 项前置任务未完成</p>}
        </div>
        <Badge variant="outline">{states[task.state]}</Badge>
        {data.canWrite && task.state === "OPEN" && <>
          <Button size="sm" variant="ghost" disabled={!!workingId} onClick={() => setEditing(task)}>编辑</Button>
          <Button size="sm" variant="outline" disabled={!!workingId || !!task.waitingFor || task.blockingCount > 0} onClick={() => void complete(task)}>办结</Button>
        </>}
      </li>)}
      {untracked.map(task => <li key={task.id} className="py-2 text-sm">{task.title}<span className="ms-2 text-muted-foreground">责任记录待核对</span></li>)}</ul>
    </CardContent></Card></TabsContent>
    <TabsContent value="calendar" className="grid gap-3">
      {data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} reload={reload}/>}
      {data.procedures.length === 0 && <p className="text-sm text-muted-foreground">暂无程序。</p>}
      {data.procedures.map(proc => <Card key={proc.id}><CardHeader><CardTitle>{proc.name}</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm">
        {data.canWrite && <ProcedureActions matterId={matterId} types={data.procedureTypes} procedure={proc} reload={reload}/>}
        {proc.stages.length > 0 && <p>{proc.stages.map(stage => stage.name).join(" · ")}</p>}
        {proc.deadlines.map(row => <p key={row.id}>{row.title} · {row.dueLabel} · {row.completed ? "已办结" : "未办结"}</p>)}
        {proc.hearings.map(row => <p key={row.id}>{row.title} · {businessTime.format(new Date(row.startsAt))}</p>)}
        {proc.deadlines.length === 0 && proc.hearings.length === 0 && <p className="text-muted-foreground">暂无期限与庭期。</p>}
      </CardContent></Card>)}
    </TabsContent>
    {editing !== null && <TaskEditor matterId={matterId} stages={stages} initialStageId={stages.some(stage => stage.id === scope) ? scope : ""} task={editing === "new" ? null : editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setStatus("任务已保存。"); reload() }} />}
  </Tabs>
}

function TaskEditor({ matterId, stages, initialStageId, task, onClose, onSaved }: {
  matterId: string; stages: { id: string; name: string }[]; initialStageId: string; task: Task | null; onClose: () => void; onSaved: () => void
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
          <label className="grid gap-1 text-sm">所属环节<NativeSelect name="stageId" defaultValue={task ? task.stageId ?? "" : initialStageId}><NativeSelectOption value="">事项级任务</NativeSelectOption>
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
