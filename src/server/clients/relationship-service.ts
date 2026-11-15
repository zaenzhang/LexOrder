import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { clientActivitySchema, type ClientActivityInput } from "@/lib/clients/relationship";
import { auditTx } from "@/server/audit";
import { canCloseClientFollowUp, liveRelationshipWriter, lockClientRelationship, type RelationshipUser } from "./relationship-access";

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
