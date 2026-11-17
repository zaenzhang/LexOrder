"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DeadlineDue, DeadlineDueDraft } from "@/lib/deadline-due";

/** Controlled business fields: unknown history requires a deliberate precision choice. */
export function DeadlineDueFields({ value, onChange, disabled, original }: {
  value: DeadlineDueDraft; onChange: (value: DeadlineDueDraft) => void; disabled?: boolean; original?: DeadlineDue;
}) {
  const id = useId();
  return <div className="space-y-2">
    <div className="space-y-1.5"><Label htmlFor={`${id}-precision`}>期限精度</Label>
      <Select value={value.precision ?? "UNKNOWN"} disabled={disabled} onValueChange={precision => {
        if (precision === "DATE" || precision === "DATETIME") onChange({ ...value, precision });
      }}><SelectTrigger id={`${id}-precision`}><SelectValue /></SelectTrigger><SelectContent>
        {!value.precision && <SelectItem value="UNKNOWN" disabled>历史精度未记录，请选择</SelectItem>}
        <SelectItem value="DATE">日期</SelectItem><SelectItem value="DATETIME">准确时刻（北京时间）</SelectItem>
      </SelectContent></Select>
    </div>
    <div className="flex gap-3"><div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor={`${id}-date`}>到期日期</Label>
      <Input id={`${id}-date`} type="date" required disabled={disabled} value={value.date} onChange={e => onChange({ ...value, date: e.target.value })} /></div>
      {value.precision === "DATETIME" && <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor={`${id}-time`}>准确时刻（北京时间）</Label>
        <Input id={`${id}-time`} type="time" required disabled={disabled} value={value.time} onChange={e => onChange({ ...value, time: e.target.value })} /></div>}
    </div>
    {original?.duePrecision === null && <details className="text-xs text-muted-foreground"><summary>查看原记录值</summary>
      <p>{new Date(original.dueAt).toISOString()}（原存储值，非已核对的准确时刻）</p></details>}
  </div>;
}
