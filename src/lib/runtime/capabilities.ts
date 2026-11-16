import type { PermissionKey } from "@/lib/roles/catalog";

/** Local business capabilities are not role grants or an ALL data scope. */
export const PERSONAL_CAPABILITIES = [
  "matters.read", "intakes.create", "matters.write", "matters.export",
  "clients.read", "clients.write", "documents.read", "documents.write", "documents.download",
  "schedule.read", "schedule.write", "finance.read", "finance.write", "finance.confirm",
  "finance.correct", "finance.settle", "finance.tail", "invoices.process",
  "archive.read", "archive.submit", "archive.supplement", "reports.read", "reports.export",
  "seals.request", "contacts.manage", "contacts.review", "express.manage", "firm-files.manage",
] as const satisfies readonly PermissionKey[];

type CapabilityUser = { role: string; runtimeMode?: "PERSONAL" | "SERVER" };

/** UI hints only until the server resolves the workspace actor and checks the object. */
export function hasPersonalCapability(user: CapabilityUser | null | undefined, key: PermissionKey): boolean {
  return user?.runtimeMode === "PERSONAL" && user.role === "INDEPENDENT_LAWYER"
    && (PERSONAL_CAPABILITIES as readonly PermissionKey[]).includes(key);
}

export function personalAuditMetadata(
  user: CapabilityUser | null | undefined,
  kind: "SUBMISSION" | "CONFIRMATION" | "REJECTION" | "EXECUTION" | "CHANGE",
) {
  return user?.runtimeMode === "PERSONAL" ? {
    runtimeMode: "PERSONAL" as const,
    decisionPolicy: kind === "CONFIRMATION" ? "PERSONAL_SELF" as const : "PERSONAL_LOCAL" as const,
    decisionKind: kind,
  } : {};
}
