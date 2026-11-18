"use client";

import { clientCooperationTone, statusTagColor } from "@/lib/ui/status-tones";
import { Empty, Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Table, Button } from "@douyinfe/semi-ui";

import Link from "next/link";
import { IconApartment as Building2, IconUser as User, IconBriefcase as Briefcase, IconEdit as Pencil, IconPhone as Phone, IconMail as Mail } from "@douyinfe/semi-icons";
import type { Client, ClientCooperationStatus, ClientType, Contact } from "@prisma/client";
import { clientTypeLabel, cooperationStatusLabel } from "@/lib/enums";

/** 合作状态标签。 */
function CoopBadge({ status }: { status: ClientCooperationStatus }) {
  return (
    <SemiTag size="small" color={statusTagColor(clientCooperationTone[status])}>{cooperationStatusLabel[status]}</SemiTag>
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
    <SemiTag size="small" color="grey">
      <Icon className={cls} />
      {clientTypeLabel[type]}
    </SemiTag>
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
      <Empty className="py-8" title="没有符合条件的客户"
        description={canCreate ? "调整筛选条件，或新建客户。" : "调整筛选条件后再试。"} />
    );
  }

  return (
    <>
      <div className="mo-scroll-x hidden md:block">
        <Table<(typeof items)[number]>
          pagination={false}
          rowKey="id"
          dataSource={items}
          scroll={{ x: 900 }}
          columns={[
            { title: "客户", width: "30%", key: "column1", render: (_, c) => <Link href={detailHref(c.id)} data-client-detail-link className="block min-w-0">
                      <div className="truncate font-semibold hover:text-[var(--semi-color-primary-active)]" style={{ fontSize: 13 }}>{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--semi-color-text-2)]">
                        {c.idNumber ? <span className="font-mono">{c.idNumber}</span> : null}
                        {c.source ? <span className="truncate">来源：{c.source}</span> : null}
                      </div>
                    </Link> },
            { title: "类型", key: "column2", render: (_, c) => <TypeBadge type={c.type} /> },
            { title: "合作状态", key: "column3", render: (_, c) => <CoopBadge status={c.cooperationStatus} /> },
            { title: "联系方式", key: "column4", render: (_, c) => <div className="flex flex-col gap-0.5 text-[var(--semi-color-text-1)]">
                      {c.phone ? <span className="flex items-center gap-1.5"><Phone aria-hidden size="small" /><span className="font-mono">{c.phone}</span></span> : null}
                      {c.email ? <span className="flex items-center gap-1.5"><Mail aria-hidden size="small" /><span className="truncate">{c.email}</span></span> : null}
                      {!c.phone && !c.email ? <span className="t-faint">—</span> : null}
                    </div> },
            { title: "主要联系人", key: "column5", render: (_, c) => { const primary = c.contacts[0]; return (primary ? (
                      <div>
                        <div>{primary.name}</div>
                        {primary.phone ? <div className="font-mono text-xs text-[var(--semi-color-text-2)]">{primary.phone}</div> : null}
                      </div>
                    ) : (
                      <span className="t-faint">—</span>
                    )); } },
            { title: "案件 / 收案", align: "right", key: "column6", render: (_, c) => <><span className="font-mono font-semibold" style={{ fontSize: 14 }}>{c._count.matters}</span>
                    <span className="font-mono text-xs text-[var(--semi-color-text-2)]"> / {c._count.intakes}</span></> },
            ...(canEditAny ? [{ title: "操作", width: 72, key: "edit", render: (_: unknown, c: ClientRow) => editableClientIds.includes(c.id) ? <Button htmlType="button" theme="borderless" type="tertiary" size="small" icon={<Pencil aria-hidden size="default" />} onClick={event => onEdit(c, event.currentTarget)} aria-label={`编辑 ${c.name}`} disabled={!!loadingClientId} aria-busy={loadingClientId === c.id} /> : null, }] : []),
          ]}
        />
      </div>

      {/* 移动端卡片列表 */}
      <div className="md:hidden">
        {items.map((c) => {
          const primary = c.contacts[0];
          return (
            <div key={c.id} className="border-b border-[var(--semi-color-border)] p-3 last:border-b-0">
              <div className="flex items-start justify-between gap-2">
                <Link href={detailHref(c.id)} data-client-detail-link className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.idNumber && (
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground tabular">
                      {c.idNumber}
                    </div>
                  )}
                  {c.source && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground/80">
                      来源：{c.source}
                    </div>
                  )}
                </Link>
                {editableClientIds.includes(c.id) ? <Button htmlType="button" className="shrink-0" theme="borderless" type="tertiary" size="small" icon={<Pencil aria-hidden size="default" />} onClick={event => onEdit(c, event.currentTarget)} aria-label={`编辑 ${c.name}`} disabled={!!loadingClientId} aria-busy={loadingClientId === c.id} /> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <CoopBadge status={c.cooperationStatus} />
                {primary && <span>{primary.name}</span>}
                {c.phone && (
                  <span className="flex items-center gap-1 font-mono tabular">
                    <Phone aria-hidden size="small" />
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
