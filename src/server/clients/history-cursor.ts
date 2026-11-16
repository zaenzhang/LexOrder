import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import type { HistorySource } from "@/lib/clients/history";
import { decodePaginationCursor, encodePaginationCursor } from "@/server/pagination-cursor";

export type ClientListKind = "matters" | "communications" | "followUps" | "history";
export type HistoryPosition = { at: string; source: HistorySource; id: string };
const envelope = z.object({
  v: z.literal(1), clientId: z.string().cuid(), userId: z.string().cuid(),
  kind: z.enum(["matters", "communications", "followUps", "history"]),
  at: z.string().datetime(), source: z.enum(["CLIENT_ACTIVITY", "CONTACT", "CONTEXT", "FEE", "FOLLOW_UP", "INTAKE", "MATTER", "NOTE"]),
  id: z.string().cuid()
}).strict();
const domain = "LexOrder.client-history.cursor.v1";

export function encodeClientCursor(clientId: string, userId: string, kind: ClientListKind, point: HistoryPosition): string {
  return encodePaginationCursor(domain, envelope.parse({ v: 1, clientId, userId, kind, ...point }));
}

export function decodeClientCursor(token: string | undefined, clientId: string, userId: string, kind: ClientListKind): HistoryPosition | null {
  if (!token) return null;
  try {
    const payload = envelope.parse(decodePaginationCursor(domain, token));
    if (payload.clientId !== clientId || payload.userId !== userId || payload.kind !== kind) throw new Error();
    const expected = { matters: "MATTER", communications: "CLIENT_ACTIVITY", followUps: "FOLLOW_UP" };
    if (kind !== "history" && payload.source !== expected[kind]) throw new Error();
    return { at: payload.at, source: payload.source, id: payload.id };
  } catch { throw new ActionError("分页位置已失效，请刷新后重试"); }
}

/** Value boundary: deletion of a former anchor row cannot break the next page. */
export function pageBoundary(field: string, point: HistoryPosition | null, source: HistorySource, ascending = false) {
  if (!point) return {};
  const op = ascending ? "gt" : "lt";
  const at = new Date(point.at);
  const tie = source === point.source ? { id: { [op]: point.id } }
    : (ascending ? source > point.source : source < point.source) ? {} : null;
  return { OR: [{ [field]: { [op]: at } }, ...(tie ? [{ [field]: at, ...tie }] : [])] };
}

export function compareHistoryPositions(a: HistoryPosition, b: HistoryPosition) {
  for (const field of ["at", "source", "id"] as const) {
    if (a[field] !== b[field]) return a[field] > b[field] ? -1 : 1;
  }
  return 0;
}
