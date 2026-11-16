import type { Prisma } from "@prisma/client";
import { customMatterFilter, matterAssociationFilter, matterFinanceVisibilityFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import type { RoleUser } from "./catalog";
import { hasPersonalCapability } from "@/lib/runtime/capabilities";
export type ReportAccess = { matters: Prisma.MatterWhereInput; finance: Prisma.MatterWhereInput };
export function reportAccess(user: RoleUser & { id: string }, exporting = false): ReportAccess {
  if(user.runtimeMode === "PERSONAL"){
    const own: Prisma.MatterWhereInput = hasPersonalCapability(user,exporting?"reports.export":"reports.read")
      ? {deletedAt:null,...matterAssociationFilter(user.id)} : {id:{in:[]}};
    return {matters:own,finance:own};
  }
  if (user.role !== "CUSTOM") return { matters: {}, finance: {} };
  const scope = customMatterFilter(user.id, user.rolePermissions, exporting ? "reports.export" : "reports.read", false);
  return {
    matters: { AND: [scope, matterReadVisibilityFilter(user.id, user.role, user.rolePermissions)] },
    finance: { AND: [scope, matterFinanceVisibilityFilter(user.id, user.role, user.rolePermissions)] },
  };
}
