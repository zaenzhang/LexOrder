"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Unlink } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import {
  addEvidenceSource, confirmEvidenceItem, createEvidenceItem, getEvidenceItem,
  listEvidenceRevisions, removeEvidenceSource, resolveEvidenceSource, updateEvidenceItem,
} from "@/server/evidence/actions";
import { listMaterialSources } from "@/server/documents/processing-actions";
import { getCaseMaterialDetail } from "@/server/evidence/workspace-actions";
import { sourceRelationLabel } from "@/server/evidence/contracts";
import type { EvidenceDocumentOption, EvidenceItemView, EvidenceRevisionView, EvidenceSourceResult, EvidenceSourceView } from "@/server/evidence/contracts";
import { evidenceKindLabel } from "@/lib/enums";
import { cn, formatDate } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";
import {
  emptyEvidenceEventDate, evidenceDatePrecisionLabel, evidenceEventDateSchema,
  evidenceEventDatesEqual, formatEvidenceEventDate, type EvidenceEventDate,
} from "@/lib/evidence/event-date";

type EvidenceKind = keyof typeof evidenceKindLabel;
type Relation = keyof typeof sourceRelationLabel;
export type EvidenceEditorData = Awaited<ReturnType<typeof getEvidenceItem>>;
type MaterialChoice = Awaited<ReturnType<typeof listMaterialSources>>["items"][number];
export type EvidenceSourceTarget = { evidenceItemId: string; sourceId: string; revision?: number };
export type EvidenceNavigation = {
  onOpenItem: (id: string) => void;
  onOpenSource: (source: EvidenceSourceTarget) => void;
};
export type EvidenceTaskState = { dirty: boolean; busy: boolean };

export type EvidenceItemRow = {
  id: string; title: string; content: string; kind: EvidenceKind;
  sourceDocumentId: string | null; sourceDocumentName: string | null; sourcePage: number | null;
  createdByName: string | null; createdAt: Date | string;
  revision?: number; confirmedAt?: Date | string | null; confirmedByName?: string | null;
  sources?: EvidenceSourceView[]; restricted?: boolean; canEdit?: boolean;
  eventDate?: EvidenceEventDate | null;
};
const EVIDENCE_KIND_VARIANT: Record<EvidenceKind, BadgeProps["variant"]> = {
  FACT: "teal",
  CLAIM: "blue",
  ANALYSIS: "violet",
  ISSUE: "red",
  TODO_VERIFY: "amber",
};
const KIND_KEYS = Object.keys(evidenceKindLabel) as EvidenceKind[];
const RELATIONS = Object.keys(sourceRelationLabel) as Relation[];

