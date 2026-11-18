"use client";

import { DialogContent, DialogHeader, DialogTitle, WorkspaceDialog } from "@/components/patterns/workspace-dialog";
import { deadlineDays, deadlineRelative, formatDeadlineDue, type DeadlineDuePrecision } from "@/lib/deadline-due";

/**
 * 全局搜索（墨案 11 效果图 palette）。
 * 范围 chip 带计数、按类型分组、关键词高亮、材料页码 / 来源 chip / OCR 标识、
 * 「跳转案件」、键盘 ↑↓ 选择 · ↵ 打开 · Tab 遍历控件；底部注明权限口径与识别失败数。
 * 数据与授权过滤全部在 server/search/actions.ts（候选逐条 canReadDocument）。
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Highlight, Input, Tabs, Tag } from "@douyinfe/semi-ui";
import { IconApartment as Building2, IconClock as Clock, IconArticle as FileText, IconFolder as Folder, IconInbox as Inbox, IconLoading as Loader2, IconLock as Lock, IconSearch as Search, IconAIWandLevel1 as Sparkle } from "@douyinfe/semi-icons";
import { continueGlobalSearch, globalSearch, type GlobalSearchResult, type SearchResultItem } from "@/server/search/actions";
import type { MaterialSourceInput } from "@/server/documents/material-processing";
import { SearchMaterialSourceDialog } from "./search-material-source-dialog";
import { documentSourceChip } from "@/lib/ui/status-tones";
import { cn } from "@/lib/utils";

type GroupKey = "documents" | "matters" | "clients" | "deadlines" | "intakes";
type Scope = "all" | GroupKey;

const GROUPS: { key: GroupKey; label: string; icon: typeof Folder; tone: string }[] = [
  { key: "documents", label: "材料正文", icon: FileText, tone: "gi-violet" },
  { key: "matters", label: "案件", icon: Folder, tone: "gi-blue" },
  { key: "clients", label: "客户", icon: Building2, tone: "gi-teal" },
  { key: "deadlines", label: "期限", icon: Clock, tone: "gi-amber" },
  { key: "intakes", label: "收案", icon: Inbox, tone: "gi-slate" }
];
const SCOPE_ORDER: Scope[] = ["all", "matters", "clients", "documents", "deadlines", "intakes"];
const ALL_SCOPE_LIMIT = 4;

const matchStyle = {
  backgroundColor: "var(--workspace-selection-bg)",
  color: "var(--workspace-selection-text)",
  fontWeight: 700,
  textDecoration: "underline",
  textUnderlineOffset: "0.14em",
};

function dueLabel(iso: string, precision: DeadlineDuePrecision | null) {
  return { date: formatDeadlineDue(iso, precision), left: deadlineRelative(iso, precision), urgent: deadlineDays(iso) <= 3 };
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; data: GlobalSearchResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [pages, setPages] = useState<Partial<Record<GroupKey, { loading: boolean; failed: boolean; retryCursor?: string | null }>>>({});
  const generation = useRef(0);
  const pageRequests = useRef<Partial<Record<GroupKey, number>>>({});
  const failedSelection = useRef<Partial<Record<GroupKey, string>>>({});
  const failedScroll = useRef<Partial<Record<GroupKey, number>>>({});
  const restoreScroll = useRef<{ top: number; scope: Scope; selectedId: string | null } | null>(null);
  const allSelectionAfterRead = useRef<Pick<SearchResultItem, "id" | "type"> | null | undefined>(undefined);
  const skipRelocationScroll = useRef(false);
  const [scope, setScope] = useState<Scope>("all");
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const [sel, setSel] = useState(0);
  const [source, setSource] = useState<MaterialSourceInput | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const router = useRouter();

  useEffect(() => { if (!open) setSource(null); }, [open]);

  // Cmd+K / Ctrl+K 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  // 防抖搜索
  useEffect(() => {
    const q = query.trim();
    const serial = ++generation.current;
    setPages({});
    setSearchError(false);
    failedSelection.current = {};
    failedScroll.current = {};
    restoreScroll.current = null;
    allSelectionAfterRead.current = undefined;
    skipRelocationScroll.current = false;
    if (!q) {
      setLoaded(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await globalSearch(q);
        if (!cancelled && serial === generation.current) {
          setLoaded({ query: q, data: r });
          setSel(0);
        }
      } catch {
        if (!cancelled && serial === generation.current) { setLoaded(null); setSearchError(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchRetry]);

  const q = query.trim();
  const results = loaded?.query === q ? loaded.data : null;
  const counts = useMemo(() => {
    const c = { documents: 0, matters: 0, clients: 0, deadlines: 0, intakes: 0 } as Record<GroupKey, number>;
    if (results) for (const g of GROUPS) c[g.key] = results[g.key].length;
    return c;
  }, [results]);

  // 当前范围下的可见分组与扁平列表（键盘选择用）
  const visible = useMemo(() => {
    if (!results) return [] as { group: (typeof GROUPS)[number]; items: SearchResultItem[]; start: number }[];
    let start = 0;
    return GROUPS.filter((g) => scope === "all" || g.key === scope)
      .map((g) => ({ group: g, items: scope === "all" ? results[g.key].slice(0, ALL_SCOPE_LIMIT) : results[g.key] }))
      .filter((g) => g.items.length > 0 || Boolean(results.nextCursorByGroup[g.group.key]) || Boolean(pages[g.group.key]?.failed))
      .map((g) => {
        const out = { ...g, start };
        start += g.items.length;
        return out;
      });
  }, [results, scope, pages]);
  const flat = useMemo(() => visible.flatMap((g) => g.items), [visible]);
  const selectionRef = useRef<SearchResultItem | null>(null);
  useLayoutEffect(() => {
    const preserved = allSelectionAfterRead.current;
    if (preserved === undefined) return;
    allSelectionAfterRead.current = undefined;
    if (scopeRef.current === "all") {
      const nextIndex = preserved ? flat.findIndex(item => item.id === preserved.id && item.type === preserved.type) : -1;
      // Keeping the same selected object is not a new user navigation action.
      if (preserved && nextIndex >= 0 && nextIndex !== sel) skipRelocationScroll.current = true;
      setSel(nextIndex);
    }
  }, [flat, sel]);
  useEffect(() => { selectionRef.current = flat[sel] ?? null; }, [flat, sel]);

  function chooseScope(value: Scope) {
    scopeRef.current = value;
    setScope(value);
    setSel(0);
  }

  async function continueGroup(group: GroupKey, restart = false) {
    if (!results || loading || pages[group]?.loading) return;
    const wasFailed = pages[group]?.failed === true;
    const cursor = restart ? undefined : wasFailed ? pages[group]?.retryCursor ?? undefined : results.nextCursorByGroup[group] ?? undefined;
    if (!restart && !cursor && !wasFailed) return;
    const serial = generation.current, request = (pageRequests.current[group] ?? 0) + 1;
    pageRequests.current[group] = request;
    const selected = flat[sel];
    const requestedScope = scopeRef.current;
    const stillAtRequest = () => scopeRef.current === requestedScope && (selectionRef.current?.id ?? null) === (selected?.id ?? null);
    if (selected && results[group].some(item => item.id === selected.id)) failedSelection.current[group] = selected.id;
    const scrollTop = wasFailed ? failedScroll.current[group] ?? 0 : bodyRef.current?.scrollTop ?? 0;
    failedScroll.current[group] = scrollTop;
    setPages(previous => ({ ...previous, [group]: { loading: true, failed: wasFailed, retryCursor: cursor ?? null } }));
    try {
      const page = await continueGlobalSearch({ query: q, group, ...(cursor ? { cursor } : {}) });
      if (serial !== generation.current || pageRequests.current[group] !== request) return;
      // A background group's new rows may shift later groups in the combined list.
      if (scopeRef.current === "all") allSelectionAfterRead.current = selectionRef.current;
      if (stillAtRequest()) restoreScroll.current = { top: scrollTop, scope: requestedScope, selectedId: selected?.id ?? null };
      setLoaded(previous => {
        if (previous?.query !== q) return previous;
        // A failed read discarded this scope's old projection. Only the newly authorized page may return.
        const items = new Map((restart || wasFailed ? [] : previous.data[group]).map(item => [item.id, item]));
        for (const item of page.items) items.set(item.id, item);
        return { query: q, data: { ...previous.data, [group]: [...items.values()], nextCursorByGroup: { ...previous.data.nextCursorByGroup, [group]: page.nextCursor } } };
      });
      setPages(previous => ({ ...previous, [group]: { loading: false, failed: false } }));
      if ((wasFailed || restart) && scopeRef.current === group && stillAtRequest()) setSel(page.items.findIndex(item => item.id === failedSelection.current[group]));
    } catch {
      if (serial !== generation.current || pageRequests.current[group] !== request) return;
      if (scopeRef.current === "all") allSelectionAfterRead.current = selectionRef.current;
      setLoaded(previous => previous?.query === q ? { ...previous, data: { ...previous.data, [group]: [], ...(group === "documents" ? { documentsFailedCount: 0 } : {}) } } : previous);
      setPages(previous => ({ ...previous, [group]: { loading: false, failed: true, retryCursor: cursor ?? null } }));
      if (group === "documents") setSource(null);
      if (stillAtRequest() && (scopeRef.current === group || selected && results[group].some(item => item.id === selected.id))) setSel(-1);
    }
  }

  const go = useCallback(
    (href: string) => {
      if (!href) return;
      setSource(null);
      onOpenChange(false);
      setQuery("");
      setScope("all");
      router.push(href);
    },
    [router, onOpenChange]
  );

  function openResult(item: SearchResultItem, trigger?: HTMLElement) {
    if (item.type !== "document") { go(item.href); return; }
    if (item.parseRunId && item.anchorId) {
      sourceTrigger.current = trigger ?? bodyRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`) ?? null;
      setSource({ documentId: item.id, runId: item.parseRunId, anchorId: item.anchorId });
    } else if (item.href) window.open(item.href, "_blank", "noopener,noreferrer");
  }

  useLayoutEffect(() => {
    if (source || !sourceTrigger.current) return;
    const trigger = sourceTrigger.current;
    sourceTrigger.current = null;
    const body = bodyRef.current;
    if (!open || !body) return;
    (trigger.isConnected && body.contains(trigger) ? trigger : inputRef.current)?.focus({ preventScroll: true });
  }, [source, open]);

  useEffect(() => {
    if (skipRelocationScroll.current) { skipRelocationScroll.current = false; return; }
    bodyRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  useEffect(() => {
    if (restoreScroll.current !== null && bodyRef.current) {
      const position = restoreScroll.current;
      if (position.scope === scopeRef.current && position.selectedId === (selectionRef.current?.id ?? null)) bodyRef.current.scrollTop = position.top;
      restoreScroll.current = null;
    }
  }, [loaded]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (source) return;
    if (e.target instanceof HTMLElement && e.target.closest('[role="tab"]')) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
      const item = flat[sel];
      if (item) {
        e.preventDefault();
        openResult(item);
      }
    }
  }

  const total = GROUPS.reduce((n, g) => n + counts[g.key], 0);

  return (
    <>
      <WorkspaceDialog open={open} dismissOnBackdrop={!source} onOpenChange={next => {
        if (next || source) return;
        onOpenChange(false);
        setScope("all");
      }}>
        <DialogContent className="max-w-[780px]" showClose={!source} inert={Boolean(source)} aria-hidden={source ? true : undefined} onKeyDown={onKeyDown}>
          <DialogHeader><DialogTitle>全局搜索</DialogTitle></DialogHeader>
          <div className="mo-search space-y-3">
            <Input
              ref={inputRef}
              value={query}
              onChange={setQuery}
              prefix={
                <span className="mx-3 inline-flex text-[var(--semi-color-text-2)]" aria-hidden>
                  {loading ? <Loader2 aria-hidden size="default" spin /> : <Search aria-hidden size="default" />}
                </span>
              }
              placeholder="搜索案件、客户、材料正文、期限…"
              aria-label="搜索关键词"
              autoComplete="off"
              autoFocus
              showClear
            />
            <Tabs type="button" activeKey={scope} onChange={value => chooseScope(value as Scope)}>
              {SCOPE_ORDER.map(value => <Tabs.TabPane itemKey={value} key={value} tab={
                <span>{value === "all" ? "全部" : GROUPS.find(group => group.key === value)!.label}
                  {value !== "all" && results ? ` ${pages[value]?.failed ? "—" : counts[value]}` : ""}
                </span>
              } />)}
            </Tabs>
                <div className="gs-body" ref={bodyRef} style={{ maxHeight: "55vh", overflowY: "auto" }}>
                  {!q ? (
                    <div className="mo-gs-empty">
                      <div className="mo-empty-title">输入关键词开始检索</div>
                      <div className="mo-empty-desc">可搜案件名称 / 所内编号、客户名称 / 证件号 / 电话、材料名称与正文、期限事项、在途收案。</div>
                    </div>
                  ) : searchError ? (
                    <div role="alert" className="p-4 text-sm">搜索读取失败，请重试。<Button theme="outline" size="small" className="ml-2" onClick={() => setSearchRetry(value => value + 1)}>重新检索</Button></div>
                  ) : results && visible.length === 0 && !loading ? (
                    <div className="mo-gs-empty">
                      <div className="mo-empty-title">{total === 0 ? "未找到相关结果" : "该范围下没有结果"}</div>
                      <div className="mo-empty-desc">{total === 0 ? "换个关键词试试；证件号需完整输入才会精确匹配。" : "可切换到其他范围查看。"}</div>
                    </div>
                  ) : null}

                  {visible.map(({ group, items, start }) => {
                    const Icon = group.icon;
                    return (
                      <Fragment key={group.key}>
                        <div className="gs-group">
                          {group.label} · {pages[group.key]?.failed ? "读取失败" : `已显示 ${counts[group.key]} 条`}
                          {scope === "all" && counts[group.key] > items.length ? (
                            <Button htmlType="button" size="small" theme="borderless" onClick={() => chooseScope(group.key)}>查看此范围 →</Button>
                          ) : null}
                        </div>
                        {items.map((item, i) => {
                          const myIdx = start + i;
                          const chip = item.sourceOrigin ? documentSourceChip[item.sourceOrigin] : null;
                          const due = item.dueAt && item.type === "deadline" ? dueLabel(item.dueAt, item.duePrecision ?? null) : null;
                          return (
                            <div
                              key={`${group.key}-${item.id}`}
                              data-idx={myIdx}
                              role="option"
                              tabIndex={-1}
                              aria-selected={sel === myIdx}
                              className={cn("gs-item", sel === myIdx && "sel")}
                              onMouseMove={() => sel !== myIdx && setSel(myIdx)}
                              onClick={event => { setSel(myIdx); openResult(item, event.currentTarget); }}
                              style={item.href ? undefined : { cursor: "default" }}
                            >
                              <div className={cn("gs-ic", group.tone)}>
                                <Icon />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="gs-title">
                                  <Highlight sourceString={item.title} searchWords={[q]} autoEscape highlightStyle={matchStyle} />
                                  {item.ocr ? (
                                    <Tag color="violet" size="small" prefixIcon={<Sparkle aria-hidden size="small" />} className="ml-2">OCR</Tag>
                                  ) : null}
                                </div>
                                {item.type === "document" && item.snippet ? (
                                  <div className="gs-snippet">…<Highlight sourceString={item.snippet} searchWords={[q]} autoEscape highlightStyle={matchStyle} />…</div>
                                ) : null}
                                <div className="gs-meta">
                                  {item.type === "document" ? (
                                    <>
                                      <span className="mono">{item.pageNo ? `第 ${item.pageNo} 页命中` : item.matchedBy}</span>
                                      {chip ? <span className={cn("src-chip", chip.kind)}>{chip.label}</span> : null}
                                      {item.context ? <span className="truncate">{item.context}</span> : <span>未挂案件或收案</span>}
                                      {item.code ? <span className="mono">{item.code}</span> : null}
                                    </>
                                  ) : item.type === "matter" ? (
                                    <>
                                      <span className="mono">{item.code}</span>
                                      <span>· <Highlight sourceString={item.matchedBy ?? ""} searchWords={[q]} autoEscape highlightStyle={matchStyle} />{item.meta ? ` · ${item.meta}` : ""}</span>
                                    </>
                                  ) : item.type === "client" ? (
                                    <span>{item.meta}{item.matchedBy && item.matchedBy !== "名称命中" ? <> · <Highlight sourceString={item.matchedBy} searchWords={[q]} autoEscape highlightStyle={matchStyle} /></> : null}</span>
                                  ) : item.type === "deadline" && due ? (
                                    <>
                                      <span className="mono">{due.date}</span>
                                      <span>· {item.meta} · {item.context}</span>
                                      <span style={{ color: due.urgent ? "var(--semi-color-danger)" : undefined }}>· {due.left}</span>
                                    </>
                                  ) : (
                                    <span>{item.meta}</span>
                                  )}
                                </div>
                              </div>
                              {item.matterLink && item.type !== "matter" ? (
                                <Button
                                  htmlType="button"
                                  theme="light"
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    go(item.matterLink!);
                                  }}
                                >
                                  {item.type === "document" && !item.code ? "打开收案" : "跳转案件"}
                                </Button>
                              ) : null}
                            </div>
                          );
                        })}
                        {pages[group.key]?.failed ? <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                          <span>此范围读取失败，先前结果已隐藏。</span>
                          <Button theme="outline" size="small" disabled={pages[group.key]?.loading} onClick={() => void continueGroup(group.key)}>重试此批</Button>
                          <Button theme="borderless" size="small" disabled={pages[group.key]?.loading} onClick={() => void continueGroup(group.key, true)}>从头检索</Button>
                        </div> : results?.nextCursorByGroup[group.key] ? <div className="flex items-center gap-2 px-4 py-3">
                          {!items.length ? <span className="text-sm text-muted-foreground">本批没有可展示结果。</span> : null}
                          <Button theme="outline" size="small" disabled={pages[group.key]?.loading || loading} onClick={() => { if (scope === "all") chooseScope(group.key); void continueGroup(group.key); }}>
                            {pages[group.key]?.loading ? "正在检索…" : "继续检索"}
                          </Button>
                        </div> : null}
                      </Fragment>
                    );
                  })}
                </div>

                <div className="gs-foot">
                  <span className="hint"><span className="kbd">↑</span><span className="kbd">↓</span> 选择</span>
                  <span className="hint"><span className="kbd">↵</span> 打开</span>
                  <span className="hint"><span className="kbd">Tab</span> 切换控件</span>
                  <span className="perm">
                    <Lock style={{ width: 12, height: 12 }} aria-hidden />
                    仅展示你有权限访问的内容 · 有具体位置的材料可直接查看来源
                    {results && results.documentsFailedCount > 0 ? ` · 另有 ${results.documentsFailedCount} 份材料识别失败未纳入全文` : ""}
                  </span>
                </div>
          </div>
        </DialogContent>
      </WorkspaceDialog>
      {open && source && <SearchMaterialSourceDialog key={`${source.documentId}:${source.runId}:${source.anchorId}`} input={source}
        onClose={() => setSource(null)} />}
    </>
  );
}
