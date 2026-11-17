import { z } from "zod";
import { shDayBoundary, shDayKey, shTime } from "@/lib/ui/sh-time";
import { ActionError } from "@/lib/action-error";

export type DeadlineDuePrecision = "DATE" | "DATETIME";
export type DeadlineDue = { dueAt: Date | string; duePrecision: DeadlineDuePrecision | null };

/** DATE is a civil date; a Date carrier is accepted only at the declared Shanghai boundary. */
export const deadlineDueSchema = z.object({
  duePrecision: z.enum(["DATE", "DATETIME"], { error: "请选择日期或准确时刻" }),
  dueAt: z.union([z.string(), z.date()], { error: "请填写期限日期或准确时刻" }),
}).transform((input, ctx) => {
  let dueAt: Date | undefined;
  if (input.duePrecision === "DATE") {
    if (typeof input.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) dueAt = shDayBoundary(input.dueAt);
    else {
      const instant = input.dueAt instanceof Date ? input.dueAt : null;
      const boundary = instant && Number.isFinite(instant.getTime()) ? shDayBoundary(shDayKey(instant)) : undefined;
      if (boundary?.getTime() === instant?.getTime()) dueAt = boundary;
    }
  } else {
    const parsed = input.dueAt instanceof Date ? z.date().safeParse(input.dueAt)
      : z.iso.datetime({ offset: true }).safeParse(input.dueAt);
    if (parsed.success) dueAt = new Date(parsed.data);
  }
  if (!dueAt || !Number.isFinite(dueAt.getTime())) {
    ctx.addIssue({ code: "custom", path: ["dueAt"], message: input.duePrecision === "DATE"
      ? "请填写有效日期；日期型期限按北京时间日界保存" : "请填写有效的准确时刻并包含明确时区" });
    return z.NEVER;
  }
  return { duePrecision: input.duePrecision, dueAt };
});

export function deadlineDays(value: Date | string, now = new Date()) {
  return Math.round((shDayBoundary(shDayKey(value))!.getTime() - shDayBoundary(shDayKey(now))!.getTime()) / 86_400_000);
}

export function deadlineOverdue(value: Date | string, precision: DeadlineDuePrecision | null, now = new Date()) {
  return precision === "DATETIME" ? new Date(value).getTime() < now.getTime() : deadlineDays(value, now) < 0;
}

export function formatDeadlineDue(value: Date | string, precision: DeadlineDuePrecision | null) {
  const day = shDayKey(value);
  return precision === "DATETIME" ? `${day} ${shTime(value)}` : precision === "DATE" ? day : `${day} · 时间精度未记录`;
}

export function deadlineRelative(value: Date | string, precision: DeadlineDuePrecision | null, now = new Date()) {
  const days = deadlineDays(value, now);
  if (deadlineOverdue(value, precision, now)) return days < 0 ? `逾期 ${-days} 天` : "已逾期";
  return days === 0 ? "今天到期" : `剩 ${days} 天`;
}

/** Database predicate shares the same actual-time / civil-day distinction as display. */
export function overdueDeadlineWhere(now = new Date()) {
  const day = shDayBoundary(shDayKey(now))!;
  return { OR: [
    { duePrecision: "DATETIME" as const, dueAt: { lt: now } },
    { duePrecision: "DATE" as const, dueAt: { lt: day } },
    { duePrecision: null, dueAt: { lt: day } },
  ] };
}

export type DeadlineDueDraft = { precision: DeadlineDuePrecision | null; date: string; time: string };
export function deadlineDueDraft(original?: DeadlineDue): DeadlineDueDraft {
  return { precision: original ? original.duePrecision : "DATE", date: shDayKey(original?.dueAt ?? new Date()),
    time: original?.duePrecision === "DATETIME" ? shTime(original.dueAt) : "" };
}

/** Unedited exact instants retain their seconds/milliseconds, even when the control shows minutes. */
export function deadlineDueFromDraft(draft: DeadlineDueDraft, original?: DeadlineDue) {
  if (!draft.precision) throw new ActionError("历史时间精度未记录，请明确选择本次日期或准确时刻");
  if (original?.duePrecision === draft.precision && draft.date === shDayKey(original.dueAt) &&
    (draft.precision === "DATE" || draft.time === shTime(original.dueAt))) {
    return deadlineDueSchema.parse({ duePrecision: draft.precision, dueAt: new Date(original.dueAt) });
  }
  if (draft.precision === "DATETIME" && !/^\d{2}:\d{2}$/.test(draft.time)) throw new ActionError("请填写准确时刻（北京时间）");
  const input = { duePrecision: draft.precision, dueAt: draft.precision === "DATE" ? draft.date : `${draft.date}T${draft.time}:00+08:00` };
  const parsed = deadlineDueSchema.safeParse(input);
  if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "请填写有效期限");
  return parsed.data;
}
