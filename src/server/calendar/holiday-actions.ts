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
import { shParts } from "@/lib/ui/sh-time";
import { holidayDateForKey, holidayDateRange } from "@/lib/calendar/holidays";
import { ActionError } from "@/lib/action-error";

const batchSchema = z.object({
  entries: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD"),
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
  const yearKey = String(y).padStart(4, "0");
  const rows = await prisma.holiday.findMany({
    where: { date: holidayDateRange(`${yearKey}-01-01`, `${yearKey}-12-31`) },
    orderBy: { date: "asc" },
    select: { id: true, date: true, name: true, kind: true }
  });
  return { year: y, rows };
}

export async function saveHolidayBatch(input: z.input<typeof batchSchema>) {
  const session = await requireAdmin();
  const data = batchSchema.parse(input);
  const entries = data.entries.map(entry => ({ ...entry, storedDate: holidayDateForKey(entry.date) }));
  let upserted = 0;
  await prisma.$transaction(async (tx) => {
    if (isPersonalMode()) await resolvePersonalActor(tx, session.user.id);
    for (const e of entries) {
      // 以当前界面同一上海日为身份；已有记录保留原时间戳，不猜测旧部署时区或迁移日期。
      const existing = await tx.holiday.findMany({
        where: { date: holidayDateRange(e.date, e.date) },
        select: { date: true },
        take: 2
      });
      if (existing.length > 1) throw new ActionError(`${e.date} 有重复的放假安排，请先核对`);
      const date = existing[0]?.date ?? e.storedDate;
      await tx.holiday.upsert({
        where: { date },
        create: { date, name: e.name, kind: e.kind },
        update: { name: e.name, kind: e.kind }
      });
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
