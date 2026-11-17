"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canPreview } from "@/lib/storage/mime-ext";
import { getMaterialSource } from "@/server/documents/processing-actions";
import type { MaterialSourceInput, MaterialSourceResult } from "@/server/documents/material-processing";

/** A search hit supplies identity only; this reader supplies the current authorized projection. */
export function SearchMaterialSourceDialog({ input, onClose, onReturnFocus }: {
  input: MaterialSourceInput; onClose(): void; onReturnFocus(): void;
}) {
  const [result, setResult] = useState<MaterialSourceResult | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { documentId, runId, anchorId } = input;
  useEffect(() => {
    let active = true;
    setResult(null); setError("");
    void getMaterialSource({ documentId, runId, anchorId })
      .then(value => { if (active) setResult(value); })
      .catch(cause => {
        if (!active) return;
        const digest = cause && typeof cause === "object" && "digest" in cause ? cause.digest : null;
        setError(typeof digest === "string" && digest.startsWith("ACTION_ERROR:")
          ? digest.slice("ACTION_ERROR:".length) : "来源读取失败，请重试。");
      });
    return () => { active = false; };
  }, [documentId, runId, anchorId, attempt]);
  const source = result?.status === "AVAILABLE" ? result : null;
  const previewable = source && canPreview(source.document.mimeType, source.document.name);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-4xl" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <DialogHeader>
        <DialogTitle>{source?.document.name ?? "材料命中来源"}</DialogTitle>
        <DialogDescription>{source ? `第 ${source.document.version} 版 · ${source.locationLabel}` : "指定材料与原文位置"}</DialogDescription>
      </DialogHeader>
      {!result && !error ? <p role="status" className="text-sm text-muted-foreground">正在读取命中位置…</p> : null}
      {result?.status === "UNAVAILABLE" ? <p role="alert" className="text-sm text-muted-foreground">此来源当前不可用，请核对材料状态和读取权限。</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {source ? <>
        {!source.run.isCurrent && <p className="text-sm text-muted-foreground">显示本次命中保留的解析版本。</p>}
        {source.coverage.units.some(unit => unit.status !== "READY") && <p className="text-sm text-muted-foreground">此材料仅部分内容已处理。</p>}
        <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{source.anchor.text}</blockquote>
        {previewable ? <iframe title="命中位置原件" src={source.originalUrl} className="h-[55vh] w-full rounded border" /> : null}
      </> : null}
      <DialogFooter>
        {error || result?.status === "UNAVAILABLE" ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>重新读取来源</Button> : null}
        {source ? <Button asChild variant="outline"><a href={source.originalUrl} target="_blank" rel="noopener noreferrer">{previewable ? "另页打开原件" : "下载原件"}</a></Button> : null}
        <Button variant="outline" onClick={onClose}>返回搜索结果</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
