"use client";

import { Select, Input } from "@douyinfe/semi-ui";
import { useId } from "react";
import type { DeadlineDue, DeadlineDueDraft } from "@/lib/deadline-due";

/** Controlled business fields: unknown history requires a deliberate precision choice. */
export function DeadlineDueFields({ value, onChange, disabled, original }: {
  value: DeadlineDueDraft; onChange: (value: DeadlineDueDraft) => void; disabled?: boolean; original?: DeadlineDue;
}) {
  const id = useId();
  return <div className="space-y-2">
    <div className="space-y-1.5"><label id={`${id}-precision` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">期限精度</label>
      <Select
        value={value.precision ?? "UNKNOWN"}
        disabled={disabled}
        onChange={precision => { if (typeof precision !== "string") return;
        if (precision === "DATE" || precision === "DATETIME") onChange({ ...value, precision });
      }}
        id={`${id}-precision`}
        aria-labelledby={`${id}-precision` + "-label"}
        className="w-full"
        motion={false}>{!value.precision && <Select.Option value="UNKNOWN" disabled>历史精度未记录，请选择</Select.Option>}<Select.Option value="DATE">日期</Select.Option><Select.Option value="DATETIME">准确时刻（北京时间）</Select.Option></Select>
    </div>
    <div className="flex gap-3"><div className="min-w-0 flex-1 space-y-1.5"><label htmlFor={`${id}-date`} className="text-sm font-medium text-[var(--semi-color-text-1)]">到期日期</label>
      <Input id={`${id}-date`} type="date" required disabled={disabled} value={value.date} onChange={inputValue => onChange({ ...value, date: inputValue })} /></div>
      {value.precision === "DATETIME" && <div className="min-w-0 flex-1 space-y-1.5"><label htmlFor={`${id}-time`} className="text-sm font-medium text-[var(--semi-color-text-1)]">准确时刻（北京时间）</label>
        <Input id={`${id}-time`} type="time" required disabled={disabled} value={value.time} onChange={inputValue => onChange({ ...value, time: inputValue })} /></div>}
    </div>
    {original?.duePrecision === null && <details className="text-xs text-muted-foreground"><summary>查看原记录值</summary>
      <p>{new Date(original.dueAt).toISOString()}（原存储值，非已核对的准确时刻）</p></details>}
  </div>;
}
