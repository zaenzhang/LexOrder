"use client"

import Link from "@/features/shell/workspace-link"
import { CalendarIcon, CircleCheckIcon, CircleIcon, CircleOffIcon, Clock3Icon, ListTodoIcon, type LucideIcon } from "lucide-react"
import { useState, type ComponentProps, type ReactNode } from "react"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import type { SortRule } from "@/kit/data/list"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

type Row = { id: string; title: string; dueAt: string | null; state: "OPEN" | "DONE" | "CANCELLED" }
const dateFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const states = {
  OPEN: { icon: CircleIcon, label: "待办", color: "text-muted-foreground" },
  DONE: { icon: CircleCheckIcon, label: "已办结", color: "text-success" },
  CANCELLED: { icon: CircleOffIcon, label: "已取消", color: "text-muted-foreground" },
  WAITING: { icon: Clock3Icon, label: "等待反馈", color: "text-warning-foreground" },
} satisfies Record<string, { icon: LucideIcon; label: string; color: string }>

function TaskState({ state, waiting }: { state: Row["state"]; waiting?: boolean }) {
  const status = states[state === "OPEN" && waiting ? "WAITING" : state]
  return <span className="flex items-center gap-1.5 whitespace-nowrap text-xs"><status.icon className={cn("size-3.5", status.color)} aria-hidden />{status.label}</span>
}

function TaskDue({ at }: { at: string | null }) {
  return at ? <time dateTime={at} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
    <CalendarIcon className="size-3 shrink-0" aria-hidden />{dateFormat.format(new Date(at))}
  </time> : <span className="text-xs text-muted-foreground">未安排</span>
}

// Adapts the Chronicle Tasks table and responsive Item rows to actual LexOrder task states.
export function LegalTaskTable<T extends Row>({ rows, loading = false, label, href, context, summary, waiting, priority, assignee, actions,
  empty = "没有符合条件的任务。" }: {
  rows?: T[]; loading?: boolean; label: string
  href(row: T): ComponentProps<typeof Link>["href"]
  context(row: T): string; summary?(row: T): string | null; waiting?(row: T): string | undefined
  priority?(row: T): ReactNode; assignee?(row: T): string
  actions(row: T): ReactNode; empty?: string
}) {
  const [sort, setSort] = useState<SortRule[]>([])
  const rule = sort[0]
  const ordered = rows && rule?.id === "due" ? [...rows].sort((a, b) => {
    if (!a.dueAt || !b.dueAt) return Number(!a.dueAt) - Number(!b.dueAt)
    return a.dueAt.localeCompare(b.dueAt) * (rule.desc ? -1 : 1)
  }) : rows
  const columns: DataColumn<T>[] = [
    { id: "title", header: "任务", className: "min-w-36 whitespace-normal", cell: row => <div className="grid gap-0.5">
      <Link href={href(row)} className="break-words font-medium hover:underline">{row.title}</Link>
      <span className="break-words text-xs text-muted-foreground">{context(row)}</span>
      {summary?.(row) && <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{summary(row)}</span>}
    </div> },
    { id: "state", header: "状态", className: "w-24", cell: row => <div className="grid gap-0.5">
      <TaskState state={row.state} waiting={!!waiting?.(row)} />
      {waiting?.(row) && <span className="whitespace-normal text-xs text-muted-foreground">{waiting(row)}</span>}
    </div> },
    ...(priority ? [{ id: "priority", header: "优先级", className: "w-20", cell: priority }] : []),
    ...(assignee ? [{ id: "assignee", header: "承办人", className: "w-24", cell: (row: T) => <span className="whitespace-normal text-xs">{assignee(row)}</span> }] : []),
    { id: "due", header: "计划完成", className: "w-24", sortId: "due", cell: row => <TaskDue at={row.dueAt} /> },
    { id: "actions", header: "操作", className: "w-24 text-end", cell: actions },
  ]
  return <DataTable label={label} columns={columns} rows={ordered} getRowId={row => row.id}
    loading={loading} sort={sort} onSortChange={setSort} skeletonRows={4}
    renderMobileRow={row => <Item role="listitem" variant="muted" className="items-start rounded-xl bg-card shadow-(--surface-shadow)">
      <ItemContent className="min-w-0">
        <ItemDescription className="flex flex-wrap items-center gap-2 text-xs">{context(row)}<TaskDue at={row.dueAt} /></ItemDescription>
        <ItemTitle><Link href={href(row)} className="break-words hover:underline">{row.title}</Link></ItemTitle>
        {summary?.(row) && <ItemDescription className="whitespace-pre-wrap break-words">{summary(row)}</ItemDescription>}
        {waiting?.(row) && <ItemDescription>{waiting(row)}</ItemDescription>}
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1"><TaskState state={row.state} waiting={!!waiting?.(row)} />{actions(row)}</ItemActions>
    </Item>}
    empty={<Empty className="rounded-xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><ListTodoIcon /></EmptyMedia><EmptyTitle>{empty}</EmptyTitle></EmptyHeader></Empty>} />
}
