"use client"

import { useEffect, useState } from "react"

import { notificationsPath, toInboxItem, useNotificationSummary, useReadNotification } from "@/features/notifications/workbench-data"
import { NotificationBell } from "@/kit/notifications/notification-bell"
import { whenIdle } from "@/kit/ui-patterns/when-idle"

export function WorkbenchNotifications() {
  const [ready, setReady] = useState(false)
  const inbox = useNotificationSummary(ready)
  const read = useReadNotification()
  useEffect(() => whenIdle(() => setReady(true)), [])

  function open() {
    setReady(true)
    if (inbox.data && Date.now() - inbox.dataUpdatedAt > 30_000) void inbox.refetch()
  }
  return <NotificationBell workbench
    items={inbox.data?.recent.map(toInboxItem) ?? []}
    unreadItems={inbox.data?.unread.map(toInboxItem)}
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
