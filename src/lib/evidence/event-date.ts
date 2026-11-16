import { z } from "zod";

export const evidenceDatePrecisionSchema = z.enum(["EXACT", "RANGE", "UNKNOWN"]);
export const evidenceDatePrecisionLabel = { EXACT: "精确日期", RANGE: "日期区间", UNKNOWN: "时间未明" } as const;

/** A calendar day, not an instant. Never normalize it in the machine's timezone. */
export function isEvidenceCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01" || value > "9999-12-31") return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const calendarDaySchema = z.string().refine(isEvidenceCalendarDay, "请输入 0001—9999 年内有效的公历日期");
export const evidenceEventDateSchema = z.object({
  precision: evidenceDatePrecisionSchema,
  start: calendarDaySchema.nullable(),
  end: calendarDaySchema.nullable(),
  text: z.string().max(500, "原始时间表述最多 500 字").nullable().transform(value => value?.trim() ? value : null),
}).strict().superRefine((value, context) => {
  if (value.precision === "EXACT" && (!value.start || value.end !== null)) {
    context.addIssue({ code: "custom", path: ["start"], message: "精确日期须填写发生日期，结束日期应为空" });
  }
  if (value.precision === "RANGE") {
    if (!value.start || !value.end) context.addIssue({ code: "custom", path: ["end"], message: "日期区间须填写开始和结束日期" });
    else if (value.end < value.start) context.addIssue({ code: "custom", path: ["end"], message: "结束日期不得早于开始日期" });
  }
  if (value.precision === "UNKNOWN" && (value.start !== null || value.end !== null)) {
    context.addIssue({ code: "custom", path: ["precision"], message: "时间未明时不能保留推定日期，可填写原始时间表述" });
  }
});

export type EvidenceEventDate = z.infer<typeof evidenceEventDateSchema>;
export type EvidenceDateRecord = {
  eventDatePrecision: EvidenceEventDate["precision"];
  eventDateStart: Date | null;
  eventDateEnd: Date | null;
  eventDateText: string | null;
};

export function emptyEvidenceEventDate(): EvidenceEventDate {
  return { precision: "UNKNOWN", start: null, end: null, text: null };
}

export function evidenceEventDateFromRecord(record: EvidenceDateRecord): EvidenceEventDate {
  return {
    precision: record.eventDatePrecision,
    start: record.eventDateStart?.toISOString().slice(0, 10) ?? null,
    end: record.eventDateEnd?.toISOString().slice(0, 10) ?? null,
    text: record.eventDateText,
  };
}

export function evidenceEventDateToRecord(value: EvidenceEventDate): EvidenceDateRecord {
  return {
    eventDatePrecision: value.precision,
    eventDateStart: value.start ? new Date(`${value.start}T00:00:00.000Z`) : null,
    eventDateEnd: value.end ? new Date(`${value.end}T00:00:00.000Z`) : null,
    eventDateText: value.text,
  };
}

export function evidenceEventDatesEqual(left: EvidenceEventDate, right: EvidenceEventDate): boolean {
  return left.precision === right.precision && left.start === right.start && left.end === right.end && left.text === right.text;
}

export function formatEvidenceEventDate(value: EvidenceEventDate): string {
  if (value.precision === "EXACT") return value.start!;
  if (value.precision === "RANGE") return `${value.start} 至 ${value.end}`;
  return "时间未明";
}

/** Sort only already-authorized views; an unavailable date never contributes a position. */
export function groupEvidenceTimeline<T extends { id: string; restricted?: boolean; eventDate?: EvidenceEventDate | null }>(items: readonly T[]) {
  const visible = items.filter(item => !item.restricted && item.eventDate != null);
  const dated = visible.filter(item => item.eventDate!.precision !== "UNKNOWN");
  const unknown = visible.filter(item => item.eventDate!.precision === "UNKNOWN");
  const byId = (left: T, right: T) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  dated.sort((left, right) => {
    const a = left.eventDate!.start!, b = right.eventDate!.start!;
    return a < b ? -1 : a > b ? 1 : byId(left, right);
  });
  unknown.sort(byId);
  return { dated, unknown };
}
