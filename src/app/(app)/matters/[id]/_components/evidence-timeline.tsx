"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { groupEvidenceTimeline } from "@/lib/evidence/event-date";
import { EvidencePoints, type EvidenceItemRow } from "./evidence-panel";

/** The caller supplies the matter-wide, permission-filtered evidence view. */
export function EvidenceTimeline({ items }: { items: EvidenceItemRow[] }) {
  const id = useId();
  const { dated, unknown } = groupEvidenceTimeline(items);
  return <Dialog>
    <DialogTrigger asChild><Button size="sm" variant="outline">事实时间线</Button></DialogTrigger>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>事项事实时间线</DialogTitle>
        <DialogDescription>当前事项可读要点；区间按开始日期排列，同日显示顺序不表示发生先后。</DialogDescription>
      </DialogHeader>
      {dated.length ? <section aria-labelledby={id + "-dated"} className="space-y-2">
        <h3 id={id + "-dated"} className="text-sm font-medium">已记录日期</h3>
        <EvidencePoints items={dated} showSource />
      </section> : null}
      {unknown.length ? <section aria-labelledby={id + "-unknown"} className="space-y-2">
        <h3 id={id + "-unknown"} className="text-sm font-medium">时间未明</h3>
        <EvidencePoints items={unknown} showSource />
      </section> : null}
      {!dated.length && !unknown.length ? <p role="status" className="text-sm text-muted-foreground">暂无可展示的要点。</p> : null}
      <DialogFooter><DialogClose asChild><Button variant="outline">返回材料</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
