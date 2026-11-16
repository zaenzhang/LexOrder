"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Sparkles, AlertTriangle, AlertCircle, Lightbulb, FileWarning, BookmarkPlus, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { reviewDocument } from "@/server/ai/review-document";
import { saveReviewToMatter } from "@/server/ai/save-review";
import { listReviewHistory, getReviewRecord, type ReviewHistoryEntry, type ReviewHistoryDetail } from "@/server/ai/review-history";
import type { ReviewItem, ReviewType, ReviewSeverity } from "@/lib/ai/review-parser";
import { summarizeReviewCoverage, type ReviewCoverage } from "@/lib/ai/review-coverage";
import { formatDateTime } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";

type Props = {
  open: boolean;
  documentId: string | null;
  matterId: string;
  canStartReview: boolean;
  canSaveReport: boolean;
  onOpenChange: (open: boolean) => void;
};

const typeMeta: Record<ReviewType, { label: string; Icon: typeof AlertTriangle }> = {
  MISSING: { label: "缺失要素", Icon: FileWarning },
  RISK: { label: "法律风险", Icon: AlertTriangle },
  ISSUE: { label: "条款问题", Icon: AlertCircle },
  SUGGESTION: { label: "优化建议", Icon: Lightbulb },
};
const severityMeta: Record<ReviewSeverity, { label: string; variant: BadgeProps["variant"] }> = {
  HIGH: { label: "高", variant: "destructive" },
  MEDIUM: { label: "中", variant: "amber" },
  LOW: { label: "低", variant: "secondary" },
};
const TYPE_ORDER: ReviewType[] = ["MISSING", "RISK", "ISSUE", "SUGGESTION"];
type View = { kind: "list" } | { kind: "detail"; result: ReviewHistoryDetail };

export function DocumentReviewDialog({ open, documentId, ...props }: Props) {
  // A reopened dialog is a new session even when it targets the same document.
  if (!open || !documentId) return null;
  return <ReviewSession key={`${props.matterId}:${documentId}`} {...props} documentId={documentId} />;
}

