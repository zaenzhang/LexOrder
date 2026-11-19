"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TaskResponsibilities } from "./task-responsibilities"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { chinaDate, usePractice, writePractice } from "./data"

const sections = {
  today: "我的工作台",
  schedule: "日程",
  "follow-ups": "客户跟进",
  notifications: "业务通知",
} as const
type View = keyof typeof sections
type Schedule = {
  id: string
  type: "hearing" | "task" | "deadline"
  title: string
  when: string
  matter: { id: string; title: string }
  completed: boolean
}
const types = { hearing: "庭期", task: "任务", deadline: "期限" }
const columns: DataColumn<Schedule>[] = [
  { id: "when", header: "上海时间", cell: (row) => row.when },
  { id: "title", header: "事项", cell: (row) => row.title },
  {
    id: "matter",
    header: "案件",
    cell: (row) =>
      /^c[a-z0-9]{24,}$/.test(row.matter.id) ? (
        <Link className="underline" href={`/matters/${row.matter.id}/tasks`}>
          {row.matter.title}
        </Link>
      ) : (
        row.matter.title
      ),
  },
  { id: "type", header: "类型", cell: (row) => types[row.type] },
  {
    id: "completed",
    header: "状态",
    cell: (row) => (row.completed ? "已结束" : "待办"),
  },
]
const currentMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date())

function ScheduleList() {
  const [month, setMonth] = useState(currentMonth)
  const { data, error } = usePractice<{ items: Schedule[] }>("schedule", {
    month,
  })
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        月份
        <Input
          type="month"
          className="w-44"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : (
        <DataTable
          rows={data?.items}
          loading={!data}
          columns={columns}
          getRowId={(r) => r.type + ":" + r.id}
          sort={[]}
          onSortChange={() => {}}
          label="日程与期限"
          empty={<p>本月没有日程。</p>}
        />
      )}
    </>
  )
}
function Today() {
  const { data, error } = usePractice<{
    todayDeadlineCount: number
    weekHearingCount: number
    overdueDeadlineCount: number
  }>("today")
  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      {data && (
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["今日到期", data.todayDeadlineCount],
            ["本周庭期", data.weekHearingCount],
            ["逾期期限", data.overdueDeadlineCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ScheduleList />
    </>
  )
}
function FollowUps() {
  const [page, setPage] = useState(1)
  const { data, error } = usePractice<{
    available: boolean
    items: {
      id: string
      client: { id: string; name: string }
      title: string
      dueAt: string
      overdue: boolean
    }[]
    total: number
    pageSize: number
  }>("follow-ups", { page: String(page) })
  if (error) return <p role="alert">{error.message}</p>
  return (
    <>
      {!data ? (
        <p>正在读取跟进…</p>
      ) : !data.available ? (
        <p>当前工作区尚未启用客户跟进。</p>
      ) : data.items.length ? (
        <ul className="divide-y">
          {data.items.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <Link
                href={`/practice/clients/${row.client.id}`}
                className="hover:underline"
              >
                {row.client.name} · {row.title}
              </Link>
              <span>
                {row.overdue && <Badge variant="outline">逾期</Badge>}{" "}
                {chinaDate(row.dueAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>没有待跟进事项。</p>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  )
}
function Notifications() {
  const [unread, setUnread] = useState(false)
  const [failure, setFailure] = useState("")
  const { data, error, refetch } = usePractice<{
    items: {
      id: string
      title: string
      content: string | null
      createdAt: string
      read: boolean
    }[]
  }>("notifications", { unread: unread ? "1" : "0" })
  async function mark(id: string) {
    try {
      setFailure("")
      await writePractice({ action: "read-notification", id })
      await refetch()
    } catch (e) {
      setFailure((e as Error).message)
    }
  }
  return (
    <>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={unread}
          onChange={(e) => setUnread(e.target.checked)}
        />
        仅看未读
      </label>
      {(error || failure) && <p role="alert">{error?.message || failure}</p>}
      {data &&
        (data.items.length ? (
          <ul className="divide-y">
            {data.items.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div>
                  <h2 className="font-medium">{row.title}</h2>
                  <p>{row.content}</p>
                  <small>{chinaDate(row.createdAt)}</small>
                </div>
                {!row.read && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => mark(row.id)}
                  >
                    标为已读
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>没有业务通知。</p>
        ))}
    </>
  )
}
export function DailyWork({ view }: { view: View }) {
  return (
    <section className="flex flex-col gap-5">
      <PageHeader title={sections[view]} />
      <nav aria-label="我的工作" className="flex flex-wrap gap-1">
        {Object.entries(sections).map(([key, name]) => (
          <Button
            key={key}
            size="sm"
            variant={view === key ? "secondary" : "ghost"}
            nativeButton={false}
            render={
              <Link
                href={`/practice/${key}`}
                aria-current={view === key ? "page" : undefined}
              />
            }
          >
            {name}
          </Button>
        ))}
      </nav>
      {view === "today" ? (
        <Today />
      ) : view === "schedule" ? (
        <Tabs defaultValue="month">
          <TabsList aria-label="日程视图"><TabsTrigger value="month">月度日程</TabsTrigger><TabsTrigger value="board">跨案任务责任板</TabsTrigger></TabsList>
          <TabsContent value="month" className="grid gap-3"><ScheduleList /></TabsContent>
          <TabsContent value="board"><TaskResponsibilities /></TabsContent>
        </Tabs>
      ) : view === "follow-ups" ? (
        <FollowUps />
      ) : (
        <Notifications />
      )}
    </section>
  )
}
