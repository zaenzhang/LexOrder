"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Typography } from "@douyinfe/semi-ui";

type PreviewableFile = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
};

function isInlineImage(mime: string | null | undefined): boolean {
  return !!mime && mime.toLowerCase().startsWith("image/");
}

function isInlinePdf(mime: string | null | undefined): boolean {
  return mime?.toLowerCase() === "application/pdf";
}

function isInlineText(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m.startsWith("text/") || m === "application/json";
}

export function PreviewDialog({
  open,
  file,
  onOpenChange
}: {
  open: boolean;
  file: PreviewableFile | null;
  onOpenChange: (o: boolean) => void;
}) {
  if (!file) return null;
  const previewUrl = `/api/firm-files/${file.id}/download?inline=1`;
  const downloadUrl = `/api/firm-files/${file.id}/download`;
  const canInlinePreview =
    isInlinePdf(file.mimeType) ||
    isInlineImage(file.mimeType) ||
    isInlineText(file.mimeType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            <span className="truncate">{file.name}</span>
          </DialogTitle>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogDescription>
              {file.mimeType ?? "未知类型"} · {(file.size / 1024).toFixed(1)} KB
            </DialogDescription>
            <div className="flex items-center gap-3">
              {canInlinePreview && (
                <Typography.Text link={{ href: previewUrl, target: "_blank", rel: "noreferrer" }} icon={<ExternalLink size={14} />}>
                  新窗口打开
                </Typography.Text>
              )}
              <Typography.Text link={{ href: downloadUrl }} icon={<Download size={14} />}>下载文件</Typography.Text>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/40">
          {canInlinePreview ? (
            isInlineImage(file.mimeType) ? (
              <div className="flex h-full items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <iframe
                src={previewUrl}
                title={file.name}
                className="h-full w-full border-0 bg-background"
              />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
              <FileText className="h-10 w-10 opacity-30" />
              <p>
                浏览器暂不支持直接预览
                <span className="ml-1 font-mono text-[11px]">
                  ({file.mimeType ?? "未知类型"})
                </span>
              </p>
              <p>下载文件后用本地应用打开。</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
