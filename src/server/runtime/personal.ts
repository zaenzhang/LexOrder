import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalRuntime } from "@/lib/runtime/personal-channel";
import type { WorkspaceActor } from "@/lib/runtime/actor";

/**
 * The caller supplies its transaction/connection. This helper must never acquire
 * a second Prisma connection while a Personal transaction owns the only one.
 */
export async function resolvePersonalActor(db: Prisma.TransactionClient, userId?: string): Promise<WorkspaceActor | null> {
  if (!isPersonalMode()) return null;
  const runtime = personalRuntime();
  if (userId !== undefined && userId !== runtime.actorId) throw new ActionError("当前操作者不属于本机工作区");
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(await readFile(runtime.manifestPath, "utf8")); }
  catch { throw new ActionError("本机工作区信息不可用，请重新打开工作区"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new ActionError("本机工作区信息不可用，请重新打开工作区");
  }
  const setting = await db.systemSetting.findUnique({ where: { key: "personal-workspace" } });
  const saved = setting?.value as Record<string, unknown> | null | undefined;
  if (manifest.version !== 2 || manifest.mode !== "PERSONAL" || manifest.workspaceId !== runtime.workspaceId
    || manifest.actorId !== runtime.actorId || !saved
    || ["version", "mode", "workspaceId", "actorId"].some(key => saved[key] !== manifest[key])) {
    throw new ActionError("本机工作区身份不一致，请重新打开工作区");
  }
  const actor = await db.user.findUnique({ where: { id: runtime.actorId }, select: {
    id: true, name: true, email: true, avatar: true, active: true, role: true, systemRole: true,
    passwordHash: true, managerAuthorized: true, roleDefinitionId: true, totpEnabled: true, totpEnforced: true,
  } });
  if (!actor?.active || actor.role !== "INDEPENDENT_LAWYER" || actor.systemRole !== "NONE"
    || actor.managerAuthorized || actor.roleDefinitionId || actor.passwordHash !== "!personal-no-login"
    || actor.totpEnabled || actor.totpEnforced) {
    throw new ActionError("本机操作者不可用，请检查工作区");
  }
  return {
    id: actor.id, name: actor.name.trim() || "本机操作者", email: actor.email.endsWith("@personal.invalid") ? null : actor.email.trim() || null,
    avatar: actor.avatar, image: actor.avatar, role: actor.role, systemRole: "NONE",
    managerAuthorized: false, roleName: "个人工作区", runtimeMode: "PERSONAL",
  };
}
