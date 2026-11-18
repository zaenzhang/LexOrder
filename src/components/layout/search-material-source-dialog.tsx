"use client";

import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, WorkspaceDialog } from "@/components/patterns/workspace-dialog";

import { useEffect, useState } from "react";
import { Button, Typography } from "@douyinfe/semi-ui";
import { getMaterialSource } from "@/server/documents/processing-actions";
import type { MaterialSourceInput, MaterialSourceResult } from "@/server/documents/material-processing";

/** A search hit supplies identity only; this reader supplies the current authorized projection. */
export function SearchMaterialSourceDialog({ input, onClose }: {
  input: MaterialSourceInput; onClose(): void;
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
  return <WorkspaceDialog open dismissOnBackdrop onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-[900px]">
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
        <div className="space-y-2"><p className="text-sm font-medium">已固定的抽取片段</p>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{source.anchor.text}</blockquote></div>
        {source.previewKind === "CONVERTED" && <p className="text-sm text-muted-foreground">转换预览打开整份文件，未按引用位置跳转。</p>}
        {source.previewUrl ? <iframe title={source.previewKind === "TABLE" ? "单元格转换预览" : source.previewKind === "CONVERTED" ? "整份转换预览" : "文件预览"} src={source.previewUrl} className="h-[55vh] w-full rounded border" /> : null}
      </> : null}
      <DialogFooter>
        {error || result?.status === "UNAVAILABLE" ? <Button theme="outline" onClick={() => setAttempt(value => value + 1)}>重新读取来源</Button> : null}
        {source?.previewUrl ? <Typography.Text link={{ href: source.previewUrl, target: "_blank", rel: "noopener noreferrer" }}>{source.previewKind === "TABLE" ? "查看单元格转换预览" : source.previewKind === "CONVERTED" ? "另页查看转换预览" : "另页查看预览"}</Typography.Text> : null}
        {source ? <Typography.Text link={{ href: source.downloadUrl, target: "_blank", rel: "noopener noreferrer" }}>下载此版本</Typography.Text> : null}
        <Button theme="outline" autoFocus onClick={onClose}>返回搜索结果</Button>
      </DialogFooter>
    </DialogContent>
  </WorkspaceDialog>;
}
