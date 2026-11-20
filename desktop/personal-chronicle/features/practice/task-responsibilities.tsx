"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CalendarDays, ChevronRight, Ellipsis, SearchIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { LegalTaskTable } from "@/features/tasks/legal-task-table"
import { Textarea } from "@/components/ui/textarea"
import { CaseForm } from "@/features/matters/case-management"
import { chinaDate, usePractice, writePractice } from "./data"

const statuses = { OPEN: "待办", DONE: "已办结", CANCELLED: "已取消" }
const actions = { COMPLETE: "办结", CANCEL: "取消任务", REOPEN: "重开" }
type Outcome = keyof typeof actions
export type TaskBoardView = "open" | "waiting" | "done"
type Task = {
  id: string
  matterId: string
  matterTitle: string
  title: string
  stageId: string | null
  dueAt: string | null
  state: keyof typeof statuses
  revision: number
  canWrite: boolean
  waiting?: { waitingFor: string; nextCheckAt: string }
}

export function TaskResponsibilities({ view, hasOtherItems = false, pageEntry = false }: { view?: TaskBoardView; hasOtherItems?: boolean; pageEntry?: boolean }) {
  const client = useQueryClient()
  const [closed, setClosed] = useState(false)
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<{
    task: Task
    outcome: Outcome
    blocked?: boolean
  } | null>(null)
  const [message, setMessage] = useState("")
  const { data, error, refetch } = usePractice<{ items: Task[] }>(
    "responsibilities",
    view ? { taskView: view } : { closed: closed ? "1" : "0" }
  )
  const optionsFor = (task: Task): Outcome[] => task.state === "OPEN" ? ["COMPLETE", "CANCEL"] : ["REOPEN"]
  const selectOutcome = (task: Task, outcome: Outcome) => { setMessage(""); setEditing({ task, outcome }) }
  const needle = search.trim().toLowerCase()
  const filtered = data?.items.filter(task => !needle || (task.title + " " + task.matterTitle).toLowerCase().includes(needle))
  usePageLoading(pageEntry && !data && !error)
  return (
    <section className="grid gap-3" aria-label={view ? "当前状态的任务" : "跨案任务责任板"}>
      {!view && <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:max-w-64">
          <InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon>
          <InputGroupInput aria-label="搜索跨案任务" placeholder="搜索任务或案件名称" value={search}
            onChange={event => setSearch(event.target.value)} />
        </InputGroup>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={closed} onCheckedChange={setClosed} />含已结束任务</label>
      </div>}
      {message && <p role="status">{message}</p>}
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !view ? <LegalTaskTable rows={filtered} loading={!data} label="跨案任务清单"
        href={task => "/matters/" + task.matterId + "/tasks?task=" + task.id}
        context={task => task.matterTitle}
        waiting={task => task.waiting && ("等待 " + task.waiting.waitingFor + " · 检查日 " + chinaDate(task.waiting.nextCheckAt))}
        actions={task => task.canWrite && <div className="flex flex-wrap justify-end gap-1">
          {optionsFor(task).map(outcome => <Button key={outcome} size="xs" variant="ghost"
            onClick={() => selectOutcome(task, outcome)}>{actions[outcome]}</Button>)}
        </div>}
      /> : !data ? (
        <InlineLoading label="正在读取任务…" />
      ) : data.items.length === 0 ? (
        hasOtherItems ? null : <p className="text-sm text-muted-foreground">没有符合条件的责任任务。</p>
      ) : (
        <ul className="divide-y">
          {data.items.map(task => {
            const date = task.dueAt ? chinaDate(task.dueAt) : "未安排时间"
            return <li key={task.id} className="flex items-center gap-1">
              <Link className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-3 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                href={{ pathname: "/matters/" + task.matterId + "/materials",
                  query: { task: task.id, ...(task.stageId ? { stage: task.stageId } : {}), from: "today", taskView: view } }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-primary"><CalendarDays aria-hidden className="size-4" /></span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="break-words text-sm font-medium">{task.title}</span>
                  <span className="text-xs text-muted-foreground">{task.matterTitle} · {task.waiting ? "等待 " + task.waiting.waitingFor + " · 检查日 " + chinaDate(task.waiting.nextCheckAt) : date}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
              {task.canWrite && <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={task.title + "的任务操作"} />}><Ellipsis /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">{optionsFor(task).map(outcome => <DropdownMenuItem key={outcome} onClick={() => selectOutcome(task, outcome)}>{actions[outcome]}</DropdownMenuItem>)}</DropdownMenuContent>
              </DropdownMenu>}
            </li>

          })}
        </ul>
      )}
      {editing && (
        <CaseForm
          title={actions[editing.outcome] + " · " + editing.task.title}
          close={() => setEditing(null)}
          submitDisabled={editing.blocked}
          onSave={async (fields) => {
            try {
              await writePractice({
                action: "resolve-schedule-task",
                outcome: editing.outcome,
                taskId: editing.task.id,
                matterId: editing.task.matterId,
                revision: editing.task.revision,
                reason: fields.get("reason"),
              })
            } catch (cause) {
              const latest = await refetch()
              if (latest.isSuccess) {
                const task = latest.data.items.find(row => row.id === editing.task.id && row.matterId === editing.task.matterId)
                const canApply = task?.canWrite && (editing.outcome === "REOPEN" ? task.state !== "OPEN" : task.state === "OPEN")
                if (!task || !canApply) {
                  setEditing({ ...editing, task: task ?? editing.task, blocked: true })
                  throw new Error("当前已不能执行此操作，处理原因仍可复制。")
                }
                if (task.revision !== editing.task.revision) {
                  setEditing({ task, outcome: editing.outcome })
                  throw new Error("任务已变化，已重读当前记录。请核对后再次提交。")
                }
              }
              throw cause
            }
          }}
          saved={() => {
            setMessage(
              editing.task.title +
                " · " +
                { COMPLETE: "已办结", CANCEL: "已取消", REOPEN: "已重开" }[
                  editing.outcome
                ]
            )
            setEditing(null)
            void client.invalidateQueries({ queryKey: ["practice"] })
          }}
        >
          <p>{editing.task.matterTitle} · {statuses[editing.task.state]} · {editing.task.dueAt ? chinaDate(editing.task.dueAt) : "未安排时间"}</p>
          <label className="grid gap-1">
            处理原因
            <Textarea name="reason" required maxLength={1000} />
          </label>
        </CaseForm>
      )}
    </section>
  )
}
