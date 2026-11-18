"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button as SemiButton } from "@douyinfe/semi-ui";

import { startTransition, useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { actionErrorMessage } from "@/lib/action-error";
import { getMaterialProcessingStatuses, retryMaterialProcessing } from "@/server/documents/processing-actions";
import type { MaterialProcessingStatusItem } from "@/server/documents/material-processing";

function ranges(values: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = values[i];
    let end = start;
    while (i + 1 < values.length && values[i + 1] === end + 1) end = values[++i];
    parts.push(start === end ? String(start) : `${start}—${end}`);
  }
  return parts.join("、");
}

export function MaterialProcessingStatus({ matterId, documentIds, canManage = false }: {
  matterId: string; documentIds: string[]; canManage?: boolean;
}) {
  const [rows, setRows] = useState<MaterialProcessingStatusItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadedSelection, setLoadedSelection] = useState("");
  const sequence = useRef(0);
  const selection = JSON.stringify([...new Set(documentIds)].sort());
  const selectedKey = `${matterId}:${selection}`;

  useEffect(() => {
    const request = ++sequence.current;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ids = JSON.parse(selection) as string[];
    async function read() {
      try {
        const result: MaterialProcessingStatusItem[] = [];
        for (let start = 0; start < ids.length; start += 500) result.push(...await getMaterialProcessingStatuses({ matterId, documentIds: ids.slice(start, start + 500) }));
        if (!alive || request !== sequence.current) return;
        setRows(result); setError(""); setLoading(false); setLoadedSelection(`${matterId}:${selection}`);
        // Poll only unfinished jobs. A completed parse with unrecognized scans is not a running job.
        if (result.some(item => item.inProgress)) timer = setTimeout(() => startTransition(() => { void read(); }), 5000);
      } catch (err) {
        if (!alive || request !== sequence.current) return;
        setRows([]); setError(actionErrorMessage(err)); setLoading(false); setLoadedSelection(`${matterId}:${selection}`);
      }
    }
    startTransition(() => { void read(); });
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [matterId, selection, revision]);

  async function retry(row: MaterialProcessingStatusItem) {
    setRetrying(row.documentId);
    try {
      await retryMaterialProcessing({ documentId: row.documentId, expectedGeneration: row.generation });
      Toast.success("已安排重新处理");
      setRevision(value => value + 1);
    } catch (err) { Toast.error(actionErrorMessage(err)); }
    finally { setRetrying(null); }
  }

  if (!documentIds.length) return null;
  const currentRows = loadedSelection === selectedKey ? rows : [];
  return <section aria-label="材料处理状态" className="space-y-2 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">材料处理</h3>
      <SemiButton htmlType="button" theme="borderless" type="tertiary" onClick={() => setRevision(value => value + 1)}>刷新状态</SemiButton>
    </div>
    {loading || loadedSelection !== selectedKey ? <p role="status" className="text-muted-foreground">正在读取材料状态…</p> : null}
    {error && loadedSelection === selectedKey ? <p role="alert" className="text-destructive">{error}</p> : null}
    {!loading && loadedSelection === selectedKey && !error && !currentRows.length ? <p className="text-muted-foreground">当前没有可查看的材料。</p> : null}
    <ul className="divide-y">
      {currentRows.map(row => {
        const unit = row.coverage?.unitKind === "PAGE" ? "页" : row.coverage?.unitKind === "PARAGRAPH" ? "段" : "处理单元";
        const pending = row.coverage && [
          ["未识别", row.coverage.pending], ["失败", row.coverage.failed],
          ["不支持", row.coverage.unsupported], ["已截断", row.coverage.truncated],
        ] as [string, number[]][];
        return <li key={row.documentId} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><span className="break-all font-medium">{row.documentName}</span><span className="ml-2 text-muted-foreground">{row.label}</span></div>
            <div className="flex shrink-0 items-center gap-2">
              {row.previewUrl ? <a href={row.previewUrl} target="_blank" rel="noreferrer" className="workspace-action-link">{row.previewKind === "CONVERTED" ? "转换预览" : "查看预览"}</a> : null}
              <a href={row.downloadUrl} target="_blank" rel="noreferrer" className="workspace-action-link">下载此版本</a>
              {canManage && row.canRetry ? <SemiButton htmlType="button" theme="borderless" type="tertiary" disabled={retrying !== null} onClick={() => startTransition(() => { void retry(row); })}>
                {retrying === row.documentId ? "正在提交…" : row.state === "NOT_PROCESSED" ? "建立来源" : "重新处理"}
              </SemiButton> : null}
            </div>
          </div>
          {row.coverage ? <p className="mt-1 text-muted-foreground">已处理 {row.coverage.ready}{row.coverage.totalUnits === null ? " / 范围未知" : ` / ${row.coverage.totalUnits}`} {unit}</p> : null}
          {row.detail ? <p className="mt-1 text-muted-foreground">{row.detail}</p> : null}
          {pending?.some(([, values]) => values.length) ? <Disclosure className="mt-1" heading="查看未处理范围">
            {pending.filter(([, values]) => values.length).map(([label, values]) => <p key={label} className="break-words text-muted-foreground">{label}：第 {ranges(values)} {unit}</p>)}
          </Disclosure> : null}
        </li>;
      })}
    </ul>
  </section>;
}
