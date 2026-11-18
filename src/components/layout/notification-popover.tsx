"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell } from "lucide-react";
import { Badge, Button, Popover, Spin, Tag } from "@douyinfe/semi-ui";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/server/notifications/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";

const typeIcons: Record<string, string> = {
  PRESERVATION_EXPIRY: "🛡️",
  HEARING_REMINDER: "⚖️",
  DEADLINE_REMINDER: "⏰",
  SEAL_STATUS_CHANGE: "🔖",
  SMS_ARRIVAL: "📩",
  TASK_ASSIGNED: "🔔",
  SYSTEM: "🔔",
  ARCHIVE_APPROVED: "📦",
  ARCHIVE_REJECTED: "📦",
};

const typeLabels: Record<string, string> = {
  PRESERVATION_EXPIRY: "保全到期",
  HEARING_REMINDER: "庭审",
  DEADLINE_REMINDER: "期限",
  SEAL_STATUS_CHANGE: "用章",
  SMS_ARRIVAL: "短信",
  TASK_ASSIGNED: "系统",
  SYSTEM: "系统",
  ARCHIVE_APPROVED: "归档",
  ARCHIVE_REJECTED: "归档",
};

const priorityColors: Record<string, string> = {
  URGENT: "var(--semi-color-danger)",
  HIGH: "var(--semi-color-warning)",
  NORMAL: "var(--semi-color-text-0)",
  LOW: "var(--semi-color-text-2)",
};

