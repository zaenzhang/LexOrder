import { clientIdTypeLabel } from "@/lib/clients/person-id";
import { clientListReturnHref } from "@/lib/clients/navigation";
import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Users, CreditCard, UserRound } from "lucide-react";
import { getClientById, getClientFinanceSummary } from "@/server/clients/actions";
import { getClientInsights } from "@/server/clients/insights";
import { getClientRelationship } from "@/server/clients/relationship-actions";
import { editableClientIds } from "@/server/clients/master-access";
import { ClientRelationshipPanel } from "./_components/client-relationship-panel";
import { ClientMattersPanel } from "./_components/client-matters-panel";
import { ClientHistoryPanel } from "./_components/client-history-panel";
import { ClientDetailTabs } from "./_components/client-detail-tabs";
import { getClientHistoryPage } from "@/server/clients/history-actions";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { clientTypeLabel, cooperationStatusLabel, genderLabel } from "@/lib/enums";
import { avatarTone } from "@/lib/ui/moan-tones";
import { FieldGrid, FieldItem, InitialAvatar } from "@/components/patterns/moan";
import { ClientEditButton } from "./_components/client-edit-button";
import { AddContactButton, MergeBanner } from "./_components/client-detail-parts";

const COOP_BADGE: Record<string, string> = { POTENTIAL: "b-slate", NEGOTIATING: "b-amber", SIGNED: "b-teal", TERMINATED: "b-bronze" };

const yuan = (n: number) => `¥${Math.round(n).toLocaleString("zh-CN")}`;
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : "—");

