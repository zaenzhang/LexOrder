import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { clientActivitySchema, type ClientActivityInput } from "@/lib/clients/relationship";
import { clientFollowUpRescheduleAuditSchema, clientFollowUpRescheduleSchema, type ClientFollowUpRescheduleInput } from "@/lib/clients/follow-ups";
import { auditTx } from "@/server/audit";
import { canCloseClientFollowUp, liveRelationshipWriter, lockClientRelationship, type RelationshipUser } from "./relationship-access";

/** Only the assignee can reschedule the same open follow-up. The existing customer lock also serializes completion and merge. */
export async function rescheduleClientFollowUpRecord(db: PrismaClient, user: RelationshipUser, input: ClientFollowUpRescheduleInput) {
  const data = clientFollowUpRescheduleSchema.parse(input);
  return db.$transaction(async tx => {
    const liveUser = await liveRelationshipWriter(tx, user);
    await lockClientRelationship(tx, liveUser, data.clientId);
    const row = await tx.clientFollowUp.findUnique({ where: { id: data.followUpId } });
    if (!row || row.clientId !== data.clientId || row.assigneeId !== liveUser.id) throw new ActionError("跟进不存在、所属客户已变化或不是本人负责，请重新读取并核对");
    const previous = await tx.auditLog.findFirst({ where: {
      userId: liveUser.id, action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: row.id,
      detail: { path: ["requestKey"], equals: data.requestKey },
    }, select: { detail: true } });
    if (previous) {
      const parsed = clientFollowUpRescheduleAuditSchema.safeParse(previous.detail);
      if (!parsed.success) throw new ActionError("改期记录无法核对，请重新读取并核对");
      const receipt = parsed.data;
      if (receipt.clientId !== data.clientId || receipt.followUpId !== data.followUpId || receipt.expectedUpdatedAt !== data.expectedUpdatedAt
        || receipt.dueAt !== data.dueAt || receipt.reason !== data.reason || receipt.requestKey !== data.requestKey) {
        throw new ActionError("此改期请求已保存但内容不同，请重新读取并核对后再保存");
      }
      if (row.status !== "OPEN" || row.dueAt.toISOString() !== receipt.afterDueAt || row.updatedAt.toISOString() !== receipt.afterUpdatedAt) {
        throw new ActionError("此改期曾保存，但跟进随后已变化或结束，请重新读取并核对");
      }
      return { ok: true as const, id: row.id, dueAt: receipt.afterDueAt, updatedAt: receipt.afterUpdatedAt, replayed: true };
    }
    if (row.status !== "OPEN") throw new ActionError("该跟进已结束，不能改期，请重新读取并核对");
    if (row.updatedAt.toISOString() !== data.expectedUpdatedAt) throw new ActionError("该跟进已变化，请重新读取并核对后再保存");
    if (row.dueAt.toISOString() === data.dueAt) throw new ActionError("跟进时间没有变化，无需改期");
    const updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
    const changed = await tx.clientFollowUp.updateMany({
      where: { id: row.id, clientId: data.clientId, assigneeId: liveUser.id, status: "OPEN", updatedAt: row.updatedAt },
      data: { dueAt: new Date(data.dueAt), updatedAt },
    });
    if (changed.count !== 1) throw new ActionError("该跟进已变化，请重新读取并核对后再保存");
    await auditTx(tx, { userId: liveUser.id, action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: row.id,
      detail: { ...data, beforeDueAt: row.dueAt.toISOString(), afterDueAt: data.dueAt,
        beforeUpdatedAt: row.updatedAt.toISOString(), afterUpdatedAt: updatedAt.toISOString() } });
    return { ok: true as const, id: row.id, dueAt: data.dueAt, updatedAt: updatedAt.toISOString(), replayed: false };
  }, { timeout: 20_000 });
}

/** 真实事务边界；请求去重、任务状态、结果、下一项及审计一起提交。 */
export async function saveClientActivity(db: PrismaClient, user: RelationshipUser, input: ClientActivityInput) {
  const data = clientActivitySchema.parse(input);
  if (new Date(data.occurredAt).getTime() > Date.now() + 300_000) throw new ActionError("沟通发生时间不能晚于当前时间；未来事项请安排为下次跟进");
  const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");

  return db.$transaction(async tx => {
    const liveUser = await liveRelationshipWriter(tx, user);
    // 唯一键冲突不在事务内 catch；同一请求先串行化，避免 PostgreSQL 事务中毒。
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`client-activity:${user.id}:${data.requestKey}`}, 0))`;
    await lockClientRelationship(tx, liveUser, data.clientId);
    const previous = await tx.clientActivity.findUnique({
      where: { authorId_requestKey: { authorId: user.id, requestKey: data.requestKey } },
      select: { id: true, requestHash: true }
    });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ActionError("此提交已保存且内容发生变化，请关闭后重新记录");
      return { ok: true as const, id: previous.id, replayed: true };
    }

    if (data.followUpId) {
      const followUp = await tx.clientFollowUp.findFirst({ where: { id: data.followUpId, clientId: data.clientId } });
      if (!followUp || !canCloseClientFollowUp(liveUser, followUp.assigneeId)) throw new ActionError("跟进不存在或无权处理");
      const changed = await tx.clientFollowUp.updateMany({
        where: { id: followUp.id, clientId: data.clientId, status: "OPEN" },
        data: { status: data.closeStatus, closedAt: new Date(), closedById: user.id }
      });
      if (changed.count !== 1) throw new ActionError("该跟进已处理，请刷新查看结果");
    }

    const activity = await tx.clientActivity.create({ data: {
      clientId: data.clientId, authorId: user.id, channel: data.channel,
      content: data.content, occurredAt: new Date(data.occurredAt), requestKey: data.requestKey, requestHash
    }, select: { id: true } });
    await auditTx(tx, { userId: user.id, action: "CLIENT_ACTIVITY_CREATE", targetType: "ClientActivity", targetId: activity.id, detail: { clientId: data.clientId, channel: data.channel } });

    if (data.followUpId) {
      await tx.clientFollowUp.update({ where: { id: data.followUpId }, data: { resultActivityId: activity.id } });
      await auditTx(tx, {
        userId: user.id, action: data.closeStatus === "CANCELLED" ? "CLIENT_FOLLOWUP_CANCEL" : "CLIENT_FOLLOWUP_COMPLETE",
        targetType: "ClientFollowUp", targetId: data.followUpId,
        detail: { clientId: data.clientId, resultActivityId: activity.id, status: data.closeStatus }
      });
    }

    if (data.nextFollowUp) {
      const next = await tx.clientFollowUp.create({ data: {
        clientId: data.clientId, title: data.nextFollowUp.title, dueAt: new Date(data.nextFollowUp.dueAt),
        createdById: user.id, assigneeId: user.id, sourceActivityId: activity.id
      }, select: { id: true } });
      await auditTx(tx, { userId: user.id, action: "CLIENT_FOLLOWUP_CREATE", targetType: "ClientFollowUp", targetId: next.id, detail: { clientId: data.clientId, dueAt: data.nextFollowUp.dueAt, sourceActivityId: activity.id } });
    }
    return { ok: true as const, id: activity.id, replayed: false };
  }, { timeout: 20_000 });
}
