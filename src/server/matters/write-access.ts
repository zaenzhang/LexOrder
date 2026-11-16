import type { Prisma } from "@prisma/client";
import type { PermissionKey, RoleUser } from "@/lib/roles/catalog";
import { checkRoleMutation } from "@/lib/roles/service";
import { matterAssociationFilter } from "@/lib/permissions";
import { ActionError } from "@/lib/action-error";

/** Serialize with authorization changes and archival before rechecking current access. */
export async function lockWritableMatters(
  tx: Prisma.TransactionClient,
  user: RoleUser & { id: string },
  permission: PermissionKey,
  ids: readonly string[],
  leadOnly = false,
) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  await checkRoleMutation(tx, user, permission);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: user.id }, select: { active: true, role: true } });
  if (!current?.active || current.role !== user.role) throw new ActionError("账号或岗位已变化，请刷新后重试");
  const uniqueIds = [...new Set(ids)].sort();
  for (const id of uniqueIds) await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${id} FOR UPDATE`;
  const matters = await tx.matter.findMany({
    where: { id: { in: uniqueIds }, deletedAt: null, ...(leadOnly
      ? { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id, role: { in: ["LEAD", "CO_LEAD"] } } } }] }
      : matterAssociationFilter(user.id)) },
    select: { id: true, status: true, serviceStatus: true },
  });
  if (matters.length !== uniqueIds.length) throw new ActionError("案件不存在或无权处理");
  if (matters.some(matter => matter.status === "ARCHIVED")) throw new ActionError("案件已归档，禁止修改");
  return matters;
}