export function NotificationPopover() {
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof getNotifications>>>([]);
  const [open, setOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const mutating = useRef(false);
  const router = useRouter();

  // 已弹过桌面通知的 id（含挂载时已存在的，避免刷新页面就刷屏）
  const seenIds = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  // 轮询：刷新未读数 + 对新到的未读通知弹浏览器桌面通知
  const poll = useCallback(async () => {
    if (mutating.current) return;
    const serial = ++request.current;
    setLoading(true);
    try {
      const [count, list] = await Promise.all([
        getUnreadCount(),
        getNotifications({ limit: 20 })
      ]);
      if (serial !== request.current) return;
      setUnread(count);
      setNotifications(list);
      setLoadError("");
      setTypeFilter(previous => previous && list.some(item => item.type === previous) ? previous : null);

      const unreadList = list.filter((n) => !n.read);
      if (!seededRef.current) {
        // 首次轮询：只记录现有 id，不弹（否则每次进站都炸一堆系统通知）
        unreadList.forEach((n) => seenIds.current.add(n.id));
        seededRef.current = true;
        return;
      }
      const canNotify =
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted";
      for (const n of unreadList) {
        if (seenIds.current.has(n.id)) continue;
        seenIds.current.add(n.id);
        if (canNotify) {
          const notif = new Notification(n.title, {
            body: n.content ?? undefined,
            tag: n.id,
            icon: "/favicon.ico"
          });
          if (n.href) {
            notif.onclick = () => {
              window.focus();
              router.push(n.href as string);
              notif.close();
            };
          }
        }
      }
    } catch {
      if (serial !== request.current) return;
      setNotifications([]);
      setLoadError("通知读取失败，请重试。");
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // 请求桌面通知授权（用户可拒绝；拒绝后仅站内铃铛生效）
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    poll();
    const timer = setInterval(poll, 60_000);
    return () => { clearInterval(timer); request.current += 1; };
  }, [poll]);

  function handleOpen(visible: boolean) {
    setOpen(visible);
    if (visible) void poll();
  }

  async function handleMarkRead(notification: (typeof notifications)[number]) {
    if (mutating.current) return;
    setActionError("");
    if (!notification.read) {
      mutating.current = true;
      request.current += 1;
      setLoading(false);
      setBusy(true);
      try {
        const saved = await markNotificationRead(notification.id);
        setUnread(previous => Math.max(0, previous - 1));
        setNotifications(previous => previous.map(item => item.id === saved.id ? { ...item, read: true, readAt: saved.readAt } : item));
      } catch {
        setActionError("标记已读失败，请重试。");
        return;
      } finally {
        mutating.current = false;
        setBusy(false);
      }
    }
    if (notification.href) {
      setOpen(false);
      router.push(notification.href);
    }
  }

  async function handleMarkAllRead() {
    if (mutating.current) return;
    mutating.current = true;
    request.current += 1;
    setLoading(false);
    setBusy(true);
    setActionError("");
    try {
      await markAllNotificationsRead();
      setUnread(0);
      setNotifications(previous => previous.map(item => ({ ...item, read: true, readAt: new Date() })));
    } catch {
      setActionError("全部标记已读失败，请重试。");
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }

  const presentTypes = Array.from(new Set(notifications.map(item => item.type)));
  const list = typeFilter ? notifications.filter(item => item.type === typeFilter) : notifications;

  return <Popover trigger="click" visible={open} onVisibleChange={handleOpen} onEscKeyDown={() => setOpen(false)}
    position="bottomRight" motion={false} content={
      <section aria-label="通知列表" className="w-80">
        <div className="flex items-center justify-between gap-2 p-3">
          <span className="font-medium">通知</span>
          {unread > 0 ? <Button size="small" theme="borderless" disabled={busy || loading || Boolean(loadError)} onClick={() => void handleMarkAllRead()}>全部已读</Button> : null}
        </div>
        {presentTypes.length > 1 ? <div className="flex flex-wrap gap-1 px-3 pb-2" role="group" aria-label="通知类型">
          <Button size="small" theme={typeFilter === null ? "light" : "borderless"} aria-pressed={typeFilter === null} onClick={() => setTypeFilter(null)}>全部</Button>
          {presentTypes.map(type => <Button key={type} size="small" theme={typeFilter === type ? "light" : "borderless"}
            aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type === typeFilter ? null : type)}>{typeLabels[type] ?? "其他"}</Button>)}
        </div> : null}
        {actionError ? <p role="alert" className="px-3 pb-2 text-sm text-[var(--semi-color-danger)]">{actionError}</p> : null}
        <div className="max-h-80 overflow-y-auto">
          {loading ? <div role="status" className="p-3"><Spin size="small" /> 正在读取通知…</div> : null}
          {loadError ? <div role="alert" className="p-3 text-sm">{loadError}<Button size="small" theme="borderless" disabled={loading} onClick={() => void poll()}>重试读取</Button></div> : !loading && list.length === 0 ?
            <p className="p-6 text-center text-sm text-[var(--semi-color-text-2)]">{typeFilter ? `没有「${typeLabels[typeFilter] ?? "其他"}」类通知` : "暂无通知"}</p> : null}
          {!loadError ? list.map(notification => <div key={notification.id} className="px-2 pb-1">
            <Button htmlType="button" block theme="borderless" type="tertiary" disabled={busy} style={{ height: "auto", padding: 10, textAlign: "left" }}
              onClick={() => void handleMarkRead(notification)}>
              <span className="flex w-full items-start gap-2">
                <span aria-hidden>{typeIcons[notification.type] ?? "🔔"}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 whitespace-normal break-words">
                  <span style={{ color: priorityColors[notification.priority], fontWeight: notification.read ? 400 : 600 }}>{notification.title}</span>
                  {notification.content ? <span className="text-xs text-[var(--semi-color-text-2)]">{notification.content}</span> : null}
                  <span className="text-xs text-[var(--semi-color-text-2)]">{formatTime(notification.createdAt)}</span>
                </span>
                {!notification.read ? <Tag color="blue" size="small">未读</Tag> : null}
              </span>
            </Button>
          </div>) : null}
        </div>
        <div className="p-3 text-right">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-sm text-[var(--semi-color-primary)]">查看全部通知</Link>
        </div>
      </section>
    }>
    <Button htmlType="button" theme="light" type="tertiary" aria-label={loadError ? "通知（读取失败）" : unread > 0 ? `通知（${unread} 条未读）` : "通知"}
      icon={unread > 0 ? <Badge dot><Bell size={18} /></Badge> : <Bell size={18} />} />
  </Popover>;
}

function formatTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" });
}
