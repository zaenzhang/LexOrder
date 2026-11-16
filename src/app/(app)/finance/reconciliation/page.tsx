import Link from "next/link";
import { canConfirmReceipt } from "@/lib/permissions";
import { requireSession } from "@/lib/auth/session";
import { canExecuteFinance, hasCustomPermission } from "@/lib/roles/catalog";
import { getFinanceLedger } from "@/server/finance/ledger-actions";
import { PageHeader } from "@/components/patterns/moan";
import { ActionError } from "@/lib/action-error";
import { isMatterReturnHref } from "@/lib/matters/return-location";
import { LedgerWorkspace, type LedgerTab } from "./_components/ledger-workspace";
import { contractHref } from "./_components/contract-location";

type Params = Record<string, string | string[] | undefined>;
function Unavailable({ message, matterId }: { message: string; matterId?: string }) {
  return <div className="space-y-4"><PageHeader title="财务入口不可用" /><p role="alert" className="text-sm text-destructive">{message}</p><Link className="btn btn-secondary btn-sm" href={contractHref({ matterId })}>查看合同列表</Link></div>;
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireSession("finance.read");
  const params = await searchParams;
  for (const key of ["matterId", "tab", "action", "billingId", "returnTo"]) {
    if (params[key] !== undefined && (typeof params[key] !== "string" || !params[key])) return <Unavailable message="入口参数不完整，请从合同列表重新选择。" />;
  }
  const matterId = params.matterId as string | undefined;
  const billingId = params.billingId as string | undefined;
  const action = params.action as string | undefined;
  const tab = (params.tab ?? "overview") as LedgerTab;
  if (!["overview", "ledger", "invoices", "contracts"].includes(tab) || (action && action !== "create") || ((action || billingId) && tab !== "contracts") || (action && billingId) || (billingId && !matterId)) {
    return <Unavailable message="此办理入口已失效，请重新选择合同或操作。" />;
  }
  let data: Awaited<ReturnType<typeof getFinanceLedger>>;
  try { data = await getFinanceLedger(matterId); }
  catch (error) { if (error instanceof ActionError) return <Unavailable message={error.message} />; throw error; }
  const selectedBilling = billingId ? data.billings.find(billing => billing.id === billingId) : undefined;
  if (billingId && !selectedBilling) return <Unavailable message="指定合同不存在或当前无权查看，请从可见合同列表选择。" matterId={matterId} />;
  const currentMatter = data.matters.find(matter => matter.id === matterId);
  const returnTo = params.returnTo as string | undefined;
  if (returnTo) {
    if (!currentMatter || !isMatterReturnHref(returnTo, currentMatter)) {
      return <Unavailable message="返回位置不属于当前案件，请重新选择合同入口。" matterId={matterId} />;
    }
  }
  const canWrite = hasCustomPermission(session.user, "finance.write");
  if (action === "create" && (!canWrite || currentMatter?.status === "ARCHIVED" || !data.matters.some(matter => matter.status !== "ARCHIVED"))) return <Unavailable message="当前没有可登记合同的案件。" matterId={matterId} />;
  return <div className="space-y-5">
    <PageHeader title="应收与收款分配" actions={<Link className="btn btn-secondary btn-sm" href={returnTo ?? "/finance"}>{returnTo ? "返回案件" : "返回财务"}</Link>} />
    <LedgerWorkspace data={data} canConfirm={canConfirmReceipt(session.user)} canCorrect={canExecuteFinance(session.user,"finance.correct")} canSettle={canExecuteFinance(session.user,"finance.settle")} canWrite={canWrite} selectedMatterId={matterId} tab={tab} billingId={billingId} createContract={action === "create"} returnTo={returnTo} />
  </div>;
}
