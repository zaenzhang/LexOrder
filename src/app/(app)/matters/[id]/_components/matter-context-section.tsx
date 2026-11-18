"use client";

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { FocusButton } from "@/components/patterns/focus-button";
import { Button as SemiButton } from "@douyinfe/semi-ui";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, FileText, History, Loader2, Pencil, Plus } from "lucide-react";
import { Select, Input, Notification, TextArea, Toast } from "@douyinfe/semi-ui";
import { WorkspaceDialog, DrawerContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker, ContextInputsSummary } from "@/components/matters/context-input-picker";
import { carriedContextInputs } from "@/lib/matters/context-inputs";
import { actionErrorMessage } from "@/lib/action-error";
import { fromShanghaiInput, toShanghaiInput } from "@/lib/clients/relationship";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { contextTextSummary } from "@/lib/matters/context-source-labels";
import { clientHistoryReturnHref } from "@/lib/clients/navigation";
import { updateDossierLocation } from "@/lib/matters/dossier-location";
import {
  contextKindLabels, contextVisibilityLabels, type ContextKind, type ContextVisibility,
  type MatterContextView, type ContextRecordView, type ContextHistoryView, type ContextSourceContent,
  type ContextSourceOptions, type ContextSourcePageInput, type ContextSourceType, type ContextRecordInput
} from "@/lib/matters/context";
import {
  recordMatterContext, confirmMatterContextRecord, getMatterContext, getMatterContextRecord, getMatterContextHistory, getMatterContextSource, getMatterContextSourceOptions
} from "@/server/matters/context-actions";

const when = (value: string) => `${shDayKey(value)} ${shTime(value)}`;
type Props = { matterId: string; view: MatterContextView | null; error?: string | null };
type EditorState = { key: string; record: ContextRecordView | null; options: ContextSourceOptions | null; loading: boolean; error: string; failedPage?: ContextSourcePageInput };
const sourceMoreLabels: Record<ContextSourceType, string> = { DOCUMENT: "更多材料", NOTE: "更多事项沟通", CLIENT_ACTIVITY: "更多客户沟通" };

function restoreFocus(...targets: (HTMLElement | null)[]) {
  for (const target of targets) {
    if (!target?.isConnected || target.matches(":disabled") || target.closest("[hidden], [inert]")) continue;
    target.focus({ preventScroll: true });
    if (document.activeElement === target) return;
  }
}

/** Only the overview hides on query navigation; the current matter's Sheets remain mounted. */
export function MatterContextSection(props: Props) {
  return <ContextSection key={props.matterId} {...props} />;
}

