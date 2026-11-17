"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { getClientHistoryPage } from "@/server/clients/history-actions";
import { clientHistoryLocationSchema, historySourceLabels, type ClientHistoryPage } from "@/lib/clients/history";
import { clientHistoryHref } from "@/lib/clients/navigation";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { ClientPagination, useClientPagination } from "./client-pagination";

export function ClientHistoryPanel({ clientId, initial, initialCursor = null, initialError = "", rowId, returnTo }: {
  clientId: string; initial: ClientHistoryPage | null; initialCursor?: string | null; initialError?: string; rowId?: string; returnTo?: unknown;
}) {
  const controls = useClientPagination(clientId, initial, getClientHistoryPage, { initialCursor, initialError });
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const cursorValues = searchParams.getAll("historyCursor"), rowValues = searchParams.getAll("rowId");
  const location = clientHistoryLocationSchema.safeParse({
    historyCursor: cursorValues.length > 1 ? cursorValues : cursorValues[0],
    rowId: rowValues.length > 1 ? rowValues : rowValues[0],
  });
  const locationValid = location.success;
  const requestedCursor = location.success ? location.data.historyCursor ?? null : null;
  const requestedRowId = location.success ? location.data.rowId : undefined;
  const serverPayload = useMemo(() => ({ initial, initialCursor, initialError, rowId }), [initial, initialCursor, initialError, rowId]);
  const consumedPayload = useRef<typeof serverPayload | null>(null);
  const { goTo } = controls;
  useEffect(() => {
    const alreadyUsed = consumedPayload.current === serverPayload;
    consumedPayload.current = serverPayload;
    if (!locationValid) return;
    if (!alreadyUsed && requestedCursor === initialCursor && requestedRowId === rowId) return;
    // Native history can restore URL positions with an older cached Server payload.
    goTo(requestedCursor);
  }, [serverPayload, initialCursor, rowId, requestedCursor, requestedRowId, locationValid, goTo]);
  const selectedRow = useRef<HTMLElement>(null);
  const locatedRowId = locationValid && controls.cursor === requestedCursor ? requestedRowId : undefined;
  useEffect(() => {
    if (!locatedRowId || !controls.page || tab !== "history") return;
    const frame = requestAnimationFrame(() => {
      const row = selectedRow.current;
      if (!row || row.closest("[hidden], [inert]")) return;
      row.scrollIntoView({ block: "center" });
      row.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [locatedRowId, controls.page, tab]);
  if (!locationValid) return <section className="card p-4 space-y-3"><p role="alert" className="text-sm text-destructive">客户动态位置无效，请重新打开客户动态</p>
    <Link className="btn btn-secondary btn-sm" href={clientHistoryHref(clientId, { returnTo })}>查看最新客户动态</Link></section>;
  return <section className="card min-w-0" aria-labelledby="client-history-title" aria-busy={controls.pending}>
    <div className="panel-head"><h2 id="client-history-title" className="panel-title" style={{ fontSize: 13 }}>客户动态</h2></div>
    <div className="panel-body space-y-3">
      {controls.page?.items.length === 0 ? <p className="t-xs t-mute">{controls.page.nextCursor ? "本页没有可显示的动态，可继续查看。" : "本页暂无动态。"}</p> : null}
      {locatedRowId && controls.page && !controls.page.items.some(item => item.key === locatedRowId)
        ? <p role="status" className="text-sm text-muted-foreground">原动态已不在当前可读页中，请重新核对；未替换为其他记录。</p> : null}
      {controls.page?.items.map(item => {
        const back = item.source === "CONTEXT" ? clientHistoryHref(clientId, { cursor: controls.cursor, rowId: item.key, returnTo }) : null;
        const href = back ? `${item.href}${item.href.includes("?") ? "&" : "?"}${new URLSearchParams({ contextReturnTo: back })}` : item.href;
        return <article key={item.key} ref={item.key === locatedRowId ? selectedRow : undefined} tabIndex={item.key === locatedRowId ? -1 : undefined}
          className="border-l-2 border-[var(--bd-hair)] pl-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--t-muted)]"><span>{historySourceLabels[item.source]}</span>
          <time dateTime={item.at}>{shDayKey(item.at)} {shTime(item.at)}</time></div>
        <h3 className="mt-1 break-words text-sm font-medium">{item.title}</h3>
        <p className="mt-1 break-words text-xs text-[var(--t-muted)]">{item.meta}</p>
        {item.content ? <details className="mt-2 text-sm"><summary className="cursor-pointer text-[var(--teal-deep)]">查看记录内容</summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{item.content}</p>
          <p className="mt-1 text-xs text-[var(--t-muted)]">记录于 {shDayKey(item.recordedAt)} {shTime(item.recordedAt)}</p>
        </details> : null}
        <Link href={href} onNavigate={back ? () => window.history.replaceState(null, "", back) : undefined}
          className="mt-1 inline-block text-xs text-[var(--teal-deep)]">{item.linkLabel} →</Link>
      </article>;
      })}
      <ClientPagination controls={controls} label="客户动态" />
    </div>
  </section>;
}
