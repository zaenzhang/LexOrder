import { SH_TZ } from "@/lib/ui/sh-time";
import type { ContextSourceChoice } from "@/lib/matters/context";

const timestampFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Short user-facing text; collapse whitespace and never split a UTF-16 surrogate pair. */
export function contextTextSummary(value: string | null | undefined, limit = 64): string {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text;
}

function sourceTime(value: Date): string {
  const parts: Record<string, string> = {};
  for (const part of timestampFormat.formatToParts(value)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Inputs must already be permission-filtered; labels never grant source access. */
export function buildContextSourceChoices(input: {
  documents: { id: string; name: string; version: number }[];
  notes: { id: string; occurredAt: Date; withWhom: string | null }[];
  activities: { id: string; occurredAt: Date; content: string; client: { name: string } }[];
}): ContextSourceChoice[] {
  const choices: ContextSourceChoice[] = [
    ...input.documents.map(document => ({ type: "DOCUMENT" as const, id: document.id,
      label: `材料 · ${contextTextSummary(document.name, 80)} · 第 ${document.version} 版` })),
    ...input.notes.map(note => ({ type: "NOTE" as const, id: note.id,
      label: `事项沟通 · ${sourceTime(note.occurredAt)} · ${contextTextSummary(note.withWhom) || "未填写沟通对象"}` })),
    ...input.activities.map(activity => ({ type: "CLIENT_ACTIVITY" as const, id: activity.id,
      label: `客户沟通 · ${contextTextSummary(activity.client.name, 36)} · ${sourceTime(activity.occurredAt)} · ${contextTextSummary(activity.content) || "未填写沟通内容"}` })),
  ];
  const totals = new Map<string, number>();
  for (const choice of choices) totals.set(choice.label, (totals.get(choice.label) ?? 0) + 1);
  const positions = new Map<string, number>();
  return choices.map(choice => {
    const total = totals.get(choice.label)!;
    if (total === 1) return choice;
    const position = (positions.get(choice.label) ?? 0) + 1;
    positions.set(choice.label, position);
    return { ...choice, label: `${choice.label} · 同名来源 ${position}/${total}` };
  });
}
