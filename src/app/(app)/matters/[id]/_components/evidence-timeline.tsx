"use client";

import { useId } from "react";
import { groupEvidenceTimeline } from "@/lib/evidence/event-date";
import { EvidencePoints, type EvidenceItemRow } from "./evidence-panel";

/** The caller supplies the matter-wide, permission-filtered evidence view. */
export function EvidenceTimeline({ items, onResearch }: { items: EvidenceItemRow[]; onResearch?(itemId: string): void }) {
  const id = useId();
  const { dated, unknown } = groupEvidenceTimeline(items);
  const restricted = items.filter(item => item.restricted);
  return <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">按发生日期排列；区间取开始日期，同日不表示先后。</p>
      {dated.length ? <section aria-labelledby={id + "-dated"} className="flex min-w-0 flex-col gap-3">
        <h3 id={id + "-dated"} className="text-sm font-medium">已记录日期</h3>
        <EvidencePoints items={dated} showSource onResearch={onResearch} />
      </section> : null}
      {unknown.length ? <section aria-labelledby={id + "-unknown"} className="flex min-w-0 flex-col gap-3">
        <h3 id={id + "-unknown"} className="text-sm font-medium">时间未明</h3>
        <EvidencePoints items={unknown} showSource onResearch={onResearch} />
      </section> : null}
      {restricted.length ? <section aria-labelledby={id + "-restricted"} className="flex min-w-0 flex-col gap-3">
        <h3 id={id + "-restricted"} className="text-sm font-medium">来源不可用</h3>
        <EvidencePoints items={restricted} showSource />
      </section> : null}
      {!dated.length && !unknown.length && !restricted.length ? <p role="status" className="text-sm text-muted-foreground">暂无可展示的要点。</p> : null}
  </div>;
}
