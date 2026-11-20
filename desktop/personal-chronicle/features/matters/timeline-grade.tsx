import { useId } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ChronologySelect } from "./chronology-select"
import type { TimelineLevel } from "../../../../src/lib/matters/timeline-levels"

export const timelineLevelLabels = { NORMAL: "一般", IMPORTANT: "重要", KEY: "关键" } satisfies Record<TimelineLevel, string>

export const timelineGradeOptions = { "": "未分级", ...timelineLevelLabels }

export function TimelineGradeBadge({ level }: { level?: TimelineLevel | null }) {
  return level ? <Badge variant={level === "KEY" ? "default" : "outline"} className="h-auto min-h-6 py-0 text-sm font-normal">
    {timelineLevelLabels[level]}
  </Badge> : null
}

export function TimelineGradeControl({ level, busy, onChange, className, inFieldGroup, compact }: {
  level?: TimelineLevel | null; busy: boolean; onChange(level: TimelineLevel | null): void; className?: string; inFieldGroup?: boolean; compact?: boolean
}) {
  const id = useId()
  const control = <ChronologySelect id={id} label="事件等级" className={inFieldGroup ? "w-full" : undefined} compact={compact} items={timelineGradeOptions} value={level ?? ""} disabled={busy}
    onChange={value => onChange((value || null) as TimelineLevel | null)} />
  if (inFieldGroup) return <Field aria-busy={busy} className="gap-1.5 @min-[18rem]/field-group:flex-row @min-[18rem]/field-group:items-center @min-[18rem]/field-group:gap-2">
    <FieldLabel htmlFor={id} className="text-xs @min-[18rem]/field-group:max-w-20 @min-[18rem]/field-group:shrink-0">事件等级</FieldLabel>
    {control}
  </Field>
  return <div className={cn("flex flex-wrap items-center gap-2 text-sm text-muted-foreground", className)}>
    <span>事件等级</span>
    {control}
    {busy && <span role="status" className="col-span-full">正在保存…</span>}
  </div>
}
