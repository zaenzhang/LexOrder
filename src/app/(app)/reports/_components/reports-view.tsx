"use client";

import { Table, Button, Input, Notification, Toast } from "@douyinfe/semi-ui";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type IconFile } from "@douyinfe/semi-icons";
import { IconCoinMoney as Wallet, IconBriefcase as Briefcase, IconArchive as Archive, IconTickCircle as CheckCircle2, IconDownload as Download, IconAlertCircle as CircleAlert, IconSend as Send, IconLoading as Loader2, IconPrint as Printer } from "@douyinfe/semi-icons";
import { matterCategoryLabel, matterCategoryColor } from "@/lib/enums";
import type { ReportData } from "@/server/reports/queries";
import type {
  CycleStats,
  ReviewIssueAnalysis
} from "@/server/reports/analytics";
import { pushWeeklyReportToAll } from "@/server/reports/push-weekly";
import { triggerArchiveOverdueScanNow } from "@/server/cron/manual-triggers";


import { cn } from "@/lib/utils";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

type PeriodKey = "month" | "quarter" | "year" | "lastYear" | "custom";

const PERIOD_LABEL: Record<Exclude<PeriodKey, "custom">, string> = {
  month: "本月",
  quarter: "本季",
  year: "本年",
  lastYear: "上年"
};

