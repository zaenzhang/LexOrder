"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { getPreviousDocumentReviewIssue } from "@/server/document-reviews/actions";
import { reviewIssueStateLabel, type PreviousReviewIssueSummary, type PreviousReviewIssueView } from "@/server/document-reviews/contracts";
import { ReviewDocumentLink, ReviewIssueContent } from "./review-issue-content";

type Request = { documentId: string; issueId: string };
export function PreviousReviewIssues({ documentId, items, disabled }: { documentId: string; items: PreviousReviewIssueSummary[]; disabled: boolean }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [read, setRead] = useState<{ request: Request; value?: PreviousReviewIssueView; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLElement>(null);
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
    {items.length > 0 && <details className="rounded-md border px-3 py-2">
      <summary ref={heading} className="cursor-pointer text-sm font-medium">前版未决意见（{items.length}）</summary>
      <div className="mt-2 flex flex-col gap-2">{items.map(item => <Button key={item.id} type="button" variant="ghost" className="h-auto justify-start whitespace-normal text-left" disabled={disabled}
        onClick={event => { trigger.current = event.currentTarget; setRequest({ documentId, issueId: item.id }); }}>
        <span className="flex min-w-0 flex-col gap-1"><span className="break-words">{item.document.name} · 第 {item.document.version} 版 · {item.title}</span>
          <span className="flex flex-wrap gap-2"><span className={badgeVariants({ variant: "outline" })}>{reviewIssueStateLabel[item.state]}</span>{item.linkedToCurrent && <span className={badgeVariants({ variant: "secondary" })}>最近回应关联本版</span>}</span></span>
      </Button>)}</div>
    </details>}
    <Dialog open={open} onOpenChange={value => { if (!value) setRequest(null); }}>
      <DialogContent className="max-w-4xl" onCloseAutoFocus={event => {
        const target = trigger.current?.isConnected && !trigger.current.closest('[hidden], [inert], [data-state="inactive"]') ? trigger.current : heading.current;
        if (target?.isConnected && !target.closest('[hidden], [inert], [data-state="inactive"]')) { event.preventDefault(); target.focus(); }
      }}>
        <DialogHeader><DialogTitle>前版复核意见</DialogTitle><DialogDescription>{current?.value ? `${current.value.document.name} · 第 ${current.value.document.version} 版 · 只读` : "保留当前文书和未保存内容"}</DialogDescription></DialogHeader>
        {!listed ? <p role="alert">此前版本意见已变化或当前不可读取，请返回本版核对。</p> : !current ? <p role="status">正在读取前版意见…</p> : null}
        {current?.error && <p role="alert" className="text-sm text-destructive">{current.error}</p>}
        {current?.value && <><ReviewDocumentLink document={current.value.document} /><ReviewIssueContent issue={current.value.issue} /></>}
        <DialogFooter>{current?.error && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新读取前版意见</Button>}
          <Button type="button" variant="outline" onClick={() => setRequest(null)}>返回本版复核</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
