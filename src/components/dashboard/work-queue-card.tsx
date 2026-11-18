"use client";

/** 墨案 02「待我处理」：审批 / 任务 / 提醒 分段（提醒=保全到期与法院短信，原工作台告警不丢失） */
import { useState } from "react";
import Link from "next/link";
import type { ApprovalAction } from "@prisma/client";
import { AlertTriangle, ListChecks, SquareCheck, Stamp, CalendarClock } from "lucide-react";
import { ACTION_LABELS } from "@/lib/approvals/rules";
import { approvalHref } from "@/lib/approvals/workspace";
import { matterHref } from "@/lib/matters/route";
import { cn, formatDateTime } from "@/lib/utils";
import { taskProgressLabels } from "@/lib/tasks/workflow";
import { Card, Empty, Tabs, Tag } from "@douyinfe/semi-ui";
import type { WorkQueue } from "@/server/dashboard/actions";
import type { AlertItem } from "./alerts-list";
import { shParts } from "@/lib/ui/sh-time";
import { personalFollowUpHref } from "@/lib/clients/follow-ups";

type Seg = "approvals" | "tasks" | "followups" | "alerts";

export function WorkQueueCard({ queue, alerts }: { queue: WorkQueue; alerts: AlertItem[] }) {
  const reminders = alerts.filter((a) => a.source !== "approval");
  const [seg, setSeg] = useState<Seg>(queue.approvalTotal > 0 ? "approvals" : queue.taskTotal > 0 ? "tasks" : queue.followUps.total > 0 ? "followups" : reminders.length > 0 ? "alerts" : "approvals");
  const items: [Seg, string, number][] = [
    ["approvals", "审批", queue.approvalTotal],
    ["tasks", "任务", queue.taskTotal],
    ["followups", "跟进", queue.followUps.total],
    ["alerts", "提醒", reminders.length]
  ];
  const fmt = (d: Date | null) => (d ? `${shParts(d).m}月${shParts(d).d}日` : "");

  return (
    <Card title={<h2 className="flex items-center gap-2"><SquareCheck size={16} aria-hidden />待我处理</h2>}>
      <Tabs
        type="button"
        size="small"
        activeKey={seg}
        onChange={(key) => setSeg(key as Seg)}
        tabPaneMotion={false}
        tabList={items.map(([key, label, count]) => ({
          itemKey: key,
          tab: `${label} ${(key === "tasks" && !queue.tasksAvailable) || (key === "followups" && !queue.followUps.available) ? "—" : count}`
        }))}
        tabBarStyle={{ marginBottom: 8 }}
      >
        {seg === "approvals" ? (
          queue.approvals.length === 0 ? (
            <Empty description="暂无待你审批的申请" />
          ) : (
            queue.approvals.map((a) => {
              const urgent = a.waitDays !== null && a.waitDays >= 2;
              return (
                <Link key={a.action + a.id} href={approvalHref(a.action as ApprovalAction, a.id)} className="flex items-start gap-3 rounded px-2 py-3 hover:bg-[var(--semi-color-fill-0)]">
                  <span className={cn("type-ic", urgent ? "t-red" : "t-bronze")} aria-hidden>
                    <Stamp strokeWidth={2} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="textext-sm font-medium truncate">{ACTION_LABELS[a.action as ApprovalAction]} · {a.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--semi-color-text-2)]">
                      <span>申请人 {a.requester}</span>
                      {a.matter ? (<><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--semi-color-text-2)]" /><span className="truncate">{a.matter}</span></>) : null}
                      <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--semi-color-text-2)]" />
                      <span>{a.task === "issue" ? "待开票" : a.task === "stamp" ? "待盖章回填" : "待审批"}</span>
                    </div>
                  </div>
                  <Tag color={urgent ? "red" : "grey"}>{a.waitDays === null ? "提交时间未记录" : a.waitDays > 0 ? `等待 ${a.waitDays} 天` : "今日"}</Tag>
                </Link>
              );
            })
          )
        ) : null}

        {seg === "tasks" ? (
          !queue.tasksAvailable ? (
            <Empty description="当前资格不能读取任务详情" />
          ) : queue.tasks.length === 0 ? (
            <Empty description="暂无指派给你的未完成任务" />
          ) : (
            queue.tasks.map((t) => (
              <Link key={t.id} href={matterHref({ internalCode: t.matterCode }, `?view=work&workPane=tasks${t.hasResponsibility ? `&task=${encodeURIComponent(t.id)}` : ""}`)} className="flex items-start gap-3 rounded px-2 py-3 hover:bg-[var(--semi-color-fill-0)]">
                <span className={cn("type-ic", t.overdue ? "t-red" : "t-teal")} aria-hidden>
                  <ListChecks strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="textext-sm font-medium truncate">{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--semi-color-text-2)]">
                    <span className="code">{t.matterCode}</span>
                    <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--semi-color-text-2)]" />
                    <span className="truncate">{t.matterTitle}</span>
                    {t.dueAt ? (<><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--semi-color-text-2)]" /><span>{fmt(t.dueAt)} 截止</span></>) : null}
                    {t.priority >= 2 ? (<><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[var(--semi-color-text-2)]" /><span>紧急</span></>) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {taskProgressLabels(t.progress).map(label => <Tag key={label} color="grey" style={{ height: "auto", whiteSpace: "normal" }}>{label}</Tag>)}
                  </div>
                  {t.progress.availability === "AVAILABLE" && t.progress.waiting ? <div className="mt-1 text-xs text-muted-foreground"><p className="line-clamp-2 break-words">待收成果：{t.progress.waiting.expectedResult}</p><p>检查时点：{formatDateTime(t.progress.waiting.nextCheckAt)}</p></div> : null}
                  {!t.hasResponsibility ? <div className="mt-1 text-xs text-muted-foreground">查看案内原任务记录</div> : null}
                </div>
                <Tag color={t.overdue ? "red" : t.priority >= 2 ? "orange" : "grey"}>{t.overdue ? "已逾期" : t.dueAt ? fmt(t.dueAt) : "无期限"}</Tag>
              </Link>
            ))
          )
        ) : null}

        {seg === "followups" && (!queue.followUps.available ? <p className="p-4 textext-sm text-muted-foreground">当前资格不能读取客户跟进</p>
          : queue.followUps.items.length === 0 ? <p className="p-4 textext-sm text-muted-foreground">暂无本人待跟进</p>
          : queue.followUps.items.map(item => <Link key={item.id} href={personalFollowUpHref({}, { followUpId: item.id, clientId: item.client.id })} className="flex items-start gap-3 rounded px-2 py-3 hover:bg-[var(--semi-color-fill-0)]">
            <span className={cn("type-ic", item.overdue ? "t-red" : "t-teal")} aria-hidden><CalendarClock /></span>
            <div className="min-w-0 flex-1"><div className="textext-sm font-medium truncate">{item.title}</div><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--semi-color-text-2)]"><span>{item.client.name}</span><span>{formatDateTime(item.dueAt)}</span></div></div>
            <Tag color={item.overdue ? "red" : "grey"}>{item.overdue ? "已逾期" : "待跟进"}</Tag>
          </Link>))}
        {seg === "alerts" ? (
          reminders.length === 0 ? (
            <Empty description="暂无保全到期与法院短信提醒" />
          ) : (
            reminders.map((a) => (
              <Link key={a.id} href={a.href} className="flex items-start gap-3 rounded px-2 py-3 hover:bg-[var(--semi-color-fill-0)]">
                <span className={cn("type-ic", a.tone === "danger" ? "t-red" : a.tone === "warn" ? "t-amber" : "t-slate")} aria-hidden>
                  <AlertTriangle strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="textext-sm font-medium truncate">{a.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--semi-color-text-2)]"><span className="truncate">{a.detail}</span></div>
                </div>
                <Tag color={a.tone === "danger" ? "red" : a.tone === "warn" ? "orange" : "grey"}>{a.source === "sms" ? "法院短信" : "保全"}</Tag>
              </Link>
            ))
          )
        ) : null}
      </Tabs>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--semi-color-border)] pt-3">
        <span className="text-xs text-[var(--semi-color-text-2)]">
          {seg === "approvals" ? `共 ${queue.approvalTotal} 件审批${queue.tasksAvailable ? ` · ${queue.taskTotal} 项任务` : ""}` : seg === "tasks" ? queue.tasksAvailable ? `本人共 ${queue.taskTotal} 项任务，逾期任务优先` : "任务详情当前不可读取" : seg === "followups" ? queue.followUps.available ? `本人共 ${queue.followUps.total} 项待跟进，按时间先后显示前五项` : "客户跟进当前不可读取" : "保全到期 · 法院短信"}
        </span>
        <Link href={seg === "approvals" ? "/approvals" : seg === "tasks" ? "/schedule#work-responsibilities" : seg === "followups" ? "/clients/follow-ups" : "/inbox"} className="text-sm" style={{ color: "var(--semi-color-primary)", fontWeight: 550 }}>
          {seg === "approvals" ? "进入审批工作台 →" : seg === "tasks" ? "打开任务责任总览 →" : seg === "followups" ? "查看全部待跟进 →" : "进入法院短信 →"}
        </Link>
      </div>
    </Card>
  );
}
