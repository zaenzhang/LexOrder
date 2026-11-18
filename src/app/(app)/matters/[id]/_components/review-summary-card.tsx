import { Sparkles, AlertTriangle, FileText } from "lucide-react";
import type { MatterReviewSummary } from "@/server/ai/matter-review-summary";
import { cn, formatDate } from "@/lib/utils";
import { BatchReviewButton } from "./batch-review-button";

export function ReviewSummaryCard({
  summary,
  matterId
}: {
  summary: MatterReviewSummary;
  matterId: string;
}) {
  const hasRecords = summary.recordCount > 0;

  // v0.27: AI 复检入口暂隐 —— 没记录时整张卡片不渲染（避免出现没按钮的空提示）
  if (!hasRecords) {
    return null;
  }

  return (
    <section className="rounded-lg border border-[var(--semi-color-secondary-light-active)] bg-[var(--semi-color-secondary-light-default)] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-[var(--semi-color-secondary)]">
          <Sparkles className="h-3.5 w-3.5" />
          AI 审查总览
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            {summary.documentCount} 份文档 · {summary.recordCount} 次审查 · 共 {summary.totalItems} 条
            {summary.latestReviewedAt && (
              <span className="ml-2">最新 {formatDate(summary.latestReviewedAt)}</span>
            )}
          </span>
          <BatchReviewButton matterId={matterId} />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <SevTile sev="HIGH" n={summary.bySeverity.HIGH} />
        <SevTile sev="MEDIUM" n={summary.bySeverity.MEDIUM} />
        <SevTile sev="LOW" n={summary.bySeverity.LOW} />
      </div>

      {summary.topHighItems.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1 text-[10px] text-[var(--semi-color-danger)]">
            <AlertTriangle className="h-3 w-3" />
            最近高风险（最多 3 条）
          </div>
          <ul className="space-y-1">
            {summary.topHighItems.map((it, i) => (
              <li
                key={`${it.documentId}-${i}`}
                className="rounded border border-[var(--semi-color-danger-light-active)] bg-background px-2 py-1.5 text-xs"
              >
                <div className="font-medium">{it.title}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/70">
                  {it.detail}
                </p>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <FileText className="h-2.5 w-2.5" />
                  <span className="truncate">{it.documentName}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SevTile({ sev, n }: { sev: "HIGH" | "MEDIUM" | "LOW"; n: number }) {
  const meta = {
    HIGH: { label: "高风险", cls: "border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)] text-[var(--semi-color-danger)]" },
    MEDIUM: { label: "中风险", cls: "border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] text-[var(--semi-color-warning)]" },
    LOW: { label: "低风险", cls: "border-[var(--semi-color-border)] bg-[var(--semi-color-fill-0)] text-[var(--semi-color-text-2)]" }
  }[sev];
  return (
    <div className={cn("rounded border px-2 py-1.5", meta.cls)}>
      <div className="text-[10px] opacity-80">{meta.label}</div>
      <div className="mt-0.5 font-mono text-base leading-none">{n}</div>
    </div>
  );
}
