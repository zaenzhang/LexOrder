"use client";

import { Button, TextArea } from "@douyinfe/semi-ui";
import { useEffect, useState } from "react";
import { IconAIWandLevel1 as Sparkles, IconLoading as Loader2, IconClose as X } from "@douyinfe/semi-icons";
import type { MatterCategory, ProcedureType } from "@prisma/client";
import {
  WorkspaceDialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import {
  recommendCause,
  type CauseRecommendation
} from "@/server/ai/recommend-cause";
import { cn } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";

type Tab = "preset" | "free";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: MatterCategory;
  procedureType?: ProcedureType | null;
  /** 用现有字段 tab 的预填内容（父组件按场景拼好） */
  contextHints?: string;
  onSelect: (causeId: string, causeName: string) => void;
};

const confidenceStyle = {
  HIGH: { label: "高置信", cls: "bg-[var(--semi-color-success-light-default)] text-[var(--semi-color-success)] border-[var(--semi-color-success-light-active)]" },
  MEDIUM: { label: "中置信", cls: "bg-[var(--semi-color-warning-light-default)] text-[var(--semi-color-warning)] border-[var(--semi-color-warning-light-active)]" },
  LOW: { label: "低置信", cls: "bg-[var(--semi-color-fill-0)] text-[var(--semi-color-text-2)] border-[var(--semi-color-border)]" }
} as const;

export function CauseAiManualDialog({
  open,
  onOpenChange,
  category,
  procedureType,
  contextHints,
  onSelect
}: Props) {
  const hasHints = !!contextHints?.trim();
  const [tab, setTab] = useState<Tab>(hasHints ? "preset" : "free");
  const [situation, setSituation] = useState(hasHints ? (contextHints ?? "") : "");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CauseRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 打开/重开时重置
  useEffect(() => {
    if (!open) return;
    const initTab: Tab = hasHints ? "preset" : "free";
    setTab(initTab);
    setSituation(initTab === "preset" ? (contextHints ?? "") : "");
    setCandidates([]);
    setError(null);
    setLoading(false);
  }, [open, contextHints, hasHints]);

  function switchTab(t: Tab) {
    if (t === tab) return;
    setTab(t);
    setSituation(t === "preset" ? (contextHints ?? "") : "");
    setCandidates([]);
    setError(null);
  }

  async function runRecommend() {
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const list = await recommendCause({ category, procedureType, situation });
      setCandidates(list);
    } catch (err) {
      setError(err instanceof Error ? actionErrorMessage(err) : "AI 推荐失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles aria-hidden size="default" className="text-[var(--semi-color-secondary)]" />
            AI 案由推荐
          </DialogTitle>
          <DialogDescription className="text-xs">
            描述案情后 AI 推荐 3 个候选案由，请人工核对后选用
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {/* Tab 切换（仅有 hints 时显示） */}
          {hasHints && (
            <div className="flex rounded-md border border-border bg-card p-0.5">
              <TabBtn active={tab === "preset"} onClick={() => switchTab("preset")}>
                用现有字段
              </TabBtn>
              <TabBtn active={tab === "free"} onClick={() => switchTab("free")}>
                自由输入
              </TabBtn>
            </div>
          )}

          <TextArea
            value={situation}
            onChange={inputValue => setSituation(inputValue)}
            placeholder={
              tab === "preset"
                ? "已根据案件字段填入，可修改后再推荐"
                : "描述案情：当事人是谁、做了什么、争议焦点、诉求"
            }
            rows={6}
            className="resize-none"
          />

          <Button
            onClick={runRecommend}
            disabled={loading || situation.trim().length < 5}
            className="w-full gap-1.5"
            htmlType="button"
            theme="solid"
          >
            {loading ? (
              <Loader2 aria-hidden size="default" spin />
            ) : (
              <Sparkles aria-hidden size="default" />
            )}
            {candidates.length > 0 ? "重新推荐" : "AI 推荐"}
          </Button>

          {/* 结果区 */}
          {error && (
            <div className="rounded border border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)] p-3 text-xs text-[var(--semi-color-danger)]">
              {error}
            </div>
          )}
          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((c) => {
                const conf = confidenceStyle[c.confidence];
                const path = [c.cause.l1Name, c.cause.l2Name].filter(Boolean).join(" / ");
                return (
                  <Button theme="outline" type="tertiary" size="small" contentClassName="flex w-full min-w-0 flex-col items-start gap-1 text-left"
                    key={c.cause.id}
                    htmlType="button"
                    onClick={() => {
                      onSelect(c.cause.id, c.cause.name);
                      onOpenChange(false);
                    }}
                    className="flex w-full flex-col items-start gap-1 rounded-sm border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-input hover:bg-muted hover:text-foreground"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium">{c.cause.name}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-xs leading-none",
                          conf.cls
                        )}
                      >
                        {conf.label}
                      </span>
                    </div>
                    {path && (
                      <span className="text-xs text-muted-foreground">{path}</span>
                    )}
                    {c.reason && (
                      <span className="text-xs text-foreground/70">{c.reason}</span>
                    )}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-2.5">
          <Button onClick={() => onOpenChange(false)} htmlType="button" type="tertiary" theme="borderless" size="small">
            <X aria-hidden size="small" />
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button theme="borderless" type="primary" size="small"
      htmlType="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-2 py-1 text-xs transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Button>
  );
}