function ContextSection({ matterId, view, error: initialError = null }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRecordId = searchParams.get("contextRecord");
  const exactLocationValid = searchParams.getAll("contextRecord").length <= 1;
  const historyReturnHref = searchParams.getAll("contextReturnTo").length === 1 ? clientHistoryReturnHref(searchParams.get("contextReturnTo")) : null;
  const overviewVisible = (searchParams.get("view") ?? "archive") === "archive";
  const scope = useMemo(() => ({ matterId, view, initialError }), [matterId, view, initialError]);
  type PageState = { scope: typeof scope; data: MatterContextView | null; cursor: string | null; previous: (string | null)[]; pending: boolean; error: string };
  const [pageState, setPageState] = useState<PageState>({ scope, data: view, cursor: null, previous: [], pending: false, error: initialError ?? "" });
  const livePage = useRef<{ scope: typeof scope | null; serial: number }>({ scope: null, serial: 0 });
  const historyRequest = useRef(0);
  const sourceRequest = useRef(0);
  const exactRequest = useRef(0);
  const page = pageState.scope === scope ? pageState : { scope, data: view, cursor: null, previous: [], pending: false, error: initialError ?? "" };
  useLayoutEffect(() => {
    livePage.current = { scope, serial: livePage.current.serial + 1 };
    historyRequest.current++;
    sourceRequest.current++;
    return () => {
      livePage.current = { scope: null, serial: livePage.current.serial + 1 };
    };
  }, [scope]);
  const titleId = useId();
  const sectionTitle = useRef<HTMLHeadingElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const editorContent = useRef<HTMLDivElement>(null);
  const editorClosePending = useRef(false);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const exactTitle = useRef<HTMLHeadingElement>(null);
  const sourceFromHistory = useRef(false);
  const sourceFromExact = useRef(false);
  const [pending, start] = useTransition();
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [history, setHistory] = useState<{ id: string; kind: ContextKind; scope: typeof scope; data: ContextHistoryView | null; loading: boolean; error: string } | null>(null);
  const [source, setSource] = useState<{ id: string; recordLabel: string; exactRecordId?: string; scope: typeof scope; data: ContextSourceContent | null; loading: boolean; error: string } | null>(null);
  const [exactAttempt, setExactAttempt] = useState(0);
  const [exact, setExact] = useState<{ id: string; locationValid: boolean; scope: typeof scope; data: ContextRecordView | null; loading: boolean; error: string } | null>(null);
  // A new server payload is authoritative before effects run. Editor state stays independent.
  const historyData = history?.scope === scope ? history.data : null;
  const sourceVisible = source !== null && (requestedRecordId === null ? !source.exactRecordId
    : exactLocationValid && source.exactRecordId === requestedRecordId);
  const sourceData = sourceVisible && source?.scope === scope ? source.data : null;
  const historyLoading = history?.scope === scope && history.loading;
  const sourceLoading = source?.scope === scope && source.loading;
  const historyError = history && history.scope !== scope ? initialError || "记录已更新，请重新读取历史。" : history?.error;
  const sourceError = source && source.scope !== scope ? initialError || "记录已更新，请重新读取来源。" : source?.error;
  const exactCurrent = exact?.locationValid === exactLocationValid && exact.id === requestedRecordId && exact.scope === scope ? exact : null;

  useEffect(() => {
    const serial = ++exactRequest.current;
    if (requestedRecordId === null) { setExact(null); return; }
    // Opening a precise read never replaces the current editor or its unsaved input.
    historyRequest.current++; setHistory(null);
    sourceRequest.current++; setSource(null);
    setExact({ id: requestedRecordId, locationValid: exactLocationValid, scope, data: null, loading: true, error: "" });
    const read = exactLocationValid ? getMatterContextRecord(matterId, requestedRecordId)
      : Promise.reject(new Error("记录位置无效，请返回客户动态重新打开"));
    void read.then(data => {
      if (serial === exactRequest.current && livePage.current.scope === scope) setExact({ id: requestedRecordId, locationValid: exactLocationValid, scope, data, loading: false, error: "" });
    }).catch(error => {
      if (serial === exactRequest.current && livePage.current.scope === scope) setExact({ id: requestedRecordId, locationValid: exactLocationValid, scope, data: null, loading: false,
        error: actionErrorMessage(error) || "记录读取失败，请重试" });
    });
  }, [matterId, requestedRecordId, exactLocationValid, scope, exactAttempt]);

  function closeExact() {
    exactRequest.current++;
    sourceRequest.current++;
    if (source?.exactRecordId) setSource(null);
    setExact(null);
    updateDossierLocation({ contextRecord: null, contextReturnTo: null }, "replace");
  }

  async function loadRecords(cursor: string | null, previous: (string | null)[]) {
    const serial = ++livePage.current.serial;
    setPageState({ scope, data: null, cursor, previous, pending: true, error: "" });
    try {
      const data = await getMatterContext(matterId, cursor ?? undefined);
      if (livePage.current.scope === scope && livePage.current.serial === serial) setPageState({ scope, data, cursor, previous, pending: false, error: "" });
    } catch (error) {
      if (livePage.current.scope === scope && livePage.current.serial === serial) setPageState({ scope, data: null, cursor, previous, pending: false, error: actionErrorMessage(error) });
    }
  }

  async function loadSources(key: string, request?: ContextSourcePageInput) {
    setEditor(previous => previous?.key === key ? { ...previous, loading: true, error: "", failedPage: undefined, ...(request ? {} : { options: null }) } : previous);
    try {
      const next = await getMatterContextSourceOptions(matterId, request);
      setEditor(previous => {
        if (previous?.key !== key) return previous;
        const options = request && previous.options ? {
          choices: [...new Map([...previous.options.choices, ...next.choices].map(choice => [`${choice.type}:${choice.id}`, choice])).values()],
          nextCursors: { ...previous.options.nextCursors, [request.type]: next.nextCursors[request.type] },
        } : next;
        return { ...previous, options, loading: false, error: "" };
      });
    } catch (error) {
      setEditor(previous => previous?.key === key ? { ...previous, loading: false, error: actionErrorMessage(error), failedPage: request } : previous);
    }
  }

  function begin(record: ContextRecordView | null, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    const key = crypto.randomUUID();
    setEditorDirty(false);
    setEditor({ key, record, options: null, loading: true, error: "" });
    void loadSources(key);
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

  async function showHistory(record: Pick<ContextRecordView, "id" | "kind">, beforeVersion?: number, trigger?: HTMLButtonElement) {
    const recordId = record.id;
    const serial = ++historyRequest.current;
    if (trigger) historyTrigger.current = trigger;
    if (beforeVersion === undefined) setHistory({ id: recordId, kind: record.kind, scope, data: null, loading: true, error: "" });
    else setHistory(previous => previous?.id === recordId && previous.scope === scope ? { ...previous, loading: true, error: "" } : previous);
    try {
      const data = await getMatterContextHistory(matterId, recordId, beforeVersion);
      if (historyRequest.current === serial && livePage.current.scope === scope) {
        setHistory(previous => previous?.id === recordId && previous.scope === scope ? { ...previous, loading: false, error: "", data: {
          ...data, records: beforeVersion === undefined ? data.records : [...(previous.data?.records ?? []), ...data.records]
        } } : previous);
      }
    } catch (error) {
      if (historyRequest.current === serial && livePage.current.scope === scope) {
        setHistory(previous => previous?.id === recordId && previous.scope === scope ? { ...previous, data: null, loading: false, error: actionErrorMessage(error) } : previous);
      }
    }
  }

  function showSource(record: ContextRecordView, trigger: HTMLButtonElement, fromHistory = false, fromExact = false) {
    sourceTrigger.current = trigger;
    sourceFromHistory.current = fromHistory;
    sourceFromExact.current = fromExact;
    void loadSource(record.id, `${contextKindLabels[record.kind]}第 ${record.version} 版`, fromExact ? requestedRecordId ?? undefined : undefined);
  }

  async function loadSource(recordId: string, recordLabel: string, exactRecordId?: string) {
    const serial = ++sourceRequest.current;
    setSource({ id: recordId, recordLabel, exactRecordId, scope, data: null, loading: true, error: "" });
    try {
      const data = await getMatterContextSource(matterId, recordId);
      if (sourceRequest.current === serial && livePage.current.scope === scope) {
        setSource(previous => previous?.id === recordId && previous.scope === scope ? { ...previous, data, loading: false, error: "" } : previous);
      }
    } catch (error) {
      if (sourceRequest.current === serial && livePage.current.scope === scope) {
        setSource(previous => previous?.id === recordId && previous.scope === scope ? { ...previous, data: null, loading: false, error: actionErrorMessage(error) } : previous);
      }
    }
  }

  async function confirmRecord(record: ContextRecordView) {
    const summary = record.readable ? contextTextSummary(record.content, 160) : "";
    const agreed = await confirmDialog({ title: `核对确认${contextKindLabels[record.kind]}记录（第 ${record.version} 版）`, confirmText: "确认已核对", initialFocus: "cancel",
      description: `${summary ? `本条内容：“${summary}”\n\n` : ""}确认第 ${record.version} 版内容与来源已核对，保留本次核对人和时间；客户授权以真实指示为准。` });
    if (!agreed) return;
    start(async () => {
      try {
        await confirmMatterContextRecord({ matterId, id: record.id, expectedVersion: record.version, acknowledged: true });
        Toast.success("核对确认已保存"); router.refresh();
      } catch (error) { Notification.error({ title: "未能确认", content: actionErrorMessage(error) }); }
    });
  }

  return (
    <>
    <section hidden={!overviewVisible} className="dos-group scroll-mt-44" aria-labelledby={titleId} id="matter-context" aria-busy={page.pending}>
      <div className="dos-group-h">
        <FileText className="ic" strokeWidth={1.9} /><h2 ref={sectionTitle} tabIndex={-1} id={titleId} className="t">目标与指示</h2>
        {page.data?.canWrite ? <span className="a"><FocusButton theme="outline" type="tertiary" size="small" ref={addTrigger} htmlType="button" disabled={pending} onClick={event => begin(null, event.currentTarget)}><Plus />记录目标或指示</FocusButton></span> : null}
      </div>
      <div className="dos-group-b">
        {page.pending ? <p role="status" className="t-sm t-mute">正在读取记录…</p> : null}
        {page.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{page.error}</span><SemiButton htmlType="button" theme="outline" type="tertiary" onClick={() => void loadRecords(page.cursor, page.previous)}>重新读取记录</SemiButton></div> : null}
        {page.data?.records.length === 0 ? <p className="t-sm t-mute">{page.cursor ? "本页暂无记录。" : "尚未记录目标或指示。"}</p> : null}
        {page.data?.records.length ? <ol className="space-y-4">
          {page.data.records.map(record => <li key={record.id} className="border-b border-[var(--semi-color-border)] pb-4 last:border-0 last:pb-0">
            <RecordContent matterId={matterId} record={record} onSource={trigger => showSource(record, trigger)} />
            <div className="mt-2 flex flex-wrap gap-1">
              <SemiButton htmlType="button" theme="borderless" type="tertiary" disabled={pending} aria-label={`查看${contextKindLabels[record.kind]}记录的历史版本`} onClick={event => showHistory(record, undefined, event.currentTarget)}><History />查看历史版本</SemiButton>
              {record.canRevise ? <SemiButton htmlType="button" theme="borderless" type="tertiary" disabled={pending} aria-label={`更正${contextKindLabels[record.kind]}第 ${record.version} 版记录`} onClick={event => begin(record, event.currentTarget)}><Pencil />更正此记录</SemiButton> : null}
              {record.canConfirm ? <SemiButton htmlType="button" theme="outline" type="tertiary" disabled={pending} aria-label={`核对确认${contextKindLabels[record.kind]}第 ${record.version} 版记录`} onClick={() => void confirmRecord(record)}><Check />核对确认此版本</SemiButton> : null}
            </div>
          </li>)}
        </ol> : null}
        {page.previous.length > 0 || page.data?.nextCursor ? <div className="mt-3 flex flex-wrap gap-2">
          <SemiButton htmlType="button" theme="outline" type="tertiary" disabled={page.pending || page.previous.length === 0} aria-label="目标与指示上一页" onClick={() => void loadRecords(page.previous.at(-1) ?? null, page.previous.slice(0, -1))}>上一页</SemiButton>
          <SemiButton htmlType="button" theme="outline" type="tertiary" disabled={page.pending || !page.data?.nextCursor} aria-label="更多目标与指示" onClick={() => { if (page.data?.nextCursor) void loadRecords(page.data.nextCursor, [...page.previous, page.cursor]); }}>更多</SemiButton>
          {page.error ? <SemiButton htmlType="button" theme="borderless" type="tertiary" disabled={page.pending} onClick={() => void loadRecords(null, [])}>最新记录</SemiButton> : null}
        </div> : null}
      </div>
    </section>

      <WorkspaceDialog open={editor !== null} dismissOnBackdrop onOpenChange={open => { if (!open) void closeEditor(); }}>
        <DrawerContent ref={editorContent} className="w-screen overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(editorTrigger.current, addTrigger.current, sectionTitle.current); }}>
          <DialogHeader><DialogTitle>{editor?.record ? `更正${contextKindLabels[editor.record.kind]}记录（当前第 ${editor.record.version} 版）` : "记录目标或指示"}</DialogTitle><DialogDescription>{editor?.record ? `保存为第 ${editor.record.version + 1} 版，保留第 ${editor.record.version} 版；新版需重新核对确认。` : "保存后待主办或协办核对确认。"}</DialogDescription></DialogHeader>
          {requestedRecordId !== null ? <p role="status" className="mt-3 text-sm text-muted-foreground">关闭当前编辑后显示选中的记录，当前输入已保留。</p> : null}
          {editor ? <ContextEditor key={editor.key} matterId={matterId} state={editor} canReadFinance={Boolean(page.data?.canReadFinance)} onSaving={setEditorBusy} onDirtyChange={setEditorDirty}
            onLoadSources={request => void loadSources(editor.key, request)}
            onSaved={() => { setEditor(null); router.refresh(); }} /> : null}
        </DrawerContent>
      </WorkspaceDialog>

      <WorkspaceDialog open={history !== null} onOpenChange={open => { if (!open) { historyRequest.current++; setHistory(null); } }}>
        <DrawerContent className="w-screen overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(historyTrigger.current, addTrigger.current, sectionTitle.current); }}>
          <DialogHeader><DialogTitle ref={historyTitle} tabIndex={-1}>{history ? `${contextKindLabels[history.kind]}的历史版本` : "记录的历史版本"}</DialogTitle><DialogDescription>按版本倒序查看原记录、来源及当时的核对状态。</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-5">
            {historyError ? <p role="alert" className="text-sm text-destructive">{historyError}</p> : null}
            {historyLoading ? <p role="status" className="t-sm t-mute">正在读取历史…</p> : null}
            {historyData?.records.map(record => <article key={record.id} className="border-b border-[var(--semi-color-border)] pb-4"><RecordContent matterId={matterId} record={record} onSource={trigger => showSource(record, trigger, true)} /></article>)}
            {history && historyData?.nextBeforeVersion ? <SemiButton htmlType="button" disabled={historyLoading} theme="outline" type="tertiary" onClick={() => void showHistory(history, historyData.nextBeforeVersion!)}>查看更早版本</SemiButton> : null}
            {history && historyError ? <SemiButton htmlType="button" disabled={historyLoading} theme="outline" type="tertiary" onClick={() => void showHistory(history)}>重新读取历史版本</SemiButton> : null}
          </div>
        </DrawerContent>
      </WorkspaceDialog>

      <WorkspaceDialog open={requestedRecordId !== null && editor === null} onOpenChange={open => { if (!open) closeExact(); }}>
        <DrawerContent className="w-screen overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => {
          event.preventDefault(); restoreFocus(addTrigger.current, sectionTitle.current);
        }}>
          <DialogHeader><DialogTitle ref={exactTitle} tabIndex={-1}>{exactCurrent?.data
            ? `${contextKindLabels[exactCurrent.data.kind]}记录（第 ${exactCurrent.data.version} 版）` : "查看指定记录"}</DialogTitle>
            <DialogDescription>查看客户动态所指向的这版记录及来源。</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            {!exactCurrent || exactCurrent.loading ? <p role="status" className="text-sm text-muted-foreground">正在读取指定记录…</p> : null}
            {exactCurrent?.error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{exactCurrent.error}</p>
              <SemiButton htmlType="button" theme="outline" type="tertiary" onClick={() => setExactAttempt(value => value + 1)}>重新读取这版记录</SemiButton></div> : null}
            {exactCurrent?.data ? <RecordContent matterId={matterId} record={exactCurrent.data} onSource={trigger => showSource(exactCurrent.data!, trigger, false, true)} /> : null}
            {historyReturnHref ? <Link className="btn btn-secondary btn-sm" href={historyReturnHref}>返回客户动态</Link> : null}
          </div>
        </DrawerContent>
      </WorkspaceDialog>

      <WorkspaceDialog open={sourceVisible} onOpenChange={open => { if (!open) { sourceRequest.current++; setSource(null); } }}>
        <DrawerContent className="w-screen overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => {
          event.preventDefault();
          restoreFocus(sourceTrigger.current, sourceFromExact.current || requestedRecordId !== null && editor === null ? exactTitle.current : null,
            sourceFromHistory.current && history !== null ? historyTitle.current : null, addTrigger.current, sectionTitle.current);
        }}>
          <DialogHeader><DialogTitle>{source ? `${source.recordLabel}的来源` : "查看记录来源"}</DialogTitle><DialogDescription>{sourceData?.label ?? "按当前资格读取关联原记录。"}</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            {sourceError ? <p role="alert" className="text-sm text-destructive">{sourceError}</p> : null}
            {sourceLoading ? <p role="status" className="t-sm t-mute">正在读取来源…</p> : null}
            {sourceData?.content ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{sourceData.content}</p> : null}
            {sourceData?.href ? <a className="btn btn-secondary" href={sourceData.href} target="_blank" rel="noopener noreferrer">打开来源原件</a> : null}
            {source && sourceError ? <SemiButton htmlType="button" theme="outline" type="tertiary" disabled={sourceLoading} onClick={() => void loadSource(source.id, source.recordLabel, source.exactRecordId)}>重新读取来源</SemiButton> : null}
          </div>
        </DrawerContent>
      </WorkspaceDialog>
    </>
  );
}

