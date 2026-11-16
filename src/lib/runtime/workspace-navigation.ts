/** Exact business configuration routes shared by navigation and the Personal route boundary. */
export const PERSONAL_WORKSPACE_CONFIGURATION_PATHS = [
  "/admin",
  "/admin/firm-profile",
  "/admin/reminders",
  "/admin/archive-policy",
  "/admin/document-templates",
  "/admin/templates",
  "/admin/custom-fields",
  "/admin/ai",
  "/admin/express",
  "/admin/import",
  "/admin/audit",
] as const;

export function isPersonalWorkspaceConfigurationPath(pathname: string): boolean {
  return PERSONAL_WORKSPACE_CONFIGURATION_PATHS.some(path => path === pathname);
}
