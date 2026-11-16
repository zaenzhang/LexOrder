const CLIENT_TYPES = new Set(["INDIVIDUAL", "COMPANY", "ORGANIZATION"]);
const LIST_PARAMETERS = new Set(["search", "type", "page"]);

export function clientListHref({ search, type, page }: { search?: string; type?: string; page?: number }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (type && CLIENT_TYPES.has(type)) params.set("type", type);
  if (page !== undefined && Number.isSafeInteger(page) && page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/clients${query ? `?${query}` : ""}`;
}

/** Only the client list and its supported filters can be used as a return destination. */
export function clientListReturnHref(value: unknown): string {
  if (typeof value !== "string" || value.includes("#")) return "/clients";
  const queryAt = value.indexOf("?");
  const pathname = queryAt < 0 ? value : value.slice(0, queryAt);
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
