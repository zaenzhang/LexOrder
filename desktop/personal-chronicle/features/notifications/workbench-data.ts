import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toast } from "@/components/ui/toast"
import { usePractice, writePractice } from "@/features/practice/data"
import type { BellNotification } from "@/kit/notifications/notification-bell"

export type NotificationRow = { id: string; title: string; content: string | null; createdAt: string; read: boolean }
type Summary = { recent: NotificationRow[]; unread: NotificationRow[]; unreadCount: number }

export const notificationsPath = "/practice/notifications"
const summaryParams = { summary: "1" }
const isNotificationQuery = (key: readonly unknown[]) =>
  key[0] === "practice" && typeof key[1] === "string" && new URLSearchParams(key[1]).get("view") === "notifications"

export function toInboxItem(row: NotificationRow): BellNotification {
  return { id: row.id, title: row.title, body: row.content ?? "", at: row.createdAt, read: row.read,
    href: notificationsPath + "?" + new URLSearchParams({ notification: row.id }) }
}

export function useNotificationSummary(enabled = true) {
  return usePractice<Summary>("notifications", summaryParams, enabled)
}

export function useReadNotification() {
  const cache = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[] | "all") => writePractice(ids === "all"
      ? { action: "read-all-notifications" }
      : { action: "read-notification", id: ids[0] }),
    onSuccess: () => cache.invalidateQueries({ predicate: query => isNotificationQuery(query.queryKey) }),
    onError: error => toast.add({ title: "未能标记为已读", description: error.message, type: "error" }),
  })
}
