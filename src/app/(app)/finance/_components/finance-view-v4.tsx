"use client";

/**
 * 财务（墨案 08 效果图）：KPI 四卡 → 分段（收付流水 / 开票管理 / 律师分成 / 应收账龄）→
 * 趋势 + 开票进度 → 收付流水表。已确认口径沿用 P0-6 规则（关联已签署合同或已登记发票号）。
 */
import type { TagColor } from "@douyinfe/semi-ui/lib/es/tag";
import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Table, Tabs, Select, Button, Input, Notification, Toast } from "@douyinfe/semi-ui";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DollarSign, FileText, Search, Users, Clock3, Plus } from "lucide-react";
import type { InvoiceReconciliation } from "@/lib/finance/invoice-reconciliation";
import type { InvoiceRequestRow } from "./invoice-types";
import type { getReceivablesAging } from "@/server/finance/aging";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { InvoiceManagementSection } from "./invoice-management";
import { InvoiceCreateDialog } from "./invoice-create-dialog";
import { RecordFeeLauncher } from "./record-fee-launcher";
import { MetricCard, PageHeader } from "@/components/patterns/moan";

import { confirmFeeEntry, rejectFeeEntry } from "@/server/finance/actions";
import { promptDialog } from "@/components/patterns/confirm-dialog";
import { useRouter } from "next/navigation";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { invoiceRequestStatusLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { shMonthDay, shParts } from "@/lib/ui/sh-time";
import { moneyKindLabels, type MoneyKind } from "@/lib/finance/ledger-labels";
import { actionErrorMessage } from "@/lib/action-error";

type Entry = {
  moneyKind?: MoneyKind;
  id: string;
  type: "RECEIVABLE" | "RECEIVED" | "REFUND" | "COST" | "COMMISSION";
  amount: number;
  occurredAt: Date;
  payerOrPayee: string | null;
  method: string | null;
  invoiceNo: string | null;
  note: string | null;
  confirmed: boolean;
  /** 实收确认：任何人登记的实收都先为 PENDING，经「确认实收到账」权限的人确认后才计入已实收（2026-09-19） */
  confirmState: "PENDING" | "CONFIRMED";
  matter: { id: string; internalCode: string; title: string };
  commissionAccrued?: number;
  commissionNetPaid?: number;
  commissionRecoverable?: number;
  beneficiaryUser: { id: string; name: string } | null;
  recordedBy: { id: string; name: string };
  confirmedBy: { id: string; name: string } | null;
};

type Aging = Awaited<ReturnType<typeof getReceivablesAging>>;

type Props = {
  entries: Entry[];
  monthly: { month: string; received: number; receivable: number }[];
  aging: Aging;
  stats: {
    ledgerReady?: boolean;
    monthlyReceived: number;
    monthlyReceivable: number;
    yearlyReceived: number;
    yearlyReceivable: number;
    lastMonthReceived: number;
    personalMonthly: number;
    personalYearly: number;
    monthlyIssued: number;
    pendingInvoiceCount: number;
    /** 本月实收笔数与待确认合计：库内统计，不受流水条数上限影响 */
    monthConfirmedCount: number;
    monthPendingCount: number;
    monthPendingAmount: number;
    /** 本月确认的退款/冲正更正合计（正值）：净实收为负时卡片注明构成，避免「¥-10,000 · 已确认 1 笔」不可解 */
    monthRefundAmount?: number;
    /** D 批：本期新增应收的当前核销率（%，分母为零时为 null——不显示为 0%） */
    writeOffRate?: number | null;
  };
  invoiceRequests: InvoiceRequestRow[];
  /** 全部待确认实收，与流水分页无关 */
  pendingEntries?: Entry[];
  /** 分成流水独立查询，避免混在 500 条流水里被截断 */
  commissionEntries?: Entry[];
  invoiceReconciliation: InvoiceReconciliation[];
  canApproveInvoice: boolean;
  canExport: boolean;
  canWrite: boolean;
  /** 能否确认 / 退回律师登记的实收（财务、主任、管理员） */
  canConfirmReceipt: boolean;
};

type Tab = "ledger" | "invoices" | "commission" | "aging";

const TYPE_META: Record<Entry["type"], { label: string; color: TagColor; sign: string; cls: string }> = {
  RECEIVED: { label: "收款", color: "green", sign: "+", cls: "in" },
  RECEIVABLE: { label: "应收", color: "amber", sign: "", cls: "" },
  COST: { label: "付款", color: "grey", sign: "−", cls: "out" },
  REFUND: { label: "退款", color: "red", sign: "−", cls: "out" },
  COMMISSION: { label: "分成", color: "violet", sign: "", cls: "out" }
};

const yuan = (n: number, digits = 0) => `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const mmdd = (d: Date | string) => shMonthDay(d);

export function FinanceViewV4({ entries, monthly, aging, stats, invoiceRequests, pendingEntries, commissionEntries: commissionRows, invoiceReconciliation, canApproveInvoice, canExport, canWrite, canConfirmReceipt }: Props) {
  const params = useSearchParams();
  const initialTab = (["ledger", "invoices", "commission", "aging"] as Tab[]).includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "ledger";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState("");
  const [range, setRange] = useState<string | undefined>("90");
  const [typeFilter, setTypeFilter] = useState<Entry["type"] | undefined>(undefined);
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  async function confirmOne(id: string) {
    setBusyId(id);
    try {
      await confirmFeeEntry(id);
      Toast.success("已确认到账");
      router.refresh();
    } catch (e) {
      Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "确认失败", duration: 6 });
    } finally {
      setBusyId(null);
    }
  }

  async function rejectOne(id: string) {
    const reason = await promptDialog({ title: "退回实收登记", description: "退回后该笔登记会被删除，登记人会收到通知并按实际到账重新登记。", label: "退回原因", placeholder: "如：银行流水未见此笔款项", confirmText: "退回", danger: true, required: true });
    if (!reason) return;
    setBusyId(id);
    try {
      await rejectFeeEntry(id, reason);
      Toast.success("已退回");
      router.refresh();
    } catch (e) {
      Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "退回失败", duration: 6 });
    } finally {
      setBusyId(null);
    }
  }

  useTopbarAction(canWrite ? { label: "登记收付", onClick: () => setRecordOpen(true) } : null, [canWrite]);

  const filtered = useMemo(() => {
    const since = range ? Date.now() - Number(range) * 86_400_000 : 0;
    const kw = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!typeFilter || e.type === typeFilter) &&
        (!since || new Date(e.occurredAt).getTime() >= since) &&
        (!kw || `${e.matter.title} ${e.matter.internalCode} ${e.payerOrPayee ?? ""} ${e.note ?? ""}`.toLowerCase().includes(kw))
    );
  }, [entries, q, range, typeFilter]);

  const now = new Date();
  const nowSh = shParts(now);
  const monthGrowth = stats.lastMonthReceived > 0 ? Math.round(((stats.monthlyReceived - stats.lastMonthReceived) / stats.lastMonthReceived) * 100) : null;

  const worst = aging.worst;
  const pendingInvoices = invoiceRequests.filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  const invoiceRows = [...pendingInvoices, ...invoiceRequests.filter((r) => r.status === "ISSUED")].slice(0, 4);
  // 待确认实收走独立查询（不受流水条数上限影响），旧数据兜底用流水里的 PENDING
  const pendingReceipts = pendingEntries ?? entries.filter((e) => e.type === "RECEIVED" && e.confirmState === "PENDING");
  const reconciliationById = new Map(invoiceReconciliation.map((row) => [row.id, row]));
  const issuedUnpaid = invoiceRequests.filter((r) => r.status === "ISSUED").map((r) => ({
    ...r,
    reconciliation: reconciliationById.get(r.id) ?? { status: "REVIEW", received: null, outstanding: null, reason: "票款关系待核，当前范围内无法确认" }
  })).filter(r=>r.reconciliation.status!=="SETTLED");
  const overdueRows = aging.items.filter((r) => (r.overdueDays ?? 0) > 0);
  const commissionEntries = commissionRows ?? entries.filter((e) => e.type === "COMMISSION");

  return (
    <div className="mo-finance">
      <PageHeader
        title="财务"
        sub={`${nowSh.y} 年 ${nowSh.m} 月 · 数据截至 ${mmdd(now)} · 金额按财务查看权限范围汇总`}
        actions={
          <div className="flex gap-2"><Link href="/finance/reconciliation" className="text-sm text-primary underline">应收与收款分配</Link>{canExport ? (
            <a href={`/api/finance/export${range ? `?days=${range}` : ""}`} className="text-sm text-primary underline">导出流水</a>
          ) : null}</div>
        }
      />

      <div className="kpi-grid">
        <MetricCard
          label={stats.ledgerReady?"本月律师费实收":"本月实收"}
          value={yuan(stats.monthlyReceived)}
          trend={monthGrowth === null ? null : { tone: monthGrowth >= 0 ? "up" : "down", text: `${monthGrowth >= 0 ? "↑" : "↓"} ${Math.abs(monthGrowth)}%` }}
          sub={`已确认 ${stats.monthConfirmedCount} 笔${stats.monthRefundAmount ? ` · 含退款冲正 -${yuan(stats.monthRefundAmount)}` : ""}${stats.monthPendingCount ? ` · 待确认 ${stats.monthPendingCount} 笔 ${yuan(stats.monthPendingAmount)}（未计入）` : ""}`}
        />
        <MetricCard
          label="应收余额"
          value={yuan(aging.totalOutstanding)}
          trend={stats.writeOffRate != null ? { tone: "info", text: `本月新应收已核销 ${stats.writeOffRate}%` } : { tone: "info", text: `${aging.matterCount} 个案件` }}
          sub={`按应收单核销口径 · 含未到期 ${yuan(aging.buckets[0].amount)}${stats.writeOffRate != null ? ` · ${aging.matterCount} 个案件` : ""}`}
        />
        <MetricCard
          label="逾期未回款"
          hot={aging.overdueAmount > 0}
          value={yuan(aging.overdueAmount)}
          trend={worst ? { tone: "down", text: `超期 ${worst.overdueDays} 天` } : { tone: "up", text: "无逾期" }}
          sub={worst ? `${worst.matter.clientName ?? worst.matter.title} · ${worst.title} ${worst.dueDate ? `${mmdd(worst.dueDate)} 到期` : ""}` : "已明确到期日的应收暂无逾期"}
        />
        <MetricCard label={stats.ledgerReady?"本年律师费实收":"本年已确认收款"} value={yuan(stats.yearlyReceived)} sub={stats.ledgerReady?"已确认净实收；不含代收及代垫回收":"当前账面收款"} />
      </div>

      <div className="fin-tabs">
        <Tabs activeKey={tab} onChange={key => setTab(key as Tab)}
          tabList={[
            { itemKey: "ledger", tab: "收付流水" },
            { itemKey: "invoices", tab: <>开票管理{stats.pendingInvoiceCount > 0 && <span className="ml-1">{stats.pendingInvoiceCount}</span>}</> },
            { itemKey: "commission", tab: "律师分成" },
            { itemKey: "aging", tab: <>应收账龄{overdueRows.length > 0 && <span className="ml-1">{overdueRows.length}</span>}</> }
          ]}
        />
      </div>

      {tab === "ledger" ? (
        <>
          <div className="fin-grid">
            <RevenueChart data={monthly} height={190} />
            <div className="card">
              <div className="panel-head">
                <div className="panel-title">
                  <FileText className="ic" strokeWidth={1.8} />
                  开票进度
                </div>
                <Button htmlType="button" className="t-sm t-mute" onClick={() => setTab("invoices")} theme="borderless" type="tertiary">开票管理 →</Button>
              </div>
              {invoiceRows.length === 0 && overdueRows.length === 0 ? (
                <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无开票申请</div></div>
              ) : (
                <>
                  {invoiceRows.slice(0, overdueRows.length ? 3 : 4).map((r) => (
                    <div key={r.id} className="inv-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="inv-title truncate">{r.matter?.title ?? r.buyerName ?? "无关联案件开票"}{r.title ? ` · ${r.title}` : ""}</div>
                        <div className="inv-meta truncate">
                          {yuan(r.amount)} · {r.invoiceType === "SPECIAL" ? "专票" : "普票"} · {r.status === "ISSUED" ? `${r.issuedAt ? mmdd(r.issuedAt) : ""} 已开出${r.invoiceNo ? ` ${r.invoiceNo}` : ""}` : invoiceRequestStatusLabel[r.status]}
                        </div>
                      </div>
                      <SemiTag size="small" color={r.status === "ISSUED" ? "green" : r.status === "REJECTED" ? "red" : "teal"}>{r.status === "ISSUED" ? "已开票" : r.status === "REJECTED" ? "已驳回" : "待处理"}</SemiTag>
                    </div>
                  ))}
                  {overdueRows.slice(0, 1).map((r) => (
                    <div key={r.id} className="inv-row" style={{ background: "var(--semi-color-danger-light-default)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="inv-title truncate">{r.matter.clientName ?? r.matter.title} · {r.title}</div>
                        <div className="inv-meta">{yuan(r.outstanding)} · 逾期 {r.overdueDays} 天未回款</div>
                      </div>
                      <Button htmlType="button" onClick={() => setTab("aging")} theme="borderless" type="danger" size="small">催收跟进</Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {pendingReceipts.length > 0 ? (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="panel-head flex-wrap">
                <div className="panel-title">
                  <Clock3 className="ic" strokeWidth={1.8} />
                  待确认实收 <span className="mo-count">{pendingReceipts.length}</span>
                  <span className="t-xs t-mute" style={{ fontWeight: 400 }}>
                    合计 {yuan(pendingReceipts.reduce((s, e) => s + e.amount, 0))} · 确认后才计入已实收并派生分成
                  </span>
                </div>
              </div>
              <div className="mo-scroll-x">
                <Table<(typeof pendingReceipts)[number]>
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={pendingReceipts}
                  scroll={{ x: 880 }}
                  tableLayout="fixed"
                  columns={[
                    { title: "日期", width: 76, key: "column1", render: (_, e) => <span className="mono whitespace-nowrap">{mmdd(e.occurredAt)}</span> },
                    { title: "案件 / 事项", key: "column2", render: (_, e) => <Link href={matterHref(e.matter)} className="block min-w-0 no-underline hover:text-[var(--semi-color-primary-active)]">
                            <div className="fee-matter truncate">{e.matter.title}{e.note ? ` · ${e.note}` : ""}</div>
                            <div className="fee-meta truncate">{e.matter.internalCode}{e.invoiceNo ? ` · 发票 ${e.invoiceNo}` : ""}{e.method ? ` · ${e.method}` : ""}</div>
                          </Link> },
                    { title: "付款方", width: 170, key: "column3", render: (_, e) => <span className="truncate" title={e.payerOrPayee ?? undefined}>{e.payerOrPayee ?? <span className="t-faint">—</span>}</span> },
                    { title: "登记金额", width: 132, align: "right", key: "column4", render: (_, e) => <span className="whitespace-nowrap"><>+{yuan(e.amount, 2)}</></span> },
                    { title: "登记人", width: 72, key: "column5", render: (_, e) => <span className="truncate whitespace-nowrap">{e.recordedBy.name}</span> },
                    { title: "操作", width: canConfirmReceipt ? 150 : 84, key: "column6", render: (_, e) => canConfirmReceipt ? (
                            <div className="flex items-center gap-1.5">
                              <Button htmlType="button"  disabled={busyId === e.id} onClick={() => void confirmOne(e.id)} size="small" theme="solid" type="primary">确认到账</Button>
                              <Button htmlType="button"  disabled={busyId === e.id} onClick={() => void rejectOne(e.id)} size="small" theme="borderless" type="tertiary">退回</Button>
                            </div>
                          ) : (
                            <SemiTag size="small" color="amber">待确认到账</SemiTag>
                          ) },
                  ]}
                />
              </div>
            </div>
          ) : null}

          <div className="card" style={{ overflow: "hidden" }}>
            <div className="panel-head flex-wrap">
              <div className="panel-title">
                <DollarSign className="ic" strokeWidth={1.8} />
                收付流水 <span className="mo-count">{filtered.length}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={q} onChange={setQ} placeholder="按案件、对方户名搜索" aria-label="搜索流水" prefix={<Search size={16} />} style={{ width: 240 }} />
                <Select<Entry["type"] | "all">
                  value={typeFilter ?? "all"}
                  optionList={[
                    { value: "all", label: "全部" },
                    ...(Object.keys(TYPE_META) as Entry["type"][]).map(value => ({ value, label: TYPE_META[value].label })),
                  ]}
                  onChange={value => setTypeFilter(typeof value === "string" && value !== "all" ? value : undefined)}
                  insetLabel="类型"
                  insetLabelId="finance-type-label"
                  aria-labelledby="finance-type-label"
                  motion={false}
                  style={{ minWidth: 130 }}
                />
                <Select<string>
                  value={range ?? "all"}
                  optionList={[
                    { value: "all", label: "全部" },
                    { value: "30", label: "近 30 天" },
                    { value: "90", label: "近 90 天" },
                    { value: "365", label: "近一年" },
                  ]}
                  onChange={value => setRange(typeof value === "string" && value !== "all" ? value : undefined)}
                  insetLabel="期间"
                  insetLabelId="finance-range-label"
                  aria-labelledby="finance-range-label"
                  motion={false}
                  style={{ minWidth: 130 }}
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">没有匹配的收付记录</div><div className="mo-empty-desc">调整期间或类型筛选；收付在案件详情或点击「登记收付」录入。</div></div>
            ) : (
              <div className="mo-scroll-x">
                <Table<(typeof filtered)[number]>
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={filtered}
                  scroll={{ x: 1000 }}
                  tableLayout="fixed"
                  columns={[
                    { title: "日期", width: 76, key: "column1", render: (_, e) => <span className="mono whitespace-nowrap">{mmdd(e.occurredAt)}</span> },
                    { title: "案件 / 事项", key: "column2", render: (_, e) => <Link href={matterHref(e.matter)} className="block min-w-0 no-underline hover:text-[var(--semi-color-primary-active)]">
                              <div className="fee-matter truncate">{e.matter.title}{e.note ? ` · ${e.note}` : ""}</div>
                              <div className="fee-meta truncate">{e.matter.internalCode}{e.moneyKind ? ` · ${moneyKindLabels[e.moneyKind]}` : ""}{e.invoiceNo ? ` · 发票 ${e.invoiceNo}` : ""}{e.beneficiaryUser ? ` · 分成给 ${e.beneficiaryUser.name}` : ""}</div>
                            </Link> },
                    { title: "类型", width: 72, key: "column3", render: (_, e) => { const meta = TYPE_META[e.type]; return (<SemiTag size="small" color={meta.color}>{meta.label}</SemiTag>); } },
                    { title: "对方户名", width: 170, key: "column4", render: (_, e) => <span className="truncate" title={e.payerOrPayee ?? undefined}>{e.payerOrPayee ?? <span className="t-faint">—</span>}</span> },
                    { title: "金额", width: 132, align: "right", key: "column5", render: (_, e) => { const meta = TYPE_META[e.type]; return (<>{meta.sign}{yuan(e.amount, 2)}</>); } },
                    { title: "方式", width: 84, key: "column6", render: (_, e) => <span className="truncate whitespace-nowrap">{e.method ?? <span className="t-faint">—</span>}</span> },
                    { title: "经手", width: 64, key: "column7", render: (_, e) => <span className="truncate whitespace-nowrap">{e.recordedBy.name}</span> },
                    { title: "状态", width: 80, key: "column8", render: (_, e) => e.type === "RECEIVED" && e.confirmState === "PENDING" ? (
                              <SemiTag size="small" color="amber"><span title="已登记，等待财务管理人员确认到账">待确认</span></SemiTag>
                            ) : stats.ledgerReady ? (
                              <SemiTag size="small" color="green"><span title="已入账记录不可直接删除">已入账</span></SemiTag>
                            ) : e.confirmed ? (
                              <SemiTag size="small" color="green"><span title="关联已签署合同或已登记发票号，不可物理删除">受保护</span></SemiTag>
                            ) : (
                              <SemiTag size="small" color="grey"><span title="尚未关联已签署合同或发票号">可更正</span></SemiTag>
                            ) },
                  ]}
                />
              </div>
            )}
            <div className="panel-foot t-xs t-mute">{stats.ledgerReady?"待确认实收不计入统计；已入账记录不可直接删除。律师费与代收、代垫回收分别统计。":"已确认记录受保护：关联已签署合同或已登记发票号的收付不可物理删除，更正需走关联冲正并留痕"}</div>
          </div>
        </>
      ) : null}

      {tab === "invoices" ? (
        <div className="card">
          <div className="panel-head">
            <div className="panel-title">
              <FileText className="ic" strokeWidth={1.8} />
              开票管理
            </div>
            <Button htmlType="button" onClick={() => setInvoiceCreateOpen(true)}  size="small" theme="solid" type="primary">
              <Plus />
              新建开票申请
            </Button>
          </div>
          <div className="panel-body">
            <InvoiceManagementSection requests={invoiceRequests} canApprove={canApproveInvoice} />
          </div>
        </div>
      ) : null}

      {tab === "invoices" && issuedUnpaid.length > 0 ? (
        <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
          <div className="panel-head flex-wrap">
            <div className="panel-title">
              <Clock3 className="ic" strokeWidth={1.8} />
              已开票待收款 / 待核 <span className="mo-count">{issuedUnpaid.length}</span>
              <span className="t-xs t-mute" style={{ fontWeight: 400 }}>
                {stats.ledgerReady?"按发票金额关联；未关联金额不直接等于客户欠款":"部分回款仍保留；票款关系不明确时不认定结清"}
              </span>
            </div>
          </div>
          <div className="mo-scroll-x">
            <Table<(typeof issuedUnpaid)[number]>
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={issuedUnpaid}
              scroll={{ x: 820 }}
              tableLayout="fixed"
              columns={[
                { title: "开票日", width: 76, key: "column1", render: (_, r) => <span className="mono whitespace-nowrap">{r.issuedAt ? mmdd(r.issuedAt) : "—"}</span> },
                { title: "案件 / 抬头", key: "column2", render: (_, r) => <><div className="fee-matter truncate">{r.matter?.title ?? "非案件事项"}</div>
                      <div className="fee-meta truncate">{r.buyerName ?? r.title ?? "—"}</div></> },
                { title: "发票号", width: 190, key: "column3", render: (_, r) => <span className="mono truncate">{r.invoiceNo ?? <span className="t-faint">未登记号码</span>}</span> },
                { title: "开票金额", width: 132, align: "right", key: "column4", render: (_, r) => <span className="whitespace-nowrap">{yuan(r.amount, 2)}</span> },
                { title: "同号已确认款", width: 132, align: "right", key: "column5", render: (_, r) => <span className="whitespace-nowrap">{r.reconciliation.received === null ? "—" : yuan(r.reconciliation.received, 2)}</span> },
                { title: "待收参考金额", width: 132, align: "right", key: "column6", render: (_, r) => <span className="whitespace-nowrap">{r.reconciliation.outstanding === null ? "待核" : yuan(r.reconciliation.outstanding, 2)}</span> },
                { title: "核对状态", width: 240, key: "column7", render: (_, r) => r.reconciliation.reason ?? (r.reconciliation.status === "PARTIAL" ? "部分关联" : "尚未关联已确认收款") },
              ]}
            />
          </div>
        </div>
      ) : null}

      {tab === "commission" ? (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <MetricCard label="我的本月分成" value={yuan(stats.personalMonthly)} sub="本期计提及更正差额；实际支付另行登记" />
            <MetricCard label="我的年度分成" value={yuan(stats.personalYearly)} sub={`${nowSh.y} 年累计`} />
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="panel-head">
              <div className="panel-title">
                <Users className="ic" strokeWidth={1.8} />
                分成流水 <span className="mo-count">{commissionEntries.length}</span>
              </div>
              <span className="t-xs t-mute">分成方案在案件详情「财务明细」中维护</span>
            </div>
            {commissionEntries.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无分成记录</div></div>
            ) : (
              <div className="mo-scroll-x">
                <Table<(typeof commissionEntries)[number]>
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={commissionEntries}
                  scroll={{ x: 720 }}
                  columns={[
                    { title: "日期", key: "column1", render: (_, e) => <span className="mono">{mmdd(e.occurredAt)}</span> },
                    { title: "案件", key: "column2", render: (_, e) => <><Link href={matterHref(e.matter)} className="fee-matter hover:text-[var(--semi-color-primary-active)]">{e.matter.title}</Link><div className="fee-meta">{e.matter.internalCode}</div></> },
                    { title: "受益人", key: "column3", render: (_, e) => e.beneficiaryUser?.name ?? "—" },
                    { title: "金额", align: "right", key: "column4", render: (_, e) => <>{yuan(e.commissionAccrued ?? e.amount, 2)}{e.commissionAccrued!==undefined&&<div className="t-xs t-mute">原计提 {yuan(e.amount,2)} · 净支付 {yuan(e.commissionNetPaid??0,2)} · 待扣回 {yuan(e.commissionRecoverable??0,2)}</div>}</> },
                    { title: "备注", key: "column5", render: (_, e) => <span className="truncate">{e.note ?? "—"}</span> },
                  ]}
                />
              </div>
            )}
          </div>
        </>
      ) : null}

      {tab === "aging" ? (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            {aging.buckets.map((b, i) => (
              <MetricCard key={b.key} label={b.label} hot={i >= 3 && b.amount > 0} value={yuan(b.amount)} sub={`${b.count} 笔`} />
            ))}
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="panel-head">
              <div className="panel-title">
                <Clock3 className="ic" strokeWidth={1.8} />
                未核销应收 <span className="mo-count">{aging.items.length}</span>
              </div>
              <span className="t-xs t-mute">余额 = 应收金额 − 已核销；按到期日排序</span>
            </div>
            {aging.items.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无未核销应收</div></div>
            ) : (
              <div className="mo-scroll-x">
                <Table<(typeof aging.items)[number]>
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={aging.items}
                  onRow={r => { const d = r?.overdueDays ?? 0; return ({ className: d > 30 ? "ledger-overdue" : undefined }); }}
                  scroll={{ x: 760 }}
                  columns={[
                    { title: "到期日", key: "column1", render: (_, r) => <span className="mono">{r.dueDate ? mmdd(r.dueDate) : "未约定"}</span> },
                    { title: "案件 / 应收事项", key: "column2", render: (_, r) => <><Link href={matterHref(r.matter)} className="fee-matter hover:text-[var(--semi-color-primary-active)]">{r.matter.title} · {r.title}</Link><div className="fee-meta">{r.matter.internalCode}</div></> },
                    { title: "客户", key: "column3", render: (_, r) => r.matter.clientName ?? "—" },
                    { title: "未回款", align: "right", key: "column4", render: (_, r) => yuan(r.outstanding, 2) },
                    { title: "账龄", key: "column5", render: (_, r) => { const d = r.overdueDays ?? 0; return (d > 0 ? <SemiTag size="small" color={d > 30 ? "red" : "amber"}>逾期 {d} 天</SemiTag> : <SemiTag size="small" color="grey">未到期</SemiTag>); } },
                  ]}
                />
              </div>
            )}
          </div>
        </>
      ) : null}

      <InvoiceCreateDialog open={invoiceCreateOpen} onOpenChange={setInvoiceCreateOpen} canCreateUnlinkedInvoice={canApproveInvoice} />
      {canWrite ? <RecordFeeLauncher open={recordOpen} onOpenChange={setRecordOpen} /> : null}
    </div>
  );
}
