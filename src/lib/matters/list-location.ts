import { z } from "zod";
import { MatterCategory } from "@prisma/client";
import { matterHref } from "./route";

export type MattersTab = "intake" | "active" | "archived" | "revision" | "all";
export type MatterSortBy = "hearing" | "intakeDate" | "claimAmount" | "archivedAt";

export function defaultSortByForTab(tab: MattersTab): MatterSortBy {
  if (tab === "active") return "hearing";
  if (tab === "archived") return "archivedAt";
  return "intakeDate";
}

export function supportsSortBy(tab: MattersTab, sortBy: MatterSortBy) {
  if (sortBy === "hearing") return tab === "active" || tab === "all";
  if (sortBy === "archivedAt") return tab === "archived";
  if (sortBy === "claimAmount") return tab !== "archived";
  return true;
}

const listFilters = z.strictObject({
  tab: z.enum(["intake", "active", "archived", "revision", "all"]).optional(),
  scope: z.enum(["all", "mine", "team"]).optional(),
  teamId: z.string().cuid().optional(), ownerId: z.string().cuid().optional(),
  search: z.string().optional(), category: z.nativeEnum(MatterCategory).optional(),
  status: z.enum(["active", "closed", "archived"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum(["hearing", "intakeDate", "claimAmount", "archivedAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(), page: z.string().regex(/^[1-9]\d*$/).optional(),
});

/** The list's applied filters, never another URL or a create-form intent. */
export function matterListEntryHref(matter: { internalCode: string }, listQuery?: string) {
  return matterHref(matter, listQuery ? `?list=${encodeURIComponent(listQuery)}` : "");
}
export function matterListReturnHref(listQuery: string | null): string | null {
  if (listQuery === null) return "/matters";
  const params = new URLSearchParams(listQuery);
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return null;
  const parsed = listFilters.safeParse(Object.fromEntries(params));
  if (!parsed.success) return null;
  const { tab = "active", sortBy, status } = parsed.data;
  if ((sortBy && !supportsSortBy(tab, sortBy)) || (status && tab !== "all")) return null;
  return `/matters${params.size ? `?${params}` : ""}`;
}
