"use client"

import { BellIcon } from "lucide-react"
import { lazy, Suspense, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

import { whenIdle } from "../ui-patterns/when-idle"
import { InlineLoading } from "../ui-patterns/workspace-loading"

export interface BellNotification {
  id: string
  title: string
  body: string
  href: string
  read: boolean
  at: string
  /** What kind of thing it is about, shown as a tile beside it. */
  icon?: React.ComponentType
}

// The list, tabs and empty states load when the bell first opens: no page needs them to paint.
const loadBody = () => import("./notification-bell-body")
const NotificationBellBody = lazy(loadBody)

export function NotificationBell({
  items,
  onMarkRead,
  viewAllHref,
  settingsHref,
  emptyDescription = "New alerts and mentions appear here.",
  unreadItems,
  unreadCount,
  onOpen,
  loading,
  error,
  onRetry,
  readPending,
  workbench,
}: {
  items: BellNotification[]
  onMarkRead: (ids: string[] | "all") => void
  viewAllHref: string
  /** Where notification preferences live, linked from the footer. */
  settingsHref?: string
  /** Under "You are all caught up": what kinds of things land here. */
  emptyDescription?: string
  unreadItems?: BellNotification[]
  unreadCount?: number
  onOpen?: () => void
  loading?: boolean
  error?: string
  onRetry?: () => void
  readPending?: boolean
  workbench?: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => whenIdle(() => void loadBody()), [])
  const unread = unreadItems ?? items.filter((item) => !item.read)
  const count = unreadCount ?? unread.length
  const recent = items.slice(0, 12)

  const openItem = (item: BellNotification) => {
    setOpen(false)
    if (!item.read) {
      onMarkRead([item.id])
    }
  }

  return (
    <Popover open={open} onOpenChange={(value) => {
      setOpen(value)
      if (value) onOpen?.()
    }}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={workbench ? "通知，" + count + " 条未读" : "Notifications, " + count + " unread"} />}>
        <BellIcon />
        {count > 0 && (
          // Keyed by the count, so each new notification pops the dot again.
          <span key={count} className="absolute end-1.5 top-1.5 size-2 animate-pop rounded-full bg-primary ring-2 ring-background" aria-hidden />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
        <Suspense fallback={<div className="p-4"><InlineLoading label={workbench ? "正在打开通知…" : "Opening notifications…"} /></div>}>
          <NotificationBellBody
            recent={recent}
            unread={unread}
            count={count}
            loading={loading}
            error={error}
            onRetry={onRetry}
            readPending={readPending}
            workbench={workbench}
            onMarkRead={onMarkRead}
            openItem={openItem}
            close={() => setOpen(false)}
            viewAllHref={viewAllHref}
            settingsHref={settingsHref}
            emptyDescription={emptyDescription}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
