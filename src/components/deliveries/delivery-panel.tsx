"use client";

import { Banner, Select, Button, Checkbox, Input, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Plus } from "lucide-react";

import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker } from "@/components/matters/context-input-picker";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";
import { actionErrorMessage } from "@/lib/action-error";
import { formatDateTime } from "@/lib/utils";
import { fromShanghaiInput, toShanghaiInput } from "@/lib/clients/relationship";
import {
  createClientBrief, findDeliveryByRequest, findDeliveryEventByRequest, getDeliveryDetail, getDeliveryOptions,
  listDeliveryRecords, prepareDelivery, registerDeliveryEvent,
} from "@/server/deliveries/actions";
import {
  deliveryEventLabels, deliveryState, deliveryStateLabels,
  type DeliveryDetail, type DeliveryEventKind, type DeliveryOptions, type DeliverySummary, type PrepareDeliveryInput,
} from "@/server/deliveries/contracts";

type Props = {
  matterId: string;
  initialDeliveryId?: string | null;
  initialEventId?: string | null;
  initialDocumentId?: string | null;
  /** Increment with the target after the owning shell confirms discarding a draft; never while busy. */
  prepareSignal?: number;
  onLocationChange?: (deliveryId: string | null, eventId?: string | null) => void;
  onDocumentOpen?: (documentId: string) => void;
  onDraftStateChange?: (dirty: boolean, busy: boolean) => void;
};
type Mode = "prepare" | "detail" | "event" | "brief" | null;
type Draft = Pick<PrepareDeliveryInput, "purpose" | "recipientName" | "recipientContact" | "disclosureScope" | "unresolvedItems" | "documentIds"> & {
  recipientClientId: string | null; supersedesId: string | null;
  sourceDeclarations: { documentId: string; kind: "TEAM_PRODUCED" | "EXTERNAL_ATTACHMENT" }[];
};
const emptyDraft = (): Draft => ({ purpose: "", recipientName: "", recipientContact: "", disclosureScope: "", unresolvedItems: "", documentIds: [], sourceDeclarations: [], recipientClientId: null, supersedesId: null });
const manualKinds = ["SENT", "RECEIVED", "REPLIED", "CONTENT_CONFIRMED", "SEND_CORRECTION"] as const;

