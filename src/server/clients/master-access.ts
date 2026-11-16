import type { Prisma } from "@prisma/client";
import { clientVisibilityFilter, isManager } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customOrLegacy, scopeFor, type RoleUser } from "@/lib/roles/catalog";

type ClientMasterUser = RoleUser & { id: string };

/** 主档维护沿用既有岗位规则；系统身份、管理查看权不替代此资格。 */
export function canMaintainClientMaster(user: RoleUser): boolean {
  return customOrLegacy(user, "clients.write", isManager(user.role));
}

/** CUSTOM 的写入范围不能用客户读取范围替代。Personal 保留本人主档范围。 */
export function clientMasterWriteFilter(user: ClientMasterUser): Prisma.ClientWhereInput {
  if (!canMaintainClientMaster(user)) return { id: { in: [] } };
  if (user.runtimeMode === "PERSONAL") return { ownerUserId: user.id };
  if (user.role !== "CUSTOM") return {};
  const scope = scopeFor(user, "clients.write");
  return clientVisibilityFilter(user.id, user.role, scope ? [{ permissionKey: "clients.read", scope }] : []);
}

/** 只计算当前已读取页面中的可编辑对象；保存时仍由 action 重验。 */
export async function editableClientIds(
  user: ClientMasterUser,
  ids: string[],
  db: Prisma.TransactionClient = prisma
): Promise<string[]> {
  if (!ids.length || !canMaintainClientMaster(user)) return [];
  const rows = await db.client.findMany({
    where: { id: { in: ids }, deletedAt: null, AND: [clientMasterWriteFilter(user)] },
    select: { id: true }
  });
  return rows.map((row) => row.id);
}
