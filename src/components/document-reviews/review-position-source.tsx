"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { getSavedDocumentReviewPosition, previewDocumentReviewPosition } from "@/server/document-reviews/actions";
import type { EvidenceSourceResult } from "@/server/evidence/contracts";

type SourceTarget = { kind: "SAVED"; input: Parameters<typeof getSavedDocumentReviewPosition>[0] }
  | { kind: "DRAFT"; input: Parameters<typeof previewDocumentReviewPosition>[0] };
type Request = { target: SourceTarget; identity: string };

/** This dialog has no editor state or save identity; closing it only restores focus. */
export function ReviewPositionSourceButton({ target, children, disabled = false }: {
  target: SourceTarget; children: React.ReactNode; disabled?: boolean;
}) {
  const identity = JSON.stringify(target);
  const trigger = useRef<HTMLButtonElement>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [read, setRead] = useState<{ request: Request; value?: EvidenceSourceResult; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const open = request?.identity === identity;
  useEffect(() => {
    if (!request || request.identity !== identity) return;
    let active = true;
    setRead(null);
    const task = request.target.kind === "SAVED" ? getSavedDocumentReviewPosition(request.target.input)
      : previewDocumentReviewPosition(request.target.input);
    void task.then(value => { if (active) setRead({ request, value }); })
      .catch(cause => { if (active) setRead({ request, error: actionErrorMessage(cause) }); });
    return () => { active = false; };
  }, [request, identity, attempt]);
  const current = read?.request === request && open ? read : null;
  const source = current?.value?.status === "AVAILABLE" ? current.value : null;
  return <Dialog open={open} onOpenChange={value => setRequest(value ? { target, identity } : null)}>
    <DialogTrigger asChild><Button ref={trigger} type="button" size="sm" variant="outline" disabled={disabled}>{children}</Button></DialogTrigger>
    <DialogContent className="max-w-4xl" onCloseAutoFocus={event => {
      if (trigger.current?.isConnected && !trigger.current.closest('[hidden], [inert], [data-state="inactive"]')) {
        event.preventDefault(); trigger.current.focus();
      }
    }}>
      <DialogHeader><DialogTitle>{source?.documentName ?? "复核原文位置"}</DialogTitle>
        <DialogDescription>{source ? `第 ${source.documentVersion} 版 · ${source.locationLabel}` : "确切材料版本及所选位置"}</DialogDescription></DialogHeader>
      {!current && <p role="status">正在读取原文…</p>}
      {current?.error && <p role="alert" className="text-sm text-destructive">{current.error}</p>}
      {current?.value?.status === "UNAVAILABLE" && <p role="alert" className="text-sm text-muted-foreground">此固定位置当前不可读取，请核对原件和读取资格。</p>}
      {source && <>
        {source.historicalParse && <p className="text-sm text-muted-foreground">显示记录保留的历史解析位置。</p>}
        {source.text && <div className="space-y-2"><p className="text-sm font-medium">已固定的抽取片段</p>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{source.text}</blockquote></div>}
        {source.previewKind === "CONVERTED" && <p className="text-sm text-muted-foreground">转换预览打开整份文件，未按引用位置跳转。</p>}
        {source.previewUrl && <iframe title={source.previewKind === "CONVERTED" ? "整份转换预览" : "文件预览"} src={source.previewUrl} className="h-[55vh] w-full rounded border" />}
      </>}
      <DialogFooter>
        {(current?.error || current?.value?.status === "UNAVAILABLE") && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新读取位置</Button>}
        {source?.previewUrl && <Button variant="outline" asChild><a href={source.previewUrl} target="_blank" rel="noopener noreferrer">{source.previewKind === "CONVERTED" ? "另页查看转换预览" : "另页查看预览"}</a></Button>}
        {source && <Button variant="outline" asChild><a href={source.downloadUrl} target="_blank" rel="noopener noreferrer">下载此版本</a></Button>}
        <Button type="button" variant="outline" onClick={() => setRequest(null)}>返回复核内容</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
