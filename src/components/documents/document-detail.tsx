"use client";

import { FileInput } from "@/components/patterns/file-input";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, Button, Tag, Toast, Typography } from "@douyinfe/semi-ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker, ContextInputsSummary } from "@/components/matters/context-input-picker";
import { carriedContextInputs, type ContextInputSelection } from "@/lib/matters/context-inputs";
import { DocumentReviewPanel } from "@/components/document-reviews/document-review-panel";
import { getDocumentDetail } from "@/server/documents/detail-actions";
import { deleteDocument, fileDocument, submitDocumentForReview, uploadNewVersion } from "@/server/documents/actions";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { canPreview, officePreviewKind } from "@/lib/storage/mime-ext";

const statusLabel = { DRAFT: "草稿", PENDING_REVIEW: "待审批", APPROVED: "已批准", FILED: "已入卷" };
type Detail = Awaited<ReturnType<typeof getDocumentDetail>>;
export function DocumentDetail({ matterId, documentId, issueId, onClose, onDocumentChange, onIssueChange, onPrepareDelivery, onDraftStateChange }: {
  matterId: string; documentId: string; issueId?: string | null; onClose(): void;
  onDocumentChange(id: string): void; onIssueChange(id: string | null): void; onPrepareDelivery(id: string): void;
  onDraftStateChange?(dirty: boolean, busy: boolean): void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [inputEdits, setInputEdits] = useState<ContextInputSelection[] | null>(null);
  const contextInputs = inputEdits ?? carriedContextInputs(detail?.contextInputs);
  const contextDirty = inputEdits !== null && JSON.stringify(inputEdits) !== JSON.stringify(carriedContextInputs(detail?.contextInputs));
  const [activeTab, setActiveTab] = useState(issueId ? "review" : "document");
  const [visitedReview, setVisitedReview] = useState(Boolean(issueId));
  const reviewState = useRef({ dirty: false, busy: false });
  const ownState = useRef({ dirty: false, busy: false });
  const draftCallback = useRef(onDraftStateChange);
  useEffect(() => { draftCallback.current = onDraftStateChange; }, [onDraftStateChange]);
  const requestKey = useRef(crypto.randomUUID()), sequence = useRef(0);
  const reload = useCallback(async () => {
    const token = ++sequence.current; setError(""); setDetail(null);
    try { const result = await getDocumentDetail(matterId, documentId); if (token === sequence.current) setDetail(result); }
    catch (cause) { if (token === sequence.current) setError(actionErrorMessage(cause)); }
  }, [matterId, documentId]);
  useEffect(() => { const requests = sequence; void reload(); return () => { requests.current++; }; }, [reload]);
  useEffect(() => { if (issueId) { setActiveTab("review"); setVisitedReview(true); } }, [issueId]);
  const publishDraft = useCallback(() => {
    draftCallback.current?.(ownState.current.dirty || reviewState.current.dirty, ownState.current.busy || reviewState.current.busy);
  }, []);
  const onReviewDirty = useCallback((dirty: boolean) => { reviewState.current.dirty = dirty; publishDraft(); }, [publishDraft]);
  const onReviewPending = useCallback((busy: boolean) => { reviewState.current.busy = busy; publishDraft(); }, [publishDraft]);
  useEffect(() => { ownState.current = { dirty: Boolean(file) || contextDirty, busy: pending }; publishDraft(); }, [file, contextDirty, pending, publishDraft]);
  useEffect(() => () => { draftCallback.current?.(false, false); }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (file || contextDirty || pending || reviewState.current.dirty || reviewState.current.busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, [file, contextDirty, pending]);
  async function canLeave() {
    return !pending && !reviewState.current.busy && (!(file || contextDirty || reviewState.current.dirty) || await confirmDialog({
      title: "放弃未保存的文书输入？", confirmText: "放弃并离开", cancelText: "继续编辑", initialFocus: "cancel",
    }));
  }
  async function retry() {
    if (!await canLeave()) return;
    setFile(null); setInputEdits(null); requestKey.current = crypto.randomUUID(); reviewState.current = { dirty: false, busy: false };
    await reload();
  }
  function mutate(run: () => Promise<unknown>, message: string) {
    if (pending || reviewState.current.busy) return;
    if (reviewState.current.dirty) { setError("请先保存复核内容，再处理文书版本。"); return; }
    startTransition(async () => {
      try { await run(); Toast.success(message); await reload(); router.refresh(); }
      catch (cause) { setError(actionErrorMessage(cause)); }
    });
  }
  async function withdraw() {
    if (!await canLeave()) return;
    if (!await confirmDialog({ title: `撤回第 ${detail?.version} 版材料？`,
      description: "撤回后此版本不再可用，已有来源和审批历史继续保留。", confirmText: "撤回此版本",
      cancelText: "保留材料", initialFocus: "cancel", danger: true })) return;
    startTransition(async () => {
      try { await deleteDocument(documentId); Toast.success("材料已撤回"); onClose(); router.refresh(); }
      catch (cause) { setError(actionErrorMessage(cause)); }
    });
  }
  const office = officePreviewKind(detail?.mimeType, detail?.name);
  const previewable = canPreview(detail?.mimeType, detail?.name);
  const preview = office ? `/api/documents/${documentId}/preview` : `/api/documents/${documentId}/download?inline=1`;
  return <Sheet open onOpenChange={open => { if (!open) void canLeave().then(allowed => { if (allowed) onClose(); }); }}>
    <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-5xl">
      <SheetHeader><SheetTitle className="break-words pr-5">{detail?.name ?? "文书版本"}</SheetTitle>
        <SheetDescription>{detail ? `第 ${detail.version} 版 · ${detail.uploadedByName} · ${shDayKey(detail.createdAt)} ${shTime(detail.createdAt)}` : "读取指定版本及当前权限"}</SheetDescription></SheetHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error} <Button onClick={() => void retry()} type="primary" theme="borderless">重新读取</Button></p>}
      {!detail && !error && <p role="status">正在读取文书…</p>}
      {detail && <>
        <div className="flex flex-wrap items-center gap-2"><Tag color="grey" type="ghost">{statusLabel[detail.status]}</Tag>{!detail.isLatest && <Tag color="grey" type="ghost">历史版本</Tag>}
          <Typography.Text link={{ href: `/api/documents/${documentId}/download`, target: "_blank", rel: "noreferrer" }} size="small">下载此版本</Typography.Text>
          <Typography.Text link={{ href: `/approvals?type=DOCUMENT_APPROVE&id=${documentId}`, target: "_blank", rel: "noopener noreferrer" }} size="small">审批记录</Typography.Text>
          {detail.canSubmit && <Button disabled={pending} onClick={() => mutate(() => submitDocumentForReview(documentId), "已提交文书审核")} theme="solid" size="small">送审</Button>}
          {detail.canFile && <Button disabled={pending} onClick={() => mutate(() => fileDocument({ documentId, expectedUpdatedAt: detail.updatedAt }), "此版本已入卷")} type="tertiary" theme="outline" size="small">入卷</Button>}
          {detail.canPrepareDelivery && <Button disabled={pending} onClick={() => void canLeave().then(allowed => { if (allowed) onPrepareDelivery(documentId); })} type="tertiary" theme="outline" size="small">准备交付</Button>}
          {detail.reviewSourceId && <Button disabled={pending} onClick={() => void canLeave().then(allowed => { if (allowed) onDocumentChange(detail.reviewSourceId!); })} type="tertiary" theme="outline" size="small">查看审查原件</Button>}
          {detail.canWithdraw && <Button disabled={pending} onClick={() => void withdraw()} type="tertiary" theme="outline" size="small">撤回此版本</Button>}
        </div>
        {detail.folderName && <p className="text-sm text-muted-foreground">卷宗：{detail.folderName}</p>}
        {detail.withdrawBlockedReason && <p className="text-sm text-muted-foreground">{detail.withdrawBlockedReason}</p>}
        <ContextInputsSummary summary={detail.contextInputs} matterId={matterId} />
        <div role="group" aria-label="文书详情分区"><Tabs activeKey={activeTab} onChange={value => { setActiveTab(value); if (value === "review") setVisitedReview(true); }} keepDOM lazyRender={false} tabPaneMotion={false}>

          <Tabs.TabPane itemKey="document" tab="正文" className="space-y-3">{previewable ? <><iframe title="具体文书版本正文" src={preview} className="h-[60vh] w-full rounded-lg border bg-white" /><Typography.Text link={{ href: preview, target: "_blank", rel: "noreferrer" }}>另页查看此版本</Typography.Text></> : <p className="py-6 text-sm text-muted-foreground">此格式请下载原件查看。</p>}</Tabs.TabPane>
          <Tabs.TabPane itemKey="review" tab="人工复核">{visitedReview && <DocumentReviewPanel key={documentId} documentId={documentId} initialIssueId={issueId} onIssueChange={onIssueChange} onDirtyChange={onReviewDirty} onPendingChange={onReviewPending} />}</Tabs.TabPane>
          <Tabs.TabPane itemKey="versions" tab="版本" className="space-y-4">
            {!detail.hasVersionFamily && <p role="status" className="text-sm text-muted-foreground">此文书尚未记录版本关系。保存新版本时将以当前原件建立版本关系。</p>}
            <div className="flex flex-col gap-2">{detail.versions.map(version => <Button key={version.id} className="h-auto justify-start whitespace-normal text-left" disabled={pending} onClick={() => void canLeave().then(allowed => { if (allowed && version.id !== documentId) onDocumentChange(version.id); })} type={version.id === documentId ? "primary" : "tertiary"} theme={version.id === documentId ? "light" : "outline"}>第 {version.version} 版 · {version.name} {version.isLatest ? "（当前版本）" : ""}</Button>)}</div>
            {detail.canUploadVersion && <div className="space-y-2 rounded-lg border p-4"><label htmlFor="document-new-version" className="text-sm font-medium text-[var(--semi-color-text-1)]">上传新稿</label><FileInput id="document-new-version" disabled={pending} onChange={event => { setFile(event.target.files?.[0] ?? null); requestKey.current = crypto.randomUUID(); }} /><p className="text-xs text-muted-foreground">新稿保存为新版本，审批需重新完成。</p><Button
              disabled={!file || pending}
              onClick={() => mutate(async () => {
              const result = await uploadNewVersion({ documentId, file: file!, requestKey: requestKey.current, contextInputs }); setFile(null); setInputEdits(null); onDocumentChange(result.id);
            }, "新版本已保存")}
              theme="solid">保存新版本</Button>
              <ContextInputPicker matterId={matterId} initial={detail.contextInputs} value={contextInputs} disabled={pending} onChange={value => { setInputEdits(value); requestKey.current = crypto.randomUUID(); }} />
            </div>}
          </Tabs.TabPane>
        </Tabs></div>
      </>}
    </SheetContent>
  </Sheet>;
}
