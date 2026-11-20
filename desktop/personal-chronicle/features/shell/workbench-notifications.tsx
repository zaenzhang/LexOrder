"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toast } from "@/components/ui/toast"
import { usePractice, writePractice } from "@/features/practice/data"
import { NotificationBell, type BellNotification } from "@/kit/notifications/notification-bell"
import { whenIdle } from "@/kit/ui-patterns/when-idle"

type NotificationRow = { id: string; title: string; content: string | null; createdAt: string; read: boolean }
type Summary = { recent: NotificationRow[]; unread: NotificationRow[]; unreadCount: number }

const notificationsPath = "/practice/notifications"
const summaryParams = { summary: "1" }
const isNotificationQuery = (key: readonly unknown[]) =>
  key[0] === "practice" && typeof key[1] === "string" && new URLSearchParams(key[1]).get("view") === "notifications"

function bellItem(row: NotificationRow): BellNotification {
  return { id: row.id, title: row.title, body: row.content ?? "", at: row.createdAt, read: row.read,
    href: notificationsPath + "?" + new URLSearchParams({ notification: row.id }) }
}

export function WorkbenchNotifications() {
  const [ready, setReady] = useState(false)
  const cache = useQueryClient()
  const inbox = usePractice<Summary>("notifications", summaryParams, ready)
  useEffect(() => whenIdle(() => setReady(true)), [])

  const read = useMutation({
    mutationFn: (ids: string[] | "all") => writePractice(ids === "all"
      ? { action: "read-all-notifications" }
      : { action: "read-notification", id: ids[0] }),
    onSuccess: () => cache.invalidateQueries({ predicate: query => isNotificationQuery(query.queryKey) }),
    onError: error => toast.add({ title: "未能标记为已读", description: error.message, type: "error" }),
  })
  function open() {
    setReady(true)
    if (inbox.data && Date.now() - inbox.dataUpdatedAt > 30_000) void inbox.refetch()
  }
  return <NotificationBell workbench
    items={inbox.data?.recent.map(bellItem) ?? []}
    unreadItems={inbox.data?.unread.map(bellItem)}
    unreadCount={inbox.data?.unreadCount}
    onOpen={open}
    onMarkRead={ids => read.mutate(ids)}
    readPending={read.isPending}
    loading={inbox.isPending}
    error={inbox.error?.message}
    onRetry={() => void inbox.refetch()}
    viewAllHref={notificationsPath}
    settingsHref="/practice/profile"
    emptyDescription="新的案件和办理通知会显示在这里。"
  />
}
