"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
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

/** Embedded in the existing MatterArchive group. A new matter resets transient dialogs. */
export function MatterContextSection(props: Props) {
  return <ContextSection key={props.matterId} {...props} />;
}

function ContextSection({ matterId, view }: Props) {
  const router = useRouter();
  const titleId = useId();
  const [pending, start] = useTransition();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [history, setHistory] = useState<{ id: string; data: ContextHistoryView | null; error: string } | null>(null);
  const [source, setSource] = useState<{ id: string; data: ContextSourceContent | null; error: string } | null>(null);

  function begin(record: ContextRecordView | null) {
    const key = crypto.randomUUID();
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

  function showHistory(recordId: string, beforeVersion?: number) {
    if (beforeVersion === undefined) setHistory({ id: recordId, data: null, error: "" });
    start(async () => {
      try {
        const data = await getMatterContextHistory(matterId, recordId, beforeVersion);
        setHistory(previous => previous?.id === recordId ? { id: recordId, error: "", data: {
          ...data, records: beforeVersion === undefined ? data.records : [...(previous.data?.records ?? []), ...data.records]
        } } : previous);
      } catch (error) {
        setHistory(previous => previous?.id === recordId ? { ...previous, error: actionErrorMessage(error) } : previous);
      }
    });
  }

  function showSource(recordId: string) {
    setSource({ id: recordId, data: null, error: "" });
    start(async () => {
      try {
        const data = await getMatterContextSource(matterId, recordId);
        setSource(previous => previous?.id === recordId ? { id: recordId, data, error: "" } : previous);
      } catch (error) {
        setSource(previous => previous?.id === recordId ? { id: recordId, data: null, error: actionErrorMessage(error) } : previous);
      }
    });
  }

  async function confirmRecord(record: ContextRecordView) {
    const agreed = await confirmDialog({ title: `核对确认${contextKindLabels[record.kind]}`, confirmText: "确认已核对",
      description: `确认第 ${record.version} 版内容与来源已核对，保留本次核对人和时间；客户授权以真实指示为准。` });
    if (!agreed) return;
    start(async () => {
      try {
        await confirmMatterContextRecord({ matterId, id: record.id, expectedVersion: record.version, acknowledged: true });
        toast.success("核对确认已保存"); router.refresh();
      } catch (error) { toast.error("未能确认", { description: actionErrorMessage(error) }); }
    });
  }

  return (
    <section className="dos-group" aria-labelledby={titleId} id="matter-context">
      <div className="dos-group-h">
        <FileText className="ic" strokeWidth={1.9} /><h2 id={titleId} className="t">目标与指示</h2>
        {view.canWrite ? <span className="a"><button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => begin(null)}><Plus />记录</button></span> : null}
      </div>
      <div className="dos-group-b">
        {view.records.length === 0 ? <p className="t-sm t-mute">尚未记录目标或指示。</p> : <ol className="space-y-4">
          {view.records.map(record => <li key={record.id} className="border-b border-[var(--bd-hair)] pb-4 last:border-0 last:pb-0">
            <RecordContent record={record} onSource={() => showSource(record.id)} />
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => showHistory(record.id)}><History />历史</button>
              {record.canRevise ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => begin(record)}><Pencil />更正</button> : null}
              {record.canConfirm ? <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => void confirmRecord(record)}><Check />核对确认</button> : null}
            </div>
          </li>)}
        </ol>}
        {view.hasMore ? <p className="mt-3 t-xs t-mute">当前显示最近 100 条记录。</p> : null}
      </div>

      <Sheet open={editor !== null} onOpenChange={open => { if (!open && !editorBusy) setEditor(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{editor?.record ? "更正记录" : "记录目标与指示"}</SheetTitle><SheetDescription>保存后待主办或协办核对确认；更正会保留旧版。</SheetDescription></SheetHeader>
          {editor ? <ContextEditor key={editor.key} matterId={matterId} state={editor} canReadFinance={view.canReadFinance} onSaving={setEditorBusy}
            onSaved={() => { setEditor(null); router.refresh(); }} /> : null}
        </SheetContent>
      </Sheet>

      <Sheet open={history !== null} onOpenChange={open => { if (!open) setHistory(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>记录历史</SheetTitle><SheetDescription>按版本倒序查看原记录、来源及当时的核对状态。</SheetDescription></SheetHeader>
          <div className="mt-5 space-y-5">
            {history?.error ? <p role="alert" className="text-sm text-destructive">{history.error}</p> : null}
            {!history?.data && pending ? <p role="status" className="t-sm t-mute">正在读取历史…</p> : null}
            {history?.data?.records.map(record => <article key={record.id} className="border-b border-[var(--bd-hair)] pb-4"><RecordContent record={record} onSource={() => showSource(record.id)} /></article>)}
            {history?.data?.nextBeforeVersion ? <button type="button" disabled={pending} className="btn btn-secondary btn-sm" onClick={() => showHistory(history.id, history.data!.nextBeforeVersion!)}>较早版本</button> : null}
            {history?.error ? <button type="button" disabled={pending} className="btn btn-secondary btn-sm" onClick={() => showHistory(history.id)}>重新读取</button> : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={source !== null} onOpenChange={open => { if (!open) setSource(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{source?.data?.label ?? "查看来源"}</SheetTitle><SheetDescription>按当前资格读取关联原记录。</SheetDescription></SheetHeader>
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

function RecordContent({ record, onSource }: { record: ContextRecordView; onSource: () => void }) {
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
      {record.source?.available ? <button type="button" className="link-inline mt-1 text-xs" onClick={onSource}>{record.source.label}</button> : null}
    </> : <p className="text-sm text-[var(--t-muted)]">关联来源已不可读取，记录正文暂不显示。</p>}
    <p className="mt-2 flex flex-wrap gap-x-2 text-xs text-[var(--t-muted)]"><span>{record.authorName}</span><time dateTime={record.occurredAt}>{when(record.occurredAt)}</time>
      {record.confirmedAt ? <span>核对：{record.confirmedByName} · {when(record.confirmedAt)}</span> : null}
    </p>
  </>;
}

function ContextEditor({ matterId, state, canReadFinance, onSaved, onSaving }: { matterId: string; state: EditorState; canReadFinance: boolean; onSaved: () => void; onSaving: (value: boolean) => void }) {
  const prefix = useId();
  const record = state.record;
  const [kind, setKind] = useState<ContextKind>(record?.kind ?? "GOAL");
  const [visibility, setVisibility] = useState<ContextVisibility>(record?.visibility ?? "MATTER");
  const [content, setContent] = useState(record?.content ?? "");
  const [reason, setReason] = useState(record?.reason ?? "");
  const [sourceDescription, setSourceDescription] = useState(record?.sourceDescription ?? "");
  const [sourceKey, setSourceKey] = useState(record?.source?.id ? `${record.source.type}:${record.source.id}` : "");
  const [occurredAt, setOccurredAt] = useState(() => toShanghaiInput(new Date()));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const choices = state.options?.choices ?? [];
  const previousSource = record?.source?.id && !choices.some(choice => `${choice.type}:${choice.id}` === `${record.source!.type}:${record.source!.id}`) ? record.source : null;

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
    <div className="flex justify-end"><button type="submit" disabled={pending} className="btn btn-primary">{pending ? <Loader2 className="animate-spin" /> : <Check />}保存记录</button></div>
  </form>;
}
