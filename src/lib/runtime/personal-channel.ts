import { timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { isPersonalMode } from "./mode";

export const PERSONAL_CHANNEL_COOKIE = "lexorder_local_channel";
export const PERSONAL_SKILL_MCP_PATH = "/api/personal/skill-mcp";
export type PersonalRuntime = Readonly<{
  origin: string; token: string; workspaceId: string; actorId: string; manifestPath: string;
}>;

/** Secrets are server-only environment values, never NEXT_PUBLIC configuration. */
export function personalRuntime(): PersonalRuntime {
  if (!isPersonalMode()) throw new Error("PERSONAL_RUNTIME_UNAVAILABLE");
  const origin = process.env.LEXORDER_PERSONAL_ORIGIN ?? "";
  const token = process.env.LEXORDER_PERSONAL_CHANNEL_TOKEN ?? "";
  const workspaceId = process.env.LEXORDER_PERSONAL_WORKSPACE_ID ?? "";
  const actorId = process.env.LEXORDER_PERSONAL_ACTOR_ID ?? "";
  const manifestPath = process.env.LEXORDER_PERSONAL_MANIFEST ?? "";
  let endpoint: URL;
  try { endpoint = new URL(origin); } catch { throw new Error("PERSONAL_RUNTIME_INCOMPLETE"); }
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.origin !== origin
    || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9-]{36}$/.test(workspaceId)
    || !/^c[a-z0-9]{24,}$/.test(actorId) || !isAbsolute(manifestPath)) {
    throw new Error("PERSONAL_RUNTIME_INCOMPLETE");
  }
  return Object.freeze({ origin, token, workspaceId, actorId, manifestPath });
}

export function validPersonalToken(value: string | null | undefined, runtime = personalRuntime()): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    && timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(runtime.token, "hex"));
}

export function personalChannelAllowed(headers: Pick<Headers, "get">, options: {
  method?: string; requireCookie?: boolean; bootstrap?: boolean; allowMissingOrigin?: boolean;
} = {}): boolean {
  const runtime = personalRuntime();
  const host = new URL(runtime.origin).host;
  if (headers.get("host") !== host) return false;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== host) return false;
  const origin = headers.get("origin");
  if (origin && origin !== runtime.origin) return false;
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && origin !== runtime.origin && !(options.allowMissingOrigin && origin === null)) return false;
  if (!options.bootstrap && headers.get("sec-fetch-site") === "cross-site") return false;
  if (options.requireCookie === false) return true;
  const cookies = (headers.get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => value.startsWith(PERSONAL_CHANNEL_COOKIE + "="));
  return cookies.length === 1 && validPersonalToken(cookies[0].slice(PERSONAL_CHANNEL_COOKIE.length + 1), runtime);
}
