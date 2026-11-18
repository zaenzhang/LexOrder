"use client";

import { Button as SemiButton } from "@douyinfe/semi-ui";
import { formatDeadlineDue } from "@/lib/deadline-due";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { IconList as ClipboardList, IconRefresh as RefreshCw } from "@douyinfe/semi-icons";
import { actionErrorMessage } from "@/lib/action-error";
import { clientChannelLabels } from "@/lib/clients/relationship";
import { contextKindLabels, type MatterBrief } from "@/lib/matters/context";
import { formatDateTime } from "@/lib/utils";
import { getMatterBrief } from "@/server/matters/context-actions";

type Props = {
  matterId: string;
  refreshKey?: string | number;
  onOpenTask: (taskId: string) => void;
  getProcedureLabel: (procedureId: string) => string | undefined;
  onOpenDeadline: (procedureId: string, deadlineId: string) => void;
  onCreateTask?: () => void;
};
type ReadState = { status: "loading" } | { status: "ready"; data: MatterBrief } | { status: "error"; error: string };
const deadlineStatusLabels: Record<string, string> = { PENDING: "待确认", CONFIRMED: "已确认", ADJUSTED: "已人工调整" };

/** A server refresh can change permissions or source availability even for the same matter. */
export function MatterBriefSection(props: Props) {
  return <BriefSection key={`${props.matterId}:${props.refreshKey ?? ""}`} {...props} />;
}

function BriefSection({ matterId, onOpenTask, getProcedureLabel, onOpenDeadline, onCreateTask }: Props) {
  const titleId = useId();
  const request = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const generation = ++request.current;
    async function read() {
      try {
        const data = await getMatterBrief(matterId);
        if (data.matterId !== matterId) throw new Error("事项摘要与当前事项不一致，请重新加载");
        if (active && request.current === generation) setState({ status: "ready", data });
      } catch (error) {
        if (active && request.current === generation) {
          setState({ status: "error", error: actionErrorMessage(error) || "请稍后重试" });
        }
      }
    }
    void read();
    return () => { active = false; };
  }, [matterId, attempt]);

  function reload() {
    // Discard prior content before the next permission-checked request begins.
    request.current += 1;
    setState({ status: "loading" });
    setAttempt(value => value + 1);
  }

  return (
    <section className="dos-group" id="matter-brief" aria-labelledby={titleId} aria-busy={state.status === "loading"}>
      <div className="dos-group-h flex-wrap">
        <ClipboardList className="ic" aria-hidden="true" />
        <h2 className="t" id={titleId}>事项摘要</h2>
        <SemiButton htmlType="button" theme="outline" type="tertiary" className="a" onClick={reload} disabled={state.status === "loading"}>
          <RefreshCw size="small" aria-hidden="true" />
          {state.status === "error" ? "重试摘要" : "刷新摘要"}
        </SemiButton>
      </div>
      <div className="dos-group-b">
        {state.status === "loading" ? <p className="t-sm t-mute" role="status">正在读取事项摘要…</p> : null}
        {state.status === "error" ? <p className="t-sm text-destructive" role="alert">摘要读取失败：{state.error}</p> : null}
        {state.status === "ready" ? <BriefContent brief={state.data} onOpenTask={onOpenTask} getProcedureLabel={getProcedureLabel} onOpenDeadline={onOpenDeadline} onCreateTask={onCreateTask} /> : null}
      </div>
    </section>
  );
}

