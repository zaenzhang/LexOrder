/** 当前合同办理入口；返回地址由 reconciliation 页面按获授权案件校验。 */
export function contractHref({ matterId, billingId, action, returnTo }: { matterId?: string; billingId?: string; action?: "create"; returnTo?: string }) {
  const params = new URLSearchParams({ tab: "contracts" });
  if (matterId) params.set("matterId", matterId);
  if (billingId) params.set("billingId", billingId);
  if (action) params.set("action", action);
  if (returnTo) params.set("returnTo", returnTo);
  return `/finance/reconciliation?${params}`;
}
