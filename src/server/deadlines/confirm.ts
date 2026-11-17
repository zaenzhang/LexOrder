"use server";

/** Existing legal deadline confirmation and explicit manual adjustment. */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { lockWritableMatters } from "@/server/matters/write-access";
import { refreshScheduleReminderAfterSave, retireScheduleReminders } from "@/server/reminders/schedule";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

const confirmSchema = z.object({ id: z.string().cuid(), expectedUpdatedAt: z.coerce.date() });
const adjustSchema = confirmSchema.extend({
  dueAt: z.coerce.date(),
  reason: z.string().trim().min(1, "请填写调整原因").max(200)
});

async function deadlineMatterId(id: string) {
  const reference = await prisma.deadline.findUnique({ where: { id }, select: { procedure: { select: { matterId: true } } } });
  if (!reference) throw new ActionError("期限不存在");
  return reference.procedure.matterId;
}

async function lockedDeadline(
  tx: Prisma.TransactionClient,
  user: Awaited<ReturnType<typeof requireSession>>["user"],
  matterId: string,
  input: z.infer<typeof confirmSchema>,
) {
  await lockWritableMatters(tx, user, "schedule.write", [matterId]);
  await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id = ${input.id} FOR UPDATE`;
  const deadline = await tx.deadline.findUnique({ where: { id: input.id }, include: { procedure: { select: { matterId: true } } } });
  if (!deadline || deadline.procedure.matterId !== matterId) throw new ActionError("期限不存在或归属已变化，请刷新后核对");
  if (deadline.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ActionError("期限已被修改，请刷新后核对；当前输入尚未保存");
  return deadline;
}

/** The displayed version must still be current when its actual date is confirmed. */
export async function confirmDeadline(input: z.infer<typeof confirmSchema>) {
  const session = await requireSession("schedule.write");
  const data = confirmSchema.parse(input);
  const matterId = await deadlineMatterId(data.id);
  await prisma.$transaction(async tx => {
    const deadline = await lockedDeadline(tx, session.user, matterId, data);
    if (deadline.confirmStatus !== "PENDING") throw new ActionError("该期限已确认");
    const changed = await tx.deadline.updateMany({
      where: { id: data.id, confirmStatus: "PENDING", updatedAt: data.expectedUpdatedAt },
      data: { confirmStatus: "CONFIRMED" }
    });
    if (changed.count !== 1) throw new ActionError("期限已被其他人处理，请刷新后重试");
    await retireScheduleReminders(tx, "Deadline", data.id);
    await auditTx(tx, { userId: session.user.id, action: "DEADLINE_CONFIRM", targetType: "Deadline", targetId: data.id,
      detail: { sourceRuleId: deadline.sourceRuleId, dueAt: deadline.dueAt.toISOString() } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  await refreshScheduleReminderAfterSave("Deadline", data.id);
  await revalidateMatter(matterId);
  return { ok: true };
}

/** Explicit adjustment preserves the actual prior date and the user's reason. */
export async function adjustDeadline(input: z.infer<typeof adjustSchema>) {
  const session = await requireSession("schedule.write");
  const data = adjustSchema.parse(input);
  const matterId = await deadlineMatterId(data.id);
  await prisma.$transaction(async tx => {
    const deadline = await lockedDeadline(tx, session.user, matterId, data);
    const changed = await tx.deadline.updateMany({
      where: { id: data.id, updatedAt: data.expectedUpdatedAt },
      data: { dueAt: data.dueAt, confirmStatus: "ADJUSTED", adjustedById: session.user.id, adjustedAt: new Date() }
    });
    if (changed.count !== 1) throw new ActionError("期限已被其他人修改，请刷新后重试");
    await retireScheduleReminders(tx, "Deadline", data.id);
    await auditTx(tx, { userId: session.user.id, action: "DEADLINE_ADJUST", targetType: "Deadline", targetId: data.id,
      detail: { previousDueAt: deadline.dueAt.toISOString(), newDueAt: data.dueAt.toISOString(), reason: data.reason, sourceRuleId: deadline.sourceRuleId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  await refreshScheduleReminderAfterSave("Deadline", data.id);
  await revalidateMatter(matterId);
  return { ok: true };
}

// Rule-side protection remains in the internal recalc-guard module. No automatic
// recalculation engine or new legal-date history is introduced by these actions.