function BriefContent({ brief, onOpenTask, getProcedureLabel, onOpenDeadline, onCreateTask }: Pick<Props, "onOpenTask" | "getProcedureLabel" | "onOpenDeadline" | "onCreateTask"> & { brief: MatterBrief }) {
  const readableRecords = brief.context.records.filter(record => record.readable && record.content !== null
    && (!record.source || record.source.available) && (record.visibility !== "FINANCE" || brief.context.canReadFinance));
  const recentRecords = readableRecords.slice(0, 5);
  const hasContextRestriction = readableRecords.length < brief.context.records.length;
  const hasPending = brief.nextActions.length > 0 || brief.deadlines.length > 0 || brief.clientFollowUps.length > 0;

  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">下一步工作</h3>
          {brief.nextActions.length > 0 || brief.deadlines.length > 0 ? <Link href="/schedule" className="t-xs underline underline-offset-2">查看日程</Link> : null}
        </div>
        {!hasPending ? <div className="flex flex-wrap items-center gap-3">
          <p className="t-xs t-mute">暂无可显示的任务、期限或客户跟进。</p>
          {onCreateTask ? <SemiButton htmlType="button" size="small" theme="solid" type="primary" onClick={onCreateTask}>新建任务</SemiButton> : null}
        </div> : null}
        <div className="dossier-next-grid">
          {brief.nextActions.length > 0 ? (
            <div>
              <h4 className="mb-1 t-xs t-mute">待办任务</h4>
              <ul className="space-y-2">
                {brief.nextActions.map(task => (
                  <li key={task.id}>
                    {task.accepted === null ? <p className="break-words">{task.title}</p> : (
                      <SemiButton htmlType="button" size="small" theme="borderless" type="primary"
                        contentClassName="whitespace-normal break-words text-left" onClick={() => onOpenTask(task.id)}>
                        {task.title}
                      </SemiButton>
                    )}
                    <p className="t-xs t-mute">
                      {task.dueAt ? formatDateTime(task.dueAt) : "未设期限"} · {task.assigneeName || "未指定责任人"}
                      {task.accepted === null ? " · 责任待核实" : task.accepted ? " · 已承接" : " · 待承接"}
                    </p>
                  </li>
                ))}
              </ul>
              {brief.coverage.tasksTruncated ? <p className="mt-1 t-xs t-mute">仅显示前 10 项待办任务，其余工作请在日程查看。</p> : null}
            </div>
          ) : null}

          {brief.deadlines.length > 0 ? (
            <div>
              <h4 className="mb-1 t-xs t-mute">待处理期限</h4>
              <ul className="space-y-2">
                {brief.deadlines.map(deadline => (
                  <li key={deadline.id}>
                    <SemiButton htmlType="button" size="small" theme="borderless" type="primary"
                      contentClassName="whitespace-normal break-words text-left"
                      aria-label={[deadline.title, getProcedureLabel(deadline.procedureId)].filter(Boolean).join(" · ")}
                      onClick={() => onOpenDeadline(deadline.procedureId, deadline.id)}>
                      {deadline.title}
                    </SemiButton>
                    <p className="t-xs t-mute">
                      {getProcedureLabel(deadline.procedureId) ? `${getProcedureLabel(deadline.procedureId)} · ` : ""}{formatDeadlineDue(deadline.dueAt, deadline.duePrecision)} · {deadlineStatusLabels[deadline.confirmationStatus] || "确认状态待核实"}
                      {deadline.assigneeName ? ` · ${deadline.assigneeName}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {brief.coverage.deadlinesTruncated ? <p className="mt-1 t-xs t-mute">仅显示前 10 项期限，其余期限请在日程查看。</p> : null}
            </div>
          ) : null}

          {brief.clientFollowUps.length > 0 ? (
            <div>
              <h4 className="mb-1 t-xs t-mute">客户跟进</h4>
              <ul className="space-y-2">
                {brief.clientFollowUps.map(followUp => (
                  <li key={followUp.id}>
                    <p className="break-words">{followUp.title}</p>
                    <p className="t-xs t-mute">
                      <Link href={`/clients/${followUp.clientId}`} className="underline underline-offset-2">{followUp.clientName}</Link>
                      {` · ${formatDateTime(followUp.dueAt)} · ${followUp.assigneeName}`}
                    </p>
                  </li>
                ))}
              </ul>
              {brief.coverage.clientFollowUpsTruncated ? <p className="mt-1 t-xs t-mute">仅显示前 10 项客户跟进，其余记录请在客户详情查看。</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      {brief.serviceScope || brief.deliverables ? (
        <dl className="grid gap-x-5 gap-y-3 border-t border-[var(--semi-color-border)] pt-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="t-xs t-mute">服务范围</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{brief.serviceScope || "未登记"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="t-xs t-mute">约定成果</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{brief.deliverables || "未登记"}</dd>
          </div>
        </dl>

      ) : null}

      <div className="border-t border-[var(--semi-color-border)] pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">近期目标与指示</h3>
          <a href="#matter-context" className="t-xs underline underline-offset-2">查看目标与指示</a>
        </div>
        {recentRecords.length === 0 ? <p className="t-xs t-mute">暂无可显示的目标与指示。</p> : (
          <ul className="space-y-2.5">
            {recentRecords.map(record => (
              <li key={record.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 t-xs t-mute">
                  <span>{contextKindLabels[record.kind]}</span>
                  <span>{record.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"}</span>
                  <span>第 {record.version} 版</span>
                  <span>{formatDateTime(record.occurredAt)}</span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words">{record.content}</p>
              </li>
            ))}
          </ul>
        )}
        {hasContextRestriction ? <p className="mt-2 t-xs t-mute">部分记录当前不可读取。</p> : null}
        {readableRecords.length > 5 || brief.context.hasMore ? <p className="mt-2 t-xs t-mute">此处最多显示最近 5 条可读记录。</p> : null}
      </div>

      {brief.recentClientActivities.length > 0 ? (
        <div className="border-t border-[var(--semi-color-border)] pt-3">
          <h3 className="mb-2 font-medium">近期客户沟通</h3>
          <ul className="space-y-1.5">
            {brief.recentClientActivities.map(activity => (
              <li key={activity.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Link href={`/clients/${activity.clientId}`} className="break-words underline underline-offset-2">{activity.clientName}</Link>
                <span className="t-xs t-mute">{clientChannelLabels[activity.channel as keyof typeof clientChannelLabels] || "沟通"} · {formatDateTime(activity.occurredAt)}</span>
              </li>
            ))}
          </ul>
          {brief.coverage.clientActivitiesTruncated ? <p className="mt-1 t-xs t-mute">仅显示最近 5 次沟通，其余记录请在客户详情查看。</p> : null}
        </div>
      ) : null}
    </div>
  );
}
