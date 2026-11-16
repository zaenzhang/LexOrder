"use client";

import Link from "next/link";
import { getClientHistoryPage } from "@/server/clients/history-actions";
import { historySourceLabels, type ClientHistoryPage } from "@/lib/clients/history";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { ClientPagination, useClientPagination } from "./client-pagination";

export function ClientHistoryPanel({ clientId, initial }: { clientId: string; initial: ClientHistoryPage }) {
  const controls = useClientPagination(clientId, initial, getClientHistoryPage);
  return <section className="card min-w-0" aria-labelledby="client-history-title" aria-busy={controls.pending}>
    <div className="panel-head"><h2 id="client-history-title" className="panel-title" style={{ fontSize: 13 }}>客户动态</h2></div>
    <div className="panel-body space-y-3">
      {controls.page?.items.length === 0 ? <p className="t-xs t-mute">{controls.page.nextCursor ? "本页没有可显示的动态，可继续查看。" : "本页暂无动态。"}</p> : null}
      {controls.page?.items.map(item => <article key={item.key} className="border-l-2 border-[var(--bd-hair)] pl-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--t-muted)]"><span>{historySourceLabels[item.source]}</span>
          <time dateTime={item.at}>{shDayKey(item.at)} {shTime(item.at)}</time></div>
        <h3 className="mt-1 break-words text-sm font-medium">{item.title}</h3>
        <p className="mt-1 break-words text-xs text-[var(--t-muted)]">{item.meta}</p>
        {item.content ? <details className="mt-2 text-sm"><summary className="cursor-pointer text-[var(--teal-deep)]">查看记录内容</summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{item.content}</p>
          <p className="mt-1 text-xs text-[var(--t-muted)]">记录于 {shDayKey(item.recordedAt)} {shTime(item.recordedAt)}</p>
        </details> : null}
        <Link href={item.href} className="mt-1 inline-block text-xs text-[var(--teal-deep)]">{item.linkLabel} →</Link>
      </article>)}
      <ClientPagination controls={controls} label="客户动态" />
    </div>
  </section>;
}
