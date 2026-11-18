"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAIWandLevel1 as Sparkles, IconLoading as Loader2, IconTick as Check, IconClose as X } from "@douyinfe/semi-icons";
import { Button, Notification, Toast } from "@douyinfe/semi-ui";
import {
  batchReviewMatterDocuments,
  type BatchReviewSummary
} from "@/server/ai/batch-review-matter";
import {
  WorkspaceDialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

// v0.27: AI 复检功能暂时隐藏（后端 server action 保留），改回时去掉此 flag
const SHOW_AI_RECHECK = false;

export function BatchReviewButton({ matterId }: { matterId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BatchReviewSummary | null>(null);
  const [open, setOpen] = useState(false);

  if (!SHOW_AI_RECHECK) return null;

  async function run() {
    if (
      !(await confirmDialog({ title: "批量 AI 审查？", description: "将对本案最多 5 份未审查过的文档发起 AI 审查，会消耗 AI 调用额度。", confirmText: "开始审查" }))
    )
      return;
    startTransition(async () => {
      try {
        const r = await batchReviewMatterDocuments({ matterId });
        setResult(r);
        setOpen(true);
        const totalErrors = r.errors.length;
        if (r.reviewed.length === 0 && totalErrors === 0) {
          Toast.info("没有需要审查的新文档");
        } else if (totalErrors > 0) {
          Toast.warning(
            `已审查 ${r.reviewed.length}，失败 ${totalErrors}`
          );
        } else {
          Toast.success(`已审查 ${r.reviewed.length} 份文档`);
        }
        router.refresh();
      } catch (err) {
        Notification.error({ title: "批量审查失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <>
      <Button
        onClick={run}
        disabled={pending}
        className="gap-1"
        title="对本案未审查过的文档批量发起 AI 审查（单次最多 5 个）"
        htmlType="button"
        type="tertiary" theme="outline"
        size="small"
      >
        {pending ? <Loader2 aria-hidden size="small" spin /> : <Sparkles aria-hidden size="small" />}
        AI 复检全部
      </Button>

      <WorkspaceDialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles aria-hidden size="default" className="text-[var(--semi-color-secondary)]" />
              AI 复检结果
            </DialogTitle>
            <DialogDescription>
              单次最多审查 5 份文档；已审过的 7 天内跳过
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-3 text-xs">
              {result.reviewed.length > 0 && (
                <section>
                  <h4 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--semi-color-success)]">
                    <Check aria-hidden size="small" />
                    已审查（{result.reviewed.length}）
                  </h4>
                  <ul className="space-y-1">
                    {result.reviewed.map((r) => (
                      <li
                        key={r.documentId}
                        className="rounded border border-[var(--semi-color-success-light-active)] bg-[var(--semi-color-success-light-default)] px-2 py-1.5"
                      >
                        <span className="truncate">{r.documentName}</span>
                        <span className="ml-2 font-mono text-xs text-[var(--semi-color-success)]">
                          {r.itemCount} 条问题
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {result.errors.length > 0 && (
                <section>
                  <h4 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-destructive">
                    <X aria-hidden size="small" />
                    失败（{result.errors.length}）
                  </h4>
                  <ul className="space-y-1">
                    {result.errors.map((r) => (
                      <li
                        key={r.documentId}
                        className="rounded border border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)] px-2 py-1.5 text-[var(--semi-color-danger)]"
                      >
                        <div className="font-medium">{r.documentName}</div>
                        <div className="text-xs">{r.error}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {result.skipped.length > 0 && (
                <section>
                  <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    跳过（{result.skipped.length}）
                  </h4>
                  <ul className="max-h-32 space-y-1 overflow-y-auto">
                    {result.skipped.map((s) => (
                      <li
                        key={s.documentId}
                        className="rounded border border-border bg-muted/30 px-2 py-1 text-muted-foreground"
                      >
                        <span className="truncate">{s.documentName}</span>
                        <span className="ml-2 text-xs">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="tertiary" theme="outline" size="small">
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </WorkspaceDialog>
    </>
  );
}