function RecordContent({ matterId, record, onSource }: { matterId: string; record: ContextRecordView; onSource: (trigger: HTMLButtonElement) => void }) {
  return <>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--semi-color-text-2)]">
      <span className="font-medium text-foreground">{contextKindLabels[record.kind]}</span><span>第 {record.version} 版</span>
      <SemiTag size="small" color={record.confirmationStatus === "CONFIRMED" ? "teal" : "amber"}>{record.confirmationStatus === "CONFIRMED" ? "已核对" : record.version > 1 ? "新版待核对" : "待核对"}</SemiTag>
      {record.visibility === "FINANCE" ? <SemiTag size="small" color="grey">财务范围</SemiTag> : null}
    </div>
    {record.readable ? <>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{record.content}</p>
      {record.reason ? <p className="mt-2 whitespace-pre-wrap break-words text-sm"><span className="t-mute">理由：</span>{record.reason}</p> : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[var(--semi-color-text-2)]">来源：{record.sourceDescription}</p>
      {record.contextInputs && <div className="mt-3"><ContextInputsSummary summary={record.contextInputs} matterId={matterId} /></div>}
      {record.source?.available ? <SemiButton theme="borderless" type="tertiary" size="small" htmlType="button" className="link-inline mt-1 text-xs" aria-label={`查看${contextKindLabels[record.kind]}第 ${record.version} 版的来源：${record.source.label}`} onClick={event => onSource(event.currentTarget)}>查看来源：{record.source.label}</SemiButton> : null}
    </> : <p className="text-sm text-[var(--semi-color-text-2)]">关联来源已不可读取，记录正文暂不显示。</p>}
    <p className="mt-2 flex flex-wrap gap-x-2 text-xs text-[var(--semi-color-text-2)]"><span>{record.authorName}</span><time dateTime={record.occurredAt}>{when(record.occurredAt)}</time>
      {record.confirmedAt ? <span>核对：{record.confirmedByName} · {when(record.confirmedAt)}</span> : null}
    </p>
  </>;
}

