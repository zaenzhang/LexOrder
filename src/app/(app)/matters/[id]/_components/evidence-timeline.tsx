"use client";

import { useId } from "react";
import { groupEvidenceTimeline } from "@/lib/evidence/event-date";
import { EvidencePoints, type EvidenceItemRow } from "./evidence-panel";

/** The caller supplies the matter-wide, permission-filtered evidence view. */
export function EvidenceTimeline({ items }: { items: EvidenceItemRow[] }) {
  const id = useId();
  const { dated, unknown } = groupEvidenceTimeline(items);
  return <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">按发生日期排列；区间取开始日期，同日不表示先后。</p>
      {dated.length ? <section aria-labelledby={id + "-dated"} className="flex min-w-0 flex-col gap-3">
        <h3 id={id + "-dated"} className="text-sm font-medium">已记录日期</h3>
        <EvidencePoints items={dated} showSource />
      </section> : null}
      {unknown.length ? <section aria-labelledby={id + "-unknown"} className="flex min-w-0 flex-col gap-3">
        <h3 id={id + "-unknown"} className="text-sm font-medium">时间未明</h3>
        <EvidencePoints items={unknown} showSource />
      </section> : null}
      {!dated.length && !unknown.length ? <p role="status" className="text-sm text-muted-foreground">暂无可展示的要点。</p> : null}
  </div>;
}