function ReviewSession({ documentId, matterId, canStartReview, canSaveReport, onOpenChange }: Omit<Props, "open" | "documentId"> & { documentId: string }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const lifecycle = useRef({ active: true, viewRequest: 0, historyRequest: 0 });

  useLayoutEffect(() => {
    const session = lifecycle.current;
    session.active = true;
    return () => {
      session.active = false;
      session.viewRequest++;
      session.historyRequest++;
    };
  }, []);

  const refreshHistory = useCallback(() => {
    const request = ++lifecycle.current.historyRequest;
    setLoadingHistory(true);
    setHistoryError(null);
    startTransition(async () => {
      try {
        const entries = await listReviewHistory({ matterId, documentId });
        if (lifecycle.current.active && request === lifecycle.current.historyRequest) setHistory(entries);
      } catch (err) {
        if (lifecycle.current.active && request === lifecycle.current.historyRequest) setHistoryError(actionErrorMessage(err));
      } finally {
        if (lifecycle.current.active && request === lifecycle.current.historyRequest) setLoadingHistory(false);
      }
    });
  }, [documentId, matterId]);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  function runNewReview() {
    if (!canStartReview || reviewing || opening || saving) return;
    const request = ++lifecycle.current.viewRequest;
    setReviewing(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await reviewDocument({ matterId, documentId });
        if (!lifecycle.current.active || request !== lifecycle.current.viewRequest) return;
        setView({ kind: "detail", result });
        refreshHistory();
      } catch (err) {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setError(actionErrorMessage(err));
      } finally {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setReviewing(false);
      }
    });
  }

  function openHistoryDetail(entry: ReviewHistoryEntry) {
    if (reviewing || opening || saving) return;
    const request = ++lifecycle.current.viewRequest;
    setOpening(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await getReviewRecord({ recordId: entry.id, matterId, documentId });
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setView({ kind: "detail", result });
      } catch (err) {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setError(actionErrorMessage(err));
      } finally {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setOpening(false);
      }
    });
  }

  function handleSave() {
    if (view.kind !== "detail" || !canSaveReport || !view.result.reportReady || saving) return;
    const source = view.result;
    const request = ++lifecycle.current.viewRequest;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        const report = await saveReviewToMatter({ recordId: source.recordId, matterId: source.matterId, documentId: source.documentId });
        if (!lifecycle.current.active || request !== lifecycle.current.viewRequest) return;
        setView({ kind: "detail", result: { ...source, reportDocumentId: report.documentId } });
        toast.success("报告已保存到本案", { description: report.documentName });
        refreshHistory();
      } catch (err) {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setError(actionErrorMessage(err));
      } finally {
        if (lifecycle.current.active && request === lifecycle.current.viewRequest) setSaving(false);
      }
    });
  }

  function close() {
    if (saving) return;
    lifecycle.current.active = false;
    lifecycle.current.viewRequest++;
    lifecycle.current.historyRequest++;
    onOpenChange(false);
  }

  const result = view.kind === "detail" ? view.result : null;
  const grouped = result ? TYPE_ORDER.map(type => ({ type, items: result.items.filter(item => item.type === type) })).filter(group => group.items.length) : [];

  return <Dialog open onOpenChange={nextOpen => { if (!nextOpen) close(); }}>
    <FormDialogContent className="max-w-2xl">
      <DialogHeader className="px-5 pt-4">
        <DialogTitle className="flex items-center gap-2">
          {result && <Button type="button" variant="ghost" size="icon" disabled={saving} aria-label="返回审查历史" onClick={() => { lifecycle.current.viewRequest++; setError(null); setView({ kind: "list" }); }}><ChevronLeft className="h-4 w-4" /></Button>}
          AI 文书审查
        </DialogTitle>
        <DialogDescription className={result ? "break-words" : "sr-only"}>
          {result ? `${result.documentName} · 版本 ${result.documentVersion} · ${formatDateTime(result.reviewedAt)}` : "审查历史与新审查"}
        </DialogDescription>
      </DialogHeader>
      <FormDialogBody className="space-y-4 px-5 py-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!result && <>
          <Button type="button" onClick={runNewReview} disabled={!canStartReview || reviewing || opening}>
            {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {reviewing ? "正在审查" : "发起新审查"}
          </Button>
          {!canStartReview && <p className="text-xs text-muted-foreground">当前无法发起新审查，仍可查看获准的历史记录。</p>}
          {reviewing && <p role="status" className="text-xs text-muted-foreground">关闭后服务端可能继续处理，可稍后在历史中核对结果。</p>}
          <section className="space-y-2" aria-label="审查历史">
            <h3 className="text-sm font-medium">审查历史</h3>
            {loadingHistory ? <p role="status" className="text-sm text-muted-foreground">正在读取历史…</p> : historyError ? <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">历史读取失败：{historyError}</p>
              <Button type="button" size="sm" variant="outline" onClick={refreshHistory}>重试读取历史</Button>
            </div> : !history.length ? <p className="text-sm text-muted-foreground">暂无审查记录</p> : <ul className="space-y-2">
              {history.map(entry => <li key={entry.id}>
                <Button type="button" variant="outline" className="h-auto w-full justify-between gap-3 whitespace-normal py-3 text-left" disabled={reviewing || opening} onClick={() => openHistoryDetail(entry)}>
                  <span className="space-y-1">
                    <span className="block">{formatDateTime(entry.reviewedAt)}</span>
                    <span className="block text-xs text-muted-foreground">{entry.reviewedBy.name} · {entry.itemCount} 条 · {coverageLabel(entry.coverage)}</span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {(["HIGH", "MEDIUM", "LOW"] as const).filter(severity => entry.severityCounts[severity] > 0).map(severity => <Badge key={severity} variant={severityMeta[severity].variant}>{severityMeta[severity].label} {entry.severityCounts[severity]}</Badge>)}
                  </span>
                </Button>
              </li>)}
            </ul>}
            {opening && <p role="status" className="text-sm text-muted-foreground">正在读取审查记录…</p>}
          </section>
        </>}
        {result && <>
          <CoverageSummary coverage={result.coverage} />
          {!result.items.length && <p className="text-sm text-muted-foreground">{result.coverage && !summarizeReviewCoverage(result.coverage).completedSegments ? "本次未取得有效审查回复，不能判断材料是否存在问题。" : "本次记录未列出审查条目，仍需结合原件人工复核。"}</p>}
          {grouped.map(group => {
            const { label, Icon } = typeMeta[group.type];
            return <section key={group.type} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" />{label} <span className="text-xs text-muted-foreground">{group.items.length}</span></h3>
              <ul className="space-y-2">{group.items.map((item, index) => <ReviewItemRow key={index} item={item} />)}</ul>
            </section>;
          })}
          {!result.reportReady && <p className="text-xs text-muted-foreground">该记录缺少可信来源、覆盖记录或有效回复，不能生成报告。</p>}
        </>}
      </FormDialogBody>
      <DialogFooter className="px-5 pb-4">
        {result?.reportDocumentId ? <Button asChild variant="outline"><a href={`/api/documents/${encodeURIComponent(result.reportDocumentId)}/download`}>下载报告</a></Button> : result?.reportReady && canSaveReport ? <Button type="button" variant="outline" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}{saving ? "正在保存" : "保存报告到本案"}
        </Button> : null}
        <Button type="button" variant="ghost" disabled={saving} onClick={close}>关闭</Button>
      </DialogFooter>
    </FormDialogContent>
  </Dialog>;
}

function coverageLabel(coverage: ReviewCoverage | null) {
  if (!coverage) return "覆盖范围未知";
  const counts = summarizeReviewCoverage(coverage);
  return counts.status === "COMPLETE" ? "提取文本已审查" : counts.status === "PARTIAL" ? "部分审查" : "审查未完成";
}

function CoverageSummary({ coverage }: { coverage: ReviewCoverage | null }) {
  if (!coverage) return <p className="text-sm text-muted-foreground">该历史未记录实际覆盖范围，不能将原文本长度视为已完成审查的字数。</p>;
  const counts = summarizeReviewCoverage(coverage);
  return <section className="space-y-2" aria-label="审查覆盖范围">
    <div className="flex flex-wrap items-center gap-2"><Badge variant={counts.status === "COMPLETE" ? "secondary" : "amber"}>{coverageLabel(coverage)}</Badge><span className="text-xs text-muted-foreground">提取文本 {counts.totalChars} 字符 / {counts.totalSegments} 段</span></div>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      {[["已请求", counts.sentChars, counts.sentSegments], ["有效回复", counts.completedChars, counts.completedSegments], ["失败", counts.failedChars, counts.failedSegments], ["未请求", counts.notSentChars, counts.notSentSegments]].map(([label, chars, segments]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{chars} 字符 / {segments} 段</dd></div>)}
    </dl>
    {counts.status !== "COMPLETE" && <p className="text-sm text-destructive">本次审查未完成，不能作为整份材料的审查结论。{coverage.stopReason === "MODEL_UNAVAILABLE" ? "模型当前不可用，剩余文本未请求。" : ""}</p>}
  </section>;
}

function ReviewItemRow({ item }: { item: ReviewItem }) {
  const severity = severityMeta[item.severity];
  return <li className="space-y-1 rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium break-words">{item.title}</span><Badge variant={severity.variant}>{severity.label}</Badge></div>
    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.detail}</p>
  </li>;
}
