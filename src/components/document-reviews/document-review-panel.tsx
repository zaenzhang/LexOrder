"use client";

import { Banner, Button, Input, RadioGroup, Select, TextArea } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { checkReviewIssue, createReviewIssue, getDocumentReview, respondReviewIssue } from "@/server/document-reviews/actions";
import { reviewDispositionLabel, reviewIssueStateLabel, type DocumentReviewView, type ReviewDocumentOption } from "@/server/document-reviews/contracts";
import type { MaterialSourceLocation } from "@/components/documents/material-source-location-picker";
import { ReviewSourcePicker } from "./review-source-picker";
import { hasReviewPosition, reviewPositionInput, ReviewPositionEditor } from "./review-position-editor";
import { ReviewIssueContent } from "./review-issue-content";
import { PreviousReviewIssues } from "./previous-review-issues";

type Props = { documentId: string; initialIssueId?: string | null; onIssueChange?: (issueId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void };
const EMPTY_POSITION: MaterialSourceLocation = { page: "", position: null };
const EMPTY_DRAFT = { title: "", location: "", basis: "", basisDocumentId: "none", note: "", disposition: "ACCEPT" as "ACCEPT" | "PARTIAL" | "REJECT", revisionDocumentId: "none", revisionLocation: "",
  position: EMPTY_POSITION, basisPosition: EMPTY_POSITION, revisionPosition: EMPTY_POSITION };

function DocumentChoice({ id, label, value, choices, onChange, disabled }: {
  id: string; label: string; value: string; choices: ReviewDocumentOption[]; onChange: (value: string) => void; disabled: boolean;
}) {
  return <div className="flex flex-col gap-1.5"><label id={id + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">{label}</label><Select value={value} onChange={value => { if (typeof value === "string") onChange(value); }} disabled={disabled} id={id} aria-labelledby={id + "-label"} className="w-full" motion={false}><Select.Option value="none">不关联材料</Select.Option>{choices.map(document => <Select.Option key={document.id} value={document.id}>{document.name} · 第 {document.version} 版</Select.Option>)}</Select></div>;
}

/** One panel is shared by the matter and the original approval entry. */
export function DocumentReviewPanel({ documentId, initialIssueId, onIssueChange, onDirtyChange, onPendingChange }: Props) {
  const [view, setView] = useState<DocumentReviewView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialIssueId ?? null);
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [basisDocument, setBasisDocument] = useState<ReviewDocumentOption | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const loadSequence = useRef(0);
  const lastInitialIssueId = useRef(initialIssueId);
  const selected = view?.issues.find(issue => issue.id === selectedId);
  const dirty = Boolean(draft.title || draft.location || draft.basis || draft.note || draft.revisionLocation || draft.basisDocumentId !== "none" || draft.revisionDocumentId !== "none" || draft.disposition !== "ACCEPT"
    || hasReviewPosition(draft.position) || hasReviewPosition(draft.basisPosition) || hasReviewPosition(draft.revisionPosition));
  const revisionDocument = view?.revisionOptions.find(document => document.id === draft.revisionDocumentId);

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
  function edit<K extends keyof typeof EMPTY_DRAFT>(key: K, value: (typeof EMPTY_DRAFT)[K]) {
    setDraft(previous => ({ ...previous, [key]: value,
      ...(key === "basisDocumentId" && value !== previous.basisDocumentId ? { basisPosition: EMPTY_POSITION } : {}),
      ...(key === "revisionDocumentId" && value !== previous.revisionDocumentId ? { revisionPosition: EMPTY_POSITION } : {}),
    })); setRequestId(crypto.randomUUID());
  }
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
        const result = kind === "CREATE" ? await createReviewIssue({ requestId, documentId, title: draft.title, location: draft.location || null, basis: draft.basis, basisDocumentId: draft.basisDocumentId === "none" ? null : draft.basisDocumentId,
          position: reviewPositionInput(draft.position), basisPosition: reviewPositionInput(draft.basisPosition) })
          : kind === "RESPONSE" ? await respondReviewIssue({ requestId, issueId: selected!.id, expectedVersion: selected!.version, disposition: draft.disposition,
            note: draft.note, revisionDocumentId: draft.revisionDocumentId === "none" ? null : draft.revisionDocumentId, revisionLocation: draft.revisionLocation || null,
            revisionPosition: reviewPositionInput(draft.revisionPosition) })
            : await checkReviewIssue({ requestId, issueId: selected!.id, expectedVersion: selected!.version, resolved: resolved === true, note: draft.note });
        setDraft(EMPTY_DRAFT); setCreating(false); setRequestId(crypto.randomUUID()); setSelectedId(result.id); onIssueChange?.(result.id); await reload();
      } catch (cause) { setError(actionErrorMessage(cause)); }
    });
  }

  return <section className="flex min-w-0 flex-col gap-4" aria-label="文书复核问题">
    <div className="flex items-center justify-between gap-3"><h3 className="font-medium">复核问题</h3>{view?.canCreate && <Button disabled={pending} onClick={() => void select(null, true)} theme="solid" size="small">提出问题</Button>}</div>
    {view && <PreviousReviewIssues key={documentId} documentId={documentId} items={view.previousIssues} disabled={pending} />}
    {error && <Banner type="danger" closeIcon={null} fullMode={false} description={<> <div className="flex flex-col gap-2"><span>{error}</span><Button disabled={pending || loading} onClick={() => void reload()} type="tertiary" theme="outline" size="small">刷新记录</Button></div></>} />}
    {loading && !view && <p role="status">正在读取复核记录…</p>}
    {view && <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <RadioGroup
          type="button"
          aria-label="复核问题状态"
          value={filter}
          disabled={pending}
          onChange={event => setFilter(event.target.value)}
          options={[{ value: "ALL", label: "全部" }, { value: "OPEN", label: "未处理" }, { value: "WAITING_CHECK", label: "待复核" }, { value: "RESOLVED", label: "已处理" }]}
        />
        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
          {view.issues.filter(issue => filter === "ALL" || issue.state === filter).map(issue => <Button key={issue.id} className="h-auto justify-start whitespace-normal text-left" disabled={pending} onClick={() => void select(issue.id)} type={selectedId === issue.id ? "primary" : "tertiary"} theme={selectedId === issue.id ? "light" : "borderless"}>
            <span className="flex min-w-0 flex-col gap-1"><span className="break-words">{issue.title}</span><span className="text-xs text-muted-foreground">{reviewIssueStateLabel[issue.state]}</span></span>
          </Button>)}
          {view.issues.filter(issue => filter === "ALL" || issue.state === filter).length === 0 && <p className="text-sm text-muted-foreground">暂无此类问题</p>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {creating ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); save("CREATE"); }}>
          <div className="flex flex-col gap-1.5"><label htmlFor="review-question" className="text-sm font-medium text-[var(--semi-color-text-1)]">问题</label><TextArea id="review-question" value={draft.title} maxLength={2000} required disabled={pending} onChange={inputValue => edit("title", inputValue)} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="review-location" className="text-sm font-medium text-[var(--semi-color-text-1)]">文书位置</label><Input id="review-location" placeholder="例如：第 2 页第 3 段" value={draft.location} maxLength={500} disabled={pending} onChange={inputValue => edit("location", inputValue)} /></div>
          <div className="space-y-2"><p className="text-sm font-medium">固定问题位置（可选）</p>
            <ReviewPositionEditor documentId={documentId} matterId={view.matterId} slot="SUBJECT" document={view.document}
              value={draft.position} onChange={value => edit("position", value)} disabled={pending} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="review-basis" className="text-sm font-medium text-[var(--semi-color-text-1)]">依据与理由</label><TextArea id="review-basis" value={draft.basis} maxLength={6000} required disabled={pending} onChange={inputValue => edit("basis", inputValue)} /></div>
          {view.canBrowseSources && <ReviewSourcePicker key={documentId} documentId={documentId} initialOptions={view.sourceOptions}
            initialNextCursor={view.sourceNextCursor} value={draft.basisDocumentId} disabled={pending} onChange={value => edit("basisDocumentId", value)} onSelectedDocument={setBasisDocument} />}
          {basisDocument?.id === draft.basisDocumentId && <div className="space-y-2"><p className="text-sm font-medium">固定依据位置（可选）</p>
            <ReviewPositionEditor documentId={documentId} matterId={view.matterId} slot="BASIS" document={basisDocument}
              value={draft.basisPosition} onChange={value => edit("basisPosition", value)} disabled={pending} /></div>}
          <div className="flex justify-end gap-2"><Button disabled={pending} onClick={() => void select(null)} htmlType="button" type="tertiary" theme="outline">取消</Button><Button disabled={pending || !draft.title.trim() || !draft.basis.trim()} htmlType="submit" theme="solid">保存问题</Button></div>
        </form> : selected ? <>
          <ReviewIssueContent issue={selected} />
          {selected.state !== "RESOLVED" && (view.canRespond || (view.canCheck && selected.state === "WAITING_CHECK")) && <div className="flex flex-col gap-3">
            {view.canRespond && <><div className="flex flex-col gap-1.5"><label id={"review-disposition" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">回应</label><Select value={draft.disposition} disabled={pending} onChange={value => { if (typeof value === "string") edit("disposition", value as typeof draft.disposition); }} id="review-disposition" aria-labelledby={"review-disposition" + "-label"} className="w-full" motion={false}>{Object.entries(reviewDispositionLabel).map(([value, label]) => <Select.Option key={value} value={value}>{label}</Select.Option>)}</Select></div>
              <DocumentChoice id="review-revision" label="实际修订版本（可选）" value={draft.revisionDocumentId} choices={view.revisionOptions} disabled={pending} onChange={value => edit("revisionDocumentId", value)} />
              {draft.revisionDocumentId !== "none" && <div className="flex flex-col gap-1.5"><label htmlFor="review-revision-location" className="text-sm font-medium text-[var(--semi-color-text-1)]">修订位置</label><Input id="review-revision-location" value={draft.revisionLocation} maxLength={500} disabled={pending} onChange={inputValue => edit("revisionLocation", inputValue)} /></div>}
              {revisionDocument && <div className="space-y-2"><p className="text-sm font-medium">固定修订位置（可选）</p>
                <ReviewPositionEditor documentId={documentId} matterId={view.matterId} slot="REVISION" document={revisionDocument}
                  value={draft.revisionPosition} onChange={value => edit("revisionPosition", value)} disabled={pending} /></div>}
            </>}
            <div className="flex flex-col gap-1.5"><label htmlFor="review-response-note" className="text-sm font-medium text-[var(--semi-color-text-1)]">{view.canRespond ? "处理说明" : "复核结论"}</label><TextArea id="review-response-note" value={draft.note} maxLength={6000} disabled={pending} onChange={inputValue => edit("note", inputValue)} /></div>
            <div className="flex flex-wrap justify-end gap-2">
              {view.canRespond && <Button disabled={pending || !draft.note.trim() || (draft.revisionDocumentId !== "none" && !draft.revisionLocation.trim() && !hasReviewPosition(draft.revisionPosition))} onClick={() => save("RESPONSE")} theme="solid">保存回应</Button>}
              {view.canCheck && selected.state === "WAITING_CHECK" && <><Button disabled={pending || !draft.note.trim()} onClick={() => save("CHECK", false)} type="tertiary" theme="outline">保留未解决</Button><Button disabled={pending || !draft.note.trim() || !selected.canResolve} onClick={() => save("CHECK", true)} theme="solid">确认已处理</Button></>}
            </div>
          </div>}
        </> : selectedId ? <Banner type="warning" closeIcon={null} fullMode={false} description="此问题不存在或当前不可读取，请返回问题列表。" /> : <p className="text-sm text-muted-foreground">选择问题查看处理记录</p>}
      </div>
    </div>}
  </section>;
}
