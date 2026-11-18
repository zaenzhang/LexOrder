"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, Button, Input, Notification, Tag, TextArea, Toast, Typography } from "@douyinfe/semi-ui";
import { Loader2, Unlink } from "lucide-react";
import { WorkspaceDialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import {
  addEvidenceSource, confirmEvidenceItem, createEvidenceItem, getEvidenceItem,
  listEvidenceRevisions, removeEvidenceSource, resolveEvidenceSource, updateEvidenceItem,
} from "@/server/evidence/actions";
import { MaterialSourceLocationPicker, type MaterialSourceLocation } from "@/components/documents/material-source-location-picker";
import { sourceRelationLabel } from "@/server/evidence/contracts";
import type { EvidenceDocumentOption, EvidenceItemView, EvidenceRevisionView, EvidenceSourceResult, EvidenceSourceView } from "@/server/evidence/contracts";
import { evidenceKindLabel } from "@/lib/enums";
import { formatDate } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";
import {
  emptyEvidenceEventDate, evidenceDatePrecisionLabel, evidenceEventDateSchema,
  evidenceEventDatesEqual, formatEvidenceEventDate, type EvidenceEventDate,
} from "@/lib/evidence/event-date";

type EvidenceKind = keyof typeof evidenceKindLabel;
type Relation = keyof typeof sourceRelationLabel;
type EditorData = Awaited<ReturnType<typeof getEvidenceItem>>;

export type EvidenceItemRow = {
  id: string; title: string; content: string; kind: EvidenceKind;
  sourceDocumentId: string | null; sourceDocumentName: string | null; sourcePage: number | null;
  createdByName: string | null; createdAt: Date | string;
  revision?: number; confirmedAt?: Date | string | null; confirmedByName?: string | null;
  sources?: EvidenceSourceView[]; restricted?: boolean; canEdit?: boolean;
  eventDate?: EvidenceEventDate | null;
};
const EVIDENCE_KIND_COLOR: Record<EvidenceKind, NonNullable<React.ComponentProps<typeof Tag>["color"]>> = {
  FACT: "teal",
  CLAIM: "blue",
  ANALYSIS: "violet",
  ISSUE: "red",
  TODO_VERIFY: "amber",
};
const KIND_KEYS = Object.keys(evidenceKindLabel) as EvidenceKind[];
const RELATIONS = Object.keys(sourceRelationLabel) as Relation[];

function KindSelect({ value, onChange, id, disabled }: { value: EvidenceKind; onChange: (value: EvidenceKind) => void; id: string; disabled?: boolean }) {
  const selectLabelId = useId();
  return <> <span className="sr-only" id={selectLabelId + "-kind"}>类型</span><Select id={id} value={value} onChange={value => { if (typeof value === "string") onChange(value as EvidenceKind); }} disabled={disabled} aria-labelledby={selectLabelId + "-kind"} className="w-full" motion={false}>{KIND_KEYS.map(kind => <Select.Option key={kind} value={kind}>{evidenceKindLabel[kind]}</Select.Option>)}</Select></>;
}

function EventDateFields({ value, onChange, id, disabled }: {
  value: EvidenceEventDate; onChange: (value: EvidenceEventDate) => void; id: string; disabled?: boolean;
}) {
  function precision(next: EvidenceEventDate["precision"]) {
    onChange({ ...value, precision: next, start: next === "UNKNOWN" ? null : value.start, end: next === "RANGE" ? value.end : null });
  }
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="mb-1 text-sm font-medium">发生时间</legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="space-y-1.5"><label id={id + "-precision" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">日期精度</label>
        <Select value={value.precision} onChange={next => { if (typeof next === "string") precision(next as EvidenceEventDate["precision"]); }} disabled={disabled} id={id + "-precision"} aria-labelledby={id + "-precision" + "-label"} className="w-full" motion={false}>{Object.entries(evidenceDatePrecisionLabel).map(([key, label]) => <Select.Option key={key} value={key}>{label}</Select.Option>)}</Select>
      </div>
      {value.precision !== "UNKNOWN" ? <div className="space-y-1.5"><label htmlFor={id + "-date-start"} className="text-sm font-medium text-[var(--semi-color-text-1)]">{value.precision === "EXACT" ? "发生日期" : "开始日期"}</label>
        <Input id={id + "-date-start"} type="date" min="0001-01-01" max="9999-12-31" value={value.start ?? ""} onChange={inputValue => onChange({ ...value, start: inputValue || null })} />
      </div> : null}
      {value.precision === "RANGE" ? <div className="space-y-1.5"><label htmlFor={id + "-date-end"} className="text-sm font-medium text-[var(--semi-color-text-1)]">结束日期</label>
        <Input id={id + "-date-end"} type="date" min="0001-01-01" max="9999-12-31" value={value.end ?? ""} onChange={inputValue => onChange({ ...value, end: inputValue || null })} />
      </div> : null}
    </div>
    <div className="space-y-1.5"><label htmlFor={id + "-date-text"} className="text-sm font-medium text-[var(--semi-color-text-1)]">原始时间表述（可选）</label>
      <TextArea id={id + "-date-text"} value={value.text ?? ""} onChange={inputValue => onChange({ ...value, text: inputValue || null })} maxLength={500} rows={2} placeholder="如：某年夏天、收到通知后的第二天" />
    </div>
  </fieldset>;
}

function EventDateDetails({ value }: { value?: EvidenceEventDate | null }) {
  if (!value) return null;
  return <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
    <p>发生日期：<span className="font-mono">{formatEvidenceEventDate(value)}</span></p>
    {value.text ? <p className="whitespace-pre-wrap break-words">原始表述：{value.text}</p> : null}
  </div>;
}

function SourceButton({ itemId, revision, source }: { itemId: string; revision?: number; source: EvidenceSourceView }) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Extract<EvidenceSourceResult, { status: "AVAILABLE" }> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  if (source.status === "UNAVAILABLE") return <span className="inline-flex items-center gap-1 text-muted-foreground"><Unlink className="h-3 w-3" />来源不可用</span>;
  function open() {
    startTransition(async () => {
      try {
        const result = await resolveEvidenceSource({ evidenceItemId: itemId, sourceId: source.id, revision });
        if (result.status === "UNAVAILABLE") { Toast.error("该来源当前不可用，请刷新后核对权限和材料状态"); return; }
        setPreview(result);
      } catch (error) { Notification.error({ title: "无法打开来源", content: actionErrorMessage(error) }); }
    });
  }
  return <>
    <button
      ref={triggerRef}
      type="button"
      onClick={open}
      disabled={pending}
      className="font-medium text-[var(--semi-color-link)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--semi-color-primary)] disabled:opacity-50 h-auto min-w-0 max-w-full justify-start whitespace-normal px-0 py-0 text-left">
      {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
      <span className="min-w-0 break-words">
        {source.relation ? sourceRelationLabel[source.relation] + " · " : "历史来源 · "}
        {source.documentName} · 第 {source.documentVersion} 版 · {source.locationLabel}
      </span>
    </button>
    <WorkspaceDialog open={preview !== null} onOpenChange={open => { if (!open) setPreview(null); }}>
      <DialogContent className="max-w-4xl" onCloseAutoFocus={event => {
        event.preventDefault();
        triggerRef.current?.focus({ preventScroll: true });
      }}>
        <DialogHeader><DialogTitle className="break-words">{preview?.documentName}</DialogTitle>
          <DialogDescription>第 {preview?.documentVersion} 版 · {preview?.locationLabel}</DialogDescription></DialogHeader>
        {preview?.legacy ? <p className="text-sm text-muted-foreground">历史引用未固定原件校验值，请核对原文。</p> : null}
        {preview?.historicalParse ? <p className="text-sm text-muted-foreground">显示引用时保留的解析版本。</p> : null}
        {preview?.text ? <div className="space-y-2"><p className="text-sm font-medium">已固定的抽取片段</p>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{preview.text}</blockquote></div> : null}
        {preview?.previewKind === "CONVERTED" && <p className="text-sm text-muted-foreground">转换预览打开整份文件，未按引用位置跳转。</p>}
        {preview?.previewUrl ? <iframe title={preview.previewKind === "TABLE" ? "单元格转换预览" : preview.previewKind === "CONVERTED" ? "整份转换预览" : "文件预览"} src={preview.previewUrl} className="h-[55vh] w-full rounded border" /> : null}
        <DialogFooter>
          {preview?.previewUrl ? <Typography.Text link={{ href: preview.previewUrl, target: "_blank", rel: "noopener noreferrer" }}>{preview.previewKind === "TABLE" ? "查看单元格转换预览" : preview.previewKind === "CONVERTED" ? "另页查看转换预览" : "另页查看预览"}</Typography.Text> : null}
          {preview ? <Typography.Text link={{ href: preview.downloadUrl, target: "_blank", rel: "noopener noreferrer" }}>下载此版本</Typography.Text> : null}
          <Button onClick={() => setPreview(null)} type="tertiary" theme="outline">返回要点</Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  </>;
}

/** Self-contained presentation shared by material rows and portalled timelines. */
export function EvidencePoints({ items, showSource = false, onResearch }: {
  items: EvidenceItemRow[]; showSource?: boolean; onResearch?(itemId: string): void;
}) {
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<EditorData | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  function openItem(id: string) {
    startTransition(async () => {
      try { setDetail(await getEvidenceItem(id)); }
      catch (error) { Notification.error({ title: "无法读取要点", content: actionErrorMessage(error) }); }
    });
  }
  return <>
    <ul ref={listRef} tabIndex={-1} aria-label="证据要点列表" className="m-0 flex min-w-0 list-none flex-col gap-3 p-0">{items.map(item => <li key={item.id} className="flex min-w-0 flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
        <Tag color={EVIDENCE_KIND_COLOR[item.kind]}>{evidenceKindLabel[item.kind]}</Tag>
        <span className="min-w-0 flex-1 break-words text-left text-sm font-semibold">{item.title}</span>
        {item.revision ? <span className="text-xs text-muted-foreground">第 {item.revision} 版 · {item.confirmedAt ? "记录已核对" : "记录待核对"}</span> : item.sourcePage ? <span className="text-xs text-muted-foreground">第 {item.sourcePage} 页</span> : null}
      </div>
      {!item.restricted ? <EventDateDetails value={item.eventDate} /> : null}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.restricted ? "部分来源当前不可用，内容暂不展示。" : item.content}</p>
      {item.sources?.length ? <ul className="flex min-w-0 list-none flex-col gap-1">{item.sources.map(source => <li key={source.id} className="min-w-0"><SourceButton itemId={item.id} revision={item.revision} source={source} /></li>)}</ul> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showSource && !item.sources?.length ? <span>{item.sourceDocumentId ? item.sourceDocumentName ?? "来源不可用（引用保留）" : "未挂来源材料"}</span> : null}
        {item.createdByName ? <span className="min-w-0 break-words">记录人 {item.createdByName}</span> : null}
        <span className="font-mono">记录时间 {formatDate(new Date(item.createdAt))}</span>
        {!item.restricted ? <Button
          className="sm:ml-auto"
          disabled={pending}
          aria-label={`${item.canEdit ? "查看与编辑要点" : "查看要点"}：${item.title}`}
          onClick={event => { detailTrigger.current = event.currentTarget; openItem(item.id); }}
          htmlType="button"
          type="tertiary" theme="borderless"
          size="small">
          {item.canEdit ? "查看与编辑要点" : "查看要点"}
        </Button> : null}
        {onResearch && item.kind === "ISSUE" && !item.restricted ? <Button
          disabled={pending}
          onClick={() => onResearch(item.id)}
          htmlType="button"
          type="tertiary" theme="outline"
          size="small">以此争点开始研究</Button> : null}
      </div>
    </li>)}</ul>
    {detail && items.some(item => item.id === detail.item.id && !item.restricted) ? <EvidenceDetailDialog key={detail.item.id} initial={detail} onClose={() => setDetail(null)} onReturnFocus={() => (detailTrigger.current?.isConnected ? detailTrigger.current : listRef.current)?.focus({ preventScroll: true })} /> : null}
  </>;
}

function EvidenceDetailDialog({ initial, onClose, onReturnFocus }: { initial: EditorData; onClose: () => void; onReturnFocus: () => void }) {
  const router = useRouter();
  const id = useId();
  const [data, setData] = useState(initial);
  const [title, setTitle] = useState(initial.item.title);
  const [content, setContent] = useState(initial.item.content);
  const [kind, setKind] = useState<EvidenceKind>(initial.item.kind);
  const [eventDate, setEventDate] = useState<EvidenceEventDate>(initial.item.eventDate ?? emptyEvidenceEventDate());
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [sourceBusy, setSourceBusy] = useState(false);
  const [history, setHistory] = useState<EvidenceRevisionView[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const item = data.item;
  const dirty = title !== item.title || content !== item.content || kind !== item.kind || !evidenceEventDatesEqual(eventDate, item.eventDate ?? emptyEvidenceEventDate());
  async function reload() {
    const refreshed = await getEvidenceItem(item.id);
    setData(refreshed); setTitle(refreshed.item.title); setContent(refreshed.item.content); setKind(refreshed.item.kind);
    setEventDate(refreshed.item.eventDate ?? emptyEvidenceEventDate());
    setHistory(null); setNextBefore(null); router.refresh();
  }
  function change(work: () => Promise<unknown>, success: string) {
    setError("");
    startTransition(async () => {
      try { await work(); await reload(); Toast.success(success); }
      catch (failure) { setError(actionErrorMessage(failure)); }
    });
  }
  async function close() {
    if (pending || sourceBusy) return;
    if (dirty && !await confirmDialog({ title: "放弃未保存的修改？", confirmText: "放弃修改" })) return;
    onClose();
  }
  async function confirm() {
    if (!await confirmDialog({ title: `核对第 ${item.revision} 版记录？`, description: `${item.title}\n性质：${evidenceKindLabel[item.kind]}\n\n核对本条记录、发生时间及支持和反驳来源，不等于认定事实。核对后保留当前性质；后续修改需重新核对。`, confirmText: "标记本版已核对", initialFocus: "cancel" })) return;
    change(() => confirmEvidenceItem({ evidenceItemId: item.id, expectedRevision: item.revision, confirm: true }), "此版记录已核对");
  }
  async function remove(source: EvidenceSourceView) {
    if (!await confirmDialog({ title: "移除此来源关联？", description: "移除关联会形成新修订，需重新核对记录。原件和历史引用仍保留。", confirmText: "移除来源关联" })) return;
    change(() => removeEvidenceSource({ evidenceItemId: item.id, expectedRevision: item.revision, sourceId: source.id }), "来源关联已移除");
  }
  function loadHistory(more = false) {
    setError("");
    startTransition(async () => {
      try {
        const result = await listEvidenceRevisions({ evidenceItemId: item.id, ...(more && nextBefore ? { beforeRevision: nextBefore } : {}) });
        setHistory(current => more ? [...(current ?? []), ...result.items] : result.items); setNextBefore(result.nextBeforeRevision);
      } catch (failure) { setError(actionErrorMessage(failure)); }
    });
  }
  function save() {
    const date = evidenceEventDateSchema.safeParse(eventDate);
    if (!date.success) { setError(date.error.issues[0].message); return; }
    change(() => updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: item.revision, title, content, kind, eventDate: date.data }), "要点修改已保存，记录待核对");
  }
  return <WorkspaceDialog open onOpenChange={open => { if (!open) void close(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <DialogHeader><DialogTitle>证据要点</DialogTitle><DialogDescription>
        第 {item.revision} 版 · {item.confirmedAt ? `记录已由 ${item.confirmedByName ?? "记录的核对人"} 核对 · ${formatDate(new Date(item.confirmedAt))}` : "记录待核对"}
      </DialogDescription></DialogHeader>
      {item.restricted ? <p role="status" className="text-sm text-muted-foreground">部分来源已不可读或身份发生变化，内容和修改暂不可用。请核对材料权限和原件状态。</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div className="space-y-1.5"><label htmlFor={id + "-title"} className="text-sm font-medium text-[var(--semi-color-text-1)]">标题</label><Input id={id + "-title"} value={title} onChange={inputValue => setTitle(inputValue)} maxLength={200} disabled={!item.canEdit || pending || sourceBusy} /></div>
          <div className="space-y-1.5"><label htmlFor={id + "-kind"} className="text-sm font-medium text-[var(--semi-color-text-1)]">性质</label><KindSelect id={id + "-kind"} value={kind} onChange={setKind} disabled={!item.canEdit || pending || sourceBusy} /></div>
        </div>
        <div className="space-y-1.5"><label htmlFor={id + "-content"} className="text-sm font-medium text-[var(--semi-color-text-1)]">内容</label><TextArea id={id + "-content"} value={content} onChange={inputValue => setContent(inputValue)} maxLength={5000} rows={5} disabled={!item.canEdit || pending || sourceBusy} /></div>
        <EventDateFields id={id} value={eventDate} onChange={setEventDate} disabled={!item.canEdit || pending || sourceBusy} />
      </>}
      <section className="space-y-2" aria-label="来源材料">
        <h3 className="text-sm font-medium">来源</h3>
        {item.sources.length ? <ul className="space-y-2 text-sm">{item.sources.map(source => <li key={source.id} className="flex items-start justify-between gap-3">
          <SourceButton itemId={item.id} revision={item.revision} source={source} />
          {item.canEdit && !source.legacy ? <Button className="shrink-0" disabled={pending || sourceBusy || dirty} onClick={() => void remove(source)} type="tertiary" theme="borderless" size="small">移除关联</Button> : null}
        </li>)}</ul> : <p className="text-sm text-muted-foreground">未挂来源材料</p>}
        {item.canEdit ? <SourceAdder key={item.revision} item={item} documents={data.documents} disabled={pending || dirty} onAdded={reload} onBusyChange={setSourceBusy} /> : null}
      </section>
      {dirty ? <p className="text-sm text-muted-foreground">先保存要点修改，再调整来源或核对记录。{item.confirmedAt ? "保存后需重新核对。" : ""}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <section className="space-y-2">
        {history === null ? <Button disabled={pending} onClick={() => loadHistory()} type="tertiary" theme="borderless" size="small">查看历史修订</Button> : <>
          <h3 className="text-sm font-medium">历史修订</h3>
          {history.length ? <ol className="space-y-3">{history.map(entry => <li key={entry.revision} className="space-y-1 border-t pt-2 text-sm">
            <div className="text-xs text-muted-foreground">第 {entry.revision} 版 · {entry.confirmedAt ? `当时已由 ${entry.confirmedByName ?? "记录的核对人"} 核对记录` : "当时记录未核对"} · {formatDate(new Date(entry.createdAt))}</div>
            <p className="break-words font-medium">{entry.title}</p>
            <p className="whitespace-pre-wrap break-words">{entry.restricted ? "当前无权读取部分历史来源，内容暂不展示。" : entry.content}</p>
            {!entry.restricted ? <EventDateDetails value={entry.eventDate} /> : null}
            {entry.sources.map(source => <div key={source.id}><SourceButton itemId={item.id} revision={entry.revision} source={source} /></div>)}
          </li>)}</ol> : <p className="text-sm text-muted-foreground">尚无历史修订</p>}
          {nextBefore ? <Button disabled={pending} onClick={() => loadHistory(true)} type="tertiary" theme="borderless" size="small">更早修订</Button> : null}
        </>}
      </section>
      <DialogFooter>
        <Button disabled={pending || sourceBusy} onClick={() => void close()} type="tertiary" theme="outline">返回要点列表</Button>
        {item.canEdit ? <>
          <Button disabled={pending || sourceBusy || dirty || Boolean(item.confirmedAt)} onClick={() => void confirm()} type="tertiary" theme="outline">核对本版记录</Button>
          <Button disabled={pending || sourceBusy || !dirty || !title.trim() || !content.trim()} onClick={save} theme="solid">
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}保存要点修改
          </Button>
        </> : null}
      </DialogFooter>
    </DialogContent>
  </WorkspaceDialog>;
}

function SourceAdder({ item, documents, disabled, onAdded, onBusyChange }: { item: EvidenceItemView; documents: EvidenceDocumentOption[]; disabled: boolean; onAdded: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [relation, setRelation] = useState<Relation>("CONTEXT");
  const [location, setLocation] = useState<MaterialSourceLocation>({ page: "", position: null });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const document = documents.find(option => option.id === documentId);
  function selectDocument(value: string) { setDocumentId(value); setLocation({ page: "", position: null }); setError(""); }
  function submit() {
    setError("");
    onBusyChange(true);
    startTransition(async () => {
      try {
        await addEvidenceSource({ evidenceItemId: item.id, expectedRevision: item.revision, documentId, relation,
          ...(location.position ? { parseRunId: location.position.runId, anchorId: location.position.anchorId } : { page: location.page ? Number(location.page) : null }) });
        await onAdded(); Toast.success("来源已添加，记录待核对");
      } catch (failure) { setError(actionErrorMessage(failure)); }
      finally { onBusyChange(false); }
    });
  }
  if (!expanded) return <Button disabled={disabled} onClick={() => setExpanded(true)} type="tertiary" theme="outline" size="small">添加来源</Button>;
  return <div className="space-y-2 border-t pt-3">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
      <div className="space-y-1"><label id={id + "-document" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">材料版本</label>
        <Select value={documentId} onChange={value => { if (typeof value === "string") selectDocument(value); }} disabled={disabled || pending} id={id + "-document"} aria-labelledby={id + "-document" + "-label"} placeholder="选择材料" className="w-full" motion={false}>{documents.map(option => <Select.Option key={option.id} value={option.id}>{option.name} · 第 {option.version} 版</Select.Option>)}</Select>
      </div>
      <div className="space-y-1"><label id={id + "-relation" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">关系</label>
        <Select value={relation} onChange={value => { if (typeof value === "string") setRelation(value as Relation); }} disabled={disabled || pending} id={id + "-relation"} aria-labelledby={id + "-relation" + "-label"} className="w-full" motion={false}>{RELATIONS.map(value => <Select.Option key={value} value={value}>{sourceRelationLabel[value]}</Select.Option>)}</Select>
      </div>
    </div>
    {document && !document.hasIdentity ? <p className="text-sm text-muted-foreground">该材料原件标识尚未就绪，请先核对材料。</p> : null}
    {document ? <MaterialSourceLocationPicker key={`${item.matterId}:${document.id}`} matterId={item.matterId} document={document} value={location} onChange={setLocation} disabled={disabled || pending} /> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button disabled={disabled || pending} onClick={() => setExpanded(false)} type="tertiary" theme="outline" size="small">取消添加</Button><Button disabled={disabled || pending || !document?.hasIdentity} onClick={submit} theme="solid" size="small">添加来源</Button></div>
  </div>;
}

/** A new opening or matter starts a new creation intent; retries keep it. */
export function EvidenceItemDialog({ open, onOpenChange, matterId, documents, defaultDocumentId }: {
  open: boolean; onOpenChange: (open: boolean) => void; matterId: string;
  documents: { id: string; name: string }[]; defaultDocumentId: string | null;
}) {
  const [saving, setSaving] = useState(false);
  return <WorkspaceDialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>{open ? <EvidenceCreateForm key={matterId} matterId={matterId} documents={documents} defaultDocumentId={defaultDocumentId} onClose={() => onOpenChange(false)} onBusyChange={setSaving} /> : null}</WorkspaceDialog>;
}

function EvidenceCreateForm({ matterId, documents, defaultDocumentId, onClose, onBusyChange }: {
  matterId: string; documents: { id: string; name: string }[]; defaultDocumentId: string | null; onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requestKey] = useState(() => crypto.randomUUID());
  const active = useRef(true);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EvidenceKind>("FACT");
  const [content, setContent] = useState("");
  const [eventDate, setEventDate] = useState<EvidenceEventDate>(emptyEvidenceEventDate);
  const [sourceDocumentId, setSourceDocumentId] = useState(defaultDocumentId ?? "none");
  const [sourcePage, setSourcePage] = useState("");
  const [relation, setRelation] = useState<Relation>("CONTEXT");
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; onBusyChange(false); };
  }, [onBusyChange]);
  function submit() {
    const page = sourcePage ? Number(sourcePage) : null;
    if (!title.trim() || !content.trim()) { setError("请填写标题与内容"); return; }
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 10000)) { setError("页码须为 1–10000 的整数"); return; }
    const date = evidenceEventDateSchema.safeParse(eventDate);
    if (!date.success) { setError(date.error.issues[0].message); return; }
    setError("");
    onBusyChange(true);
    startTransition(async () => {
      try {
        await createEvidenceItem({ requestKey, matterId, title: title.trim(), content: content.trim(), kind,
          sourceDocumentId: sourceDocumentId === "none" ? null : sourceDocumentId, sourcePage: page, sourceRelation: relation, eventDate: date.data });
        if (!active.current) return;
        Toast.success("证据要点已保存，记录待核对"); onClose(); router.refresh();
      } catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
      finally { if (active.current) onBusyChange(false); }
    });
  }
  return <DialogContent onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>添加证据要点</DialogTitle><DialogDescription>保存后可继续编辑、关联来源并核对记录。</DialogDescription></DialogHeader>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
      <div className="space-y-1.5"><label htmlFor={id + "-title"} className="text-sm font-medium text-[var(--semi-color-text-1)]">标题</label><Input id={id + "-title"} value={title} onChange={inputValue => setTitle(inputValue)} maxLength={200} disabled={pending} /></div>
      <div className="space-y-1.5"><label htmlFor={id + "-kind"} className="text-sm font-medium text-[var(--semi-color-text-1)]">性质</label><KindSelect id={id + "-kind"} value={kind} onChange={setKind} disabled={pending} /></div>
    </div>
    <div className="space-y-1.5"><label htmlFor={id + "-content"} className="text-sm font-medium text-[var(--semi-color-text-1)]">内容</label><TextArea id={id + "-content"} value={content} onChange={inputValue => setContent(inputValue)} maxLength={5000} rows={4} disabled={pending} /></div>
    <EventDateFields id={id} value={eventDate} onChange={setEventDate} disabled={pending} />
    <div className="space-y-1.5"><label id={id + "-source" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">来源材料</label>
      <Select value={sourceDocumentId} onChange={value => { if (typeof value !== "string") return; setSourceDocumentId(value); setSourcePage(""); }} disabled={pending} id={id + "-source"} aria-labelledby={id + "-source" + "-label"} className="w-full" motion={false}><Select.Option value="none">不挂来源</Select.Option>{documents.map(document => <Select.Option key={document.id} value={document.id}>{document.name}</Select.Option>)}</Select>
    </div>
    {sourceDocumentId !== "none" ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><label htmlFor={id + "-page"} className="text-sm font-medium text-[var(--semi-color-text-1)]">PDF 页码（可选）</label><Input id={id + "-page"} type="number" min={1} max={10000} value={sourcePage} onChange={inputValue => setSourcePage(inputValue)} disabled={pending} /></div>
      <div className="space-y-1.5"><label id={id + "-relation" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">来源关系</label><Select value={relation} onChange={value => { if (typeof value === "string") setRelation(value as Relation); }} disabled={pending} id={id + "-relation"} aria-labelledby={id + "-relation" + "-label"} className="w-full" motion={false}>{RELATIONS.map(value => <Select.Option key={value} value={value}>{sourceRelationLabel[value]}</Select.Option>)}</Select></div>
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button onClick={onClose} disabled={pending} type="tertiary" theme="outline">取消</Button><Button onClick={submit} disabled={pending} theme="solid">{pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}保存要点</Button></DialogFooter>
  </DialogContent>;
}