function ContextEditor({ matterId, state, canReadFinance, onSaved, onSaving, onDirtyChange, onLoadSources }: { matterId: string; state: EditorState; canReadFinance: boolean; onSaved: () => void; onSaving: (value: boolean) => void; onDirtyChange: (value: boolean) => void; onLoadSources: (request?: ContextSourcePageInput) => void }) {
  const prefix = useId();
  const record = state.record;
  const [kind, setKind] = useState<ContextKind>(record?.kind ?? "GOAL");
  const [visibility, setVisibility] = useState<ContextVisibility>(record?.visibility ?? "MATTER");
  const [content, setContent] = useState(record?.content ?? "");
  const [reason, setReason] = useState(record?.reason ?? "");
  const [sourceDescription, setSourceDescription] = useState(record?.sourceDescription ?? "");
  const [sourceKey, setSourceKey] = useState(record?.source?.id ? `${record.source.type}:${record.source.id}` : "");
  const [sourceLabel, setSourceLabel] = useState(record?.source?.label ?? "");
  const [contextInputs, setContextInputs] = useState(() => carriedContextInputs(record?.contextInputs));
  const [initialOccurredAt] = useState(() => toShanghaiInput(new Date()));
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const choices = state.options?.choices ?? [];
  const selectedSourceMissing = sourceKey && !choices.some(choice => `${choice.type}:${choice.id}` === sourceKey);
  const dirty = kind !== (record?.kind ?? "GOAL") || visibility !== (record?.visibility ?? "MATTER")
    || content !== (record?.content ?? "") || reason !== (record?.reason ?? "")
    || sourceDescription !== (record?.sourceDescription ?? "")
    || sourceKey !== (record?.source?.id ? `${record.source.type}:${record.source.id}` : "")
    || occurredAt !== initialOccurredAt || JSON.stringify(contextInputs) !== JSON.stringify(carriedContextInputs(record?.contextInputs));

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    let input: ContextRecordInput;
    try {
      const [sourceType, sourceId] = sourceKey.split(":");
      input = { matterId, requestKey: state.key, supersedesId: record?.id, kind, visibility, content, reason,
        contextInputs: kind === "OPTION" ? contextInputs : [],
        sourceDescription, occurredAt: fromShanghaiInput(occurredAt),
        sourceDocumentId: sourceType === "DOCUMENT" ? sourceId : null,
        sourceNoteId: sourceType === "NOTE" ? sourceId : null,
        sourceClientActivityId: sourceType === "CLIENT_ACTIVITY" ? sourceId : null };
    } catch (issue) { setError(actionErrorMessage(issue)); return; }
    onSaving(true);
    start(async () => {
      try { await recordMatterContext(input); Toast.success("记录已保存，待核对确认"); onSaved(); }
      catch (issue) { setError(actionErrorMessage(issue) || "保存失败，请重试"); }
      finally { onSaving(false); }
    });
  }

  return <form onSubmit={submit} className="mt-5 space-y-4">
    <fieldset disabled={pending} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><label htmlFor={`${prefix}-kind`} className="text-sm font-medium text-[var(--semi-color-text-1)]">记录类型</label><Select<string> id={`${prefix}-kind`} aria-label="记录类型" value={kind} disabled={pending || Boolean(record)} onChange={value => { if (typeof value === "string") setKind(value as ContextKind); }} className="w-full">{Object.entries(contextKindLabels).map(([value, label]) => <Select.Option key={value} value={value}>{label}</Select.Option>)}</Select></div>
        <div className="space-y-1.5"><label htmlFor={`${prefix}-visibility`} className="text-sm font-medium text-[var(--semi-color-text-1)]">可见范围</label><Select<string> id={`${prefix}-visibility`} aria-label="可见范围" value={visibility} disabled={pending || Boolean(record)} onChange={value => { if (typeof value === "string") setVisibility(value as ContextVisibility); }} className="w-full">{Object.entries(contextVisibilityLabels).filter(([value]) => value !== "FINANCE" || canReadFinance || visibility === "FINANCE").map(([value, label]) => <Select.Option key={value} value={value} disabled={value === "FINANCE" && !canReadFinance}>{label}</Select.Option>)}</Select></div>
      </div>
      <div className="space-y-1.5"><label htmlFor={`${prefix}-content`} className="text-sm font-medium text-[var(--semi-color-text-1)]">内容 *</label><TextArea id={`${prefix}-content`} required maxLength={8000} rows={6} value={content} onChange={inputValue => setContent(inputValue)} /></div>
      {kind === "OPTION" && <ContextInputPicker matterId={matterId} value={contextInputs} onChange={setContextInputs} initial={record?.contextInputs} disabled={pending} />}
      {kind === "CONSTRAINT" ? <p className="t-xs t-mute">费用及预算约束请选择财务可见范围。</p> : null}
      <div className="space-y-1.5"><label htmlFor={`${prefix}-occurred`} className="text-sm font-medium text-[var(--semi-color-text-1)]">发生时间（北京时间）*</label><Input id={`${prefix}-occurred`} type="datetime-local" required value={occurredAt} onChange={inputValue => setOccurredAt(inputValue)} /></div>
      <div className="space-y-1.5"><label htmlFor={`${prefix}-reason`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{record ? "更正或决定理由" : "理由"}</label><TextArea id={`${prefix}-reason`} rows={2} maxLength={3000} value={reason} onChange={inputValue => setReason(inputValue)} /></div>
      <div className="space-y-1.5"><label htmlFor={`${prefix}-source`} className="text-sm font-medium text-[var(--semi-color-text-1)]">关联来源</label><Select<string> id={`${prefix}-source`} aria-label="关联来源" value={sourceKey} disabled={pending} onChange={value => { if (typeof value !== "string") return; setSourceKey(value); setSourceLabel(choices.find(choice => `${choice.type}:${choice.id}` === value)?.label ?? ""); }} className="w-full"><Select.Option value="">仅填写来源说明</Select.Option>
        {selectedSourceMissing ? <Select.Option value={sourceKey}>{sourceLabel}（保存时重新核验）</Select.Option> : null}
        {choices.map(choice => <Select.Option key={`${choice.type}:${choice.id}`} value={`${choice.type}:${choice.id}`}>{choice.label}</Select.Option>)}
      </Select>{state.loading ? <p role="status" className="t-xs t-mute">正在读取可关联来源…</p> : null}
      {state.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>{state.error}</span><SemiButton htmlType="button" theme="outline" type="tertiary" disabled={state.loading} onClick={() => onLoadSources(state.failedPage)}>重试</SemiButton>{state.failedPage ? <SemiButton htmlType="button" theme="borderless" type="tertiary" disabled={state.loading} onClick={() => onLoadSources()}>重新读取来源</SemiButton> : null}</div> : null}
      {state.options ? <div className="flex flex-wrap gap-2">{(Object.keys(sourceMoreLabels) as ContextSourceType[]).map(type => state.options!.nextCursors[type] ? <SemiButton key={type} htmlType="button" theme="outline" type="tertiary" disabled={state.loading} onClick={() => onLoadSources({ type, cursor: state.options!.nextCursors[type]! })}>{sourceMoreLabels[type]}</SemiButton> : null)}</div> : null}</div>
      <div className="space-y-1.5"><label htmlFor={`${prefix}-source-description`} className="text-sm font-medium text-[var(--semi-color-text-1)]">来源说明 *</label><TextArea id={`${prefix}-source-description`} required rows={3} maxLength={1200} value={sourceDescription} onChange={inputValue => setSourceDescription(inputValue)} placeholder="指示人、沟通方式、原件位置或其他真实依据" /></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end"><SemiButton htmlType="submit" disabled={pending} theme="solid" type="primary">{pending ? <Loader2 className="animate-spin" /> : <Check />}{record ? "保存更正版" : "保存记录"}</SemiButton></div>
  </form>;
}