export function DeliveryPanel({ matterId, initialDeliveryId, initialEventId, initialDocumentId, prepareSignal, onLocationChange, onDocumentOpen, onDraftStateChange }: Props) {
  const [rows, setRows] = useState<DeliverySummary[]>([]);
  const [options, setOptions] = useState<DeliveryOptions | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [mode, setMode] = useState<Mode>(initialDeliveryId ? "detail" : initialDocumentId ? "prepare" : null);
  const [selectedId, setSelectedId] = useState<string | null>(initialDeliveryId ?? null);
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), documentIds: initialDocumentId ? [initialDocumentId] : [] }));
  const [brief, setBrief] = useState({ title: "", content: "", contextInputs: [] as ContextInputSelection[] });
  const [eventKind, setEventKind] = useState<(typeof manualKinds)[number]>("SENT");
  const [eventTime, setEventTime] = useState("");
  const [channel, setChannel] = useState("");
  const [note, setNote] = useState("");
  const [proofId, setProofId] = useState<string | null>(null);
  const [correctsId, setCorrectsId] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const popupContainer = useRef<HTMLDivElement>(null);
  const openDropdown = useRef(false);
  const selectedRef = useRef(selectedId);
  const operationRef = useRef({ dirty: false, busy: false });
  const callbacks = useRef({ onLocationChange, onDocumentOpen, onDraftStateChange });
  const initialDocumentRef = useRef(initialDocumentId);
  const prepareSignalRef = useRef(prepareSignal ?? 0);
  useEffect(() => { callbacks.current = { onLocationChange, onDocumentOpen, onDraftStateChange }; }, [onLocationChange, onDocumentOpen, onDraftStateChange]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  useEffect(() => { operationRef.current = { dirty, busy }; callbacks.current.onDraftStateChange?.(dirty, busy); }, [dirty, busy]);
  useEffect(() => () => { callbacks.current.onDraftStateChange?.(false, false); }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setListError("");
    Promise.all([listDeliveryRecords(matterId, cursor), getDeliveryOptions(matterId)]).then(([page, choices]) => {
      if (!current) return;
      setRows(page.items); setNextCursor(page.nextCursor); setOptions(choices);
    }).catch(err => { if (current) { setRows([]); setOptions(null); setListError(actionErrorMessage(err) || "交付记录加载失败"); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [matterId, cursor, refresh]);

  useEffect(() => {
    let current = true;
    setDetail(null);
    if (!selectedId) return;
    setDetailLoading(true); setError("");
    getDeliveryDetail(selectedId).then(value => {
      if (!current) return;
      if (value.matterId !== matterId) { setError("该交付清单不属于当前案件，请返回原案件打开"); return; }
      setDetail(value);
    })
      .catch(err => { if (current) setError(actionErrorMessage(err) || "交付清单加载失败"); })
      .finally(() => { if (current) setDetailLoading(false); });
    return () => { current = false; };
  }, [matterId, selectedId, refresh]);

  useEffect(() => {
    const requested = initialDeliveryId ?? null;
    if (requested === selectedRef.current) return;
    let active = true;
    void (async () => {
      const state = operationRef.current;
      const allowed = !state.busy && (!state.dirty || await confirmDialog({
        title: "放弃未保存内容？", confirmText: "放弃", cancelText: "继续编辑", initialFocus: "cancel",
      }));
      if (!active) return;
      if (!allowed) { callbacks.current.onLocationChange?.(selectedRef.current); return; }
      selectedRef.current = requested;
      setSelectedId(requested); setMode(requested ? "detail" : null); setDirty(false); setError("");
    })();
    return () => { active = false; };
  }, [initialDeliveryId]);
  useEffect(() => {
    if (!initialDocumentId) { initialDocumentRef.current = null; return; }
    const confirmedPreparation = (prepareSignal ?? 0) > prepareSignalRef.current;
    if (operationRef.current.busy || (!confirmedPreparation &&
      (initialDocumentId === initialDocumentRef.current || operationRef.current.dirty))) return;
    if (confirmedPreparation) prepareSignalRef.current = prepareSignal!;
    initialDocumentRef.current = initialDocumentId;
    requestKey.current = crypto.randomUUID();
    setSelectedId(null); setDetail(null);
    setDraft({ ...emptyDraft(), documentIds: [initialDocumentId] }); setMode("prepare"); setDirty(false); setError("");
  }, [initialDocumentId, prepareSignal]);
  useEffect(() => {
    if (!initialEventId || !detail || mode !== "detail") return;
    document.getElementById(`delivery-event-${initialEventId}`)?.focus();
  }, [detail, mode, initialEventId]);

  const confirmLeave = useCallback(async () => !dirty || await confirmDialog({
    title: "放弃未保存内容？", confirmText: "放弃", cancelText: "继续编辑", initialFocus: "cancel",
  }), [dirty]);

  async function close() {
    if (busy || !await confirmLeave()) return;
    selectedRef.current = null;
    setMode(null); setSelectedId(null); setDirty(false); setError(""); requestKey.current = null;
    initialDocumentRef.current = null;
    callbacks.current.onLocationChange?.(null);
  }
  function begin(next: "prepare" | "brief", button: HTMLElement, replacement?: DeliveryDetail) {
    trigger.current = button; requestKey.current = crypto.randomUUID(); setError(""); setDirty(false);
    setDraft(replacement ? {
      purpose: replacement.purpose, recipientName: replacement.recipientName, recipientContact: replacement.recipientContact,
      disclosureScope: replacement.disclosureScope, unresolvedItems: replacement.unresolvedItems,
      documentIds: replacement.items.map(item => item.documentId), sourceDeclarations: [], recipientClientId: replacement.recipientClientId, supersedesId: replacement.id,
    } : emptyDraft());
    setBrief({ title: "", content: "", contextInputs: [] }); setMode(next);
  }
  function openDetail(id: string, button?: HTMLElement) {
    if (button) trigger.current = button;
    selectedRef.current = id;
    setDirty(false); setError(""); setSelectedId(id); setMode("detail");
    callbacks.current.onLocationChange?.(id);
  }
  function changeDraft(patch: Partial<Draft>) { setDraft(value => ({ ...value, ...patch })); setDirty(true); }
  function reorder(index: number, delta: number) {
    const ids = [...draft.documentIds];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    changeDraft({ documentIds: ids });
  }
  function beginEvent(kind: (typeof manualKinds)[number]) {
    setEventKind(kind); setEventTime(toShanghaiInput(new Date())); setChannel(""); setNote(""); setProofId(null);
    setCorrectsId(kind === "SEND_CORRECTION" ? detail?.events.filter(event => event.kind === "SENT" || event.kind === "SEND_CORRECTION").at(-1)?.id ?? null : null);
    requestKey.current = crypto.randomUUID(); setMode("event"); setDirty(false); setError("");
  }
  async function savePreparation() {
    if (busy) return;
    const key = requestKey.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      let result;
      const input = { ...draft, matterId, requestKey: key };
      try { result = await prepareDelivery(input); }
      catch (err) { result = await findDeliveryByRequest(input); if (!result) throw err; }
      setDirty(false); openDetail(result.id); setRefresh(value => value + 1); Toast.success("交付清单已固定保存");
    } catch (err) { setError(actionErrorMessage(err) || "保存失败，输入已保留"); }
    finally { setBusy(false); }
  }
  async function saveBrief() {
    if (busy) return;
    const key = requestKey.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const result = await createClientBrief({ matterId, requestKey: key, ...brief });
      setDirty(false); setMode(null); setRefresh(value => value + 1);
      Toast.success("简报已保存为草稿，请核对并按原流程送审");
      callbacks.current.onDocumentOpen?.(result.id);
    } catch (err) { setError(actionErrorMessage(err) || "保存失败，输入已保留"); }
    finally { setBusy(false); }
  }
  async function saveEvent() {
    if (busy || !detail) return;
    const key = requestKey.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      let result;
      const input = { deliveryId: detail.id, requestKey: key, kind: eventKind,
        occurredAt: fromShanghaiInput(eventTime), channel, note, proofDocumentId: proofId, correctsEventId: correctsId };
      try { result = await registerDeliveryEvent(input); }
      catch (err) { result = await findDeliveryEventByRequest(input); if (!result) throw err; }
      setDirty(false); setMode("detail"); setRefresh(value => value + 1);
      callbacks.current.onLocationChange?.(result.deliveryId, result.id); Toast.success("实际发生情况已登记");
    } catch (err) { setError(actionErrorMessage(err) || "登记失败，输入已保留"); }
    finally { setBusy(false); }
  }
  async function exportFiles() {
    if (busy || !detail) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/deliveries/${detail.id}/export`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: crypto.randomUUID() }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "导出未完成"); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${detail.purpose}_交付材料.zip`; link.click(); URL.revokeObjectURL(url);
      setRefresh(value => value + 1); Toast.success("已导出，实际发送后请另行登记");
    } catch (err) { setError(actionErrorMessage(err) || "导出失败，固定清单仍保留"); }
    finally { setBusy(false); }
  }

  const title = mode === "prepare" ? draft.supersedesId ? "另建交付清单" : "准备交付"
    : mode === "brief" ? "准备客户简报" : mode === "event" ? deliveryEventLabels[eventKind] : "交付清单";
  const allSelectedAvailable = draft.documentIds.every(id => options?.documents.some(document => document.id === id));
  const sent = detail?.events.some(event => event.kind === "SENT");

  return <section className="flex flex-col gap-4" aria-labelledby="delivery-list-title">
    <header className="flex items-center justify-between gap-3">
      <h3 id="delivery-list-title" className="font-medium">简报与交付</h3>
      <div className="flex gap-2">
        {options?.canCreateBrief && <Button theme="outline" type="tertiary" size="small" onClick={event => begin("brief", event.currentTarget)} htmlType="button"><FileText data-icon="inline-start" />准备简报</Button>}
        {options?.canPrepare && <Button size="small" onClick={event => begin("prepare", event.currentTarget)} theme="solid" type="primary" htmlType="button"><Plus data-icon="inline-start" />准备交付</Button>}
      </div>
    </header>
    {listError ? <Banner type="danger" closeIcon={null} description={<>{listError} <Button theme="outline" type="tertiary" size="small" onClick={() => setRefresh(value => value + 1)} htmlType="button">重新加载</Button></>} />
      : loading ? <p role="status" className="text-sm text-muted-foreground">正在读取交付记录…</p>
        : rows.length ? <ul className="flex flex-col divide-y">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0 flex-1"><Button theme="borderless" type="tertiary" className="h-auto whitespace-normal p-0 text-left" onClick={event => openDetail(row.id, event.currentTarget)} htmlType="button">{row.purpose ?? "交付记录暂不可查看"}</Button>
            <p className="text-sm text-muted-foreground">{row.recipientName && `${row.recipientName} · `}{row.itemCount} 份 · {formatDateTime(row.createdAt)}</p></div>
          <Tag color="grey" type="light">{deliveryStateLabels[row.state]}</Tag>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无交付记录。</p>}
    {(previousCursors.length > 0 || nextCursor) && <div className="flex justify-end gap-2">
      <Button size="small" theme="outline" type="tertiary" disabled={loading || !previousCursors.length} onClick={() => { setCursor(previousCursors.at(-1)); setPreviousCursors(value => value.slice(0, -1)); }} htmlType="button">上一页</Button>
      <Button size="small" theme="outline" type="tertiary" disabled={loading || !nextCursor} onClick={() => { setPreviousCursors(value => [...value, cursor]); setCursor(nextCursor!); }} htmlType="button">下一页</Button>
    </div>}

    <Dialog open={mode !== null} onOpenChange={open => { if (!open) void close(); }}>
      <FormDialogContent ref={popupContainer} className="max-w-3xl" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}
        onEscapeKeyDown={event => { if (busy || openDropdown.current) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="px-6 pt-5"><DialogTitle>{title}</DialogTitle></DialogHeader>
        <FormDialogBody className="flex flex-col gap-5 px-6 py-5">
          {error && <Banner type="danger" closeIcon={null} description={error} />}
          {mode === "prepare" && <>
            {draft.supersedesId && <p className="text-sm text-muted-foreground">原清单与历史登记继续保留。</p>}
            <div className="flex flex-col gap-2"><label htmlFor="delivery-purpose">交付目的</label><Input id="delivery-purpose" value={draft.purpose} maxLength={300} disabled={busy} onChange={event => changeDraft({ purpose: event })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2"><label id="delivery-client-label" htmlFor="delivery-client">接收对象</label><Select<string> getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} value={draft.recipientClientId ?? "external"} disabled={busy} onChange={value => (value => {
                const client = options?.clients.find(item => item.id === value);
                changeDraft({ recipientClientId: client?.id ?? null, recipientName: client?.name ?? "", recipientContact: client?.contact ?? "" });
              })(String(value ?? ""))} style={{ width: "100%" }} motion={false} id="delivery-client" aria-labelledby="delivery-client-label"><Select.Option value="external">其他接收人</Select.Option>{options?.clients.map(client => <Select.Option key={client.id} value={client.id}>{client.name}</Select.Option>)}</Select></div>
              <div className="flex flex-col gap-2"><label htmlFor="delivery-recipient">实际接收人</label><Input id="delivery-recipient" value={draft.recipientName} maxLength={200} disabled={busy} onChange={event => changeDraft({ recipientName: event })} /></div>
            </div>
            <div className="flex flex-col gap-2"><label htmlFor="delivery-contact">实际联系方式或交接地点</label><Input id="delivery-contact" value={draft.recipientContact} maxLength={500} disabled={busy} onChange={event => changeDraft({ recipientContact: event })} /></div>
            <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-sm font-medium">具体版本与顺序</legend>
              {!options ? <p className="text-sm text-muted-foreground">材料列表尚未加载。</p> : options.documents.length === 0 ? <p className="text-sm text-muted-foreground">暂无可读取材料，请先保存或上传文书。</p> : <div className="max-h-52 overflow-y-auto rounded-md border p-3"><div className="flex flex-col gap-3">{options.documents.map(document => <div key={document.id} className="flex items-start gap-3">
                <Checkbox checked={draft.documentIds.includes(document.id)} disabled={busy || !document.canDeliver} aria-label={`选择 ${document.name} 第 ${document.version} 版`} onChange={event => (checked => changeDraft({ documentIds: checked ? [...draft.documentIds, document.id] : draft.documentIds.filter(id => id !== document.id), sourceDeclarations: checked ? draft.sourceDeclarations : draft.sourceDeclarations.filter(item => item.documentId !== document.id) }))(event.target.checked === true)} />
                <div className="min-w-0 text-sm break-words">{document.name} · 第 {document.version} 版{document.blockedReason && <span className="block text-muted-foreground">{document.blockedReason}</span>}
                  {document.needsSourceDeclaration && draft.documentIds.includes(document.id) && <div className="mt-2">确认材料来源<span id={`delivery-source-${document.id}`} className="sr-only">{`确认 ${document.name} 第 ${document.version} 版来源`}</span>
                    <Select<string> getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} aria-labelledby={`delivery-source-${document.id}`} disabled={busy} value={draft.sourceDeclarations.find(item => item.documentId === document.id)?.kind ?? ""} onChange={value => (event => {
                      const value = event as "" | "TEAM_PRODUCED" | "EXTERNAL_ATTACHMENT";
                      changeDraft({ sourceDeclarations: [...draft.sourceDeclarations.filter(item => item.documentId !== document.id), ...(value ? [{ documentId: document.id, kind: value }] : [])] });
                    })(String(value ?? ""))} className="mt-1" style={{ width: "100%" }} motion={false}><Select.Option value="">请选择来源</Select.Option><Select.Option value="TEAM_PRODUCED">团队成果，须先审批</Select.Option><Select.Option value="EXTERNAL_ATTACHMENT">普通来源附件</Select.Option></Select>
                  </div>}
                </div>
              </div>)}</div></div>}
              {!allSelectedAvailable && <Banner type="danger" closeIcon={null} description="原先选入的材料当前不可读取。请核对并重新选择，系统不会改用最新版本。" />}
              {draft.documentIds.length > 0 && <ol className="flex flex-col gap-2">{draft.documentIds.map((id, index) => {
                const document = options?.documents.find(item => item.id === id);
                return <li key={id} className="flex items-center gap-2 text-sm"><span className="flex-1 break-words">{index + 1}. {document ? `${document.name} · 第 ${document.version} 版` : "材料当前不可读取"}</span>
                  <Button size="small" theme="borderless" type="tertiary" disabled={busy || index === 0} aria-label={`上移第 ${index + 1} 份材料`} onClick={() => reorder(index, -1)} htmlType="button"><ArrowUp /></Button>
                  <Button size="small" theme="borderless" type="tertiary" disabled={busy || index === draft.documentIds.length - 1} aria-label={`下移第 ${index + 1} 份材料`} onClick={() => reorder(index, 1)} htmlType="button"><ArrowDown /></Button>
                  <Button size="small" theme="borderless" type="tertiary" disabled={busy} onClick={() => changeDraft({
                    documentIds: draft.documentIds.filter(item => item !== id), sourceDeclarations: draft.sourceDeclarations.filter(item => item.documentId !== id),
                  })} htmlType="button">移除</Button>
                </li>;
              })}</ol>}
            </fieldset>
            <div className="flex flex-col gap-2"><label htmlFor="delivery-scope">本次披露范围</label><TextArea id="delivery-scope" rows={2} value={draft.disclosureScope} maxLength={2000} disabled={busy} onChange={event => changeDraft({ disclosureScope: event })} /></div>
            <div className="flex flex-col gap-2"><label htmlFor="delivery-unresolved">未决事项</label><TextArea id="delivery-unresolved" rows={2} value={draft.unresolvedItems} maxLength={4000} disabled={busy} onChange={event => changeDraft({ unresolvedItems: event })} /></div>
          </>}
          {mode === "brief" && <>
            <ContextInputPicker matterId={matterId} value={brief.contextInputs} disabled={busy} onChange={contextInputs => {
              setBrief(value => ({ ...value, contextInputs })); setDirty(true); requestKey.current = crypto.randomUUID();
            }} />
            <div className="flex flex-col gap-2"><label htmlFor="brief-title">简报标题</label><Input id="brief-title" value={brief.title} maxLength={200} disabled={busy} onChange={event => { setBrief(value => ({ ...value, title: event })); setDirty(true); }} /></div>
            <div className="flex flex-col gap-2"><label htmlFor="brief-content">简报正文</label><TextArea id="brief-content" rows={16} value={brief.content} maxLength={40000} disabled={busy} onChange={event => { setBrief(value => ({ ...value, content: event })); setDirty(true); }} placeholder="进展、风险、待决定事项、下一步" /></div>
          </>}
          {mode === "detail" && (detailLoading ? <p role="status">正在读取固定清单…</p> : detail ? <>
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium break-words">{detail.purpose}</h4><Tag color="grey" type="light">{deliveryStateLabels[deliveryState(detail.events)]}</Tag></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">接收人</dt><dd className="break-words">{detail.recipientName}</dd>
              <dt className="text-muted-foreground">联系方式或地点</dt><dd className="break-words">{detail.recipientContact}</dd>
              <dt className="text-muted-foreground">披露范围</dt><dd className="whitespace-pre-wrap break-words">{detail.disclosureScope}</dd>
              <dt className="text-muted-foreground">准备</dt><dd>{detail.createdByName} · {formatDateTime(detail.createdAt)}</dd>
            </dl>
            <ol className="flex flex-col gap-3">{detail.items.map(item => <li key={item.id} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{item.position}. {item.documentName} · 第 {item.documentVersion} 版{item.newerVersionAvailable && <Tag color="grey" type="ghost" className="ml-2">已有后续版本，本清单保留原版</Tag>}</span>
              {onDocumentOpen ? <Button size="small" theme="outline" type="tertiary" onClick={() => callbacks.current.onDocumentOpen?.(item.documentId)} htmlType="button">打开此版本</Button> : <a className="text-primary underline underline-offset-4" href={`/api/documents/${item.documentId}/download`} target="_blank" rel="noreferrer">下载此版本</a>}
            </li>)}</ol>
            {detail.unresolvedItems && <div className="flex flex-col gap-2"><h4 className="text-sm font-medium">未决事项</h4><p className="whitespace-pre-wrap break-words text-sm">{detail.unresolvedItems}</p></div>}
            {detail.supersedesId && <Button theme="borderless" type="tertiary" className="justify-start p-0" onClick={() => openDetail(detail.supersedesId!)} htmlType="button">查看关联原清单</Button>}
            <div className="flex flex-col gap-3"><h4 className="text-sm font-medium">发生记录</h4>{!detail.events.length ? <p className="text-sm text-muted-foreground">尚未导出或登记发送。</p> : detail.events.map(event => <article key={event.id} id={`delivery-event-${event.id}`} tabIndex={-1} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><strong>{deliveryEventLabels[event.kind]}</strong><span>{formatDateTime(event.occurredAt)}{event.channel && ` · ${event.channel}`}</span></div>
              {event.note && <p className="whitespace-pre-wrap break-words">{event.note}</p>}
              {event.kind !== "EXPORTED" && (event.proofUnavailable ? <p className="text-muted-foreground">凭据当前不可读取，登记正文暂不显示。</p> : event.proofDocumentId ? <a className="text-primary underline" href={`/api/documents/${event.proofDocumentId}/download`} target="_blank" rel="noreferrer">凭据：{event.proofName}</a> : <p className="text-muted-foreground">仅人工登记，未附凭据</p>)}
              {event.correctsEventId && <p className="text-muted-foreground">追加更正，原发送登记保留。</p>}
              <p className="text-xs text-muted-foreground">{event.actorName} 登记于 {formatDateTime(event.recordedAt)}</p>
            </article>)}</div>
          </> : <p className="text-sm text-muted-foreground">无法打开该清单，请返回列表或重新加载。</p>)}
          {mode === "event" && <>
            <div className="grid grid-cols-2 gap-4"><div className="flex flex-col gap-2"><label htmlFor="delivery-event-time">实际发生时间（上海）</label><Input id="delivery-event-time" type="datetime-local" disabled={busy} value={eventTime} onChange={event => { setEventTime(event); setDirty(true); }} /></div>
              <div className="flex flex-col gap-2"><label htmlFor="delivery-channel">渠道</label><Input id="delivery-channel" value={channel} maxLength={100} disabled={busy} onChange={event => { setChannel(event); setDirty(true); }} /></div></div>
            <div className="flex flex-col gap-2"><label htmlFor="delivery-event-note">{eventKind === "REPLIED" || eventKind === "CONTENT_CONFIRMED" ? "客户原意及对应内容" : eventKind === "SEND_CORRECTION" ? "更正原因与实际情况" : "实际发生情况"}</label><TextArea id="delivery-event-note" rows={6} maxLength={8000} disabled={busy} value={note} onChange={event => { setNote(event); setDirty(true); }} /></div>
            <div className="flex flex-col gap-2"><label id="delivery-proof-label" htmlFor="delivery-proof">凭据材料</label><Select<string> getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} value={proofId ?? "none"} disabled={busy} onChange={value => (value => { setProofId(value === "none" ? null : value); setDirty(true); })(String(value ?? ""))} style={{ width: "100%" }} motion={false} id="delivery-proof" aria-labelledby="delivery-proof-label"><Select.Option value="none">未附凭据，仅人工登记</Select.Option>{options?.documents.map(document => <Select.Option key={document.id} value={document.id}>{document.name} · 第 {document.version} 版</Select.Option>)}</Select></div>
          </>}
        </FormDialogBody>
        <DialogFooter className="px-6 pb-5">
          <Button theme="outline" type="tertiary" disabled={busy} onClick={() => { void close(); }} htmlType="button">关闭</Button>
          {mode === "prepare" && <Button disabled={busy || !options?.canPrepare || !allSelectedAvailable || draft.documentIds.length === 0} onClick={() => { void savePreparation(); }} theme="solid" type="primary" htmlType="button">{busy ? "保存中…" : "核对并保存清单"}</Button>}
          {mode === "brief" && <Button disabled={busy || !brief.title.trim() || !brief.content.trim()} onClick={() => { void saveBrief(); }} theme="solid" type="primary" htmlType="button">{busy ? "保存中…" : "保存为文书草稿"}</Button>}
          {mode === "event" && <><Button theme="outline" type="tertiary" disabled={busy} onClick={async () => { if (await confirmLeave()) { setMode("detail"); setDirty(false); setError(""); } }} htmlType="button">返回清单</Button><Button disabled={busy || !note.trim()} onClick={() => { void saveEvent(); }} theme="solid" type="primary" htmlType="button">{busy ? "登记中…" : "保存登记"}</Button></>}
          {mode === "detail" && detail?.canWrite && <>
            <Button theme="outline" type="tertiary" disabled={busy} onClick={event => begin("prepare", event.currentTarget, detail)} htmlType="button">另建清单</Button>
            <Button theme="outline" type="tertiary" disabled={busy} onClick={() => { void exportFiles(); }} htmlType="button">导出固定材料</Button>
            {!sent ? <Button disabled={busy} onClick={() => beginEvent("SENT")} theme="solid" type="primary" htmlType="button">登记已发送</Button> : <Select<string> getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} disabled={busy} onChange={value => (value => beginEvent(value as Exclude<DeliveryEventKind, "EXPORTED">))(String(value ?? ""))} style={{ width: "100%" }} motion={false} className="w-40" insetLabel="追加发生记录" insetLabelId="delivery-event-kind-label" aria-labelledby="delivery-event-kind-label" placeholder="登记收悉或回复">{manualKinds.filter(kind => kind !== "SENT").map(kind => <Select.Option key={kind} value={kind}>{deliveryEventLabels[kind]}</Select.Option>)}</Select>}
          </>}
        </DialogFooter>
      </FormDialogContent>
    </Dialog>
  </section>;
}
