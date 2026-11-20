"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TaskResponsibilities, type TaskBoardView } from "./task-responsibilities"
import { CalendarDays, ChevronRight, Inbox } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { longCalendarDate, type PersonalScheduleItem } from "./personal-calendar"
import { chinaDate, usePractice, writePractice } from "./data"

const sections = {
  today: "今日办理",
  schedule: "工作日程",
  "follow-ups": "客户跟进",
  notifications: "业务通知",
} as const
type View = Exclude<keyof typeof sections, "schedule">
type TodayData = {
  day: string
  courtDates: PersonalScheduleItem[]
  courtInbox: { id: string; title: string; day: string; matter: { id: string; title: string } | null }[]
  moreCourtInbox: boolean
}
const taskViews: [TaskBoardView, string][] = [["open", "待我办理"], ["waiting", "等待反馈"], ["done", "已办理"]]

function TodayRow({ href, icon: Icon, title, detail }: {
  href: React.ComponentProps<typeof Link>["href"]
  icon: typeof CalendarDays
  title: string
  detail: string
}) {
  return <li><Link href={href} className="flex min-w-0 items-center gap-3 rounded-md px-1 py-3 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
    <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-primary"><Icon aria-hidden className="size-4" /></span>
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="break-words text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </span>
    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  </Link></li>
}

function Today({ initialTab }: { initialTab: TaskBoardView }) {
  const { data, error, refetch } = usePractice<TodayData>("today")
  usePageLoading(!data && !error)
  return <section className="grid gap-4">
    <PageHeader className="sm:items-center [&_h1]:text-[1.75rem]" title="今日办理" description={data ? longCalendarDate(data.day) + " · 本机承办工作" : "本机承办工作"}
      actions={<><Button size="sm" variant="outline" nativeButton={false} render={<Link href="/practice/operations" />}>跨案事务</Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/practice/schedule" />}>查看日程</Button></>} />
    {error && <div role="alert" className="flex items-center gap-2 text-sm">{error.message}<Button size="sm" variant="outline" onClick={() => void refetch()}>重试</Button></div>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2.1fr)_minmax(16rem,1fr)]">
      <Card>
        <CardHeader><CardTitle className="text-lg">我的工作</CardTitle></CardHeader>
        <CardContent>
          <Tabs key={initialTab} defaultValue={initialTab}>
            <TabsList aria-label="今日办理状态">
              {taskViews.map(([value, label]) => <TabsTrigger className="px-2.5" key={value} value={value}>{label}</TabsTrigger>)}
            </TabsList>
            {taskViews.map(([value]) => <TabsContent key={value} value={value}>
              {value === "open" && !!data?.courtInbox.length && <ul className="divide-y border-b">
                {data.courtInbox.map(item => <TodayRow key={item.id} icon={Inbox} title={item.title}
                  detail={item.day + " · " + (item.matter?.title ?? "待确认案件")}
                  href={{ pathname: item.matter ? "/matters/" + item.matter.id + "/court" : "/practice/operations/court-inbox", query: { record: item.id, from: "today" } }} />)}
                {data.moreCourtInbox && <li><Button variant="link" size="sm" nativeButton={false}
                  render={<Link href="/practice/operations/court-inbox?from=today" />}>查看其余来件</Button></li>}
              </ul>}
              <TaskResponsibilities view={value} pageEntry={value === initialTab} hasOtherItems={value === "open" && !!data?.courtInbox.length} />
            </TabsContent>)}
          </Tabs>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">临近的法院日期</CardTitle></CardHeader>
        <CardContent>
          {!data && !error && <InlineLoading label="正在读取日期…" />}
          {data && (data.courtDates.length ? <ul className="divide-y">
            {data.courtDates.map(item => <TodayRow key={item.id} icon={CalendarDays} title={item.title}
              detail={item.when + (item.matter ? " · " + item.matter.title : "")}
              href={{ pathname: "/practice/schedule", query: { day: item.day, event: item.id, from: "today" } }} />)}
          </ul> : <p className="text-sm text-muted-foreground">最近 30 天没有已登记的庭期或法律期限。</p>)}
        </CardContent>
      </Card>
    </div>
  </section>
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
        <InlineLoading label="正在读取跟进…" />
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
function Notifications({ focused }: { focused?: string }) {
  const cache = useQueryClient()
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
      await Promise.all([refetch(), cache.invalidateQueries({ queryKey: ["practice", "view=notifications&summary=1"] })])
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
                className={"flex items-center justify-between gap-4 rounded-md px-2 py-3 " + (row.id === focused ? "bg-accent" : "")}
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
export function DailyWork({ view, todayTab = "open", notification }: { view: View; todayTab?: TaskBoardView; notification?: string }) {
  if (view === "today") return <Today initialTab={todayTab} />
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
      {view === "follow-ups" ? <FollowUps /> : <Notifications focused={notification} />}
    </section>
  )
}
