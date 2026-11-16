"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, History, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { fromShanghaiInput, toShanghaiInput } from "@/lib/clients/relationship";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { contextTextSummary } from "@/lib/matters/context-source-labels";
import {
  contextKindLabels, contextVisibilityLabels, type ContextKind, type ContextVisibility,
  type MatterContextView, type ContextRecordView, type ContextHistoryView, type ContextSourceContent,
  type ContextSourceOptions, type ContextRecordInput
} from "@/lib/matters/context";
import {
  recordMatterContext, confirmMatterContextRecord, getMatterContextHistory, getMatterContextSource, getMatterContextSourceOptions
} from "@/server/matters/context-actions";

const when = (value: string) => `${shDayKey(value)} ${shTime(value)}`;
type Props = { matterId: string; view: MatterContextView };
type EditorState = { key: string; record: ContextRecordView | null; options: ContextSourceOptions | null; error: string };

function restoreFocus(...targets: (HTMLElement | null)[]) {
  for (const target of targets) {
    if (!target?.isConnected || target.matches(":disabled") || target.closest("[hidden], [inert]")) continue;
    target.focus({ preventScroll: true });
    if (document.activeElement === target) return;
  }
}

/** Embedded in the existing MatterArchive group. A new matter resets transient dialogs. */
export function MatterContextSection(props: Props) {
  return <ContextSection key={props.matterId} {...props} />;
}

