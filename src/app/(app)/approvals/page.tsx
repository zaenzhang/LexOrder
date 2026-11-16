import { ApprovalAction } from "@prisma/client";
import { listApprovalWorkspace } from "@/server/approval-permissions/inbox";
import { ApprovalInbox } from "./approval-inbox";
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const data = await listApprovalWorkspace(params);
  const action = typeof params.type === "string" && Object.values(ApprovalAction).includes(params.type as ApprovalAction) ? params.type as ApprovalAction : undefined;
  const initialSelection = action && typeof params.id === "string" ? { action, id: params.id } : undefined;
  const returnTo = typeof params.returnTo === "string" ? params.returnTo : params.returnTo === undefined ? undefined : "";
  return <ApprovalInbox data={data} initialSelection={initialSelection} returnTo={returnTo} />;
}
