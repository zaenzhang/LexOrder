import { safeFetch } from "@/lib/net/safe-url";
import type { RetrievalErrorCode } from "@/lib/workbench/contracts";

export class ServiceFailure extends Error {
  constructor(readonly code: RetrievalErrorCode) { super(code); }
}

export interface ServiceTransport {
  request(path: string, init?: RequestInit, binary?: boolean): Promise<unknown>;
}

export interface ServiceConfiguration {
  baseUrl: string;
  apiKey?: string;
  authentication?: "bearer" | "none";
  // Trusted configuration comes from the process owner, never query/model input.
  trustedOrigin?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new ServiceFailure("INVALID_RESULT");
      parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function createServiceTransport(config: ServiceConfiguration): ServiceTransport {
  const base = new URL(config.baseUrl.replace(/\/$/, ""));
  if (base.username || base.password || base.search || base.hash ||
      !["https:", "http:"].includes(base.protocol) ||
      (config.trustedOrigin ? base.origin !== config.trustedOrigin : base.protocol !== "https:") ||
      (config.authentication === "none" ? !config.trustedOrigin : !config.apiKey?.trim()) ||
      (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 300_000))) throw new ServiceFailure("INVALID_INPUT");
  return {
    async request(path, init = {}, binary = false) {
      if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") ||
          path.split(/[/?]/).includes("..")) throw new ServiceFailure("INVALID_INPUT");
      const url = new URL(base.href.replace(/\/$/, "") + path);
      if (url.origin !== base.origin) throw new ServiceFailure("INVALID_INPUT");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
      const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      const headers = new Headers(init.headers);
      if (config.authentication === "none") headers.delete("Authorization");
      else headers.set("Authorization", "Bearer " + config.apiKey);
      let onAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new ServiceFailure(init.signal?.aborted ? "CANCELLED" : "TIMEOUT"));
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([aborted, (async () => {
          if (signal.aborted) throw new ServiceFailure(init.signal?.aborted ? "CANCELLED" : "TIMEOUT");
          const options = { ...init, headers, signal, redirect: "error" as const };
          const response = config.trustedOrigin
            ? await fetch(url, options)
            : await safeFetch(url.href, options);
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new ServiceFailure(response.status === 401 || response.status === 403 ? "UNAUTHORIZED"
              : response.status === 429 ? "RATE_LIMITED"
              : response.status === 408 || response.status === 504 ? "TIMEOUT"
              : response.status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT");
          }
          const body = await boundedBody(response, config.maxResponseBytes ?? 32 * 1024 * 1024);
          if (binary) return body;
          try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
          catch { throw new ServiceFailure("INVALID_RESULT"); }
        })()]);
      } catch (error) {
        if (error instanceof ServiceFailure) throw error;
        if (init.signal?.aborted) throw new ServiceFailure("CANCELLED");
        if (controller.signal.aborted) throw new ServiceFailure("TIMEOUT");
        throw new ServiceFailure("SERVICE_UNAVAILABLE");
      } finally { clearTimeout(timeout); signal.removeEventListener("abort", onAbort); }
    },
  };
}

export function serviceError(error: unknown): RetrievalErrorCode {
  return error instanceof ServiceFailure ? error.code : "SERVICE_UNAVAILABLE";
}
