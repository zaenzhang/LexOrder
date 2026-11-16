import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { decodePaginationCursor, encodePaginationCursor } from "@/server/pagination-cursor";

const envelope = z.object({
  v: z.literal(1), matterId: z.string().cuid(), userId: z.string().cuid(),
  kind: z.enum(["records", "DOCUMENT", "NOTE", "CLIENT_ACTIVITY"]),
  at: z.string().datetime(), id: z.string().cuid(),
}).strict();
type ContextPageKind = z.infer<typeof envelope>["kind"];
type ContextPosition = { at: string; id: string };
const domain = "LexOrder.matter-context.cursor.v1";

export function encodeContextCursor(matterId: string, userId: string, kind: ContextPageKind, point: ContextPosition): string {
  return encodePaginationCursor(domain, envelope.parse({ v: 1, matterId, userId, kind, ...point }));
}

export function decodeContextCursor(token: string | undefined, matterId: string, userId: string, kind: ContextPageKind): ContextPosition | null {
  if (token === undefined) return null;
  const payload = envelope.safeParse(decodePaginationCursor(domain, token));
  if (!payload.success || payload.data.matterId !== matterId || payload.data.userId !== userId || payload.data.kind !== kind) {
    throw new ActionError("分页位置已失效，请重新读取");
  }
  return { at: payload.data.at, id: payload.data.id };
}

export function contextPageBoundary(field: "createdAt" | "occurredAt", point: ContextPosition | null) {
  if (!point) return {};
  const at = new Date(point.at);
  return { OR: [{ [field]: { lt: at } }, { [field]: at, id: { lt: point.id } }] };
}
