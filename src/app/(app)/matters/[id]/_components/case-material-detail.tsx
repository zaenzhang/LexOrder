"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { ARCHIVE_DOCUMENT_STATUS_LABELS } from "@/lib/archive/snapshot";
import { formatDate } from "@/lib/utils";
import { approveDocument, deleteDocument, fileDocument, rejectDocument, submitDocumentForReview, uploadNewVersion } from "@/server/documents/actions";
import { moveDocumentToFolder } from "@/server/document-folders/actions";
import type { getCaseMaterialDetail } from "@/server/evidence/workspace-actions";
import { EvidencePoints, type EvidenceNavigation, type EvidenceTaskState } from "./evidence-panel";

type MaterialData = Awaited<ReturnType<typeof getCaseMaterialDetail>>;
type DetailView = "details" | "original" | "version" | "folder" | "reject" | "history";
const historyLabels: Record<string, string> = {
  DOCUMENT_SUBMIT_REVIEW: "提交审核", DOCUMENT_SELF_CONFIRM: "本人确认", DOCUMENT_APPROVE: "批准",
  DOCUMENT_REJECT: "退回修改", DOCUMENT_FILE: "入卷",
};

/** A concrete version's actions share the existing detail surface and task guard. */
export function CaseMaterialDetail({ data, onCreate, onBack, onOpenItem, onOpenSource, onDocumentChange, onSaved, onStateChange }: {
  data: MaterialData; onCreate: () => void; onBack: () => void;
  onDocumentChange: (documentId: string, mode?: "push" | "replace") => void;
  onSaved: () => void; onStateChange: (state: EvidenceTaskState) => void;
} & EvidenceNavigation) {
  const router = useRouter();
  const document = data.document;
  const reviewSourceId = document.reviewReport?.sourceDocumentId;
  const [view, setView] = useState<DetailView>("details");
  const [originalReturn, setOriginalReturn] = useState<DetailView>("details");
  const [file, setFile] = useState<File | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [folderId, setFolderId] = useState(document.folderId);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const dirty = file !== null || folderId !== document.folderId || reason.trim().length > 0;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onStateChange({ dirty, busy }); }, [dirty, busy, onStateChange]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [view]);

  function open(next: DetailView, trigger?: HTMLButtonElement) {
    if (working.current) return;
    if (trigger) opener.current = trigger;
    if (next === "version") setRequestKey(crypto.randomUUID());
    setError(""); setView(next);
  }
  function original(trigger: HTMLButtonElement) {
    opener.current = trigger; setOriginalReturn(view); setView("original");
  }
  async function returnToDetail() {
    if (working.current) return;
    if (view === "original") { setView(originalReturn); return; }
    if (dirty && !await confirmDialog({ title: "放弃未保存的修改？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    if (!alive.current) return;
    setFile(null); setFolderId(document.folderId); setReason(""); setError(""); setView("details");
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }

  async function perform<T>(operation: () => Promise<T>, success: string, after: (result: T) => void = () => onSaved()) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); onStateChange({ dirty, busy: true });
    try {
      const result = await operation();
      if (!alive.current) return;
      working.current = false; setBusy(false); setFile(null); setFolderId(document.folderId); setReason("");
      onStateChange({ dirty: false, busy: false });
      toast.success(success); after(result); router.refresh();
    } catch (failure) {
      if (!alive.current) return;
      working.current = false; setBusy(false); setError(actionErrorMessage(failure)); onStateChange({ dirty, busy: false });
    }
  }
  async function withdraw() {
    if (working.current) return;
    working.current = true; setBusy(true); onStateChange({ dirty, busy: true });
    const confirmed = await confirmDialog({ title: `撤回第 ${document.version} 版材料？`,
      description: "撤回后，此版本将不再可用。已有来源和审批历史仍保留原版本的关联。",
      confirmText: "撤回此版本", cancelText: "保留材料", initialFocus: "cancel", danger: true });
    if (!alive.current) return;
    working.current = false; setBusy(false); onStateChange({ dirty, busy: false });
    if (confirmed) await perform(() => deleteDocument(document.id), "材料已撤回", onBack);
  }
  const rejected = document.status === "DRAFT" && data.approval.history[0]?.action === "DOCUMENT_REJECT";
  const title = view === "version" ? "上传新版本" : view === "folder" ? "调整卷宗" : view === "reject" ? "退回修改" : view === "history" ? "审批记录" : document.name;
  return <>
    <DialogHeader><DialogTitle ref={heading} tabIndex={-1}>{title}</DialogTitle>
      <DialogDescription>{view === "details" || view === "original" ? `第 ${document.version} 版${document.mimeType === "application/pdf" && document.pageCount ? ` · ${document.pageCount} 页` : ""}` : `${document.name} · 第 ${document.version} 版`}</DialogDescription>
    </DialogHeader>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {view === "original" ? <>
      <iframe title="材料原件" src={document.originalUrl} className="h-[60vh] w-full rounded border" />
      <DialogFooter><Button asChild variant="outline"><a href={document.originalUrl} target="_blank" rel="noopener noreferrer">另页打开原件</a></Button>
        <Button variant="outline" onClick={returnToDetail}>返回{originalReturn === "version" ? "上传新版本" : "材料"}</Button></DialogFooter>
    </> : view === "version" ? <form className="flex flex-col gap-4" onSubmit={event => {
      event.preventDefault();
      if (file) void perform(() => uploadNewVersion({ documentId: document.id, file, requestKey }), "新版本已保存为草稿", result => onDocumentChange(result.id, "replace"));
    }}>
      <div className="flex flex-col gap-2"><Label htmlFor="material-new-version">新版本文件</Label>
        <Input id="material-new-version" type="file" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} />
        {file ? <p className="text-sm">已选择：{file.name}</p> : null}
        <p className="text-sm text-muted-foreground">新版本从草稿开始；原版本的来源引用和批准记录保留。</p>
      </div>
      {document.previewable ? <Button type="button" variant="outline" className="self-start" disabled={busy} onClick={event => original(event.currentTarget)}>查看当前原件</Button> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={returnToDetail}>返回材料</Button>
        <Button type="submit" disabled={!file || busy}>{busy ? "正在上传…" : "上传新版本"}</Button></DialogFooter>
    </form> : view === "folder" ? <form className="flex flex-col gap-4" onSubmit={event => {
      event.preventDefault(); void perform(() => moveDocumentToFolder({ documentId: document.id, folderId }), "卷宗归属已更新");
    }}>
      <div className="flex flex-col gap-2"><Label htmlFor="material-folder">卷宗</Label>
        <Select value={folderId ?? "unfiled"} onValueChange={value => setFolderId(value === "unfiled" ? null : value)} disabled={busy}>
          <SelectTrigger id="material-folder"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unfiled">散件</SelectItem>
            {data.folders.map(folder => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
          </SelectContent></Select>
      </div>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={returnToDetail}>返回材料</Button>
        <Button type="submit" disabled={busy || folderId === document.folderId}>{busy ? "正在保存…" : "保存卷宗"}</Button></DialogFooter>
    </form> : view === "reject" ? <form className="flex flex-col gap-4" onSubmit={event => {
      event.preventDefault(); if (reason.trim()) void perform(() => rejectDocument(document.id, reason.trim()), "已退回当前版本");
    }}>
      <div className="flex flex-col gap-2"><Label htmlFor="material-rejection">退回原因</Label>
        <Textarea id="material-rejection" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} maxLength={2000} required />
      </div>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={returnToDetail}>返回材料</Button>
        <Button type="submit" disabled={busy || !reason.trim()}>{busy ? "正在退回…" : "退回修改"}</Button></DialogFooter>
    </form> : view === "history" ? <>
      <ol className="flex flex-col divide-y">{data.approval.history.map(record => <li key={record.id} className="space-y-1 py-3">
        <div className="flex flex-wrap items-baseline gap-2"><span className="font-medium">{historyLabels[record.action]}</span><span className="text-sm text-muted-foreground">{record.userName} · {formatDate(new Date(record.at))}</span></div>
        {record.note ? <p className="whitespace-pre-wrap break-words text-sm">{record.note}</p> : null}
      </li>)}</ol>
      <DialogFooter><Button variant="outline" onClick={returnToDetail}>返回材料</Button></DialogFooter>
    </> : <>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{rejected ? "退回修改" : ARCHIVE_DOCUMENT_STATUS_LABELS[document.status]}</Badge>
        <Badge variant="secondary">{document.isLatest ? "当前版本" : "历史版本"}</Badge>
        {data.versions.length > 1 ? <Select value={document.id} onValueChange={id => onDocumentChange(id)} disabled={busy}>
          <SelectTrigger className="w-auto min-w-36 max-w-full" aria-label="材料版本"><SelectValue /></SelectTrigger>
          <SelectContent>{data.versions.map(version => <SelectItem key={version.id} value={version.id}>第 {version.version} 版{version.isLatest ? " · 当前" : ""}</SelectItem>)}</SelectContent>
        </Select> : null}
      </div>
      {data.currentVersionUnavailable ? <p role="status" className="text-sm text-muted-foreground">当前版本不可用；这里展示的是获准读取的历史版本。</p> : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">上传人</dt><dd>{document.uploadedByName}</dd></div>
        <div><dt className="text-muted-foreground">记录时间</dt><dd>{formatDate(new Date(document.createdAt))}</dd></div>
        <div><dt className="text-muted-foreground">卷宗</dt><dd>{document.folderName ?? "散件"}</dd></div></dl>
      <div className="flex flex-wrap gap-2">
        {document.previewable ? <Button variant="outline" size="sm" disabled={busy} onClick={event => original(event.currentTarget)}>查看原件</Button> : null}
        <Button asChild variant="outline" size="sm"><a href={document.downloadUrl} target="_blank" rel="noopener noreferrer">下载</a></Button>
        {data.actions.canUploadVersion ? <Button variant="outline" size="sm" disabled={busy} onClick={event => open("version", event.currentTarget)}>传新版</Button> : null}
        {data.actions.canMoveFolder ? <Button variant="outline" size="sm" disabled={busy} onClick={event => open("folder", event.currentTarget)}>调整卷宗</Button> : null}
        {data.actions.canWithdraw ? <Button variant="outline" size="sm" disabled={busy} onClick={withdraw}>撤回材料</Button> : null}
      </div>
      {document.reviewReport ? <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">审查报告为固定记录。修订请重新审查原材料，或返回材料列表独立上传。</p>
        {reviewSourceId ? <Button variant="link" size="sm" disabled={busy} onClick={() => onDocumentChange(reviewSourceId)}>打开原材料</Button> : null}
      </div> : null}
      {data.actions.restriction ? <p className="text-sm text-muted-foreground">{data.actions.restriction}</p> : null}
      {data.actions.withdrawBlockedReason ? <p className="text-sm text-muted-foreground">{data.actions.withdrawBlockedReason}</p> : null}
      <section aria-label="文书审核" className="flex flex-col gap-2">
        {rejected && data.approval.history[0]?.note ? <Alert><AlertDescription>退回原因：{data.approval.history[0].note}</AlertDescription></Alert> : null}
        <div className="flex flex-wrap gap-2">
          {data.actions.submitMode ? <Button size="sm" disabled={busy} onClick={() => void perform(() => submitDocumentForReview(document.id), data.actions.submitMode === "self" ? "已完成本人确认" : "已提交审核")}>{data.actions.submitMode === "self" ? "本人确认" : rejected ? "重新送审" : "提交审核"}</Button> : null}
          {data.actions.canDecide ? <><Button size="sm" disabled={busy} onClick={() => void perform(() => approveDocument(document.id), "已批准当前版本")}>批准</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={event => open("reject", event.currentTarget)}>退回修改</Button></> : null}
          {data.actions.canFile ? <Button size="sm" disabled={busy} onClick={() => void perform(() => fileDocument({ documentId: document.id, expectedUpdatedAt: document.updatedAt }), "已入卷")}>批准版入卷</Button> : null}
          {data.approval.history.length ? <Button variant="outline" size="sm" disabled={busy} onClick={event => open("history", event.currentTarget)}>审批记录</Button> : null}
        </div>
        {data.actions.submitBlockedReason ? <p role="status" className="text-sm text-muted-foreground">{data.actions.submitBlockedReason}</p> : null}
      </section>
      <section className="flex flex-col gap-3" aria-label="材料相关要点">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">相关要点</h3>
          {data.canCreateEvidence ? <Button size="sm" disabled={busy} onClick={onCreate}>添加要点</Button> : null}</div>
        {data.items.length ? <EvidencePoints items={data.items} onOpenItem={onOpenItem} onOpenSource={onOpenSource} /> : <p className="text-sm text-muted-foreground">暂无关联要点。</p>}
      </section>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onBack}>返回材料列表</Button></DialogFooter>
    </>}
  </>;
}
