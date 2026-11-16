"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog, promptDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import {
  checkResearchRevision, formResearchDraft, getResearch, getResearchHistory, getResearchList,
  getResearchOptions, getResearchSource, getResearchSourcePreview, saveResearchRevision,
} from "@/server/research/actions";
import {
  emptyResearchContent, researchSaveSchema, type ResearchContent, type ResearchList, type ResearchOptions,
  type ResearchRevisionView, type ResearchSourceInput, type ResearchSourceResult,
} from "@/server/research/contracts";
import { ResearchEditor } from "./research-editor";

type Props = {
  matterId: string; researchId?: string | null; issueId?: string | null;
  onSelectResearch(id: string | null): void; onOpenDocument(documentId: string): void;
  onDraftStateChange?(dirty: boolean, busy: boolean): void;
};
type Target = { researchId: string | null; issueId: string | null; creating: boolean };
const errorText = (error: unknown, fallback: string) => {
  const message = actionErrorMessage(error);
  return message && !/Prisma|Invalid .*invocation|Minified|ECONN|SELECT |postgresql:|ENOENT/i.test(message) ? message : fallback;
};

export function ResearchWorkspace({ matterId, researchId = null, issueId = null, onSelectResearch, onOpenDocument, onDraftStateChange }: Props) {
  const [list, setList] = useState<ResearchList | null>(null);
  const [row, setRow] = useState<ResearchRevisionView | null>(null);
  const [value, setValue] = useState<ResearchContent>(emptyResearchContent);
  const [options, setOptions] = useState<ResearchOptions | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [source, setSource] = useState<ResearchSourceResult | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<{ records: ResearchRevisionView[]; nextVersion: number | null } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const dirty = useRef(false), busy = useRef(false), sequence = useRef(0), sourceSequence = useRef(0), historySequence = useRef(0);
  const target = useRef<Target>({ researchId, issueId, creating: Boolean(issueId) });
  const seenProps = useRef("");
  const requestKey = useRef(crypto.randomUUID()), draftRequestKey = useRef(crypto.randomUUID());
  useEffect(() => { onDraftStateChange?.(dirty.current, pending); }, [value, editing, pending, onDraftStateChange]);

  const load = useCallback(async (next: Target) => {
    const token = ++sequence.current;
    target.current = next;
    setLoading(true); setError(""); setRow(null); setList(null); setOptions(null); setEditing(false);
    setHistoryOpen(false); setSourceOpen(false); sourceSequence.current++; historySequence.current++;
    requestKey.current = crypto.randomUUID(); draftRequestKey.current = crypto.randomUUID();
    try {
      if (next.researchId) {
        const record = await getResearch(matterId, next.researchId);
        if (sequence.current !== token) return;
        setRow(record); if (record.content) setValue(record.content);
      } else if (next.creating || next.issueId) {
        const choices = await getResearchOptions(matterId);
        if (sequence.current !== token) return;
        const issue = next.issueId ? choices.issues.find(item => item.id === next.issueId) : null;
        if (next.issueId && !issue) throw new Error("此争点已变化或无权读取，请返回事实列表重新选择");
        setOptions(choices); setValue({ ...emptyResearchContent(), ...(issue ? { question: issue.title, issueId: issue.id, issueRevisionId: issue.revisionId } : {}) });
        setEditing(true);
      } else {
        const records = await getResearchList(matterId);
        if (sequence.current !== token) return;
        setList(records);
      }
      dirty.current = false;
    } catch (failure) { if (sequence.current === token) setError(errorText(failure, "研究加载失败，请重试")); }
    finally { if (sequence.current === token) setLoading(false); }
  }, [matterId]);

  async function allowLeave() {
    if (busy.current) return false;
    return !dirty.current || await confirmDialog({ title: "放弃未保存的研究？", description: "当前输入尚未保存。", confirmText: "放弃并离开", cancelText: "继续编辑", initialFocus: "cancel" });
  }

  useEffect(() => {
    const key = `${matterId}:${researchId ?? ""}:${issueId ?? ""}`;
    if (seenProps.current === key) return;
    seenProps.current = key;
    let cancelled = false;
    void (async () => {
      if (dirty.current || busy.current) {
        const proceed = !busy.current && await confirmDialog({ title: "放弃未保存的研究？", confirmText: "放弃并切换", cancelText: "继续编辑", initialFocus: "cancel" });
        if (cancelled) return;
        if (!proceed) {
          seenProps.current = `${matterId}:${target.current.researchId ?? ""}:`;
          onSelectResearch(target.current.researchId); return;
        }
      }
      if (!cancelled) await load({ researchId, issueId, creating: Boolean(issueId) });
    })();
    return () => { cancelled = true; };
  }, [matterId, researchId, issueId, load, onSelectResearch]);

  useEffect(() => () => { sequence.current++; sourceSequence.current++; historySequence.current++; }, []);

  async function navigate(id: string | null, creating = false) {
    if (!await allowLeave()) return;
    dirty.current = false; setNotice("");
    seenProps.current = `${matterId}:${id ?? ""}:`;
    onSelectResearch(id);
    await load({ researchId: id, issueId: null, creating });
  }
  function mutate(run: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setError(""); setNotice("");
    startTransition(async () => {
      try { await run(); } catch (failure) { setError(errorText(failure, "操作未完成，请保留输入并重试")); }
      finally { busy.current = false; }
    });
  }
  function edit() {
    if (!row?.content || !row.canRevise) return;
    const content = row.content;
    mutate(async () => {
      const choices = await getResearchOptions(matterId);
      setOptions(choices); setValue(content); setEditing(true); requestKey.current = crypto.randomUUID();
    });
  }
  function save() {
    const parsed = researchSaveSchema.safeParse({ ...value, matterId, requestKey: requestKey.current,
      supersedesId: row?.id ?? null, expectedVersion: row?.version ?? null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查研究内容"); return; }
    mutate(async () => {
      const result = await saveResearchRevision(parsed.data);
      dirty.current = false;
      seenProps.current = `${matterId}:${result.id}:`;
      onSelectResearch(result.id);
      await load({ researchId: result.id, issueId: null, creating: false });
      setNotice(`已保存研究修订 ${result.version}`);
    });
  }
  async function check() {
    if (!row?.canCheck || editing) return;
    const note = await promptDialog({ title: "核对这份研究", label: "核对结论及仍待核实项", description: "核对研究范围、来源时点和结论条件。未知项仍需明确保留。", required: true, maxLength: 2000, confirmText: "记录核对", cancelText: "取消" });
    if (note === null) return;
    mutate(async () => {
      await checkResearchRevision({ matterId, id: row.id, expectedVersion: row.version, acknowledged: true, note });
      await load({ researchId: row.id, issueId: null, creating: false }); setNotice("已记录研究核对");
    });
  }
  function draft() {
    if (!row?.canDraft || editing) return;
    mutate(async () => {
      const result = await formResearchDraft({ matterId, researchRevisionId: row.id, requestKey: draftRequestKey.current });
      setNotice("分析草稿已保存到材料，仍需按原流程复核与审批");
      onOpenDocument(result.documentId);
    });
  }
  function showSource(sourceId: string | null, preview?: ResearchSourceInput) {
    const token = ++sourceSequence.current;
    setSource(null); setSourceError(""); setSourceOpen(true);
    const operation = preview ? getResearchSourcePreview(matterId, preview) : getResearchSource(matterId, row!.id, sourceId!);
    void operation.then(result => { if (sourceSequence.current === token) setSource(result); })
      .catch(failure => { if (sourceSequence.current === token) setSourceError(errorText(failure, "来源读取失败，请关闭后重试")); });
  }
  function showHistory(before?: number) {
    if (!row) return;
    const token = ++historySequence.current;
    setHistoryError(""); setHistoryOpen(true); if (!before) setHistory(null);
    void getResearchHistory(matterId, row.id, before).then(result => {
      if (historySequence.current === token) setHistory(previous => before && previous
        ? { records: [...previous.records, ...result.records], nextVersion: result.nextVersion } : result);
    }).catch(failure => { if (historySequence.current === token) setHistoryError(errorText(failure, "修订记录加载失败，请重试")); });
  }
  function more() {
    if (!list?.nextCursor) return;
    const cursor = list.nextCursor, token = sequence.current;
    mutate(async () => {
      const result = await getResearchList(matterId, cursor);
      if (sequence.current === token) setList(previous => previous ? { ...result, records: [...previous.records, ...result.records] } : result);
    });
  }
  const showingEditor = editing || Boolean(row);
  return <section aria-label="事项研究" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">{showingEditor || error ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => void navigate(null)}>返回研究列表</Button> : <h2 className="font-semibold">研究</h2>}
        {row ? <><Badge variant="outline">修订 {row.version}</Badge><Badge variant={row.checkedAt ? "secondary" : "outline"}>{row.checkedAt ? "研究已核对" : "待核对"}</Badge>{!row.current ? <Badge variant="outline">历史修订</Badge> : null}</> : editing ? <span className="text-sm text-muted-foreground">新建研究</span> : null}
      </div>
      <div className="flex items-center gap-2">
        {list?.canWrite ? <Button onClick={() => void navigate(null, true)} disabled={pending}>新建研究</Button> : null}
        {row ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => showHistory()}>修订记录</Button> : null}
        {row && !editing && row.canRevise ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void edit()}>修改研究</Button> : null}
        {row && !editing && row.canCheck ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void check()}>核对研究</Button> : null}
        {row && !editing && row.canDraft ? <Button size="sm" disabled={pending} onClick={draft}>形成分析稿</Button> : null}
        {editing ? <><Button variant="outline" size="sm" disabled={pending} onClick={() => void navigate(row?.id ?? null)}>取消编辑</Button><Button size="sm" disabled={pending || !options} onClick={save}>{pending ? "保存中…" : row ? "保存新修订" : "保存研究"}</Button></> : null}
      </div>
    </div>
    {error ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm space-y-2"><p>{error}</p>{!editing ? <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(target.current)}>重试</Button> : null}</div> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取研究…</p> : null}
    {!loading && list ? <div className="divide-y rounded-md border">
      {list.records.length ? list.records.map(item => <div key={item.id} className="flex items-center justify-between gap-4 p-3">
        <div className="min-w-0 space-y-1"><p className="font-medium text-sm break-words">{item.question ?? "来源受限的研究"}</p><p className="text-xs text-muted-foreground">修订 {item.version} · {item.authorName ?? "原作者"} · {shDayKey(item.createdAt)} {shTime(item.createdAt)} · {item.checkedAt ? "已核对" : "待核对"}</p></div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void navigate(item.id)}>打开研究</Button>
      </div>) : <p className="p-4 text-sm text-muted-foreground">暂无研究记录</p>}
      {list.nextCursor ? <div className="p-3"><Button size="sm" variant="outline" disabled={pending} onClick={more}>继续加载</Button></div> : null}
    </div> : null}
    {!loading && row && !row.readable ? <p role="alert" className="rounded-md border p-4 text-sm">研究来源已撤回、变化或无权读取。请核对材料资格后重试。</p> : null}
    {!loading && showingEditor && (editing || row?.readable) ? <>
      {row?.checkedAt && !editing ? <p className="text-sm text-muted-foreground">{row.checkedByName ?? "原核对人"} · {shDayKey(row.checkedAt)} 核对：{row.checkNote}</p> : null}
      {row && editing ? <p className="text-sm text-muted-foreground">保存后形成新修订，原修订及已有稿件依据保留。</p> : null}
      <ResearchEditor key={`${row?.id ?? "new"}:${editing}`} value={value} onChange={next => { setValue(next); dirty.current = true; }} options={options} disabled={pending} readOnly={!editing} saved={row}
        onOpenSource={id => showSource(id)} onPreviewSource={source => showSource(null, source)} />
    </> : null}
    <Dialog open={sourceOpen} onOpenChange={open => { setSourceOpen(open); if (!open) sourceSequence.current++; }}><DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{source?.status === "AVAILABLE" ? source.documentName : "研究来源"}</DialogTitle><DialogDescription>核对本次选入的具体原文版本。</DialogDescription></DialogHeader>
      {sourceError ? <p role="alert" className="text-sm text-destructive">{sourceError}</p> : !source ? <p role="status">正在读取来源…</p> : source.status === "UNAVAILABLE" ? <p role="alert">来源已变化或无权读取，请返回研究核对。</p> : <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><span className="text-sm">V{source.documentVersion} · {source.locationLabel}{source.historicalParse ? " · 历史解析位置" : ""}</span><Button variant="outline" size="sm" asChild><a href={source.originalUrl} target="_blank" rel="noopener noreferrer">打开原件</a></Button></div>
        {source.text ? <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{source.text}</p> : <p className="text-sm text-muted-foreground">此引用定位到原件，未提供可显示的解析片段。</p>}
      </div>}
    </DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={open => { setHistoryOpen(open); if (!open) historySequence.current++; }}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>研究修订</DialogTitle><DialogDescription>每次保存保留独立修订，旧稿仍引用原修订。</DialogDescription></DialogHeader>
      {historyError ? <div role="alert" className="space-y-2 text-sm"><p>{historyError}</p><Button variant="outline" size="sm" onClick={() => showHistory()}>重试</Button></div> : null}
      {!history ? <p role="status">正在读取修订记录…</p> : <div className="divide-y">{history.records.map(item => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium break-words">修订 {item.version} · {item.content?.question ?? "来源受限"}</p><p className="text-xs text-muted-foreground">{item.authorName ?? "原作者"} · {shDayKey(item.createdAt)} · {item.checkedAt ? "已核对" : "待核对"}{item.current ? " · 当前修订" : ""}</p></div><Button variant="outline" size="sm" disabled={pending} onClick={() => void navigate(item.id)}>查看修订</Button></div>)}
        {history.nextVersion ? <Button variant="outline" size="sm" onClick={() => showHistory(history.nextVersion!)}>更早修订</Button> : null}</div>}
    </DialogContent></Dialog>
  </section>;
}
