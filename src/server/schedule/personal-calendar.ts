import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { approvalTransaction } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { formatDeadlineDue } from "@/lib/deadline-due";
import { procedureTypeLabel } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { shDayKey, shDayBoundary, shTime } from "@/lib/ui/sh-time";
import { auditTx } from "@/server/audit";
import { listScheduleItems } from "./actions";
import type { ScheduleItem } from "./query";

const dayMs = 24 * 60 * 60 * 1000;
const dateKey = (day: Date) => day.toISOString().slice(0, 10);
const time = (minute: number) => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
const minute = z.number().int().min(0).max(1439).nullable();
export const createPersonalCalendarEntry = z.object({
  action: z.literal("create-calendar-entry"),
  requestKey: z.uuid(),
  title: z.string().trim().min(1, "请输入安排标题。").max(100),
  day: z.iso.date().refine(value => value >= "0001-01-01"),
  startMinute: minute,
  endMinute: minute,
}).refine(value => (value.startMinute === null) === (value.endMinute === null)
  && (value.startMinute === null || value.startMinute < value.endMinute!), { message: "结束时间须晚于开始时间。" });

export async function savePersonalCalendarEntry(data: z.infer<typeof createPersonalCalendarEntry>) {
  const { user } = await requireSession("schedule.write");
  if (user.runtimeMode !== "PERSONAL" || !hasCustomPermission(user, "schedule.write")) throw new ActionError("当前工作区无权新建个人安排。");
  return approvalTransaction(async db => {
    const { count } = await db.personalCalendarEntry.createMany({
      data: { userId: user.id, requestKey: data.requestKey, title: data.title, day: new Date(data.day + "T00:00:00Z"),
        startMinute: data.startMinute, endMinute: data.endMinute },
      skipDuplicates: true,
    });
    const entry = await db.personalCalendarEntry.findUniqueOrThrow({
      where: { userId_requestKey: { userId: user.id, requestKey: data.requestKey } },
    });
    if (entry.title !== data.title || dateKey(entry.day) !== data.day || entry.startMinute !== data.startMinute || entry.endMinute !== data.endMinute) {
      throw new ActionError("该提交已用于另一项安排，请重新打开编辑表单。");
    }
    if (count > 0) await auditTx(db, { userId: user.id, action: "PERSONAL_CALENDAR_ENTRY_CREATE", targetType: "PersonalCalendarEntry", targetId: entry.id,
      detail: { day: data.day, allDay: data.startMinute === null } });
    return { id: "a-" + entry.id, day: data.day };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}

function projectScheduleItem(item: ScheduleItem) {
  const day = shDayKey(item.occurredAt);
  const clock = item.type === "deadline" && item.duePrecision === "DATE" ? null : shTime(item.occurredAt);
  const procedure = item.procedureLabel;
  let href = item.href;
  if (item.intakeId) href = "/practice/intakes/" + item.intakeId;
  else if (item.id.startsWith("t-")) {
    const query = new URLSearchParams({ task: item.id.slice(2), from: "schedule", day });
    if (item.stageId) query.set("stage", item.stageId);
    href = `/matters/${item.matter.id}/materials?${query}`;
  } else if (item.procedureId) {
    href = `/matters/${item.matter.id}/tasks?program=${item.procedureId}`;
  } else if (item.id.startsWith("p-")) {
    href = "/practice/operations";
  }
  return {
    id: item.id, type: item.type, title: item.title, day, clock, completed: item.completed ?? false,
    matter: item.matter, href, procedure: procedure ? (Object.hasOwn(procedureTypeLabel, procedure) ? procedureTypeLabel[procedure as keyof typeof procedureTypeLabel] : procedure) : null,
    location: item.location ?? null, sourceDocumentId: item.sourceDocumentId ?? null,
    end: item.endsAt ? shDayKey(item.endsAt) === day ? shTime(item.endsAt) : shDayKey(item.endsAt) + " " + shTime(item.endsAt) : null,
    when: item.type === "deadline" ? formatDeadlineDue(item.occurredAt, item.duePrecision ?? null) : day + " " + clock,
  };
}

export async function readPersonalCalendar(month: string, includeGrid: boolean) {
  const { user } = await requireSession("schedule.read");
  const first = new Date(month + "-01T00:00:00Z");
  const next = new Date(first);
  next.setUTCMonth(first.getUTCMonth() + 1);
  const offset = (first.getUTCDay() + 6) % 7;
  const gridStart = first.getTime() - offset * dayMs;
  const civilStart = new Date(includeGrid ? Math.max(gridStart, Date.parse("0001-01-01")) : first.getTime());
  const civilEnd = new Date(Math.min((includeGrid ? gridStart + 42 * dayMs : next.getTime()) - dayMs, Date.parse("9999-12-31")));
  const [business, personal] = await Promise.all([
    listScheduleItems({
      from: shDayBoundary(dateKey(civilStart)),
      to: shDayBoundary(dateKey(civilEnd), true),
      onlyMine: true, includeCompleted: true, excludePendingDeadlines: true,
    }),
    prisma.personalCalendarEntry.findMany({
      where: { userId: user.id, day: { gte: civilStart, lte: civilEnd } },
      orderBy: [{ day: "asc" }, { startMinute: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    today: shDayKey(new Date()), canWrite: hasCustomPermission(user, "schedule.write"),
    items: [...business.map(projectScheduleItem), ...personal.map(row => ({
      id: "a-" + row.id, type: "personal" as const, title: row.title, day: dateKey(row.day),
      clock: row.startMinute === null ? null : time(row.startMinute), end: row.endMinute === null ? null : time(row.endMinute),
      completed: false, when: row.startMinute === null ? dateKey(row.day) : dateKey(row.day) + " " + time(row.startMinute), matter: null,
    }))],
  };
}

const inboxLabels = {
  HEARING_NOTICE: "开庭通知待处理", SERVICE_NOTICE: "法院送达待处理", FEE_NOTICE: "缴费通知待处理", MEDIATION: "调解通知待处理",
  ENFORCEMENT: "执行来件待处理", FILING_NOTICE: "立案通知待处理", JUDGMENT_NOTICE: "裁判文书待处理",
  EVIDENCE_SUBMIT: "举证通知待处理", OTHER: "法院来件待处理",
};

export async function readPersonalToday() {
  const { user } = await requireSession("schedule.read");
  const day = shDayKey(new Date());
  const from = shDayBoundary(day)!;
  const [dates, inbox] = await Promise.all([
    listScheduleItems({ from, to: new Date(from.getTime() + 30 * dayMs - 1), onlyMine: true, onlyCourtDates: true, excludePendingDeadlines: true }),
    hasCustomPermission(user, "matters.write") ? prisma.smsMessage.findMany({
      where: { receivedById: user.id, processed: false },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 13,
      select: { id: true, smsType: true, receivedAt: true, matchedMatter: { select: { title: true, id: true, deletedAt: true } } },
    }) : [],
  ]);
  return {
    day,
    courtDates: dates.slice(0, 8).map(projectScheduleItem),
    courtInbox: inbox.slice(0, 12).map(item => ({
      id: item.id, title: inboxLabels[item.smsType], day: shDayKey(item.receivedAt),
      matter: item.matchedMatter?.deletedAt ? null : item.matchedMatter,
    })),
    moreCourtInbox: inbox.length > 12,
  };
}