function KindSelect({ value, onChange, id, disabled }: { value: EvidenceKind; onChange: (value: EvidenceKind) => void; id: string; disabled?: boolean }) {
  return <Select value={value} onValueChange={value => onChange(value as EvidenceKind)} disabled={disabled}>
    <SelectTrigger id={id}><SelectValue /></SelectTrigger>
    <SelectContent><SelectGroup>{KIND_KEYS.map(kind => <SelectItem key={kind} value={kind}>{evidenceKindLabel[kind]}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

function EventDateFields({ value, onChange, id, disabled }: {
  value: EvidenceEventDate; onChange: (value: EvidenceEventDate) => void; id: string; disabled?: boolean;
}) {
  function precision(next: EvidenceEventDate["precision"]) {
    onChange({ ...value, precision: next, start: next === "UNKNOWN" ? null : value.start, end: next === "RANGE" ? value.end : null });
  }
  return <fieldset className="flex flex-col gap-2" disabled={disabled}>
    <legend className="mb-1 text-sm font-medium">发生时间</legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-precision"}>日期精度</Label>
        <Select value={value.precision} onValueChange={next => precision(next as EvidenceEventDate["precision"])} disabled={disabled}>
          <SelectTrigger id={id + "-precision"}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(evidenceDatePrecisionLabel).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      {value.precision !== "UNKNOWN" ? <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-date-start"}>{value.precision === "EXACT" ? "发生日期" : "开始日期"}</Label>
        <Input id={id + "-date-start"} type="date" min="0001-01-01" max="9999-12-31" value={value.start ?? ""} onChange={event => onChange({ ...value, start: event.target.value || null })} />
      </div> : null}
      {value.precision === "RANGE" ? <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-date-end"}>结束日期</Label>
        <Input id={id + "-date-end"} type="date" min="0001-01-01" max="9999-12-31" value={value.end ?? ""} onChange={event => onChange({ ...value, end: event.target.value || null })} />
      </div> : null}
    </div>
    <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-date-text"}>原始时间表述（可选）</Label>
      <Textarea id={id + "-date-text"} value={value.text ?? ""} onChange={event => onChange({ ...value, text: event.target.value || null })} maxLength={500} rows={2} placeholder="如：某年夏天、收到通知后的第二天" />
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

function SourceButton({ itemId, revision, source, onOpenSource, disabled }: {
  itemId: string; revision?: number; source: EvidenceSourceView;
  onOpenSource: EvidenceNavigation["onOpenSource"]; disabled?: boolean;
}) {
  if (source.status === "UNAVAILABLE") return <span className="inline-flex items-center gap-1 text-muted-foreground"><Unlink className="h-3 w-3" />来源不可用</span>;
  return <Button type="button" onClick={() => onOpenSource({ evidenceItemId: itemId, sourceId: source.id, revision })}
      data-source-key={`${revision ?? "current"}:${source.id}`} disabled={disabled} variant="link" size="sm"
      className="h-auto min-w-0 max-w-full justify-start whitespace-normal px-0 py-0 text-left">
      <span className="min-w-0 break-words">
        {source.relation ? sourceRelationLabel[source.relation] + " · " : "历史来源 · "}
        {source.documentName} · 第 {source.documentVersion} 版 · {source.locationLabel}
      </span>
    </Button>;
}

/** Self-contained presentation shared by material rows and portalled timelines. */
export function EvidencePoints({ items, showSource = false, onOpenItem, onOpenSource }: {
  items: EvidenceItemRow[]; showSource?: boolean;
} & EvidenceNavigation) {
  return <ul tabIndex={-1} aria-label="证据要点列表" className="m-0 flex min-w-0 list-none flex-col gap-3 p-0">{items.map(item => <li key={item.id} className="flex min-w-0 flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
        <Badge variant={EVIDENCE_KIND_VARIANT[item.kind]}>{evidenceKindLabel[item.kind]}</Badge>
        <span className="min-w-0 flex-1 break-words text-left text-sm font-semibold">{item.title}</span>
        {item.revision ? <span className="text-xs text-muted-foreground">第 {item.revision} 版 · {item.confirmedAt ? "记录已核对" : "记录待核对"}</span> : item.sourcePage ? <span className="text-xs text-muted-foreground">第 {item.sourcePage} 页</span> : null}
      </div>
      {!item.restricted ? <EventDateDetails value={item.eventDate} /> : null}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.restricted ? "部分来源当前不可用，内容暂不展示。" : item.content}</p>
      {item.sources?.length ? <ul className="flex min-w-0 list-none flex-col gap-1">{item.sources.map(source => <li key={source.id} className="min-w-0"><SourceButton itemId={item.id} revision={item.revision} source={source} onOpenSource={onOpenSource} /></li>)}</ul> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showSource && !item.sources?.length ? <span>{item.sourceDocumentId ? item.sourceDocumentName ?? "来源不可用（引用保留）" : "未挂来源材料"}</span> : null}
        {item.createdByName ? <span className="min-w-0 break-words">记录人 {item.createdByName}</span> : null}
        <span className="font-mono">记录时间 {formatDate(new Date(item.createdAt))}</span>
        {!item.restricted ? <Button type="button" variant="ghost" size="sm" className="sm:ml-auto"
          data-evidence-id={item.id}
          aria-label={`${item.canEdit ? "查看与编辑要点" : "查看要点"}：${item.title}`}
          onClick={() => onOpenItem(item.id)}>
          {item.canEdit ? "查看与编辑要点" : "查看要点"}
        </Button> : null}
      </div>
    </li>)}</ul>;
}

export function EvidenceDetailContent({ initial, source, onOpenSource, onReturnFromSource, onBack, backLabel, onStateChange }: {
  initial: EvidenceEditorData; source: EvidenceSourceTarget | null;
  onOpenSource: EvidenceNavigation["onOpenSource"]; onReturnFromSource: () => void;
  onBack: () => void; backLabel: string; onStateChange: (state: EvidenceTaskState) => void;
}) {
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
  const [sourceDirty, setSourceDirty] = useState(false);
  const [history, setHistory] = useState<EvidenceRevisionView[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [sourceView, setSourceView] = useState<{ target: EvidenceSourceTarget; result: EvidenceSourceResult | null; error: string } | null>(null);
  const sourceRequest = useRef(0);
  const returnSource = useRef<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const active = useRef(true);
  const item = data.item;
  const dirty = title !== item.title || content !== item.content || kind !== item.kind || !evidenceEventDatesEqual(eventDate, item.eventDate ?? emptyEvidenceEventDate());
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { onStateChange({ dirty: dirty || sourceDirty, busy: pending || sourceBusy }); }, [dirty, sourceDirty, pending, sourceBusy, onStateChange]);
  const loadSource = useCallback(async (target: EvidenceSourceTarget) => {
    const request = ++sourceRequest.current;
    returnSource.current = `${target.revision ?? "current"}:${target.sourceId}`;
    setSourceView({ target, result: null, error: "" });
    try {
      const result = await resolveEvidenceSource({ evidenceItemId: target.evidenceItemId, sourceId: target.sourceId, revision: target.revision });
      if (active.current && sourceRequest.current === request) setSourceView({ target, result, error: "" });
    } catch (failure) {
      if (active.current && sourceRequest.current === request) setSourceView({ target, result: null, error: actionErrorMessage(failure) });
    }
  }, []);
  useEffect(() => {
    if (source) void loadSource(source);
    else { sourceRequest.current++; setSourceView(null); }
  }, [source, loadSource]);
  const showingSource = source !== null;
  useEffect(() => {
    if (showingSource) { headingRef.current?.focus({ preventScroll: true }); return; }
    if (returnSource.current) {
      const trigger = Array.from(formRef.current?.querySelectorAll<HTMLButtonElement>("button[data-source-key]") ?? [])
        .find(button => button.dataset.sourceKey === returnSource.current);
      (trigger ?? headingRef.current)?.focus({ preventScroll: true });
      returnSource.current = null;
    }
  }, [showingSource]);
  async function reload() {
    const refreshed = await getEvidenceItem(item.id);
    if (!active.current) return;
    setData(refreshed); setTitle(refreshed.item.title); setContent(refreshed.item.content); setKind(refreshed.item.kind);
    setEventDate(refreshed.item.eventDate ?? emptyEvidenceEventDate());
    setHistory(null); setNextBefore(null); router.refresh();
  }
  function change(work: () => Promise<unknown>, success: string) {
    setError("");
    onStateChange({ dirty: dirty || sourceDirty, busy: true });
    startTransition(async () => {
      try { await work(); if (active.current) { await reload(); toast.success(success); } }
      catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
    });
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
        if (active.current) { setHistory(current => more ? [...(current ?? []), ...result.items] : result.items); setNextBefore(result.nextBeforeRevision); }
      } catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
    });
  }
  function save() {
    const date = evidenceEventDateSchema.safeParse(eventDate);
    if (!date.success) { setError(date.error.issues[0].message); return; }
    change(() => updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: item.revision, title, content, kind, eventDate: date.data }), "要点修改已保存，记录待核对");
  }
  const shownSource = source && sourceView?.target.sourceId === source.sourceId && sourceView.target.revision === source.revision ? sourceView : null;
  const preview = shownSource?.result?.status === "AVAILABLE" ? shownSource.result : null;
  return <>
      <DialogHeader><DialogTitle ref={headingRef} tabIndex={-1}>{showingSource ? preview?.documentName ?? "来源原文" : "证据要点"}</DialogTitle><DialogDescription>
        {showingSource ? preview ? `第 ${preview.documentVersion} 版 · ${preview.locationLabel}` : shownSource?.error || shownSource?.result ? "来源暂不可用" : "正在读取…" :
          `第 ${item.revision} 版 · ${item.confirmedAt ? `记录已由 ${item.confirmedByName ?? "记录的核对人"} 核对 · ${formatDate(new Date(item.confirmedAt))}` : "记录待核对"}`}
      </DialogDescription></DialogHeader>
      {showingSource ? <>
        {preview?.legacy ? <p className="text-sm text-muted-foreground">历史引用未固定原件校验值，请核对原文。</p> : null}
        {preview?.historicalParse ? <p className="text-sm text-muted-foreground">显示引用时保留的解析版本。</p> : null}
        {preview?.text ? <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{preview.text}</blockquote> : null}
        {preview?.previewable ? <iframe title="来源原件" src={preview.originalUrl} className="h-[55vh] w-full rounded border" /> : null}
        {!shownSource?.result && !shownSource?.error ? <p role="status" className="text-sm text-muted-foreground">正在读取来源…</p> : null}
        {shownSource?.result?.status === "UNAVAILABLE" || shownSource?.error ? <Alert variant="destructive"><AlertDescription>
          {shownSource.error || "来源当前不可用，请核对材料权限和原件状态。"}
          <Button variant="link" size="sm" onClick={() => source && void loadSource(source)}>重新读取</Button>
        </AlertDescription></Alert> : null}
        <DialogFooter>
          {preview ? <Button asChild variant="outline"><a href={preview.originalUrl} target="_blank" rel="noopener noreferrer">{preview.previewable ? "另页打开原件" : "下载原件"}</a></Button> : null}
          <Button variant="outline" onClick={onReturnFromSource}>返回要点</Button>
        </DialogFooter>
      </> : null}
      {/* One task keeps its form state while its source is visible; it performs no background reads. */}
      <div ref={formRef} hidden={showingSource} className={cn("flex flex-col gap-4", showingSource && "hidden")}>
      {item.restricted ? <p role="status" className="text-sm text-muted-foreground">部分来源已不可读或身份发生变化，内容和修改暂不可用。请核对材料权限和原件状态。</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-title"}>标题</Label><Input id={id + "-title"} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} disabled={!item.canEdit || pending || sourceBusy || sourceDirty} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-kind"}>性质</Label><KindSelect id={id + "-kind"} value={kind} onChange={setKind} disabled={!item.canEdit || pending || sourceBusy || sourceDirty} /></div>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-content"}>内容</Label><Textarea id={id + "-content"} value={content} onChange={event => setContent(event.target.value)} maxLength={5000} rows={5} disabled={!item.canEdit || pending || sourceBusy || sourceDirty} /></div>
        <EventDateFields id={id} value={eventDate} onChange={setEventDate} disabled={!item.canEdit || pending || sourceBusy || sourceDirty} />
      </>}
      <section className="flex flex-col gap-2" aria-label="来源材料">
        <h3 className="text-sm font-medium">来源</h3>
        {item.sources.length ? <ul className="flex flex-col gap-2 text-sm">{item.sources.map(source => <li key={source.id} className="flex items-start justify-between gap-3">
          <SourceButton itemId={item.id} revision={item.revision} source={source} disabled={pending || sourceBusy} onOpenSource={onOpenSource} />
          {item.canEdit && !source.legacy ? <Button size="sm" variant="ghost" className="shrink-0" disabled={pending || sourceBusy || dirty || sourceDirty} onClick={() => void remove(source)}>移除关联</Button> : null}
        </li>)}</ul> : <p className="text-sm text-muted-foreground">未挂来源材料</p>}
        {item.canEdit ? <SourceAdder key={item.revision} item={item} documents={data.documents} disabled={pending || dirty || showingSource} onAdded={reload} onBusyChange={setSourceBusy} onDirtyChange={setSourceDirty} /> : null}
      </section>
      {dirty ? <p className="text-sm text-muted-foreground">先保存要点修改，再调整来源或核对记录。{item.confirmedAt ? "保存后需重新核对。" : ""}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <section className="flex flex-col gap-2">
        {history === null ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => loadHistory()}>查看历史修订</Button> : <>
          <h3 className="text-sm font-medium">历史修订</h3>
          {history.length ? <ol className="flex flex-col gap-3">{history.map(entry => <li key={entry.revision} className="flex flex-col gap-1 border-t pt-2 text-sm">
            <div className="text-xs text-muted-foreground">第 {entry.revision} 版 · {entry.confirmedAt ? `当时已由 ${entry.confirmedByName ?? "记录的核对人"} 核对记录` : "当时记录未核对"} · {formatDate(new Date(entry.createdAt))}</div>
            <p className="break-words font-medium">{entry.title}</p>
            <p className="whitespace-pre-wrap break-words">{entry.restricted ? "当前无权读取部分历史来源，内容暂不展示。" : entry.content}</p>
            {!entry.restricted ? <EventDateDetails value={entry.eventDate} /> : null}
            {entry.sources.map(source => <div key={source.id}><SourceButton itemId={item.id} revision={entry.revision} source={source} disabled={pending || sourceBusy} onOpenSource={onOpenSource} /></div>)}
          </li>)}</ol> : <p className="text-sm text-muted-foreground">尚无历史修订</p>}
          {nextBefore ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => loadHistory(true)}>更早修订</Button> : null}
        </>}
      </section>
      <DialogFooter>
        <Button variant="outline" disabled={pending || sourceBusy} onClick={onBack}>{backLabel}</Button>
        {item.canEdit ? <>
          <Button variant="outline" disabled={pending || sourceBusy || dirty || sourceDirty || Boolean(item.confirmedAt)} onClick={() => void confirm()}>核对本版记录</Button>
          <Button disabled={pending || sourceBusy || sourceDirty || !dirty || !title.trim() || !content.trim()} onClick={save}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}保存要点修改
          </Button>
        </> : null}
      </DialogFooter>
      </div>
  </>;
}

