"use client";

import { Banner, Tag, Typography } from "@douyinfe/semi-ui";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { reviewDispositionLabel, reviewIssueStateLabel, type ReviewDocumentOption, type ReviewIssueView, type ReviewPositionView } from "@/server/document-reviews/contracts";
import { ReviewPositionSourceButton } from "./review-position-source";

export function ReviewDocumentLink({ document }: { document: ReviewDocumentOption }) {
  return <Typography.Text link={{ href: `/api/documents/${encodeURIComponent(document.id)}/download`, target: "_blank", rel: "noopener noreferrer" }} size="small">下载原件：{document.name}· 第 {document.version}版</Typography.Text>;
}

function Position({ issueId, eventId, slot, value }: { issueId: string; eventId?: string; slot: "SUBJECT" | "BASIS" | "REVISION"; value: ReviewPositionView | null }) {
  if (!value) return null;
  const label = slot === "SUBJECT" ? "问题原文" : slot === "BASIS" ? "依据原文" : "修订原文";
  return <div className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-muted-foreground">{value.status === "AVAILABLE" ? value.label : "固定位置当前不可用"}</span>
    <ReviewPositionSourceButton target={{ kind: "SAVED", input: { issueId, slot, ...(eventId ? { eventId } : {}) } }}>查看{label}</ReviewPositionSourceButton>
  </div>;
}

/** The same history content serves the current editor and a previous-version read-only dialog. */
export function ReviewIssueContent({ issue }: { issue: ReviewIssueView }) {
  return <>
    <div className="flex flex-col gap-2"><div className="flex items-start justify-between gap-3"><h4 className="whitespace-pre-wrap break-words font-medium">{issue.title}</h4><Tag color="grey">{reviewIssueStateLabel[issue.state]}</Tag></div>
      {issue.location && <p className="text-sm">{issue.location}</p>}
      <Position issueId={issue.id} slot="SUBJECT" value={issue.position} />
      <p className="text-xs text-muted-foreground">{issue.authorName} · {shDayKey(issue.createdAt)} {shTime(issue.createdAt)}</p>
      {issue.basisUnavailable ? <Banner type="warning" closeIcon={null} fullMode={false} description="依据材料当前不可读取，原文尚不能核实。" /> : <p className="whitespace-pre-wrap break-words text-sm">{issue.basis}</p>}
      {issue.basisDocument && <ReviewDocumentLink document={issue.basisDocument} />}
      <Position issueId={issue.id} slot="BASIS" value={issue.basisPosition} />
      {!issue.basisDocument && !issue.basisUnavailable && <p className="text-xs text-muted-foreground">未关联依据材料；本条核对范围限于当前文书与处理说明。</p>}
    </div>
    <ol className="flex max-h-[30vh] flex-col gap-4 overflow-y-auto" aria-label="回应与复核历史">{issue.events.map(event => <li key={event.id} className="flex flex-col gap-1.5 border-l pl-3">
      <div className="flex flex-wrap items-center gap-2"><Tag color="grey" type="ghost">{event.kind === "RESPONSE" ? reviewDispositionLabel[event.disposition!] : event.resolved ? "已处理" : "仍未解决"}</Tag><span className="text-xs text-muted-foreground">{event.actorName} · {shDayKey(event.createdAt)} {shTime(event.createdAt)}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{event.note ?? "关联来源当前不可读取，处理内容受限"}</p>
      {event.revisionDocument && <><ReviewDocumentLink document={event.revisionDocument} />{event.revisionLocation && <p className="text-xs text-muted-foreground">修订位置：{event.revisionLocation}</p>}</>}
      {event.kind === "RESPONSE" && <Position issueId={issue.id} eventId={event.id} slot="REVISION" value={event.revisionPosition} />}
      {event.revisionUnavailable && <p className="text-sm text-muted-foreground">修订版当前不可读取；请通过原文书流程取得该版本授权。</p>}
      {event.kind === "RESPONSE" && !event.revisionDocument && !event.revisionUnavailable && <p className="text-xs text-muted-foreground">未关联修订版</p>}
    </li>)}</ol>
  </>;
}
