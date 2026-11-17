import { createHash } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { decodePaginationCursor, encodePaginationCursor } from "@/server/pagination-cursor";

export const searchGroups = ["matters", "clients", "intakes", "documents", "deadlines"] as const;
export type SearchGroup = typeof searchGroups[number];
export const searchQuerySchema = z.string().trim().max(500, "检索词过长，请缩短后重试");
export const searchPageSchema = z.object({
  query: searchQuerySchema.pipe(z.string().min(1, "请填写检索词")),
  group: z.enum(searchGroups), cursor: z.string().min(1).max(1200).optional(),
}).strict();
const envelope = z.object({
  v: z.literal(1), userId: z.string().min(1).max(100), queryHash: z.string().length(64),
  group: z.enum(searchGroups), at: z.string().datetime(), id: z.string().min(1).max(100),
}).strict();
const domain = "LexOrder.global-search.cursor.v1";
export type SearchPosition = { at: string; id: string };
const queryHash = (query: string) => createHash("sha256").update(query).digest("hex");

export function encodeSearchCursor(userId: string, query: string, group: SearchGroup, point: SearchPosition) {
  return encodePaginationCursor(domain, envelope.parse({ v: 1, userId, queryHash: queryHash(query), group, ...point }));
}

export function decodeSearchCursor(token: string | undefined, userId: string, query: string, group: SearchGroup): SearchPosition | null {
  if (token === undefined) return null;
  const payload = envelope.safeParse(decodePaginationCursor(domain, token));
  if (!payload.success || payload.data.userId !== userId || payload.data.queryHash !== queryHash(query) || payload.data.group !== group) {
    throw new ActionError("检索位置已失效，请从头检索此范围");
  }
  return { at: payload.data.at, id: payload.data.id };
}

export function searchBoundary(field: "updatedAt" | "createdAt" | "receivedAt" | "dueAt", point: SearchPosition | null, ascending = false) {
  if (!point) return {};
  const at = new Date(point.at), comparison = ascending ? "gt" : "lt";
  return { OR: [{ [field]: { [comparison]: at } }, { [field]: at, id: { [comparison]: point.id } }] };
}
