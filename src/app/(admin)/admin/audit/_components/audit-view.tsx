"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button, Select, Tag } from "@douyinfe/semi-ui";
import { useState, useCallback, useTransition } from "react";
import { auditActionLabel, auditTargetLabel } from "@/lib/audit-labels";
import { useRouter } from "next/navigation";
import { IconUndo as RotateCcw } from "@douyinfe/semi-icons";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { shMonthDayTime } from "@/lib/ui/sh-time";

type AuditItem = {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  user: { id: string; name: string } | null;
};

const actionColor = {
  LOGIN: "blue",
  MATTER_CREATE: "green",
  MATTER_CLOSE: "amber",
  MATTER_ARCHIVE: "violet",
  MATTER_DELETE: "red",
  CLIENT_CREATE: "green",
  CLIENT_DELETE: "red",
  CONFLICT_CHECK_RUN: "amber",
  FEE_ENTRY_CREATE: "green",
  USER_CREATE: "green",
  USER_DEACTIVATE: "red",
  USER_PASSWORD_RESET: "amber"
} as const;

function colorFor(action: string) {
  const color = actionColor[action as keyof typeof actionColor];
  if (color) return color;
  if (action.endsWith("_CREATE") || action.endsWith("_ADD")) return "green";
  if (action.endsWith("_DELETE") || action.endsWith("_DEACTIVATE")) return "red";
  if (action.endsWith("_UPDATE") || action.endsWith("_EDIT")) return "amber";
  if (action.endsWith("_VIEW")) return "grey";
  return "blue";
}

export function AuditView({
  items,
  distinctActions,
  userOptions,
  initialFilters
}: {
  items: AuditItem[];
  distinctActions: string[];
  userOptions: { id: string; name: string }[];
  initialFilters: { action: string; userId: string; days: string };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [action, setAction] = useState(initialFilters.action);
  const [userId, setUserId] = useState(initialFilters.userId);
  const [days, setDays] = useState(initialFilters.days);

  const updateUrl = useCallback(
    (next: Partial<{ action: string; userId: string; days: string }>) => {
      const params = new URLSearchParams();
      const a = next.action ?? action;
      const u = next.userId ?? userId;
      const d = next.days ?? days;
      if (a && a !== "ALL") params.set("action", a);
      if (u && u !== "ALL") params.set("userId", u);
      if (d && d !== "30") params.set("days", d);
      startTransition(() => {
        router.replace(`/admin/audit${params.toString() ? `?${params.toString()}` : ""}`);
      });
    },
    [router, action, userId, days]
  );

  function reset() {
    setAction("ALL");
    setUserId("ALL");
    setDays("30");
    startTransition(() => router.replace("/admin/audit"));
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="审计日志" sub={<>当前筛选下 <b>{items.length}</b> 条 · 敏感操作（明文查看、导出、权限变更）均在此留痕，不可删除</>} />

      <div className="flex flex-wrap items-center gap-3 card p-3">
        <Select<string> insetLabel="动作" insetLabelId="audit-action-label" aria-labelledby="audit-action-label" className="w-44" motion={false}
          value={action}
          onChange={(v) => {
            const nextAction = String(v);
            setAction(nextAction);
            updateUrl({ action: nextAction });
          }}
        >
            <Select.Option value="ALL">全部动作</Select.Option>
            {distinctActions.map((a) => (
              <Select.Option key={a} value={a}>
                {auditActionLabel(a)}
              </Select.Option>
            ))}
          </Select>

        <Select<string> insetLabel="用户" insetLabelId="audit-user-label" aria-labelledby="audit-user-label" className="w-44" filter motion={false}
          value={userId}
          onChange={(v) => {
            const nextUser = String(v);
            setUserId(nextUser);
            updateUrl({ userId: nextUser });
          }}
        >
            <Select.Option value="ALL">全部用户</Select.Option>
            {userOptions.map((u) => (
              <Select.Option key={u.id} value={u.id}>
                {u.name}
              </Select.Option>
            ))}
          </Select>

        <Select<string> insetLabel="期间" insetLabelId="audit-period-label" aria-labelledby="audit-period-label" className="w-36" motion={false}
          value={days}
          onChange={(v) => {
            const nextDays = String(v);
            setDays(nextDays);
            updateUrl({ days: nextDays });
          }}
        >
            <Select.Option value="7">近 7 天</Select.Option>
            <Select.Option value="30">近 30 天</Select.Option>
            <Select.Option value="90">近 90 天</Select.Option>
            <Select.Option value="365">近 1 年</Select.Option>
          </Select>

        {(action !== "ALL" || userId !== "ALL" || days !== "30") && (
          <Button theme="borderless" type="tertiary" size="small" onClick={reset} className="gap-1">
            <RotateCcw aria-hidden size="small" />
            重置
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">没有匹配的审计记录</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const color = colorFor(it.action);
            return (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-2.5"
              >
                <div className="flex-1 overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag color={color}>
                      {auditActionLabel(it.action)}
                    </Tag>
                    {it.targetType && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {auditTargetLabel(it.targetType)}
                      </span>
                    )}
                    {it.targetId && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {it.targetId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <Disclosure className="mt-1 text-xs text-muted-foreground" heading="技术详情">
                    <pre className="mt-1 max-h-48 overflow-auto font-mono text-xs">
                      {JSON.stringify({ action: it.action, targetType: it.targetType, detail: it.detail }, null, 2)}
                    </pre>
                  </Disclosure>
                </div>
                <div className="text-right text-xs">
                  <div>{it.user?.name ?? "—"}</div>
                  <div className="font-mono text-xs text-muted-foreground tabular">
                    {shMonthDayTime(it.createdAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
