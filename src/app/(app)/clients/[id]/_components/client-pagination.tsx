"use client";

import { Button } from "@douyinfe/semi-ui";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";
import type { ClientPageInput } from "@/lib/clients/history";

/** Stores only the current page and opaque navigation positions, never old bodies. */
export function useClientPagination<T extends { nextCursor: string | null }>(
  clientId: string, initial: T | null, read: (input: ClientPageInput) => Promise<T>,
  { initialCursor = null, initialError = "" }: { initialCursor?: string | null; initialError?: string } = {},
) {
  const scope = useMemo(() => ({ clientId, initial, initialCursor, initialError }), [clientId, initial, initialCursor, initialError]);
  const live = useRef<{ scope: typeof scope | null; serial: number }>({ scope: null, serial: 0 });
  type State = { scope: typeof scope; page: T | null; cursor: string | null; previous: (string | null)[]; pending: boolean; error: string };
  const [state, setState] = useState<State>({ scope, page: initial, cursor: initialCursor, previous: [], pending: false, error: initialError });
  // A fresh server payload is authoritative immediately, before passive cleanup.
  const current = state.scope === scope ? state : { scope, page: initial, cursor: initialCursor, previous: [], pending: false, error: initialError };
  useLayoutEffect(() => {
    live.current = { scope, serial: live.current.serial + 1 };
    return () => { live.current = { scope: null, serial: live.current.serial + 1 }; };
  }, [scope]);

  const load = useCallback(async (cursor: string | null, previous: (string | null)[]) => {
    if (live.current.scope !== scope) return;
    const serial = ++live.current.serial;
    setState({ scope, page: null, cursor, previous, pending: true, error: "" });
    try {
      const page = await read({ clientId, ...(cursor ? { cursor } : {}) });
      if (live.current.scope === scope && serial === live.current.serial) setState({ scope, page, cursor, previous, pending: false, error: "" });
    } catch (error) {
      if (live.current.scope === scope && serial === live.current.serial) setState({ scope, page: null, cursor, previous, pending: false,
        error: actionErrorMessage(error) || "加载失败，请重试" });
    }
  }, [scope, read, clientId]);
  const goTo = useCallback((cursor: string | null) => { void load(cursor, []); }, [load]);
  return {
    page: current.page, cursor: current.cursor, pending: current.pending, error: current.error,
    goTo,
    hasPrevious: current.previous.length > 0,
    next: () => { if (!current.pending && current.page?.nextCursor) void load(current.page.nextCursor, [...current.previous, current.cursor]); },
    previous: () => { if (!current.pending && current.previous.length) void load(current.previous.at(-1) ?? null, current.previous.slice(0, -1)); },
    refresh: () => { void load(null, []); },
    retry: () => { void load(current.cursor, current.previous); },
    invalidate: () => { live.current.serial++; setState({ scope, page: null, cursor: null, previous: [], pending: true, error: "" }); }
  };
}

type Controls = ReturnType<typeof useClientPagination<{ nextCursor: string | null }>>;
export function ClientPagination({ controls, label }: { controls: Controls; label: string }) {
  return <div className="mt-3 space-y-2">
    {controls.pending ? <p className="t-xs t-mute" role="status">正在加载{label}…</p> : null}
    {controls.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--red)]">
      <span>{controls.error}</span><Button htmlType="button" theme="outline" type="tertiary" size="small" onClick={controls.retry}>重试{label}</Button>
    </div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button htmlType="button" theme="outline" type="tertiary" size="small" disabled={controls.pending || !controls.hasPrevious} aria-label={`${label}上一页`} onClick={controls.previous}>上一页</Button>
      <Button htmlType="button" theme="outline" type="tertiary" size="small" disabled={controls.pending || !controls.page?.nextCursor} aria-label={`${label}下一页`} onClick={controls.next}>下一页</Button>
      <Button htmlType="button" theme="borderless" type="tertiary" size="small" aria-label={`刷新${label}`} onClick={controls.refresh}>刷新</Button>
    </div>
  </div>;
}
