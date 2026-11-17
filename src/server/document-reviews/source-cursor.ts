import { createHash } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { decodePaginationCursor, encodePaginationCursor } from "@/server/pagination-cursor";

const envelope = z.object({
  v: z.literal(1), userId: z.string().cuid(), documentId: z.string().cuid(), queryHash: z.string().length(64),
  at: z.string().datetime(), id: z.string().cuid(),
}).strict();
const domain = "LexOrder.document-review.sources.v1";
const queryHash = (query: string) => createHash("sha256").update(query).digest("hex");
type SourcePosition = { at: string; id: string };
export function encodeReviewSourceCursor(userId: string, documentId: string, query: string, point: SourcePosition) {
  return encodePaginationCursor(domain, envelope.parse({ v: 1, userId, documentId, queryHash: queryHash(query), ...point }));
}
export function decodeReviewSourceCursor(token: string | undefined, userId: string, documentId: string, query: string): SourcePosition | null {
  if (token === undefined) return null;
  const payload = envelope.safeParse(decodePaginationCursor(domain, token));
  if (!payload.success || payload.data.userId !== userId || payload.data.documentId !== documentId || payload.data.queryHash !== queryHash(query)) {
    throw new ActionError("依据查找位置已失效，请重新查找");
  }
  return { at: payload.data.at, id: payload.data.id };
}
