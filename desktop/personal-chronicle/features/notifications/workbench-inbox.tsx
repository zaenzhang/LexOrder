"use client"

import { Settings2Icon } from "lucide-react"
import { useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { usePractice } from "@/features/practice/data"
import Link from "@/features/shell/workspace-link"
import { NotificationsInbox } from "@/kit/notifications/notifications-inbox"
import { PageHeader } from "@/kit/ui-patterns/page-header"

import { toInboxItem, useNotificationSummary, useReadNotification, type NotificationRow } from "./workbench-data"

export function WorkbenchNotificationsPage() {
  const [params, setParams] = useSearchParams()
  const filter = params.get("unread") === "1" ? "unread" : "all"
  const inbox = usePractice<{ items: NotificationRow[] }>("notifications", { unread: filter === "unread" ? "1" : "0" })
  const summary = useNotificationSummary()
  const read = useReadNotification()

  return (
    <>
      <PageHeader
        title="通知"
        description="查看案件和办理通知。"
        actions={<Button variant="outline" nativeButton={false} render={<Link href="/practice/profile" />}>
          <Settings2Icon data-icon="inline-start" />
          设置
        </Button>}
      />
      <NotificationsInbox
        workbench
        items={inbox.data?.items.map(toInboxItem)}
        unreadCount={summary.data?.unreadCount}
        selectedId={params.get("notification")}
        loading={inbox.isPending}
        error={inbox.error}
        onRetry={() => void inbox.refetch()}
        filter={filter}
        onFilterChange={(next) => setParams(next === "unread" ? { unread: "1" } : {}, { replace: true })}
        onMarkRead={read.mutate}
        readPending={read.isPending}
      />
    </>
  )
}
