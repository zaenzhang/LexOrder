"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button, Tag } from "@douyinfe/semi-ui";
import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { getPreviousDocumentReviewIssue } from "@/server/document-reviews/actions";
import { reviewIssueStateLabel, type PreviousReviewIssueSummary, type PreviousReviewIssueView } from "@/server/document-reviews/contracts";
import { ReviewDocumentLink, ReviewIssueContent } from "./review-issue-content";

type Request = { documentId: string; issueId: string };
export function PreviousReviewIssues({ documentId, items, disabled }: { documentId: string; items: PreviousReviewIssueSummary[]; disabled: boolean }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [read, setRead] = useState<{ request: Request; value?: PreviousReviewIssueView; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLButtonElement>(null);
  const open = Boolean(request && request.documentId === documentId);
  const listed = Boolean(request && items.some(item => item.id === request.issueId));
  useEffect(() => {
    if (!request || request.documentId !== documentId || !listed) return;
    let active = true;
    setRead(null);
    void getPreviousDocumentReviewIssue(request)
      .then(value => { if (active) setRead({ request, value }); })
      .catch(cause => { if (active) setRead({ request, error: actionErrorMessage(cause) }); });
    return () => { active = false; };
  }, [request, documentId, listed, attempt]);
  const current = listed && read?.request === request && open ? read : null;
  return <>
    {items.length > 0 && <Disclosure headingRef={heading} heading={<>前版未决意见（{items.length}）</>}>
      <div className="mt-2 flex flex-col gap-2">{items.map(item => <Button
        key={item.id}
        className="h-auto justify-start whitespace-normal text-left"
        disabled={disabled}
        onClick={event => { trigger.current = event.currentTarget; setRequest({ documentId, issueId: item.id }); }}
        htmlType="button"
        type="tertiary" theme="borderless">
        <span className="flex min-w-0 flex-col gap-1"><span className="break-words">{item.document.name} · 第 {item.document.version} 版 · {item.title}</span>
          <span className="flex flex-wrap gap-2"><Tag color="grey" type="ghost">{reviewIssueStateLabel[item.state]}</Tag>{item.linkedToCurrent && <Tag color="grey">最近回应关联本版</Tag>}</span></span>
      </Button>)}</div>
    </Disclosure>}
    <WorkspaceDialog open={open} onOpenChange={value => { if (!value) setRequest(null); }}>
      <DialogContent className="max-w-4xl" onCloseAutoFocus={event => {
        const target = trigger.current?.isConnected && !trigger.current.closest('[hidden], [inert], [aria-hidden="true"]') ? trigger.current : heading.current;
        if (target?.isConnected && !target.closest('[hidden], [inert], [aria-hidden="true"]')) { event.preventDefault(); target.focus(); }
      }}>
        <DialogHeader><DialogTitle>前版复核意见</DialogTitle><DialogDescription>{current?.value ? `${current.value.document.name} · 第 ${current.value.document.version} 版 · 只读` : "保留当前文书和未保存内容"}</DialogDescription></DialogHeader>
        {!listed ? <p role="alert">此前版本意见已变化或当前不可读取，请返回本版核对。</p> : !current ? <p role="status">正在读取前版意见…</p> : null}
        {current?.error && <p role="alert" className="text-sm text-destructive">{current.error}</p>}
        {current?.value && <><ReviewDocumentLink document={current.value.document} /><ReviewIssueContent issue={current.value.issue} /></>}
        <DialogFooter>{current?.error && <Button onClick={() => setAttempt(value => value + 1)} htmlType="button" type="tertiary" theme="outline">重新读取前版意见</Button>}
          <Button onClick={() => setRequest(null)} htmlType="button" type="tertiary" theme="outline">返回本版复核</Button></DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  </>;
}
