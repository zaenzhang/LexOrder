import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import type { HistorySource } from "@/lib/clients/history";

export type ClientListKind = "matters" | "communications" | "followUps" | "history";
export type HistoryPosition = { at: string; source: HistorySource; id: string };
const envelope = z.object({
  v: z.literal(1), clientId: z.string().cuid(), userId: z.string().cuid(),
  kind: z.enum(["matters", "communications", "followUps", "history"]),
  at: z.string().datetime(), source: z.enum(["CLIENT_ACTIVITY", "CONTACT", "CONTEXT", "FEE", "FOLLOW_UP", "INTAKE", "MATTER", "NOTE"]),
  id: z.string().cuid()
}).strict();
const domain = Buffer.from("LexOrder.client-history.cursor.v1");
// Development can use NextAuth's process-local secret. Production already requires
// NEXTAUTH_SECRET; sharing it across web instances also makes these cursors portable.
const developmentKey = randomBytes(32);
function cursorKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new ActionError("分页配置不可用，请联系管理员");
  return createHash("sha256").update(domain).update(secret ?? developmentKey).digest();
}

export function encodeClientCursor(clientId: string, userId: string, kind: ClientListKind, point: HistoryPosition): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cursorKey(), iv);
  cipher.setAAD(domain);
  const bytes = Buffer.from(JSON.stringify(envelope.parse({ v: 1, clientId, userId, kind, ...point })));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decodeClientCursor(token: string | undefined, clientId: string, userId: string, kind: ClientListKind): HistoryPosition | null {
  if (!token) return null;
  try {
    if (token.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length < 29 || bytes.toString("base64url") !== token) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", cursorKey(), bytes.subarray(0, 12));
    decipher.setAAD(domain); decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = envelope.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
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
