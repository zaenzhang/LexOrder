"use client";

import Link from "next/link";
import { Folder } from "lucide-react";
import type { ClientMatterPage } from "@/lib/clients/history";
import { getClientMatterPage } from "@/server/clients/history-actions";
import { matterHref } from "@/lib/matters/route";
import { matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import { matterSpineTone, matterStatusTone } from "@/lib/ui/moan-tones";
import { ClientPagination, useClientPagination } from "./client-pagination";

const active = new Set(["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"]);
export function ClientMattersPanel({ clientId, initial }: { clientId: string; initial: ClientMatterPage }) {
  const controls = useClientPagination(clientId, initial, getClientMatterPage);
  const page = controls.page;
  return <section className="card overflow-hidden" aria-labelledby="client-matters-title" aria-busy={controls.pending}>
    <div className="panel-head"><h2 className="panel-title" id="client-matters-title"><Folder className="ic" strokeWidth={1.8} />关联案件
      {page ? <span className="badge b-white">{page.total}</span> : null}</h2></div>
    {page?.items.length === 0 ? <div className="empty mo-empty-compact"><div className="mo-empty-title">本页暂无可见的关联案件</div></div> : null}
    {page?.items.map(matter => <Link key={matter.id} href={matterHref(matter)} className="mrow mo-spine no-underline" data-spine={matterSpineTone(matter.status)} style={{ color: "inherit" }}>
      <div className="min-w-0 flex-1"><div className="mr-name truncate">{matter.title}</div><div className="mr-meta truncate">
        {[matter.procedure ?? matterCategoryLabel[matter.category], matter.stage, matter.ownerName ? `主办 ${matter.ownerName}` : null,
          active.has(matter.status) ? matter.internalCode : matter.year].filter(Boolean).join(" · ")}
      </div></div>
      <span className={`badge b-${matterStatusTone(matter.status)}`}><span className="bdot" />{matterStatusLabel[matter.status]}</span>
      {matter.contract !== null ? <span className="mr-money">¥{Math.round(matter.contract).toLocaleString("zh-CN")}</span> : null}
    </Link>)}
    <div className="panel-body"><ClientPagination controls={controls} label="关联案件" /></div>
  </section>;
}
