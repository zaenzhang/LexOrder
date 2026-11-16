import { listAuditLogs } from "@/server/settings/actions";
import { listUsers } from "@/server/users/actions";
import { AuditView } from "./_components/audit-view";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";

type Props = { searchParams: Promise<{ action?: string; userId?: string; days?: string }> };

export default async function AuditPage({ searchParams }: Props) {
  const session = await requireWorkspaceConfiguration();
  const filters = await searchParams;
  const [{ items, distinctActions }, users] = await Promise.all([
    listAuditLogs({
      action: filters.action,
      userId: filters.userId,
      days: filters.days ? Number(filters.days) : 30
    }),
    session.user.runtimeMode === "PERSONAL"
      ? Promise.resolve([{ id: session.user.id, name: session.user.name || "本机操作者" }])
      : listUsers()
  ]);
  return <AuditView items={items} distinctActions={distinctActions} userOptions={users.map(user => ({ id: user.id, name: user.name }))} initialFilters={{ action: filters.action ?? "ALL", userId: filters.userId ?? "ALL", days: filters.days ?? "30" }} />;
}
