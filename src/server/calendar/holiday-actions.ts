"use server";
/**
 * 法定放假安排管理（F-5）：Server 仅系统管理员，Personal 由本机操作者配置；每年按国务院通知录入一批，
 * 期限引擎据此顺延届满日（src/lib/calendar/holidays.ts）。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, requireWorkspaceConfiguration } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { isPersonalMode } from "@/lib/runtime/mode";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { audit } from "@/server/audit";
import { shDateFromKey, shParts } from "@/lib/ui/sh-time";
import { ActionError } from "@/lib/action-error";

const batchSchema = z.object({
  entries: z.array(z.object({
    date: z.string().refine(value => { try { shDateFromKey(value); return true; } catch { return false; } }, "请填写有效的 YYYY-MM-DD 日期"),
    name: z.string().min(1, "名称必填").max(40),
    kind: z.enum(["HOLIDAY", "WORKDAY"])
  })).min(1, "至少一条").max(200, "单批最多 200 条")
});

async function requireAdmin() {
  if (isPersonalMode()) return requireWorkspaceConfiguration();
  const session = await requireSession();
  if (!isSystemAdmin(session.user)) throw new ActionError("仅系统超级管理员可维护放假安排");
  return session;
}

export async function listHolidays(year?: number) {
  await requireSession("personal");
  // 默认看明年（每年 Q4 录入次年安排）。年月按上海口径取——此前用服务器本地
  // getFullYear/getMonth，UTC 容器下 11 月 1 日前后会跨月错判（第七轮体检 P3-4）。
  const nowSh = shParts(new Date());
  const y = year ?? nowSh.y + (nowSh.m >= 11 ? 1 : 0);
  const from = shDateFromKey(`${y}-01-01`);
  const to = shDateFromKey(`${y + 1}-01-01`);
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, name: true, kind: true }
  });
  return { year: y, rows };
}

export async function saveHolidayBatch(input: z.input<typeof batchSchema>) {
  const session = await requireAdmin();
  const data = batchSchema.parse(input);
  let upserted = 0;
  await prisma.$transaction(async (tx) => {
    if (isPersonalMode()) await resolvePersonalActor(tx, session.user.id);
    for (const e of data.entries) {
      const date = shDateFromKey(e.date);
      const matches = await tx.holiday.findMany({ where: { date: { gte: date, lt: new Date(date.getTime() + 86_400_000) } }, select: { id: true } });
      if (matches.length > 1) throw new ActionError("同一天存在重复放假安排，请先核对日历配置");
      if (matches[0]) await tx.holiday.update({ where: { id: matches[0].id }, data: { date, name: e.name, kind: e.kind } });
      else await tx.holiday.create({ data: { date, name: e.name, kind: e.kind } });
      upserted++;
    }
  });
  await audit({
    userId: session.user.id,
    action: "HOLIDAY_BATCH_SAVE",
    targetType: "Holiday",
    targetId: "holiday-calendar",
    detail: { count: upserted }
  });
  return { ok: true, count: upserted };
}

export async function deleteHoliday(id: string) {
  const session = await requireAdmin();
  await prisma.holiday.delete({ where: { id } });
  await audit({
    userId: session.user.id,
    action: "HOLIDAY_DELETE",
    targetType: "Holiday",
    targetId: id
  });
  return { ok: true };
}
