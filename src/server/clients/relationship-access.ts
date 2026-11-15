import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { intakeVisibilityFilter, matterAssociationFilter } from "@/lib/permissions";
import { scopeFor, type RoleUser } from "@/lib/roles/catalog";
import { checkRoleMutation, resolveRoleUser } from "@/lib/roles/service";

export type RelationshipUser = RoleUser & { id: string };

/** 沟通正文不继承财务岗位对客户主档的全所读取豁免。 */
export function clientRelationshipFilter(user: RelationshipUser, mode: "read" | "write"): Prisma.ClientWhereInput {
  const permission = mode === "read" ? "clients.read" : "clients.write";
  if (user.role === "CUSTOM") {
    const scope = scopeFor(user, permission);
    if (!scope) return { id: { in: [] } };
    if (scope === "ALL") return {};
  } else {
    if (user.role === "PRINCIPAL_LAWYER") return {};
    if (mode === "read" && (user.managerAuthorized || scopeFor(user, "clients.read") === "ALL")) return {};
    if (!["LAWYER", "INDEPENDENT_LAWYER", "ASSISTANT", "FINANCE"].includes(user.role)) return { id: { in: [] } };
  }
  return { OR: [
    { ownerUserId: user.id },
    { matters: { some: { deletedAt: null, ...matterAssociationFilter(user.id) } } },
    { intakes: { some: intakeVisibilityFilter(user.id, "LAWYER") } }
  ] };
}

export function canCloseClientFollowUp(user: RelationshipUser, assigneeId: string) {
  return assigneeId === user.id || user.role === "PRINCIPAL_LAWYER" ||
    (user.role === "CUSTOM" && scopeFor(user, "clients.write") === "ALL");
}

export async function liveRelationshipWriter(tx: Prisma.TransactionClient, user: RelationshipUser): Promise<RelationshipUser> {
  // 与账号停用、改岗和角色授权变更使用同一事务锁，内置角色也不能凭旧页面写入。
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  await checkRoleMutation(tx, user, "clients.write");
  const live = await tx.user.findUnique({ where: { id: user.id }, select: { active: true, role: true } });
  if (!live?.active || live.role !== user.role) throw new ActionError("账号或岗位已变化，请重新登录");
  const role = await resolveRoleUser(user.id, live.role, tx);
  if (!role.enabled) throw new ActionError("角色已停用，请联系管理员");
  return { ...role, id: user.id };
}

/** 同一客户的沟通写入与合并共用行锁；软删除后不能再留下悬空的新记录。 */
export async function lockClientRelationship(tx: Prisma.TransactionClient, user: RelationshipUser, clientId: string) {
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  const client = await tx.client.findFirst({
    where: { id: clientId, deletedAt: null, AND: [clientRelationshipFilter(user, "read"), clientRelationshipFilter(user, "write")] },
    select: { id: true, ownerUserId: true }
  });
  if (!client) throw new ActionError("客户不存在或无权维护其沟通与跟进");
  return client;
}
