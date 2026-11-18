"use client";

/**
 * 证件号加密迁移卡（P1 §三 存量回填入口，管理后台概览页）。
 */
import { Button } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { IconKey as KeyRound, IconLoading as Loader2 } from "@douyinfe/semi-icons";
import { backfillClientIdEncryption } from "@/server/clients/backfill-crypto";
import { actionErrorMessage } from "@/lib/action-error";

type Stats = { pending: number; sealed: number; total: number };
type RunResult = { scanned: number; sealed: number; skippedDuplicate: number; remaining: number };

export function ClientIdCryptoCard({ initialStats }: { initialStats: Stats }) {
  const [pending, startTransition] = useTransition();
  const [stats, setStats] = useState(initialStats);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound aria-hidden size="default" className="text-primary" />
            证件号加密迁移
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            将存量客户证件号转为加密存储并建立盲索引（等值查重不受影响）。重复主体的行会跳过并计数，请走客户合并流程处理。
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            客户总数 {stats.total} · 已加密 {stats.sealed} · 待迁移 {stats.pending}
          </div>
        </div>
        <Button theme="outline" type="tertiary" size="default" contentClassName="inline-flex items-center gap-1.5"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const r = await backfillClientIdEncryption();
                setLastRun(r);
                setStats(s => ({ ...s, pending: r.remaining, sealed: s.sealed + r.sealed }));
              } catch (e) {
                setError(e instanceof Error ? actionErrorMessage(e) : "执行失败");
              }
            });
          }}
          disabled={pending || stats.pending === 0}
          className="shrink-0"
        >
          {pending && <Loader2 aria-hidden size="small" spin />}
          {stats.pending > 0 ? "迁移一批（50）" : "无待迁移"}
        </Button>
      </div>
      {lastRun && (
        <div className="mt-2 text-xs text-muted-foreground">
          上次执行：扫描 {lastRun.scanned} · 加密 {lastRun.sealed}
          {lastRun.skippedDuplicate > 0 ? ` · 跳过重复 ${lastRun.skippedDuplicate}（待合并）` : ""}
          {lastRun.remaining > 0 ? ` · 剩余 ${lastRun.remaining} 可继续` : " · 已全部处理"}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
    </div>
  );
}
