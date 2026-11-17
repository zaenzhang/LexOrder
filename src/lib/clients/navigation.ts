const CLIENT_TYPES = new Set(["INDIVIDUAL", "COMPANY", "ORGANIZATION"]);
const LIST_PARAMETERS = new Set(["search", "type", "page"]);
import { personalFollowUpHref, personalFollowUpLocation } from "./follow-ups";

export function clientListHref({ search, type, page }: { search?: string; type?: string; page?: number }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (type && CLIENT_TYPES.has(type)) params.set("type", type);
  if (page !== undefined && Number.isSafeInteger(page) && page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/clients${query ? `?${query}` : ""}`;
}

/** Only the client list or personal follow-up list and their exact filters are return destinations. */
export function clientListReturnHref(value: unknown): string {
  if (typeof value !== "string" || value.includes("#")) return "/clients";
  const queryAt = value.indexOf("?");
  const pathname = queryAt < 0 ? value : value.slice(0, queryAt);
  if (pathname === "/clients/follow-ups") {
    const params = new URLSearchParams(queryAt < 0 ? "" : value.slice(queryAt + 1));
    for (const key of params.keys()) if (!["filter", "page"].includes(key) || params.getAll(key).length !== 1) return "/clients";
    const location = personalFollowUpLocation(Object.fromEntries(params));
    return location.query ? personalFollowUpHref(location.query) : "/clients";
  }
  if (pathname !== "/clients") return "/clients";
  const params = new URLSearchParams(queryAt < 0 ? "" : value.slice(queryAt + 1));
  for (const key of params.keys()) {
    if (!LIST_PARAMETERS.has(key) || params.getAll(key).length !== 1) return "/clients";
  }
  const type = params.get("type");
  if (type !== null && !CLIENT_TYPES.has(type)) return "/clients";
  const page = params.get("page");
  if (page !== null && (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))) return "/clients";
  return clientListHref({ search: params.get("search") ?? undefined, type: type ?? undefined, page: page === null ? undefined : Number(page) });
}
import { clientHistoryLocationSchema, clientPageInputSchema, type ClientHistoryFilters } from "./history";


/** This return link belongs only to a concrete context record in client history. */
export function clientHistoryHref(clientId: string, input: { cursor?: string | null; rowId?: string | null; returnTo?: unknown; filters?: ClientHistoryFilters } = {}) {
  const params = new URLSearchParams({ tab: "history" });
  if (input.cursor) params.set("historyCursor", input.cursor);
  if (input.rowId) params.set("rowId", input.rowId);
  if (input.filters?.from) params.set("historyFrom", input.filters.from);
  if (input.filters?.to) params.set("historyTo", input.filters.to);
  if (input.filters?.source) params.set("historySource", input.filters.source);
  if (input.filters?.matterId) params.set("historyMatterId", input.filters.matterId);
  const listReturn = clientListReturnHref(input.returnTo);
  if (listReturn !== "/clients") params.set("returnTo", listReturn);
  return `/clients/${encodeURIComponent(clientId)}?${params}`;
}

export function clientHistoryReturnHref(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("#")) return null;
  const queryAt = value.indexOf("?");
  if (queryAt < 0) return null;
  const path = value.slice(0, queryAt);
  const clientId = path.startsWith("/clients/") ? path.slice("/clients/".length) : "";
  if (!clientPageInputSchema.shape.clientId.safeParse(clientId).success) return null;
  const params = new URLSearchParams(value.slice(queryAt + 1));
  const allowed = new Set(["tab", "historyCursor", "rowId", "returnTo", "historyFrom", "historyTo", "historySource", "historyMatterId"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
  if (params.get("tab") !== "history") return null;
  const location = clientHistoryLocationSchema.safeParse(Object.fromEntries(params));
  if (!location.success) return null;
  return clientHistoryHref(clientId, { cursor: location.data.historyCursor, rowId: location.data.rowId, filters: location.data.filters, returnTo: params.get("returnTo") });
}
