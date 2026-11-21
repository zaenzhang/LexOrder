import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { assertMatterWritable } from "@/lib/archive/guard";
import { requireSession } from "@/lib/auth/session";
import { timelineEventKey, timelineLevels, type TimelineEventReference } from "@/lib/matters/timeline-levels";
import { assertCanHandleMatter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { auditTx } from "@/server/audit";
import { sourceReader, sourceReferences } from "@/server/evidence/source-links";

export const setTimelineGradeSchema = z.object({
  action: z.literal("set-timeline-grade"),
  matterId: z.cuid(),
  event: z.object({ kind: z.enum(["fact", "hearing", "deadline", "accepted", "concluded"]), id: z.cuid() }),
  level: z.enum(timelineLevels).nullable(),
});

export async function timelineGrades(userId: string, matterId: string, facts: boolean) {
  const eventKey = facts ? { startsWith: "fact:" } : { not: { startsWith: "fact:" } };
  const rows = await prisma.matterTimelineGrade.findMany({ where: { userId, matterId, eventKey }, select: { eventKey: true, level: true } });
  return new Map(rows.map(row => [row.eventKey, row.level]));
}

async function assertVisibleEvent(userId: string, matterId: string, event: TimelineEventReference) {
  if (event.kind === "fact") {
    const item = await prisma.evidenceItem.findFirst({ where: { id: event.id, matterId },
      select: { sourceDocumentId: true, sourcePage: true, sources: { where: { removedAt: null } } },
    });
    if (!item) throw new ActionError("要点不存在或不属于本案");
    const references = sourceReferences(item);
    const reader = await sourceReader(userId, matterId, references);
    if (references.some(reference => !reader.documentFor(reference))) throw new ActionError("部分出处不可读，无法标记此事件");
    return;
  }

  const where = { id: event.id, procedure: { matterId } };
  const target = event.kind === "hearing"
    ? await prisma.hearing.findFirst({ where, select: { id: true } })
    : event.kind === "deadline"
      ? await prisma.deadline.findFirst({ where: { ...where, confirmStatus: { not: "PENDING" } }, select: { id: true } })
      : await prisma.matterProcedure.findFirst({ where: { id: event.id, matterId,
        ...(event.kind === "accepted" ? { acceptedAt: { not: null } } : { concludedAt: { not: null } }),
      }, select: { id: true } });
  if (!target) throw new ActionError("程序事件未登记或不属于本案");
}

export async function setTimelineGrade(input: z.infer<typeof setTimelineGradeSchema>) {
  const { matterId, event, level } = input;
  const { user } = await requireSession("matters.write");
  await assertCanHandleMatter(user, matterId);
  await assertMatterWritable(matterId, { allowPrincipal: true });
  if (event.kind !== "fact" && !hasCustomPermission(user, "schedule.read")) throw new ActionError("无权查看程序事件");
  await assertVisibleEvent(user.id, matterId, event);
  const identity = { matterId, userId: user.id, eventKey: timelineEventKey(event.kind, event.id) };
  await prisma.$transaction(async tx => {
    if (level === null) {
      const deleted = await tx.matterTimelineGrade.deleteMany({ where: identity });
      if (!deleted.count) return;
    } else {
      await tx.matterTimelineGrade.upsert({
        where: { matterId_userId_eventKey: identity }, create: { ...identity, level }, update: { level },
      });
    }
    await auditTx(tx, { userId: user.id, action: "TIMELINE_GRADE_SET", targetType: "MatterTimelineEvent", targetId: event.id,
      detail: { matterId, eventKind: event.kind, level } });
  });
  return { level };
}