function SourceAdder({ item, documents, disabled, onAdded, onBusyChange, onDirtyChange }: {
  item: EvidenceItemView; documents: EvidenceDocumentOption[]; disabled: boolean; onAdded: () => Promise<void>;
  onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [relation, setRelation] = useState<Relation>("CONTEXT");
  const [page, setPage] = useState("");
  const [choices, setChoices] = useState<MaterialChoice[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<MaterialChoice | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const active = useRef(true);
  const document = documents.find(option => option.id === documentId);
  useEffect(() => { onDirtyChange(expanded && Boolean(documentId || page || selected || relation !== "CONTEXT")); }, [expanded, documentId, page, selected, relation, onDirtyChange]);
  useEffect(() => { active.current = true; return () => { active.current = false; onDirtyChange(false); }; }, [onDirtyChange]);
  function selectDocument(value: string) { setDocumentId(value); setPage(""); setChoices(null); setSelected(null); setNextOffset(null); setError(""); }
  function loadPositions(more = false) {
    setError("");
    startTransition(async () => {
      try {
        const result = await listMaterialSources({ matterId: item.matterId, documentIds: [documentId], limit: 20, ...(more && nextOffset !== null ? { offset: nextOffset } : {}) });
        if (active.current) { setChoices(current => more ? [...(current ?? []), ...result.items] : result.items); setNextOffset(result.nextOffset); }
      } catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
    });
  }
  function submit() {
    setError("");
    onBusyChange(true);
    startTransition(async () => {
      try {
        await addEvidenceSource({ evidenceItemId: item.id, expectedRevision: item.revision, documentId, relation,
          ...(selected ? { parseRunId: selected.runId, anchorId: selected.anchorId } : { page: page ? Number(page) : null }) });
        await onAdded(); toast.success("来源已添加，记录待核对");
      } catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
      finally { onBusyChange(false); }
    });
  }
  if (!expanded) return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setExpanded(true)}>添加来源</Button>;
  return <div className="flex flex-col gap-2 border-t pt-3">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
      <div className="flex flex-col gap-1"><Label htmlFor={id + "-document"}>材料版本</Label>
        <Select value={documentId} onValueChange={selectDocument} disabled={disabled || pending}>
          <SelectTrigger id={id + "-document"}><SelectValue placeholder="选择材料" /></SelectTrigger>
          <SelectContent><SelectGroup>{documents.map(option => <SelectItem key={option.id} value={option.id}>{option.name} · 第 {option.version} 版</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1"><Label htmlFor={id + "-relation"}>关系</Label>
        <Select value={relation} onValueChange={value => setRelation(value as Relation)} disabled={disabled || pending}>
          <SelectTrigger id={id + "-relation"}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{RELATIONS.map(value => <SelectItem key={value} value={value}>{sourceRelationLabel[value]}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
    </div>
    {document && !document.hasIdentity ? <p className="text-sm text-muted-foreground">该材料原件标识尚未就绪，请先核对材料。</p> : null}
    {document?.isPdf && document.pageCount && !selected ? <div className="flex flex-col gap-1"><Label htmlFor={id + "-page"}>页码（可选，共 {document.pageCount} 页）</Label><Input id={id + "-page"} type="number" min={1} max={document.pageCount} value={page} onChange={event => setPage(event.target.value)} disabled={disabled || pending} /></div> : null}
    {document ? <Button size="sm" variant="ghost" disabled={disabled || pending || choices !== null} onClick={() => loadPositions()}>读取可引用的原文位置</Button> : null}
    {choices !== null ? <div className="flex flex-col gap-2">
      <Select value={selected ? selected.runId + ":" + selected.anchorId : "original"} onValueChange={value => { setSelected(choices.find(choice => choice.runId + ":" + choice.anchorId === value) ?? null); setPage(""); }} disabled={disabled || pending}>
        <SelectTrigger aria-label="原文位置"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="original">引用原件</SelectItem>{choices.map(choice => <SelectItem key={choice.runId + ":" + choice.anchorId} value={choice.runId + ":" + choice.anchorId}>{choice.locationLabel} · {choice.excerpt.slice(0, 55)}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {selected ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{selected.excerpt}</p> : null}
      {!choices.length ? <p className="text-xs text-muted-foreground">暂无可引用的已处理位置，可以引用原件。</p> : null}
      {nextOffset !== null ? <Button size="sm" variant="ghost" disabled={disabled || pending} onClick={() => loadPositions(true)}>更多位置</Button> : null}
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => { setExpanded(false); selectDocument(""); setRelation("CONTEXT"); }}>取消添加</Button><Button size="sm" disabled={disabled || pending || !document?.hasIdentity} onClick={submit}>添加来源</Button></div>
  </div>;
}

/** One task owns one creation identity. Source inspection and retries never replace it. */
export function EvidenceCreateContent({ matterId, documents, defaultDocumentId, onBack, backLabel, onCreated, onStateChange }: {
  matterId: string; documents: EvidenceDocumentOption[]; defaultDocumentId: string | null;
  onBack: () => void; backLabel: string; onCreated: (id: string) => void; onStateChange: (state: EvidenceTaskState) => void;
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
  const [original, setOriginal] = useState<{
    documentId: string; document: Awaited<ReturnType<typeof getCaseMaterialDetail>>["document"] | null; error: string;
  } | null>(null);
  const originalRequest = useRef(0);
  const originalTrigger = useRef<HTMLButtonElement | null>(null);
  const originalHeading = useRef<HTMLHeadingElement | null>(null);
  const document = documents.find(option => option.id === sourceDocumentId);
  const dirty = Boolean(title || content || kind !== "FACT" || sourcePage || relation !== "CONTEXT" ||
    sourceDocumentId !== (defaultDocumentId ?? "none") || !evidenceEventDatesEqual(eventDate, emptyEvidenceEventDate()));
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { onStateChange({ dirty, busy: pending }); }, [dirty, pending, onStateChange]);
  const viewingOriginal = original !== null;
  useEffect(() => { if (viewingOriginal) originalHeading.current?.focus({ preventScroll: true }); }, [viewingOriginal]);
  async function openOriginal(documentId: string) {
    const request = ++originalRequest.current;
    setOriginal({ documentId, document: null, error: "" });
    try {
      const result = await getCaseMaterialDetail({ matterId, documentId });
      if (active.current && originalRequest.current === request) setOriginal({ documentId, document: result.document, error: "" });
    } catch (failure) {
      if (active.current && originalRequest.current === request) setOriginal({ documentId, document: null, error: actionErrorMessage(failure) });
    }
  }
  function backToDraft() {
    originalRequest.current++; setOriginal(null);
    requestAnimationFrame(() => originalTrigger.current?.focus({ preventScroll: true }));
  }
  function submit() {
    const page = sourcePage ? Number(sourcePage) : null;
    if (!title.trim() || !content.trim()) { setError("请填写标题与内容"); return; }
    if (sourceDocumentId !== "none" && !document?.hasIdentity) { setError("该材料原件标识尚未就绪，请先核对材料"); return; }
    if (page !== null && (!document?.isPdf || !document.pageCount || !Number.isInteger(page) || page < 1 || page > document.pageCount)) {
      setError("页码须在已知 PDF 原件页数内"); return;
    }
    const date = evidenceEventDateSchema.safeParse(eventDate);
    if (!date.success) { setError(date.error.issues[0].message); return; }
    setError("");
    onStateChange({ dirty, busy: true });
    startTransition(async () => {
      try {
        const created = await createEvidenceItem({ requestKey, matterId, title: title.trim(), content: content.trim(), kind,
          sourceDocumentId: sourceDocumentId === "none" ? null : sourceDocumentId, sourcePage: page, sourceRelation: relation, eventDate: date.data });
        if (!active.current) return;
        onStateChange({ dirty: false, busy: false });
        toast.success("证据要点已保存，记录待核对"); onCreated(created.id); router.refresh();
      } catch (failure) { if (active.current) setError(actionErrorMessage(failure)); }
    });
  }
  return <>
    <DialogHeader><DialogTitle ref={originalHeading} tabIndex={-1}>{original ? original.document?.name ?? "来源原件" : "添加证据要点"}</DialogTitle>
      <DialogDescription>{original?.document ? `第 ${original.document.version} 版` : document ? `${document.name} · 第 ${document.version} 版` : "人工记录"}</DialogDescription></DialogHeader>
    {original ? <>
      {!original.document && !original.error ? <p role="status" className="text-sm text-muted-foreground">正在读取原件…</p> : null}
      {original.error ? <Alert variant="destructive"><AlertDescription>{original.error}<Button variant="link" size="sm" onClick={() => void openOriginal(original.documentId)}>重新读取</Button></AlertDescription></Alert> : null}
      {original.document?.previewable ? <iframe title="来源原件" src={original.document.originalUrl} className="h-[55vh] w-full rounded border" /> : null}
      <DialogFooter>{original.document ? <Button asChild variant="outline"><a href={original.document.originalUrl} target="_blank" rel="noopener noreferrer">{original.document.previewable ? "另页打开原件" : "下载原件"}</a></Button> : null}
        <Button variant="outline" onClick={backToDraft}>返回草稿</Button></DialogFooter>
    </> : null}
    <div hidden={viewingOriginal} className={cn("flex flex-col gap-4", viewingOriginal && "hidden")}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
      <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-title"}>标题</Label><Input id={id + "-title"} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} disabled={pending} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-kind"}>性质</Label><KindSelect id={id + "-kind"} value={kind} onChange={setKind} disabled={pending} /></div>
    </div>
    <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-content"}>内容</Label><Textarea id={id + "-content"} value={content} onChange={event => setContent(event.target.value)} maxLength={5000} rows={4} disabled={pending} /></div>
    <EventDateFields id={id} value={eventDate} onChange={setEventDate} disabled={pending} />
    <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-2"><Label htmlFor={id + "-source"}>来源材料</Label>
      {document ? <Button ref={originalTrigger} variant="link" size="sm" disabled={pending} onClick={() => void openOriginal(document.id)}>查看来源原件</Button> : null}</div>
      <Select value={sourceDocumentId} onValueChange={value => { setSourceDocumentId(value); setSourcePage(""); }} disabled={pending}>
        <SelectTrigger id={id + "-source"}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">不挂来源</SelectItem>{documents.map(option => <SelectItem key={option.id} value={option.id}>{option.name} · 第 {option.version} 版</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </div>
    {sourceDocumentId !== "none" ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {document?.isPdf && document.pageCount ? <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-page"}>PDF 页码（可选，共 {document.pageCount} 页）</Label><Input id={id + "-page"} type="number" min={1} max={document.pageCount} value={sourcePage} onChange={event => setSourcePage(event.target.value)} disabled={pending} /></div> : null}
      <div className="flex flex-col gap-1.5"><Label htmlFor={id + "-relation"}>来源关系</Label><Select value={relation} onValueChange={value => setRelation(value as Relation)} disabled={pending}><SelectTrigger id={id + "-relation"}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{RELATIONS.map(value => <SelectItem key={value} value={value}>{sourceRelationLabel[value]}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
    </div> : null}
    {document && !document.hasIdentity ? <p className="text-sm text-muted-foreground">该材料原件标识尚未就绪，请先核对材料。</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="outline" onClick={onBack} disabled={pending}>{backLabel}</Button><Button onClick={submit} disabled={pending || (sourceDocumentId !== "none" && !document?.hasIdentity)}>{pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}保存要点</Button></DialogFooter>
    </div>
  </>;
}
