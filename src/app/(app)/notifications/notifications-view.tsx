"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { markAllNotificationsRead, type getNotifications } from "@/server/notifications/actions";
import { Button, Tag } from "@douyinfe/semi-ui";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/patterns/moan";
import { shMonthDayTime } from "@/lib/ui/sh-time";

const typeLabels: Record<string, string> = {
  PRESERVATION_EXPIRY: "保全到期",
  HEARING_REMINDER: "庭审",
  DEADLINE_REMINDER: "期限",
  SEAL_STATUS_CHANGE: "用章",
  SMS_ARRIVAL: "短信",
  TASK_ASSIGNED: "系统",
  SYSTEM: "系统",
  ARCHIVE_APPROVED: "归档",
  ARCHIVE_REJECTED: "归档"
};

const priorityClass: Record<string, string> = {
  URGENT: "text-[var(--red)]",
  HIGH: "text-[var(--amber)]",
  NORMAL: "text-foreground",
  LOW: "text-muted-foreground"
};

export function NotificationsView({ notifications: initialNotifications }: {
  notifications: Awaited<ReturnType<typeof getNotifications>>;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => { setNotifications(initialNotifications); }, [initialNotifications]);
  const unreadCount = notifications.filter(item => !item.read).length;

  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await markAllNotificationsRead();
      setNotifications(previous => previous.map(item => ({ ...item, read: true, readAt: new Date() })));
      router.refresh();
    } catch {
      setError("全部标记已读失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        className="!mb-0"
        title="通知"
        sub={<>系统提醒、用章、期限和庭审通知{unreadCount > 0 ? <> · 未读 <b>{unreadCount}</b> 条</> : null}</>}
        actions={
          unreadCount > 0 ? (
            <Button htmlType="button" type="secondary" size="small" loading={busy} disabled={busy} icon={<CheckCheck size={16} />} onClick={() => void markAllRead()}>全部已读</Button>
          ) : null
        }
      />

      {error ? <p role="alert" className="text-sm text-[var(--semi-color-danger)]">{error}</p> : null}
      <div className="ll-surface overflow-hidden rounded-lg">
        {notifications.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-6 w-6 opacity-40" />
            暂无通知
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => {
              const row = (
                <div
                  className={cn(
                    "flex min-w-0 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60",
                    !n.read && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      n.read ? "bg-muted" : "bg-primary"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Tag size="small">{typeLabels[n.type] ?? "其他"}</Tag>
                      <span
                        className={cn(
                          "min-w-0 truncate text-[13px]",
                          !n.read && "font-medium",
                          priorityClass[n.priority] ?? "text-foreground"
                        )}
                      >
                        {n.title}
                      </span>
                    </div>
                    {n.content && (
                      <p className="mt-1 truncate text-[12px] text-muted-foreground">
                        {n.content}
                      </p>
                    )}
                  </div>
                  <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatTime(n.createdAt)}
                  </time>
                </div>
              );

              return n.href ? (
                <Link key={n.id} href={n.href} className="block">
                  {row}
                </Link>
              ) : (
                <div key={n.id}>{row}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date | string) {
  return shMonthDayTime(date);
}