export default async function ClientDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const client = await getClientById(id).catch(() => null);
  if (!client) notFound();
  const session = await requireSession("clients.read");
  const canReadFinance = hasCustomPermission(session.user, "finance.read");
  const canWrite = (await editableClientIds(session.user, [id])).includes(id);
  const canMerge = canWrite;
  const [finance, insights, relationship, history] = await Promise.all([
    canReadFinance ? getClientFinanceSummary(id) : Promise.resolve(null),
    getClientInsights(id),
    getClientRelationship(id),
    getClientHistoryPage({ clientId: id })
  ]);

  const isIndividual = client.type === "INDIVIDUAL";
  const activeCount = insights.matterPage.activeCount;
  const idNumber = decryptIdNumber(client.idNumber);
  // 回款进度分子分母同口径：有应收时按「已核销/应收」（与案件详情 allocated/receivable 一致），
  // 无应收时退回「累计实收/合同总额」——不再把含未核销的实收直接除以应收
  const paidRate = finance
    ? finance.receivable > 0
      ? Math.min(100, Math.round((finance.allocated / finance.receivable) * 100))
      : finance.contractTotal > 0
        ? Math.min(100, Math.round((finance.received / finance.contractTotal) * 100))
        : 0
    : 0;
  const intakeHref = `/matters?tab=intake&new=1&clientId=${client.id}`;

  return (
    <div className="mo-client">
      <Link href={clientListReturnHref(query.returnTo)} className="mo-back">
        <ChevronLeft className="h-3.5 w-3.5" />
        返回客户列表
      </Link>

      <div className="card client-hero">
        <div className="ch-top flex-wrap">
          <div className="ch-logo">{client.name.trim().charAt(0) || "客"}</div>
          <div style={{ minWidth: 0 }} className="flex-1">
            <h1 className="ch-name truncate" title={client.name}>{client.name}</h1>
            <div className="ch-badges">
              <span className="badge b-white">{clientTypeLabel[client.type]}</span>
              <span className={`badge ${COOP_BADGE[client.cooperationStatus] ?? "b-white"}`}><span className="bdot" />{cooperationStatusLabel[client.cooperationStatus]}</span>
            </div>
          </div>
        </div>
      </div>

      <ClientDetailTabs
        key={client.id}
        initialTab={typeof query.tab === "string" ? query.tab : undefined}
        defaultTab={relationship ? "followups" : "profile"}
        sections={{
          followups: <ClientRelationshipPanel clientId={client.id} view={relationship} />,
          matters: <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="t-sm t-mute">在办 {activeCount} 件</span>
              {hasCustomPermission(session.user, "intakes.create") ? <Link href={intakeHref} className="btn btn-secondary btn-sm">为此客户新建收案</Link> : null}
            </div>
            <div className={`grid items-start gap-3.5 ${finance ? "xl:grid-cols-[minmax(0,1fr)_296px]" : "grid-cols-1"}`}>
              <ClientMattersPanel clientId={client.id} initial={insights.matterPage} />
              {finance ? <section className="card min-w-0" aria-labelledby="client-finance-title">
                <div className="panel-head"><h2 id="client-finance-title" className="panel-title"><CreditCard className="ic" strokeWidth={1.8} />财务往来</h2></div>
                <div className="panel-body">
                  <div className="flex justify-between py-1"><span className="t-sm t-mute">合同总额</span><span className="num-md">{yuan(finance.contractTotal)}</span></div>
                  <div className="flex justify-between py-1"><span className="t-sm t-mute">累计实收</span><span className="num-md" style={{ color: "var(--green)" }}>{yuan(finance.received)}</span></div>
                  <div className="flex justify-between py-1"><span className="t-sm t-mute">待回款</span><span className="num-md" style={{ color: finance.pending ? "var(--amber)" : undefined }}>{yuan(finance.pending)}</span></div>
                  <div className="progress mt-2.5"><div className="progress-fill" style={{ width: `${paidRate}%` }} /></div>
                  <div className="mt-1.5 flex justify-between"><span className="t-xs t-mute">回款进度</span><span className="num-sm t-mute">{paidRate}%</span></div>
                </div>
              </section> : null}
            </div>
          </div>,
          history: <ClientHistoryPanel clientId={client.id} initial={history} />,
          profile: <div className="space-y-3.5">
            {canMerge && insights.suspects.length > 0 ? <MergeBanner keepId={client.id} keepName={client.name} suspects={insights.suspects} canMerge={canMerge} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              {canWrite ? <ClientEditButton client={{ ...client, idNumber: idNumber || null }} /> : null}
              <Link href={`/conflicts?name=${encodeURIComponent(client.name)}`} className="btn btn-secondary btn-sm">冲突预检</Link>
              {canMerge && insights.suspects.length === 0 ? <MergeBanner keepId={client.id} keepName={client.name} suspects={[]} canMerge={canMerge} /> : null}
            </div>
            <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
              <section className="card min-w-0" aria-labelledby="client-profile-title">
                <div className="panel-head"><h2 id="client-profile-title" className="panel-title"><UserRound className="ic" strokeWidth={1.8} />{isIndividual ? "个人信息" : "工商信息"}</h2></div>
                <div className="panel-body">
                  <FieldGrid cols={2}>
                    <FieldItem label="客户编号" mono>{client.internalCode || "—"}</FieldItem>
                    <FieldItem label="建档日期" mono>{ymd(client.createdAt)}</FieldItem>
                    <FieldItem label={isIndividual ? (!client.idType || client.idType === "ID_CARD" ? "身份证号" : clientIdTypeLabel[client.idType]) : "统一社会信用代码"} mono wide>{idNumber || "未登记"}</FieldItem>
                    <FieldItem label="客户来源">{client.source || "—"}</FieldItem>
                    <FieldItem label="所属行业">{client.industry || "—"}</FieldItem>
                    {isIndividual ? <FieldItem label="性别">{client.gender ? genderLabel[client.gender] : "—"}</FieldItem> : <FieldItem label="法定代表人">{client.legalRep || "—"}</FieldItem>}
                    {isIndividual ? <FieldItem label="民族">{client.ethnicity || "—"}</FieldItem> : null}
                    <FieldItem label="联系电话" mono>{client.phone || "—"}</FieldItem>
                    <FieldItem label="邮箱">{client.email || "—"}</FieldItem>
                    <FieldItem label={isIndividual ? "住所地" : "注册地"} wide>{client.address || "—"}</FieldItem>
                    {client.tags.length > 0 ? <FieldItem label="标签" wide><span className="flex flex-wrap gap-1.5">{client.tags.map(tag => <span key={tag} className="badge b-white">{tag}</span>)}</span></FieldItem> : null}
                    {client.notes ? <FieldItem label="备注" wide><span className="whitespace-pre-wrap">{client.notes}</span></FieldItem> : null}
                  </FieldGrid>
                  {insights.source ? <details className="mt-4 border-t border-[var(--bd-hair)] pt-3 text-xs text-[var(--t-muted)]">
                    <summary className="cursor-pointer">来源渠道统计</summary>
                    <p className="mt-2">可见客户中，同渠道 {insights.source.sameSourceClients} 家，占 {Math.round((insights.source.sameSourceClients / Math.max(1, insights.source.totalClients)) * 100)}%。</p>
                  </details> : null}
                </div>
              </section>
              <section className="card min-w-0 overflow-hidden" aria-labelledby="client-contacts">
                <div className="panel-head flex-wrap gap-2">
                  <h2 id="client-contacts" className="panel-title"><Users className="ic" strokeWidth={1.8} />联系人 <span className="badge b-white">{client.contacts.length}</span></h2>
                  {canWrite ? <AddContactButton clientId={client.id} /> : null}
                </div>
                {client.contacts.length === 0 ? <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无联系人</div></div> : client.contacts.map(c => (
                  <div key={c.id} className="contact">
                    <InitialAvatar name={c.name} tone={c.isPrimary ? "teal" : avatarTone(c.name)} />
                    <div className="min-w-0 flex-1">
                      <div className="ct-name flex flex-wrap items-center gap-1.5">
                        {c.name}
                        {c.isPrimary ? <span className="badge b-teal text-[10px]">主要联系人</span> : null}
                        {c.title ? <span className="badge b-white text-[10px]">{c.title}</span> : null}
                      </div>
                      <div className="ct-meta flex flex-wrap items-center gap-x-1.5 break-all">
                        {c.phone ? <span className="mono">{c.phone}</span> : null}
                        {c.email ? <span>{c.email}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        }}
      />
    </div>
  );
}
