"use client";

import { Button } from "@douyinfe/semi-ui";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, MessageSquare, Plus, X } from "lucide-react";
import { clientChannelLabels, type ClientRelationshipView, type ClientCommunicationPage, type ClientFollowUpPage } from "@/lib/clients/relationship";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { getClientCommunicationPage, getClientFollowUpPage } from "@/server/clients/relationship-actions";
import { ClientPagination, useClientPagination } from "./client-pagination";
import { ClientActivityDialog, type ClientActivityMode } from "@/components/clients/client-activity-dialog";

const when = (value: string) => `${shDayKey(value)} ${shTime(value)}`;


export function ClientRelationshipPanel({ clientId, view }: { clientId: string; view: ClientRelationshipView | null }) {
  const router = useRouter();
  const activityInitial = useMemo<ClientCommunicationPage>(() => ({ items: view?.activities ?? [], nextCursor: view?.activityNextCursor ?? null, total: view?.activityCount ?? 0, canWrite: view?.canWrite ?? false }), [view]);
  const followUpInitial = useMemo<ClientFollowUpPage>(() => ({ items: view?.followUps ?? [], nextCursor: view?.followUpNextCursor ?? null, total: view?.openCount ?? 0, canWrite: view?.canWrite ?? false }), [view]);
  const activityPager = useClientPagination(clientId, activityInitial, getClientCommunicationPage);
  const followUpPager = useClientPagination(clientId, followUpInitial, getClientFollowUpPage);
  const activities = activityPager.page;
  const followUps = followUpPager.page;
  const [mode, setMode] = useState<ClientActivityMode | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const sectionTitle = useRef<HTMLHeadingElement>(null);
  function begin(nextMode: ClientActivityMode, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    setMode(nextMode);
  }
  function saved() {
    setMode(null);
    activityPager.invalidate();
    followUpPager.invalidate();
    router.refresh();
  }

  return (
    <section className="card min-w-0 overflow-hidden" aria-labelledby="client-relationship-title">
      <div className="panel-head flex-wrap gap-2">
        <h2 ref={sectionTitle} tabIndex={-1} id="client-relationship-title" className="panel-title"><MessageSquare className="ic" strokeWidth={1.8} />沟通与跟进</h2>
        {view?.canWrite && activities?.canWrite && followUps?.canWrite ? <Button htmlType="button" theme="outline" type="tertiary" size="small" icon={<Plus size={14} />} onClick={event => begin({ status: "COMPLETED" }, event.currentTarget)}>记录沟通</Button> : null}
      </div>
      {!view ? <div className="panel-body t-sm t-mute">沟通记录仅向客户经办人员及获授权的管理人员开放。</div> : (
        <div className="panel-body grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4" />待跟进 {followUps ? <span className="badge b-white">{followUps.total}</span> : null}</h3>
            {followUps?.items.length === 0 ? <p className="t-sm t-mute py-2">本页暂无待跟进。</p> : <ul className="space-y-2">
              {followUps?.items.map(item => <li key={item.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-[var(--bd-hair)] p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--t-muted)]">
                    <time dateTime={item.dueAt}>{when(item.dueAt)}</time><span>· {item.assigneeName}</span>
                    {item.overdue ? <span className="badge b-amber">已逾期</span> : null}
                  </div>
                </div>
                {item.canClose ? <div className="flex flex-wrap gap-1">
                  <Button htmlType="button" theme="outline" type="tertiary" size="small" icon={<Check size={14} />} aria-label={`录入结果：${item.title}`} onClick={event => begin({ id: item.id, title: item.title, status: "COMPLETED" }, event.currentTarget)}>录入结果</Button>
                  <Button htmlType="button" theme="borderless" type="tertiary" size="small" icon={<X size={14} />} aria-label={`取消跟进：${item.title}`} onClick={event => begin({ id: item.id, title: item.title, status: "CANCELLED" }, event.currentTarget)}>取消</Button>
                </div> : null}
              </li>)}
            </ul>}
            <ClientPagination controls={followUpPager} label="待跟进" />
          </div>
          <div className="min-w-0 border-t border-[var(--bd-hair)] pt-4 lg:border-t-0 lg:pt-0">
            <h3 className="mb-3 text-sm font-medium">沟通历史 {activities ? <span className="t-xs t-mute">{activities.total} 条</span> : null}</h3>
            {activities?.items.length === 0 ? <p className="t-sm t-mute">本页暂无沟通记录。</p> : <ol className="space-y-4">
              {activities?.items.map(item => <li key={item.id} className="border-l-2 border-[var(--bd-hair)] pl-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--t-muted)]"><span className="badge b-white">{clientChannelLabels[item.channel]}</span><span>{item.authorName}</span><time dateTime={item.occurredAt}>{when(item.occurredAt)}</time></div>
                {item.closedTitle ? <p className="mb-1 text-xs font-medium text-[var(--teal-deep)]">{item.closedStatus === "CANCELLED" ? "已取消" : "已完成"}：{item.closedTitle}</p> : null}
                <CommunicationContent activityId={item.id} content={item.content} />
              </li>)}
            </ol>}
            <ClientPagination controls={activityPager} label="沟通历史" />
          </div>
          <p className="t-xs t-mute lg:col-span-2">时间均为北京时间。到期状态在打开页面时更新。</p>
        </div>
      )}
      {mode && <ClientActivityDialog clientId={clientId} mode={mode} trigger={editorTrigger} fallback={sectionTitle}
        onClose={() => setMode(null)} onSaved={saved} />}
    </section>
  );
}

function CommunicationContent({ activityId, content }: { activityId: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 120 || content.split("\n").length > 4;
  const contentId = `client-communication-${activityId}`;
  return <div>
    <p id={contentId} className={`whitespace-pre-wrap break-words text-sm leading-relaxed${isLong && !expanded ? " line-clamp-4" : ""}`}>{content}</p>
    {isLong ? <Button
      htmlType="button"
      theme="borderless" noHorizontalPadding
      size="small"
      className="mt-0.5"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => setExpanded(value => !value)}
    >{expanded ? "收起" : "展开全文"}</Button> : null}
  </div>;
}