export function ReportsView({
  periodKey,
  periodLabel,
  customStart,
  customEnd,
  resolveError,
  data,
  cycle,
  reviewAnalysis,
  presetLabels
}: {
  periodKey: PeriodKey;
  periodLabel: string;
  customStart?: string;
  customEnd?: string;
  resolveError?: string;
  data: ReportData;
  cycle: CycleStats[];
  reviewAnalysis: ReviewIssueAnalysis;
  presetLabels: Record<Exclude<PeriodKey, "custom">, string>;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [customOpen, setCustomOpen] = useState(periodKey === "custom");
  const [start, setStart] = useState(customStart ?? "");
  const [end, setEnd] = useState(customEnd ?? "");
  const [pushing, startPushing] = useTransition();
  const [scanning, startScanning] = useTransition();

  async function handleScanOverdue() {
    if (!(await confirmDialog({ title: "立即扫描归档逾期？", description: "扫描已结案超过 30 天未归档的案件，并给主办律师发送预警通知。", confirmText: "开始扫描" }))) return;
    startScanning(async () => {
      try {
        const r = await triggerArchiveOverdueScanNow();
        Toast.success(`归档逾期扫描完成：${r.scanned} 候选 / ${r.notified} 通知 / ${r.suppressed} 抑制`);
      } catch (err) {
        Notification.error({ title: "扫描失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  async function handlePushWeekly() {
    if (!(await confirmDialog({ title: "推送本周报告？", description: "立即给所有主任律师和律师推送本周报告，每人收到一条通知。", confirmText: "推送" }))) return;
    startPushing(async () => {
      try {
        const res = await pushWeeklyReportToAll();
        if (res.failed.length === 0) {
          Toast.success(`已推送本周报告（${res.weekLabel}），共 ${res.succeeded} 人`);
        } else {
          Notification.warning({ title: `部分成功：${res.succeeded} 成功，${res.failed.length} 失败`, content: res.failed.map((f) => f.error).slice(0, 3).join("；"), duration: 6 });
        }
      } catch (err) {
        Notification.error({ title: "推送失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  function switchPreset(k: Exclude<PeriodKey, "custom">) {
    const next = new URLSearchParams(sp.toString());
    next.set("period", k);
    next.delete("start");
    next.delete("end");
    router.push(`/reports?${next.toString()}`);
    setCustomOpen(false);
  }

  function applyCustom() {
    if (!start || !end) return;
    const next = new URLSearchParams();
    next.set("period", "custom");
    next.set("start", start);
    next.set("end", end);
    router.push(`/reports?${next.toString()}`);
  }

  const maxCat = data.byCategory.reduce((m, c) => Math.max(m, c.count), 0);

  const exportHref = (() => {
    const q = new URLSearchParams();
    q.set("period", periodKey);
    if (periodKey === "custom" && customStart && customEnd) {
      q.set("start", customStart);
      q.set("end", customEnd);
    }
    return `/api/reports/export?${q.toString()}`;
  })();

  return (
    <div className="space-y-5">
      <header className="ll-page-head">
        <div>
          <h1 className="mo-ph-title">律所报表</h1>
          <p className="ll-page-sub">
            统计期：<span className="text-foreground">{periodLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 ll-no-print">
          <div className="flex items-center gap-1">
            {(["month", "quarter", "year", "lastYear"] as const).map((k) => (
              <Button
                key={k}
                htmlType="button"
                onClick={() => switchPreset(k)}
                className="shrink-0"
                aria-pressed={periodKey === k}
                title={presetLabels[k]} theme={periodKey === k ? "solid" : "borderless"}
              >
                {PERIOD_LABEL[k]}
              </Button>
            ))}
            <Button
              htmlType="button"
              onClick={() => setCustomOpen((v) => !v)}
              className="shrink-0"
              aria-pressed={periodKey === "custom"}
              theme={periodKey === "custom" ? "solid" : "borderless"}
            >
              自定义
            </Button>
          </div>
          <Button
            size="small"
            theme="outline" type="tertiary"
            onClick={handleScanOverdue}
            disabled={scanning}
            className="gap-1.5"
            title="扫描已结超过 30 天未归档的案件" htmlType="button"
          >
            {scanning ? (
              <Loader2 aria-hidden size="small" spin />
            ) : (
              <Send aria-hidden size="small" />
            )}
            扫归档逾期
          </Button>
          <Button
            size="small"
            theme="outline" type="tertiary"
            onClick={handlePushWeekly}
            disabled={pushing}
            className="gap-1.5"
            title="给所有律师推送本周报告通知" htmlType="button"
          >
            {pushing ? (
              <Loader2 aria-hidden size="small" spin />
            ) : (
              <Send aria-hidden size="small" />
            )}
            推送周报
          </Button>
          <Button
            size="small"
            theme="outline" type="tertiary"
            onClick={() => window.print()}
            className="gap-1.5"
            title="Cmd/Ctrl+P 同样可触发，可以「另存为 PDF」" htmlType="button"
          >
            <Printer aria-hidden size="small" />
            打印 / PDF
          </Button>
          <Link href={exportHref} prefetch={false}>
            <Button size="small" className="gap-1.5" theme="solid" type="primary" htmlType="button">
              <Download aria-hidden size="small" />
              导出 xlsx
            </Button>
          </Link>
        </div>
      </header>

      {customOpen && (
        <div className="ll-no-print ll-surface flex flex-wrap items-end gap-2 p-3 text-xs">
          <div>
            <label className="text-muted-foreground">起始（含）</label>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e)}
              className="mt-0.5 h-8 w-36 text-xs"
            />
          </div>
          <span className="pb-2 text-muted-foreground">~</span>
          <div>
            <label className="text-muted-foreground">结束（含）</label>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e)}
              className="mt-0.5 h-8 w-36 text-xs"
            />
          </div>
          <Button size="small" onClick={applyCustom} disabled={!start || !end} theme="solid" type="primary" htmlType="button">
            应用
          </Button>
          <span className="ml-2 text-xs text-muted-foreground">最大跨度 5 年</span>
        </div>
      )}

      {resolveError && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] p-3 text-xs text-[var(--semi-color-warning)]">
          <CircleAlert aria-hidden size="small" className="mt-0.5 shrink-0" />
          <span>{resolveError}</span>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Briefcase} label="本期新收" value={data.kpis.newIntake} color="#1E56C8" />
        <Kpi icon={Wallet} label="在办中" value={data.kpis.inProgress} color="#96650B" />
        <Kpi icon={CheckCircle2} label="本期已结" value={data.kpis.closed} color="#1A7F45" />
        <Kpi
          icon={Archive}
          label="本期已归档"
          value={data.kpis.archived}
          color="#6C3FC5"
          hint={data.kpis.closed > 0 ? `归档率 ${Math.round(data.kpis.archiveRate * 100)}%` : ""}
        />
      </div>

      {/* 类别分布 */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 text-sm font-medium">本期新收 · 类别分布</h3>
        {data.byCategory.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期暂无新收案件</p>
        ) : (
          <ul className="space-y-2">
            {data.byCategory.map((c) => {
              const pct = maxCat > 0 ? (c.count / maxCat) * 100 : 0;
              const color = matterCategoryColor[c.category];
              return (
                <li key={c.category} className="flex items-center gap-3 text-xs">
                  <span className="w-16 shrink-0 text-foreground/80">
                    {matterCategoryLabel[c.category]}
                  </span>
                  <div className="flex-1">
                    <div
                      className="h-4 rounded"
                      style={{
                        width: `${pct}%`,
                        minWidth: c.count > 0 ? 8 : 0,
                        backgroundColor: `${color}99`
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 font-mono text-right text-foreground">
                    {c.count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* 客户来源渠道分布（P0-1 第三步） */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">客户来源渠道 · 存量</h3>
          {data.byClientSource.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无客户数据</p>
          ) : (
            <ul className="space-y-2">
              {data.byClientSource.slice(0, 8).map((s) => {
                const max = data.byClientSource[0].count || 1;
                const pct = (s.count / max) * 100;
                return (
                  <li key={s.source} className="flex items-center gap-3 text-xs">
                    <span className="w-20 shrink-0 truncate text-foreground/80" title={s.source}>
                      {s.source}
                    </span>
                    <div className="flex-1">
                      <div className="h-4 rounded" style={{ width: `${pct}%`, minWidth: 8, backgroundColor: "color-mix(in srgb, var(--semi-color-primary) 60%, transparent)" }} />
                    </div>
                    <span className="w-16 shrink-0 font-mono text-right text-foreground" title={`${s.count} 位客户 · 关联 ${s.intakeCount} 件案件`}>
                      {s.count} / {s.intakeCount}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">客户数 / 关联案件数 · 未记录来源的客户可在客户档案中补录</p>
        </section>

        {/* 律师产出 */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">律师产出 · 本期</h3>
          {data.byLawyer.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">本期无产出数据</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <Table<(typeof data.byLawyer)[number]>
                pagination={false}
                rowKey="userId"
                dataSource={data.byLawyer}
                columns={[
                  { title: "律师", dataIndex: "name" },
                  { title: "新收", align: "right", key: "column2", render: (_, r) => <span className="font-mono">{r.ownedCount}</span> },
                  { title: "已结", align: "right", key: "column3", render: (_, r) => <span className="font-mono">{r.closedCount}</span> },
                  { title: "收款（元）", align: "right", key: "column4", render: (_, r) => <span className="font-mono">{r.receivedAmount.toLocaleString("zh-CN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}</span> },
                ]}
              />
            </div>
          )}
        </section>

        {/* 客户应收 */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">{data.financeReady?"客户应收 · 当前余额":"客户应收 · 本期"}</h3>
          {data.byClientReceivable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无应收数据</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <Table<(typeof data.byClientReceivable)[number]>
                pagination={false}
                rowKey="clientId"
                dataSource={data.byClientReceivable}
                columns={[
                  { title: "客户", dataIndex: "name" },
                  { title: "应收", align: "right", key: "column2", render: (_, r) => <span className="font-mono">{r.receivable.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span> },
                  { title: data.financeReady?"已核销":"已收", align: "right", key: "column3", render: (_, r) => <span className="font-mono">{r.received.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span> },
                  { title: "余额", align: "right", key: "column4", render: (_, r) => r.balance.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) },
                ]}
              />
            </div>
          )}
        </section>
      </div>

      {/* 办案周期分析 */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 text-sm font-medium">办案周期 · 本期已结案件（收案 → 结案）</h3>
        {cycle.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期无已结案件</p>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <Table<(typeof cycle)[number]>
              pagination={false}
              rowKey="category"
              dataSource={cycle}
              columns={[
                { title: "类别", key: "column1", render: (_, r) => matterCategoryLabel[r.category] },
                { title: "样本数", align: "right", key: "column2", render: (_, r) => <span className="font-mono">{r.count}</span> },
                { title: "均值（天）", align: "right", key: "column3", render: (_, r) => <span className="font-mono">{r.avgDays}</span> },
                { title: "中位数（天）", align: "right", key: "column4", render: (_, r) => <span className="font-mono">{r.medianDays}</span> },
                { title: "最快（天）", align: "right", key: "column5", render: (_, r) => <span className="font-mono">{r.minDays}</span> },
                { title: "最慢（天）", align: "right", key: "column6", render: (_, r) => <span className="font-mono">{r.maxDays}</span> },
              ]}
            />
          </div>
        )}
      </section>

      {/* AI 审查 top issues */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
          AI 审查 · 本期高频问题
          <span className="text-xs font-normal text-muted-foreground">
            （{reviewAnalysis.recordCount} 次审查 / {reviewAnalysis.documentCount} 份文档 /{" "}
            {reviewAnalysis.totalItems} 条问题）
          </span>
        </h3>
        {reviewAnalysis.totalItems === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期没有 AI 审查记录</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <SevTotalChip sev="HIGH" n={reviewAnalysis.bySeverity.HIGH} />
              <SevTotalChip sev="MEDIUM" n={reviewAnalysis.bySeverity.MEDIUM} />
              <SevTotalChip sev="LOW" n={reviewAnalysis.bySeverity.LOW} />
            </div>
            <div className="overflow-hidden rounded border border-border">
              <Table<(typeof reviewAnalysis.topIssues)[number]>
                pagination={false}
                rowKey="title"
                dataSource={reviewAnalysis.topIssues}
                columns={[
                  { title: "问题标题", dataIndex: "title" },
                  { title: "类型", key: "column2", render: (_, iss) => <span className="text-muted-foreground">{TYPE_CN[iss.type]}</span> },
                  { title: "次数", align: "right", key: "column3", render: (_, iss) => <span className="font-mono">{iss.occurrences}</span> },
                  { title: "高/中/低", align: "right", key: "column4", render: (_, iss) => <span className="font-mono"><><span className="text-[var(--semi-color-danger)]">{iss.severityCounts.HIGH}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-[var(--semi-color-warning)]">{iss.severityCounts.MEDIUM}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-[var(--semi-color-text-2)]">{iss.severityCounts.LOW}</span></></span> },
                ]}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const TYPE_CN = {
  MISSING: "缺失",
  RISK: "风险",
  ISSUE: "问题",
  SUGGESTION: "建议"
} as const;

function SevTotalChip({ sev, n }: { sev: "HIGH" | "MEDIUM" | "LOW"; n: number }) {
  const meta = {
    HIGH: { label: "高严重", cls: "border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)] text-[var(--semi-color-danger)]" },
    MEDIUM: { label: "中严重", cls: "border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] text-[var(--semi-color-warning)]" },
    LOW: { label: "低严重", cls: "border-[var(--semi-color-border)] bg-[var(--semi-color-fill-0)] text-[var(--semi-color-text-2)]" }
  }[sev];
  return (
    <div className={cn("rounded border px-3 py-2 text-xs", meta.cls)}>
      <div className="text-xs opacity-80">{meta.label}</div>
      <div className="mt-0.5 font-mono text-lg">{n}</div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  color,
  hint
}: {
  icon: typeof IconFile;
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-1 font-mono text-2xl tabular text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
