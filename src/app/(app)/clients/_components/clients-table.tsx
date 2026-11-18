"use client";

import { Button } from "@douyinfe/semi-ui";

import Link from "next/link";
import { Building2, User, Briefcase, Pencil, Phone, Mail } from "lucide-react";
import type { Client, ClientCooperationStatus, ClientType, Contact } from "@prisma/client";
import { clientTypeLabel, cooperationStatusLabel } from "@/lib/enums";

/** 墨案：合作状态 → 徽章 + 案卷脊（teal=签约 / amber=洽谈 / slate=潜在 / bronze=终止） */
const COOP_META: Record<ClientCooperationStatus, { badge: string; spine: string }> = {
  POTENTIAL: { badge: "b-slate", spine: "slate" },
  NEGOTIATING: { badge: "b-amber", spine: "amber" },
  SIGNED: { badge: "b-teal", spine: "teal" },
  TERMINATED: { badge: "b-bronze", spine: "bronze" }
};

function CoopBadge({ status }: { status: ClientCooperationStatus }) {
  return (
    <span className={`badge ${COOP_META[status].badge}`}>
      <span className="bdot" aria-hidden />
      {cooperationStatusLabel[status]}
    </span>
  );
}

type ClientRow = Client & {
  contacts: Contact[];
  _count: { matters: number; intakes: number };
};

function TypeBadge({ type }: { type: ClientType }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  const Icon = type === "INDIVIDUAL" ? User : type === "COMPANY" ? Building2 : Briefcase;
  return (
    <span className="badge b-white !gap-1">
      <Icon className={cls} strokeWidth={1.8} />
      {clientTypeLabel[type]}
    </span>
  );
}

export function ClientsTable({
  items,
  onEdit,
  canCreate,
  editableClientIds,
  loadingClientId,
  returnTo = "/clients"
}: {
  items: ClientRow[];
  onEdit: (c: ClientRow, trigger: HTMLButtonElement) => void;
  canCreate: boolean;
  editableClientIds: string[];
  loadingClientId: string | null;
  returnTo?: string;
}) {
  const canEditAny = editableClientIds.length > 0;
  const detailHref = (id: string) => `/clients/${id}${returnTo === "/clients" ? "" : `?${new URLSearchParams({ returnTo }).toString()}`}`;
  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="mo-empty-title">没有符合条件的客户</div>
        <div className="mo-empty-desc">{canCreate ? "调整筛选条件，或点击右上角「新建客户」建档；收案时关联的委托方也会自动出现在这里。" : "调整筛选条件。"}</div>
      </div>
    );
  }

  return (
    <>
      <div className="mo-scroll-x hidden md:block">
        <table className="mo-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: "30%", paddingLeft: 20 }}>客户</th>
              <th>类型</th>
              <th>合作状态</th>
              <th>联系方式</th>
              <th>主要联系人</th>
              <th className="num">案件 / 收案</th>
              {canEditAny ? <th style={{ width: 56 }} /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const primary = c.contacts[0];
              return (
                <tr key={c.id} data-spine={COOP_META[c.cooperationStatus].spine} className="group">
                  <td style={{ paddingLeft: 20 }}>
                    <Link href={detailHref(c.id)} data-client-detail-link className="block min-w-0">
                      <div className="truncate font-semibold group-hover:text-[var(--teal-deep)]" style={{ fontSize: 13 }}>{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--t-muted)]">
                        {c.idNumber ? <span className="font-mono">{c.idNumber}</span> : null}
                        {c.source ? <span className="truncate">来源：{c.source}</span> : null}
                      </div>
                    </Link>
                  </td>
                  <td><TypeBadge type={c.type} /></td>
                  <td><CoopBadge status={c.cooperationStatus} /></td>
                  <td className="text-[var(--t-secondary)]">
                    <div className="flex flex-col gap-0.5 text-[12px]">
                      {c.phone ? <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" strokeWidth={1.8} /><span className="font-mono">{c.phone}</span></span> : null}
                      {c.email ? <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" strokeWidth={1.8} /><span className="truncate">{c.email}</span></span> : null}
                      {!c.phone && !c.email ? <span className="t-faint">—</span> : null}
                    </div>
                  </td>
                  <td>
                    {primary ? (
                      <div>
                        <div>{primary.name}</div>
                        {primary.phone ? <div className="font-mono text-[11px] text-[var(--t-muted)]">{primary.phone}</div> : null}
                      </div>
                    ) : (
                      <span className="t-faint">—</span>
                    )}
                  </td>
                  <td className="num">
                    <span className="font-mono font-semibold" style={{ fontSize: 14 }}>{c._count.matters}</span>
                    <span className="font-mono text-[11px] text-[var(--t-muted)]"> / {c._count.intakes}</span>
                  </td>
                  {canEditAny ? <td className="text-right">
                    {editableClientIds.includes(c.id) ? <Button htmlType="button" className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" theme="borderless" type="tertiary" size="small" icon={<Pencil size={14} />} onClick={event => onEdit(c, event.currentTarget)} aria-label={`编辑 ${c.name}`} disabled={!!loadingClientId} aria-busy={loadingClientId === c.id} /> : null}
                  </td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片列表 */}
      <div className="md:hidden">
        {items.map((c) => {
          const primary = c.contacts[0];
          const spine = COOP_META[c.cooperationStatus].spine;
          return (
            <div key={c.id} className="mo-spine border-b border-[var(--bd-hair)] p-3 pl-4 last:border-b-0" data-spine={spine}>
              <div className="flex items-start justify-between gap-2">
                <Link href={detailHref(c.id)} data-client-detail-link className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.idNumber && (
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground tabular">
                      {c.idNumber}
                    </div>
                  )}
                  {c.source && (
                    <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">
                      来源：{c.source}
                    </div>
                  )}
                </Link>
                {editableClientIds.includes(c.id) ? <Button htmlType="button" className="shrink-0" theme="borderless" type="tertiary" size="small" icon={<Pencil size={14} />} onClick={event => onEdit(c, event.currentTarget)} aria-label={`编辑 ${c.name}`} disabled={!!loadingClientId} aria-busy={loadingClientId === c.id} /> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <CoopBadge status={c.cooperationStatus} />
                {primary && <span>{primary.name}</span>}
                {c.phone && (
                  <span className="flex items-center gap-1 font-mono tabular">
                    <Phone className="h-3 w-3" strokeWidth={1.8} />
                    {c.phone}
                  </span>
                )}
                <span className="font-mono tabular">{c._count.matters} 个案件</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
