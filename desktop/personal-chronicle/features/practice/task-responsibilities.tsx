"use client"

import Link from "next/link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { CaseForm } from "@/features/matters/case-management"
import { chinaDate, usePractice, writePractice } from "./data"

const statuses = { OPEN: "待办", DONE: "已办结", CANCELLED: "已取消" }
const actions = { COMPLETE: "办结", CANCEL: "取消任务", REOPEN: "重开" }
type Outcome = keyof typeof actions
type Task = {
  id: string
  matterId: string
  matterTitle: string
  title: string
  dueAt: string | null
  state: keyof typeof statuses
  revision: number
  canWrite: boolean
}

export function TaskResponsibilities() {
  const client = useQueryClient()
  const [closed, setClosed] = useState(false)
  const [editing, setEditing] = useState<{
    task: Task
    outcome: Outcome
    blocked?: boolean
  } | null>(null)
  const [message, setMessage] = useState("")
  const { data, error, refetch } = usePractice<{ items: Task[] }>(
    "responsibilities",
    { closed: closed ? "1" : "0" }
  )
  return (
    <section className="grid gap-3" aria-label="跨案任务责任板">
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={closed}
          onChange={(e) => setClosed(e.target.checked)}
        />
        含已结束任务
      </label>
      {message && <p role="status">{message}</p>}
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p>正在读取任务…</p>
      ) : data.items.length === 0 ? (
        <p>没有符合条件的责任任务。</p>
      ) : (
        <ul className="divide-y">
          {data.items.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="me-auto">
                <Link
                  className="font-medium underline"
                  href={`/matters/${task.matterId}/tasks?task=${task.id}`}
                >
                  {task.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {task.matterTitle} ·{" "}
                  {task.dueAt ? chinaDate(task.dueAt) : "未安排时间"}
                </p>
              </div>
              <span>{statuses[task.state]}</span>
              {task.canWrite &&
                (task.state === "OPEN"
                  ? (["COMPLETE", "CANCEL"] as const)
                  : (["REOPEN"] as const)
                ).map((outcome) => (
                  <Button
                    key={outcome}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMessage("")
                      setEditing({ task, outcome })
                    }}
                  >
                    {actions[outcome]}
                  </Button>
                ))}
            </li>
          ))}
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
