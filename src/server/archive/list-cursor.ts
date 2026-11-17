import { createHash } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { decodePaginationCursor, encodePaginationCursor } from "@/server/pagination-cursor";

export const archiveListSchema = z.object({
  query: z.string().trim().max(200, "检索词过长，请缩短后重试").default(""),
  cursor: z.string().min(1).max(1200).optional(),
}).strict();
export type ArchiveListInput = z.input<typeof archiveListSchema>;
const payloadSchema = z.object({
  v: z.literal(1), userId: z.string().min(1).max(100), queryHash: z.string().length(64),
  at: z.string().datetime(), id: z.string().cuid(),
}).strict();
const domain = "LexOrder.archive-records.cursor.v1";
function queryHash(query: string) { return createHash("sha256").update(query).digest("hex"); }

export function encodeArchiveListCursor(userId: string, query: string, position: { at: string; id: string }) {
  return encodePaginationCursor(domain, { v: 1, userId, queryHash: queryHash(query), ...position });
}
export function decodeArchiveListCursor(token: string, userId: string, query: string) {
  const parsed = payloadSchema.safeParse(decodePaginationCursor(domain, token));
  if (!parsed.success || parsed.data.userId !== userId || parsed.data.queryHash !== queryHash(query)) {
    throw new ActionError("归档查找位置已失效，请从第一页重新查找");
  }
  return { at: parsed.data.at, id: parsed.data.id };
}
