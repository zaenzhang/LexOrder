"use client";
import { Table, Empty, Tabs, Select, Button, Input, RadioGroup, Notification, Toast } from "@douyinfe/semi-ui";
import {InvoiceAdjustments} from "./invoice-adjustments";
import { ContractWorkspace } from "./contract-workspace";
import { CorrectionWorkspace } from "./correction-workspace";
import { RegistrationWorkspace } from "./registration-workspace";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceDialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/patterns/workspace-dialog";

import { MetricCard } from "@/components/patterns/moan";
import { formatDate } from "@/lib/utils";
import { moneyKindLabels, dueLabels } from "@/lib/finance/ledger-labels";
import { allocateLedger, type getFinanceLedger } from "@/server/finance/ledger-actions";
import { actionErrorMessage } from "@/lib/action-error";
type Data = Awaited<ReturnType<typeof getFinanceLedger>>;
const yuan = (amount: string) => `¥${Number(amount).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

// 2026-09-21 布局收敛（用户反馈页面过长）：原九个区块单列堆叠改为四个页签分区
// （与 /finance 同款 Segmented 视觉），列表默认折叠为少量行、按需展开——
// 待办与登记动作在默认页签，长表不再把操作区推出首屏。
export type LedgerTab = "overview" | "ledger" | "invoices" | "contracts";
const TABLE_LIMIT = 8;
const LIST_LIMIT = 6;

/** 表尾「展开全部 / 收起」——行数超限时折叠展示 */
function ShowMoreFooter({ total, expanded, onToggle }: { total: number; expanded: boolean; onToggle: () => void }) {
  if (total <= TABLE_LIMIT) return null;
  return <div className="pt-2 text-center">
    <Button htmlType="button"  onClick={onToggle} size="small" theme="borderless" type="tertiary">
      {expanded ? "收起" : `展开全部 ${total} 条`}
    </Button>
  </div>;
}

export function LedgerWorkspace({ data, canWrite, canConfirm, canCorrect, canSettle, selectedMatterId, tab = "overview", billingId, createContract = false, returnTo }: { data: Data; canWrite: boolean; canConfirm:boolean; canCorrect:boolean; canSettle:boolean; selectedMatterId?: string; tab?: LedgerTab; billingId?: string; createContract?: boolean; returnTo?: string }) {
  const router = useRouter();
  function navigate(nextTab: LedgerTab, nextMatter = selectedMatterId, keepReturn = true) {
    const params = new URLSearchParams({ tab: nextTab });
    if (nextMatter) params.set("matterId", nextMatter);
    if (keepReturn && returnTo) params.set("returnTo", returnTo);
    router.push(`/finance/reconciliation?${params}`);
  }
  const [showAllReceivables, setShowAllReceivables] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [payment, setPayment] = useState<Data["payments"][number] | null>(null);
  const [kind, setKind] = useState<"RECEIVABLE" | "INVOICE">("RECEIVABLE");
  const [amounts, setAmounts] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const matters = new Map(data.matters.map(m => [m.id,m]));
  const matterName = (id: string) => `${matters.get(id)?.internalCode ?? ""} · ${matters.get(id)?.title ?? "案件"}`;
  // 归档案件默认只读；本案指定的财务收尾人（tailWritable）仍可分配收款/关联票款
  const writable = (id: string) => data.ready && (matters.get(id)?.status !== "ARCHIVED" || matters.get(id)?.tailWritable === true);
  const startAllocation = (value: Data["payments"][number]) => { setPayment(value); setKind("RECEIVABLE"); setAmounts({}); };
  const targets = !payment ? [] : kind === "RECEIVABLE"
    ? data.receivables.filter(r => r.matterId === payment.matterId && r.moneyKind === payment.moneyKind && r.status !== "CANCELLED" && Number(r.outstanding)>0).map(r => ({id:r.id,title:r.title,remaining:r.outstanding,dueAt:r.dueDate?new Date(r.dueDate).getTime():Number.MAX_SAFE_INTEGER})).sort((a,b)=>a.dueAt-b.dueAt)
    : data.invoices.filter(i => i.matterId === payment.matterId && Number(i.outstanding)>0).map(i => ({id:i.id,title:`发票 ${i.invoiceNo ?? "未填写号码"}`,remaining:i.outstanding}));
  async function submitAllocation(event: React.FormEvent) {
    event.preventDefault(); if (!payment) return; setBusy(true);
    try {
      const result = await allocateLedger({ paymentId: payment.id, revision: payment.revision, kind, items: targets.filter(t => amounts[t.id]?.trim()).map(t => ({targetId:t.id,amount:amounts[t.id]})) });
      if(!result.ok)throw new Error(result.message);
      Toast.success(kind === "RECEIVABLE" ? "已分配收款" : "已关联票款"); setPayment(null); router.refresh();
    } catch(e) { Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "分配失败", duration: 6 }); } finally { setBusy(false); }
  }
  if (!data.ready) return <p className="rounded-xl border bg-card p-5 text-sm">应收与收款分配尚未启用，请待财务流程更新完成后使用。</p>;

  const openReceivables = data.receivables.filter(r => r.status !== "CANCELLED" && Number(r.outstanding) > 0);
  const unallocatedPayments = data.payments.filter(p => Number(p.unallocated) > 0);
  const receivableRows = showAllReceivables ? data.receivables : data.receivables.slice(0, TABLE_LIMIT);
  const paymentRows = showAllPayments ? data.payments : data.payments.slice(0, TABLE_LIMIT);
  const invoiceRows = showAllInvoices ? data.invoices : data.invoices.slice(0, LIST_LIMIT);

  return <>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label id="ledger-matter-label" htmlFor="ledger-matter">案件范围</label>
      <Select<string> id="ledger-matter" aria-labelledby="ledger-matter-label" value={selectedMatterId ?? ""} onChange={value => (e => navigate(tab, e, false))(String(value ?? ""))} style={{ width: "100%" }} motion={false}>
        <Select.Option value="">全部可见案件</Select.Option>{data.matters.map(m => <Select.Option key={m.id} value={m.id}>{m.internalCode} · {m.title}</Select.Option>)}
      </Select>
    </div>

    <div className="fin-tabs">
      <Tabs activeKey={tab} onChange={key => navigate(key as LedgerTab)}
        tabList={[
          { itemKey: "overview", tab: <>总览与登记{data.pending.length > 0 && <span className="ml-1">{data.pending.length}</span>}</> },
          { itemKey: "ledger", tab: <>应收与收款{openReceivables.length > 0 && <span className="ml-1">{openReceivables.length}</span>}</> },
          { itemKey: "invoices", tab: "发票关联" },
          { itemKey: "contracts", tab: "合同与更正" }
        ]}
      />
    </div>

    {tab === "overview" ? <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="应收余额" value={yuan(data.summary.outstanding)} sub="应收及已确认调整 − 有效核销" />
        <MetricCard label="净收款" value={yuan(data.summary.netReceived)} sub="已确认收款 − 已确认退款" />
        <MetricCard label="律师费实收" value={yuan(data.summary.lawyerFeeReceived)} sub={`代收款另计 ${yuan(data.summary.clientFundsReceived)}`} />
        <MetricCard label="未分配收款" value={yuan(data.summary.unallocated)} sub="尚未核销应收；票款单独关联" />
      </div>
      <RegistrationWorkspace data={data} canWrite={canWrite} canConfirm={canConfirm} selectedMatterId={selectedMatterId} returnTo={returnTo} />
    </> : null}

    {tab === "ledger" ? <>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 font-semibold">应收计划与余额</h2>
        <p className="mb-3 text-xs text-muted-foreground">未结清 {openReceivables.length} 项 · 共 {data.receivables.length} 条{data.receivables.length > TABLE_LIMIT && !showAllReceivables ? ` · 当前显示前 ${TABLE_LIMIT} 条` : ""}</p>
        <div className="overflow-x-auto"><Table<(typeof receivableRows)[number]>
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={receivableRows}
          scroll={{ x: 640 }}
          empty={<Empty description={"暂无应收计划"} />}
          columns={[
            { title: "案件 / 应收", key: "column1", render: (_, r) => <><div>{r.title}</div><div className="text-xs text-muted-foreground">{matterName(r.matterId)}</div></> },
            { title: "款项性质", key: "column2", render: (_, r) => moneyKindLabels[r.moneyKind] },
            { title: "原额 / 调整", align: "right", key: "column3", render: (_, r) => <>{yuan(r.amount)} / {yuan(r.adjustmentAmount)}</> },
            { title: "待收", align: "right", key: "column4", render: (_, r) => yuan(r.outstanding) },
            { title: "到期情况", key: "column5", render: (_, r) => <>{r.status === "CANCELLED" ? "已作废" : r.status === "SETTLED" ? "已结清" : dueLabels[r.dueBucket]}{r.dueDate ? <div className="text-xs">到期日 {formatDate(r.dueDate)}</div> : null}{r.dueCondition ? <div className="text-xs">{r.dueCondition}</div> : null}</> },
          ]}
        />
        <ShowMoreFooter total={data.receivables.length} expanded={showAllReceivables} onToggle={() => setShowAllReceivables(!showAllReceivables)} /></div>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 font-semibold">实收与分配</h2>
        <p className="mb-3 text-xs text-muted-foreground">未核销 {unallocatedPayments.length} 笔 · 共 {data.payments.length} 条{data.payments.length > TABLE_LIMIT && !showAllPayments ? ` · 当前显示前 ${TABLE_LIMIT} 条` : ""}</p>
        <div className="overflow-x-auto"><Table<(typeof paymentRows)[number]>
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={paymentRows}
          scroll={{ x: 640 }}
          empty={<Empty description={"暂无实收记录；待确认款不列入此表"} />}
          columns={[
            { title: "案件 / 日期", key: "column1", render: (_, p) => <>{matterName(p.matterId)}<div className="text-xs text-muted-foreground">{formatDate(p.occurredAt)}</div></> },
            { title: "款项性质", key: "column2", render: (_, p) => moneyKindLabels[p.moneyKind] },
            { title: "原始收款 / 退款", align: "right", key: "column3", render: (_, p) => <>{yuan(p.amount)} / {yuan(p.refundedAmount)}</> },
            { title: "未核销", align: "right", key: "column4", render: (_, p) => yuan(p.unallocated) },
            { title: "操作", key: "column5", render: (_, p) => canWrite && writable(p.matterId) ? <Button  onClick={() => startAllocation(p)} size="small" theme="outline" type="tertiary" htmlType="button">分配收款</Button> : "仅查看" },
          ]}
        />
        <ShowMoreFooter total={data.payments.length} expanded={showAllPayments} onToggle={() => setShowAllPayments(!showAllPayments)} /></div>
      </section>
    </> : null}

    {tab === "invoices" ? <>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">发票金额关联</h2>
        <p className="mb-3 text-xs text-muted-foreground">这里仅按已建立的金额关系计算；未关联金额不直接等于客户欠款。共 {data.invoices.length} 张{data.invoices.length > LIST_LIMIT && !showAllInvoices ? ` · 当前显示前 ${LIST_LIMIT} 张` : ""}</p>
        <ul className="divide-y">{invoiceRows.map(i => <li key={i.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{matterName(i.matterId!)} · {i.invoiceNo ?? "未填写发票号"}</span><span>有效票面 {yuan(i.amount)} · 已关联 {yuan(i.linked)} · 未关联 {yuan(i.outstanding)}</span></li>)}{!data.invoices.length ? <li className="py-3 text-sm text-muted-foreground">暂无已开具发票</li> : null}</ul>
        {data.invoices.length > LIST_LIMIT ? (
          <div className="pt-2 text-center">
            <Button htmlType="button"  onClick={() => setShowAllInvoices(!showAllInvoices)} size="small" theme="borderless" type="tertiary">
              {showAllInvoices ? "收起" : `展开全部 ${data.invoices.length} 张`}
            </Button>
          </div>
        ) : null}
      </section>
      <InvoiceAdjustments data={data} canCorrect={canCorrect}/>
    </> : null}

    {tab === "contracts" ? <>
      <ContractWorkspace key={`${selectedMatterId ?? "all"}:${billingId ?? "list"}:${createContract}`} data={data} canWrite={canWrite} canCorrect={canCorrect} selectedMatterId={selectedMatterId} billingId={billingId} createContract={createContract} returnTo={returnTo} />
      {!billingId && !createContract && <CorrectionWorkspace data={data} canWrite={canWrite} canCorrect={canCorrect} canSettle={canSettle} />}
    </> : null}

    <WorkspaceDialog open={Boolean(payment)} onOpenChange={open => { if (!open && !busy) setPayment(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>分配收款</DialogTitle><DialogDescription>同一笔款可核销应收，也可关联发票；两个维度独立计算可用余额。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitAllocation}>
      <RadioGroup disabled={busy} options={[{value:"RECEIVABLE",label:"核销应收"},...(payment?.moneyKind === "LAWYER_FEE" ? [{value:"INVOICE",label:"关联发票"}] : [])]} value={kind} onChange={event => (v => {setKind(v as typeof kind);setAmounts({});})(String(event.target.value))} type="button" />
      {targets.length ? <>
        {/* M-3a（D 批）：生成分配建议→预览→确认——按最早到期自动填满（同案同性质），未分配余额保持可见 */}
        <Button htmlType="button" disabled={busy} onClick={() => {
          let left = Number(payment!.unallocated);
          const next: Record<string,string> = {};
          for (const t of targets) {
            const take = Math.min(left, Number(t.remaining));
            if (take > 0) { next[t.id] = take.toFixed(2); left = Math.round((left - take) * 100) / 100; }
          }
          setAmounts(next);
          Toast.info(left > 0 ? `已按到期顺序填满，剩余 ¥${left.toFixed(2)} 未分配（无更多未结清应收）` : "已按最早到期顺序填满本次收款");
        }} size="small" theme="outline" type="tertiary">按最早到期自动填满</Button>
        {targets.map(t => <div key={t.id}><label htmlFor={`amount-${t.id}`}>{t.title} · 剩余 {yuan(t.remaining)}</label><Input disabled={busy} id={`amount-${t.id}`} inputMode="decimal" placeholder="本次分配金额；不分配可留空" value={amounts[t.id] ?? ""} onChange={e => setAmounts({...amounts,[t.id]:e})} /></div>)}
      </> : <p className="text-sm text-muted-foreground">暂无同案同类款项的未结清应收或发票。</p>}
      <Button htmlType="submit"  disabled={busy || !targets.length} theme="solid" type="primary">{busy ? "保存中…" : "确认分配"}</Button>
    </form></DialogContent></WorkspaceDialog>
  </>;
}
