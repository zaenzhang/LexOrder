import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./options";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission, type PermissionKey } from "@/lib/roles/catalog";
import { prisma } from "@/lib/prisma";
import { isSystemAdmin } from "./system-role";
import { ActionError } from "@/lib/action-error";
import { headers } from "next/headers";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { resolvePersonalActor } from "@/server/runtime/personal";
import type { WorkspaceActor, WorkspaceSession } from "@/lib/runtime/actor";

/**
 * Server Component / Server Action 中读取当前 session。
 * 未登录返回 null。
 */
export async function getSession(): Promise<WorkspaceSession | null> {
  if (isPersonalMode()) {
    if (!personalChannelAllowed(await headers())) return null;
    const user = await resolvePersonalActor(prisma);
    return user ? { user } : null;
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { active: true, role: true, systemRole: true }
  });
  if (!user?.active) return null;
  const access = await resolveRoleUser(session.user.id, user.role);
  if (!access.enabled) return null;
  session.user.role = user.role;
  session.user.systemRole = user.systemRole;
  session.user.roleName = access.roleName;
  session.user.rolePermissions = access.rolePermissions;
  session.user.managerAuthorized = access.managerAuthorized === true;
  return { ...session, user: { ...session.user, runtimeMode: "SERVER" } as WorkspaceActor };
}

/**
 * 要求登录，未登录强制跳 /login。
 * 在 Server Component / Server Action 中使用。
 */
export async function requireSession(permission?: PermissionKey | "personal" | "approval") {
  const session = await getSession();
  if (!session?.user) {
    if (isPersonalMode()) throw new ActionError("请通过本机工作区入口打开应用");
    redirect("/login");
  }
  if (session.user.role === "CUSTOM" && (permission === undefined || (permission !== "personal" && permission !== "approval" && !hasCustomPermission(session.user, permission)))) {
    throw new ActionError("当前角色无权访问此功能，请联系管理员调整角色权限");
  }
  return session;
}

export async function requireSystemAdmin() {
  const session = await requireSession("personal");
  if (session.user.runtimeMode === "PERSONAL" || !isSystemAdmin(session.user)) {
    throw new ActionError("仅系统超级管理员可执行");
  }
  return session;
}

/** Business configuration only. Account, role and organization actions keep requireSystemAdmin. */
export async function requireWorkspaceConfiguration() {
  const session = await requireSession("personal");
  if (session.user.runtimeMode !== "PERSONAL" && !isSystemAdmin(session.user)) {
    throw new ActionError("仅系统超级管理员可配置工作区");
  }
  return session;
}