function ContextSection({ matterId, view }: Props) {
  const router = useRouter();
  const titleId = useId();
  const sectionTitle = useRef<HTMLHeadingElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const editorContent = useRef<HTMLDivElement>(null);
  const editorClosePending = useRef(false);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const sourceFromHistory = useRef(false);
  const [pending, start] = useTransition();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [history, setHistory] = useState<{ id: string; kind: ContextKind; data: ContextHistoryView | null; error: string } | null>(null);
  const [source, setSource] = useState<{ id: string; recordLabel: string; data: ContextSourceContent | null; error: string } | null>(null);

  function begin(record: ContextRecordView | null, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    const key = crypto.randomUUID();
    setEditorDirty(false);
    setEditor({ key, record, options: null, error: "" });
    start(async () => {
      try {
        const options = await getMatterContextSourceOptions(matterId);
        setEditor(previous => previous?.key === key ? { ...previous, options } : previous);
      } catch (error) {
        setEditor(previous => previous?.key === key ? { ...previous, options: { choices: [], truncated: false }, error: actionErrorMessage(error) } : previous);
      }
    });
  }

  async function closeEditor() {
    if (!editor || editorBusy || editorClosePending.current) return;
    const key = editor.key;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editorClosePending.current = true;
    try {
      if (editorDirty && !await confirmDialog({
        title: "放弃未保存的记录？",
        confirmText: "放弃记录",
        cancelText: "继续编辑",
        initialFocus: "cancel",
      })) {
        requestAnimationFrame(() => restoreFocus(returnFocus, editorContent.current));
        return;
      }
      setEditor(current => current?.key === key ? null : current);
    } finally {
      editorClosePending.current = false;
    }
  }

  function showHistory(record: Pick<ContextRecordView, "id" | "kind">, beforeVersion?: number, trigger?: HTMLButtonElement) {
    const recordId = record.id;
    if (trigger) historyTrigger.current = trigger;
    if (beforeVersion === undefined) setHistory({ id: recordId, kind: record.kind, data: null, error: "" });
    start(async () => {
      try {
        const data = await getMatterContextHistory(matterId, recordId, beforeVersion);
        setHistory(previous => previous?.id === recordId ? { ...previous, error: "", data: {
          ...data, records: beforeVersion === undefined ? data.records : [...(previous.data?.records ?? []), ...data.records]
        } } : previous);
      } catch (error) {
        setHistory(previous => previous?.id === recordId ? { ...previous, error: actionErrorMessage(error) } : previous);
      }
    });
  }

  function showSource(record: ContextRecordView, trigger: HTMLButtonElement, fromHistory = false) {
    const recordId = record.id;
    sourceTrigger.current = trigger;
    sourceFromHistory.current = fromHistory;
    setSource({ id: recordId, recordLabel: `${contextKindLabels[record.kind]}第 ${record.version} 版`, data: null, error: "" });
    start(async () => {
      try {
        const data = await getMatterContextSource(matterId, recordId);
        setSource(previous => previous?.id === recordId ? { ...previous, data, error: "" } : previous);
      } catch (error) {
        setSource(previous => previous?.id === recordId ? { ...previous, data: null, error: actionErrorMessage(error) } : previous);
      }
    });
  }

  async function confirmRecord(record: ContextRecordView) {
    const summary = record.readable ? contextTextSummary(record.content, 160) : "";
    const agreed = await confirmDialog({ title: `核对确认${contextKindLabels[record.kind]}记录（第 ${record.version} 版）`, confirmText: "确认已核对", initialFocus: "cancel",
      description: `${summary ? `本条内容：“${summary}”\n\n` : ""}确认第 ${record.version} 版内容与来源已核对，保留本次核对人和时间；客户授权以真实指示为准。` });
    if (!agreed) return;
    start(async () => {
      try {
        await confirmMatterContextRecord({ matterId, id: record.id, expectedVersion: record.version, acknowledged: true });
        toast.success("核对确认已保存"); router.refresh();
      } catch (error) { toast.error("未能确认", { description: actionErrorMessage(error) }); }
    });
  }

  return (
    <section className="dos-group scroll-mt-44" aria-labelledby={titleId} id="matter-context">
      <div className="dos-group-h">
        <FileText className="ic" strokeWidth={1.9} /><h2 ref={sectionTitle} tabIndex={-1} id={titleId} className="t">目标与指示</h2>
        {view.canWrite ? <span className="a"><button ref={addTrigger} type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={event => begin(null, event.currentTarget)}><Plus />记录目标或指示</button></span> : null}
      </div>
      <div className="dos-group-b">
        {view.records.length === 0 ? <p className="t-sm t-mute">尚未记录目标或指示。</p> : <ol className="space-y-4">
          {view.records.map(record => <li key={record.id} className="border-b border-[var(--bd-hair)] pb-4 last:border-0 last:pb-0">
            <RecordContent record={record} onSource={trigger => showSource(record, trigger)} />
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} aria-label={`查看${contextKindLabels[record.kind]}记录的历史版本`} onClick={event => showHistory(record, undefined, event.currentTarget)}><History />查看历史版本</button>
              {record.canRevise ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending} aria-label={`更正${contextKindLabels[record.kind]}第 ${record.version} 版记录`} onClick={event => begin(record, event.currentTarget)}><Pencil />更正此记录</button> : null}
              {record.canConfirm ? <button type="button" className="btn btn-secondary btn-sm" disabled={pending} aria-label={`核对确认${contextKindLabels[record.kind]}第 ${record.version} 版记录`} onClick={() => void confirmRecord(record)}><Check />核对确认此版本</button> : null}
            </div>
          </li>)}
        </ol>}
        {view.hasMore ? <p className="mt-3 t-xs t-mute">当前显示最近 100 条记录。</p> : null}
      </div>

      <Sheet open={editor !== null} onOpenChange={open => { if (!open) void closeEditor(); }}>
        <SheetContent ref={editorContent} className="w-full overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(editorTrigger.current, addTrigger.current, sectionTitle.current); }}>
          <SheetHeader><SheetTitle>{editor?.record ? `更正${contextKindLabels[editor.record.kind]}记录（当前第 ${editor.record.version} 版）` : "记录目标或指示"}</SheetTitle><SheetDescription>{editor?.record ? `保存为第 ${editor.record.version + 1} 版，保留第 ${editor.record.version} 版；新版需重新核对确认。` : "保存后待主办或协办核对确认。"}</SheetDescription></SheetHeader>
          {editor ? <ContextEditor key={editor.key} matterId={matterId} state={editor} canReadFinance={view.canReadFinance} onSaving={setEditorBusy} onDirtyChange={setEditorDirty}
            onSaved={() => { setEditor(null); router.refresh(); }} /> : null}
        </SheetContent>
      </Sheet>

      <Sheet open={history !== null} onOpenChange={open => { if (!open) setHistory(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(historyTrigger.current, addTrigger.current, sectionTitle.current); }}>
          <SheetHeader><SheetTitle ref={historyTitle} tabIndex={-1}>{history ? `${contextKindLabels[history.kind]}的历史版本` : "记录的历史版本"}</SheetTitle><SheetDescription>按版本倒序查看原记录、来源及当时的核对状态。</SheetDescription></SheetHeader>
          <div className="mt-5 space-y-5">
            {history?.error ? <p role="alert" className="text-sm text-destructive">{history.error}</p> : null}
            {!history?.data && pending ? <p role="status" className="t-sm t-mute">正在读取历史…</p> : null}
            {history?.data?.records.map(record => <article key={record.id} className="border-b border-[var(--bd-hair)] pb-4"><RecordContent record={record} onSource={trigger => showSource(record, trigger, true)} /></article>)}
            {history?.data?.nextBeforeVersion ? <button type="button" disabled={pending} className="btn btn-secondary btn-sm" onClick={() => showHistory(history, history.data!.nextBeforeVersion!)}>查看更早版本</button> : null}
            {history?.error ? <button type="button" disabled={pending} className="btn btn-secondary btn-sm" onClick={() => showHistory(history)}>重新读取历史版本</button> : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={source !== null} onOpenChange={open => { if (!open) setSource(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => {
          event.preventDefault();
          restoreFocus(sourceTrigger.current, sourceFromHistory.current && history !== null ? historyTitle.current : null, addTrigger.current, sectionTitle.current);
        }}>
          <SheetHeader><SheetTitle>{source ? `${source.recordLabel}的来源` : "查看记录来源"}</SheetTitle><SheetDescription>{source?.data?.label ?? "按当前资格读取关联原记录。"}</SheetDescription></SheetHeader>
          <div className="mt-5 space-y-4">
            {source?.error ? <p role="alert" className="text-sm text-destructive">{source.error}</p> : null}
            {!source?.data && !source?.error ? <p role="status" className="t-sm t-mute">正在读取来源…</p> : null}
            {source?.data?.content ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{source.data.content}</p> : null}
            {source?.data?.href ? <a className="btn btn-secondary" href={source.data.href} target="_blank" rel="noopener noreferrer">打开来源原件</a> : null}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function RecordContent({ record, onSource }: { record: ContextRecordView; onSource: (trigger: HTMLButtonElement) => void }) {
  return <>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--t-muted)]">
      <span className="font-medium text-foreground">{contextKindLabels[record.kind]}</span><span>第 {record.version} 版</span>
      <span className={`badge ${record.confirmationStatus === "CONFIRMED" ? "b-teal" : "b-amber"}`}>{record.confirmationStatus === "CONFIRMED" ? "已核对" : record.version > 1 ? "新版待核对" : "待核对"}</span>
      {record.visibility === "FINANCE" ? <span className="badge b-white">财务范围</span> : null}
    </div>
    {record.readable ? <>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{record.content}</p>
      {record.reason ? <p className="mt-2 whitespace-pre-wrap break-words text-sm"><span className="t-mute">理由：</span>{record.reason}</p> : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[var(--t-muted)]">来源：{record.sourceDescription}</p>
      {record.source?.available ? <button type="button" className="link-inline mt-1 text-xs" aria-label={`查看${contextKindLabels[record.kind]}第 ${record.version} 版的来源：${record.source.label}`} onClick={event => onSource(event.currentTarget)}>查看来源：{record.source.label}</button> : null}
    </> : <p className="text-sm text-[var(--t-muted)]">关联来源已不可读取，记录正文暂不显示。</p>}
    <p className="mt-2 flex flex-wrap gap-x-2 text-xs text-[var(--t-muted)]"><span>{record.authorName}</span><time dateTime={record.occurredAt}>{when(record.occurredAt)}</time>
      {record.confirmedAt ? <span>核对：{record.confirmedByName} · {when(record.confirmedAt)}</span> : null}
    </p>
  </>;
}

function ContextEditor({ matterId, state, canReadFinance, onSaved, onSaving, onDirtyChange }: { matterId: string; state: EditorState; canReadFinance: boolean; onSaved: () => void; onSaving: (value: boolean) => void; onDirtyChange: (value: boolean) => void }) {
  const prefix = useId();
  const record = state.record;
  const [kind, setKind] = useState<ContextKind>(record?.kind ?? "GOAL");
  const [visibility, setVisibility] = useState<ContextVisibility>(record?.visibility ?? "MATTER");
  const [content, setContent] = useState(record?.content ?? "");
  const [reason, setReason] = useState(record?.reason ?? "");
  const [sourceDescription, setSourceDescription] = useState(record?.sourceDescription ?? "");
  const [sourceKey, setSourceKey] = useState(record?.source?.id ? `${record.source.type}:${record.source.id}` : "");
  const [initialOccurredAt] = useState(() => toShanghaiInput(new Date()));
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const choices = state.options?.choices ?? [];
  const previousSource = record?.source?.id && !choices.some(choice => `${choice.type}:${choice.id}` === `${record.source!.type}:${record.source!.id}`) ? record.source : null;
  const dirty = kind !== (record?.kind ?? "GOAL") || visibility !== (record?.visibility ?? "MATTER")
    || content !== (record?.content ?? "") || reason !== (record?.reason ?? "")
    || sourceDescription !== (record?.sourceDescription ?? "")
    || sourceKey !== (record?.source?.id ? `${record.source.type}:${record.source.id}` : "")
    || occurredAt !== initialOccurredAt;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    let input: ContextRecordInput;
    try {
      const [sourceType, sourceId] = sourceKey.split(":");
      input = { matterId, requestKey: state.key, supersedesId: record?.id, kind, visibility, content, reason,
        sourceDescription, occurredAt: fromShanghaiInput(occurredAt),
        sourceDocumentId: sourceType === "DOCUMENT" ? sourceId : null,
        sourceNoteId: sourceType === "NOTE" ? sourceId : null,
        sourceClientActivityId: sourceType === "CLIENT_ACTIVITY" ? sourceId : null };
    } catch (issue) { setError(actionErrorMessage(issue)); return; }
    onSaving(true);
    start(async () => {
      try { await recordMatterContext(input); toast.success("记录已保存，待核对确认"); onSaved(); }
      catch (issue) { setError(actionErrorMessage(issue) || "保存失败，请重试"); }
      finally { onSaving(false); }
    });
  }

  return <form onSubmit={submit} className="mt-5 space-y-4">
    <fieldset disabled={pending} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`${prefix}-kind`}>记录类型</Label><select id={`${prefix}-kind`} value={kind} disabled={Boolean(record)} onChange={event => setKind(event.target.value as ContextKind)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{Object.entries(contextKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor={`${prefix}-visibility`}>可见范围</Label><select id={`${prefix}-visibility`} value={visibility} disabled={Boolean(record)} onChange={event => setVisibility(event.target.value as ContextVisibility)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{Object.entries(contextVisibilityLabels).filter(([value]) => value !== "FINANCE" || canReadFinance).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-content`}>内容 *</Label><Textarea id={`${prefix}-content`} required maxLength={8000} rows={6} value={content} onChange={event => setContent(event.target.value)} /></div>
      {kind === "CONSTRAINT" ? <p className="t-xs t-mute">费用及预算约束请选择财务可见范围。</p> : null}
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-occurred`}>发生时间（北京时间）*</Label><Input id={`${prefix}-occurred`} type="datetime-local" required value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-reason`}>{record ? "更正或决定理由" : "理由"}</Label><Textarea id={`${prefix}-reason`} rows={2} maxLength={3000} value={reason} onChange={event => setReason(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-source`}>关联来源</Label><select id={`${prefix}-source`} value={sourceKey} onChange={event => setSourceKey(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">仅填写来源说明</option>
        {previousSource ? <option value={`${previousSource.type}:${previousSource.id}`}>{previousSource.label}</option> : null}
        {choices.map(choice => <option key={`${choice.type}:${choice.id}`} value={`${choice.type}:${choice.id}`}>{choice.label}</option>)}
      </select>{state.options === null ? <p role="status" className="t-xs t-mute">正在读取可关联来源…</p> : null}
      {state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
      {state.options?.truncated ? <p className="t-xs t-mute">仅列出最近材料与沟通；其他来源请在下方准确说明。</p> : null}</div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-source-description`}>来源说明 *</Label><Textarea id={`${prefix}-source-description`} required rows={3} maxLength={1200} value={sourceDescription} onChange={event => setSourceDescription(event.target.value)} placeholder="指示人、沟通方式、原件位置或其他真实依据" /></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end"><button type="submit" disabled={pending} className="btn btn-primary">{pending ? <Loader2 className="animate-spin" /> : <Check />}{record ? "保存更正版" : "保存记录"}</button></div>
  </form>;
}
