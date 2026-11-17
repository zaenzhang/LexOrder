"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getClientHistoryPage } from "@/server/clients/history-actions";
import { clientHistoryFiltersKey, clientHistoryLocationSchema, historySourceLabels, type ClientHistoryFilters, type ClientHistoryPage, type ClientPageInput } from "@/lib/clients/history";
import { clientHistoryHref } from "@/lib/clients/navigation";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { ClientPagination, useClientPagination } from "./client-pagination";
import { ClientHistoryFilters as HistoryFilters } from "./client-history-filters";

type PanelProps = {
  clientId: string; initial: ClientHistoryPage | null; initialCursor?: string | null; initialError?: string; rowId?: string; returnTo?: unknown;
  initialFilters?: ClientHistoryFilters;
};
type HistoryStatus = { selectedMatter: ClientHistoryPage["selectedMatter"]; loading: boolean; failed: boolean };
export function ClientHistoryPanel(props: PanelProps) {
  const { clientId, returnTo } = props;
  const searchParams = useSearchParams();
  const location = clientHistoryLocationSchema.safeParse(Object.fromEntries([...searchParams.keys()].map(key => {
    const values = searchParams.getAll(key);
    return [key, values.length > 1 ? values : values[0]];
  })));
  const filterKey = location.success ? clientHistoryFiltersKey(location.data.filters) : "invalid";
  const initialFilterKey = clientHistoryFiltersKey(props.initialFilters ?? {});
  const { initial, initialCursor = null, initialError = "", rowId } = props;
  const serverPayload = useMemo(() => ({ initial, initialCursor, initialError, rowId, initialFilterKey, clientId }),
    [initial, initialCursor, initialError, rowId, initialFilterKey, clientId]);
  const [initialUse, setInitialUse] = useState({ serverPayload, departed: filterKey !== initialFilterKey });
  const freshPayload = initialUse.serverPayload !== serverPayload;
  if (freshPayload) setInitialUse({ serverPayload, departed: filterKey !== initialFilterKey });
  else if (!initialUse.departed && filterKey !== initialFilterKey) setInitialUse({ serverPayload, departed: true });
  // Returning A → B → A with the same Server props must reread A, not revive its old body.
  const initialMatches = filterKey === initialFilterKey && (freshPayload || !initialUse.departed);
  const scope = useMemo(() => ({ serverPayload, filterKey }), [serverPayload, filterKey]);
  const [reported, setReported] = useState<{ scope: typeof scope; status: HistoryStatus } | null>(null);
  const reportStatus = useCallback((status: HistoryStatus) => setReported({ scope, status }), [scope]);
  const status = reported?.scope === scope ? reported.status : {
    selectedMatter: initialMatches ? initial?.selectedMatter ?? null : null,
    loading: !initialMatches, failed: initialMatches && Boolean(initialError),
  };
  if (!location.success) return <section className="card p-4 space-y-3"><p role="alert" className="text-sm text-destructive">客户动态位置无效，请重新打开客户动态</p>
    <Link className="btn btn-secondary btn-sm" href={clientHistoryHref(clientId, { returnTo })}>查看最新客户动态</Link></section>;
  const currentReturn = location.data.returnTo ?? returnTo;
  return <section className="card min-w-0" aria-labelledby="client-history-title" aria-busy={status.loading}>
    <div className="panel-head"><h2 id="client-history-title" className="panel-title" style={{ fontSize: 13 }}>客户动态</h2></div>
    <div className="panel-body space-y-3">
      <HistoryFilters clientId={clientId} filters={location.data.filters} {...status}
        onChange={filters => window.history.pushState(null, "", clientHistoryHref(clientId, { filters, returnTo: currentReturn }))} />
      <ClientHistoryResults key={`${clientId}:${filterKey}`} {...props} filters={location.data.filters} initialMatches={initialMatches}
        requestedCursor={location.data.historyCursor ?? null} requestedRowId={location.data.rowId}
        tab={location.data.tab} returnTo={currentReturn} reportStatus={reportStatus} />
    </div>
  </section>;
}

function ClientHistoryResults({ clientId, initial, initialCursor = null, initialError = "", rowId, returnTo,
  filters, initialMatches, requestedCursor, requestedRowId, tab, reportStatus }: PanelProps & {
  filters: ClientHistoryFilters; initialMatches: boolean; requestedCursor: string | null; requestedRowId?: string; tab?: string;
  reportStatus: (status: HistoryStatus) => void;
}) {
  const { from, to, source, matterId } = filters;
  const read = useCallback((input: ClientPageInput) => getClientHistoryPage({ ...input, from, to, source, matterId }), [from, to, source, matterId]);
  const controls = useClientPagination(clientId, initialMatches ? initial : null, read,
    { initialCursor, initialError: initialMatches ? initialError : "" });
  const selectedMatter = controls.page?.selectedMatter ?? null;
  useLayoutEffect(() => {
    reportStatus({ selectedMatter, loading: controls.pending, failed: Boolean(controls.error) });
  }, [reportStatus, selectedMatter, controls.pending, controls.error]);
  const serverPayload = useMemo(() => ({ initial, initialCursor, initialError, rowId, initialMatches }), [initial, initialCursor, initialError, rowId, initialMatches]);
  const consumedPayload = useRef<typeof serverPayload | null>(null);
  const { goTo } = controls;
  useEffect(() => {
    const alreadyUsed = consumedPayload.current === serverPayload;
    consumedPayload.current = serverPayload;
    if (!alreadyUsed && initialMatches && requestedCursor === initialCursor && requestedRowId === rowId) return;
    // Native history can restore URL positions with an older cached Server payload.
    goTo(requestedCursor);
  }, [serverPayload, initialCursor, rowId, initialMatches, requestedCursor, requestedRowId, goTo]);
  const selectedRow = useRef<HTMLElement>(null);
  const locatedRowId = controls.cursor === requestedCursor ? requestedRowId : undefined;
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
  return <div className="space-y-3" aria-busy={controls.pending}>
      {controls.page?.items.length === 0 ? <p className="t-xs t-mute">{controls.page.nextCursor ? "本页没有可显示的动态，可继续查看。" : "本页暂无动态。"}</p> : null}
      {locatedRowId && controls.page && !controls.page.items.some(item => item.key === locatedRowId)
        ? <p role="status" className="text-sm text-muted-foreground">原动态已不在当前可读页中，请重新核对；未替换为其他记录。</p> : null}
      {controls.page?.items.map(item => {
        const back = item.source === "CONTEXT" ? clientHistoryHref(clientId, { cursor: controls.cursor, rowId: item.key, filters, returnTo }) : null;
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
  </div>;
}
