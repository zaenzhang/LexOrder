"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { checkReviewIssue, createReviewIssue, getDocumentReview, respondReviewIssue } from "@/server/document-reviews/actions";
import { reviewDispositionLabel, reviewIssueStateLabel, type DocumentReviewView, type ReviewDocumentOption } from "@/server/document-reviews/contracts";

type Props = { documentId: string; initialIssueId?: string | null; onIssueChange?: (issueId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void };
const EMPTY_DRAFT = { title: "", location: "", basis: "", basisDocumentId: "none", note: "", disposition: "ACCEPT" as "ACCEPT" | "PARTIAL" | "REJECT", revisionDocumentId: "none", revisionLocation: "" };

function DocumentChoice({ id, label, value, choices, onChange, disabled }: {
  id: string; label: string; value: string; choices: ReviewDocumentOption[]; onChange: (value: string) => void; disabled: boolean;
}) {
  return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">不关联材料</SelectItem>{choices.map(document => <SelectItem key={document.id} value={document.id}>{document.name} · 第 {document.version} 版</SelectItem>)}</SelectGroup></SelectContent>
  </Select></div>;
}
function DocumentLink({ document }: { document: ReviewDocumentOption }) {
  return <Button variant="link" size="sm" asChild><a href={`/api/documents/${document.id}/download?inline=1`} target="_blank" rel="noopener noreferrer">{document.name} · 第 {document.version} 版</a></Button>;
}

/** One panel is shared by the matter and the original approval entry. */
export function DocumentReviewPanel({ documentId, initialIssueId, onIssueChange, onDirtyChange, onPendingChange }: Props) {
  const [view, setView] = useState<DocumentReviewView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialIssueId ?? null);
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const loadSequence = useRef(0);
  const lastInitialIssueId = useRef(initialIssueId);
  const selected = view?.issues.find(issue => issue.id === selectedId);
  const dirty = Boolean(draft.title || draft.location || draft.basis || draft.note || draft.revisionLocation || draft.basisDocumentId !== "none" || draft.revisionDocumentId !== "none" || draft.disposition !== "ACCEPT");

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try { const result = await getDocumentReview(documentId); if (sequence === loadSequence.current) setView(result); }
    catch (cause) { if (sequence === loadSequence.current) { setView(null); setError(actionErrorMessage(cause)); } }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [documentId]);
  useEffect(() => { setCreating(false); setDraft(EMPTY_DRAFT); void reload(); return () => { loadSequence.current += 1; }; }, [documentId, reload]);
  useEffect(() => {
    if (initialIssueId !== lastInitialIssueId.current && !dirty && !pending) {
      lastInitialIssueId.current = initialIssueId; setSelectedId(initialIssueId ?? null);
    }
  }, [initialIssueId, dirty, pending]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending); return () => onPendingChange?.(false); }, [pending, onPendingChange]);
  function edit<K extends keyof typeof EMPTY_DRAFT>(key: K, value: (typeof EMPTY_DRAFT)[K]) { setDraft(previous => ({ ...previous, [key]: value })); setRequestId(crypto.randomUUID()); }
  async function canLeave() {
    return !pending && (!dirty || await confirmDialog({ title: "放弃未保存的复核内容？", confirmText: "放弃内容", cancelText: "继续编辑", initialFocus: "cancel" }));
  }
  async function select(id: string | null, create = false) {
    if (!await canLeave()) return;
    setDraft(EMPTY_DRAFT); setRequestId(crypto.randomUUID()); setCreating(create); setSelectedId(id); setError(null); onIssueChange?.(id);
  }
  function save(kind: "CREATE" | "RESPONSE" | "CHECK", resolved?: boolean) {
    if (!view || (kind !== "CREATE" && !selected)) return;
    startTransition(async () => {
      try {
        const result = kind === "CREATE" ? await createReviewIssue({ requestId, documentId, title: draft.title, location: draft.location || null, basis: draft.basis, basisDocumentId: draft.basisDocumentId === "none" ? null : draft.basisDocumentId })
          : kind === "RESPONSE" ? await respondReviewIssue({ requestId, issueId: selected!.id, expectedVersion: selected!.version, disposition: draft.disposition,
            note: draft.note, revisionDocumentId: draft.revisionDocumentId === "none" ? null : draft.revisionDocumentId, revisionLocation: draft.revisionLocation || null })
            : await checkReviewIssue({ requestId, issueId: selected!.id, expectedVersion: selected!.version, resolved: resolved === true, note: draft.note });
        setDraft(EMPTY_DRAFT); setCreating(false); setRequestId(crypto.randomUUID()); setSelectedId(result.id); onIssueChange?.(result.id); await reload();
      } catch (cause) { setError(actionErrorMessage(cause)); }
    });
  }

  return <section className="flex min-w-0 flex-col gap-4" aria-label="文书复核问题">
    <div className="flex items-center justify-between gap-3"><h3 className="font-medium">复核问题</h3>{view?.canCreate && <Button size="sm" disabled={pending} onClick={() => void select(null, true)}>提出问题</Button>}</div>
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-col gap-2"><span>{error}</span><Button variant="outline" size="sm" disabled={pending || loading} onClick={() => void reload()}>刷新记录</Button></AlertDescription></Alert>}
    {loading && !view && <p role="status">正在读取复核记录…</p>}
    {view && <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <Tabs value={filter} onValueChange={value => { if (!pending) setFilter(value); }}><TabsList className="grid h-auto grid-cols-2"><TabsTrigger value="ALL">全部</TabsTrigger><TabsTrigger value="OPEN">未处理</TabsTrigger><TabsTrigger value="WAITING_CHECK">待复核</TabsTrigger><TabsTrigger value="RESOLVED">已处理</TabsTrigger></TabsList></Tabs>
        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
          {view.issues.filter(issue => filter === "ALL" || issue.state === filter).map(issue => <Button key={issue.id} variant={selectedId === issue.id ? "secondary" : "ghost"} className="h-auto justify-start whitespace-normal text-left" disabled={pending} onClick={() => void select(issue.id)}>
            <span className="flex min-w-0 flex-col gap-1"><span className="break-words">{issue.title}</span><span className="text-xs text-muted-foreground">{reviewIssueStateLabel[issue.state]}</span></span>
          </Button>)}
          {view.issues.filter(issue => filter === "ALL" || issue.state === filter).length === 0 && <p className="text-sm text-muted-foreground">暂无此类问题</p>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {creating ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); save("CREATE"); }}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="review-question">问题</Label><Textarea id="review-question" value={draft.title} maxLength={2000} required disabled={pending} onChange={event => edit("title", event.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="review-location">文书位置</Label><Input id="review-location" placeholder="例如：第 2 页第 3 段" value={draft.location} maxLength={500} disabled={pending} onChange={event => edit("location", event.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="review-basis">依据与理由</Label><Textarea id="review-basis" value={draft.basis} maxLength={6000} required disabled={pending} onChange={event => edit("basis", event.target.value)} /></div>
          {view.sourceOptions.length > 0 && <DocumentChoice id="review-basis-document" label="关联依据材料（可选）" value={draft.basisDocumentId} choices={view.sourceOptions} disabled={pending} onChange={value => edit("basisDocumentId", value)} />}
          {view.sourcesTruncated && <p className="text-sm text-muted-foreground">仅显示最近 100 份可读取材料</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => void select(null)}>取消</Button><Button type="submit" disabled={pending || !draft.title.trim() || !draft.basis.trim()}>保存问题</Button></div>
        </form> : selected ? <>
          <div className="flex flex-col gap-2"><div className="flex items-start justify-between gap-3"><h4 className="whitespace-pre-wrap break-words font-medium">{selected.title}</h4><Badge variant="secondary">{reviewIssueStateLabel[selected.state]}</Badge></div>
            {selected.location && <p className="text-sm">{selected.location}</p>}<p className="text-xs text-muted-foreground">{selected.authorName} · {shDayKey(selected.createdAt)} {shTime(selected.createdAt)}</p>
            {selected.basisUnavailable ? <Alert><AlertDescription>依据材料当前不可读取，原文尚不能核实。</AlertDescription></Alert> : <p className="whitespace-pre-wrap break-words text-sm">{selected.basis}</p>}
            {selected.basisDocument && <DocumentLink document={selected.basisDocument} />}
            {!selected.basisDocument && !selected.basisUnavailable && <p className="text-xs text-muted-foreground">未关联依据材料；本条核对范围限于当前文书与处理说明。</p>}
          </div>
          <ol className="flex max-h-[30vh] flex-col gap-4 overflow-y-auto" aria-label="回应与复核历史">{selected.events.map(event => <li key={event.id} className="flex flex-col gap-1.5 border-l pl-3">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{event.kind === "RESPONSE" ? reviewDispositionLabel[event.disposition!] : event.resolved ? "已处理" : "仍未解决"}</Badge><span className="text-xs text-muted-foreground">{event.actorName} · {shDayKey(event.createdAt)} {shTime(event.createdAt)}</span></div>
            <p className="whitespace-pre-wrap break-words text-sm">{event.note ?? "关联来源当前不可读取，处理内容受限"}</p>
            {event.revisionDocument && <><DocumentLink document={event.revisionDocument} /><p className="text-xs text-muted-foreground">修订位置：{event.revisionLocation}</p></>}
            {event.revisionUnavailable && <p className="text-sm text-muted-foreground">修订版当前不可读取；请通过原文书流程取得该版本授权。</p>}
            {event.kind === "RESPONSE" && !event.revisionDocument && !event.revisionUnavailable && <p className="text-xs text-muted-foreground">未关联修订版</p>}
          </li>)}</ol>
          {selected.state !== "RESOLVED" && (view.canRespond || (view.canCheck && selected.state === "WAITING_CHECK")) && <div className="flex flex-col gap-3">
            {view.canRespond && <><div className="flex flex-col gap-1.5"><Label htmlFor="review-disposition">回应</Label><Select value={draft.disposition} disabled={pending} onValueChange={value => edit("disposition", value as typeof draft.disposition)}><SelectTrigger id="review-disposition"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(reviewDispositionLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
              <DocumentChoice id="review-revision" label="实际修订版本（可选）" value={draft.revisionDocumentId} choices={view.revisionOptions} disabled={pending} onChange={value => edit("revisionDocumentId", value)} />
              {draft.revisionDocumentId !== "none" && <div className="flex flex-col gap-1.5"><Label htmlFor="review-revision-location">修订位置</Label><Input id="review-revision-location" value={draft.revisionLocation} maxLength={500} disabled={pending} onChange={event => edit("revisionLocation", event.target.value)} /></div>}
            </>}
            <div className="flex flex-col gap-1.5"><Label htmlFor="review-response-note">{view.canRespond ? "处理说明" : "复核结论"}</Label><Textarea id="review-response-note" value={draft.note} maxLength={6000} disabled={pending} onChange={event => edit("note", event.target.value)} /></div>
            <div className="flex flex-wrap justify-end gap-2">
              {view.canRespond && <Button disabled={pending || !draft.note.trim() || (draft.revisionDocumentId !== "none" && !draft.revisionLocation.trim())} onClick={() => save("RESPONSE")}>保存回应</Button>}
              {view.canCheck && selected.state === "WAITING_CHECK" && <><Button variant="outline" disabled={pending || !draft.note.trim()} onClick={() => save("CHECK", false)}>保留未解决</Button><Button disabled={pending || !draft.note.trim() || !selected.canResolve} onClick={() => save("CHECK", true)}>确认已处理</Button></>}
            </div>
          </div>}
        </> : selectedId ? <Alert><AlertDescription>此问题不存在或当前不可读取，请返回问题列表。</AlertDescription></Alert> : <p className="text-sm text-muted-foreground">选择问题查看处理记录</p>}
      </div>
    </div>}
  </section>;
}
