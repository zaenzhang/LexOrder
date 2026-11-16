import { safeFetch } from "@/lib/net/safe-url";
import { isRecord, McpFailure, MCP_TOOL_NAME, mcpEndpointSchema, type McpTool } from "@/lib/legal-mcp/contracts";

/**
 * Streamable HTTP subset, verified against the official 2025-11-25 transport,
 * lifecycle and tools specifications at https://modelcontextprotocol.io/specification/2025-11-25/.
 * Supports JSON/SSE, negotiated version/session headers and bounded SSE resumption.
 * No stdio, OAuth, legacy HTTP+SSE, roots, sampling, elicitation, task or resource execution.
 * Sessions exist for one explicit UI operation; POSTs (especially tools/call) are never replayed.
 * safeFetch supplies the same DNS/IP pinning and SSRF protection as other service transports.
 */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
type Fetcher = (url: string, init?: Record<string, unknown>) => Promise<Response>;
interface Configuration { endpoint: string; apiKey?: string; timeoutMs?: number; maxResponseBytes?: number }

function failureForStatus(status: number) {
  return new McpFailure(status === 401 || status === 403 ? "UNAUTHORIZED" : status === 404 ? "SESSION_EXPIRED"
    : status === 429 ? "RATE_LIMITED" : status === 408 || status === 504 ? "TIMEOUT"
    : status >= 500 ? "SERVICE_UNAVAILABLE" : "PROTOCOL_ERROR");
}
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new McpFailure("PROTOCOL_ERROR"); }
}
function validHeader(value: string) { return value.length <= 512 && /^[\x21-\x7e]+$/.test(value); }

class McpSession {
  private sessionId?: string;
  private protocolVersion?: string;
  private nextId = 0;
  private supportsTools = false;
  private receivedMessages = 0;
  readonly limit: number;
  constructor(private config: Configuration, private signal: AbortSignal, private fetcher: Fetcher) {
    if (!mcpEndpointSchema.safeParse(config.endpoint).success || (config.apiKey && /[\r\n]/.test(config.apiKey))) throw new McpFailure("INVALID_CONFIG");
    this.limit = Math.min(Math.max(config.maxResponseBytes ?? 1_048_576, 256), 2_097_152);
  }
  private headers(accept = "application/json, text/event-stream") {
    const headers: Record<string, string> = { Accept: accept };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    return headers;
  }
  private async fetch(init: Record<string, unknown>) {
    if (this.signal.aborted) throw new McpFailure("TIMEOUT");
    const response = await this.fetcher(this.config.endpoint, { ...init, signal: this.signal, redirect: "error" });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw response.status === 404 && !this.sessionId ? new McpFailure("PROTOCOL_ERROR") : failureForStatus(response.status);
    }
    return response;
  }
  private async post(message: Record<string, unknown>, expectsResponse: boolean, initialize = false) {
    const response = await this.fetch({ method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify(message) });
    const session = response.headers.get("Mcp-Session-Id");
    if (session) {
      if (!validHeader(session) || (!initialize && session !== this.sessionId)) {
        void response.body?.cancel().catch(() => undefined);
        throw new McpFailure("PROTOCOL_ERROR");
      }
      if (initialize) this.sessionId = session;
    }
    if (!expectsResponse) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status !== 202) throw new McpFailure("PROTOCOL_ERROR");
      return;
    }
    return this.receive(response, message.id as number);
  }
  private async envelope(value: unknown, expectedId: number): Promise<{ result: unknown } | undefined> {
    if (!isRecord(value) || value.jsonrpc !== "2.0" || ++this.receivedMessages > 300) throw new McpFailure("PROTOCOL_ERROR");
    if (typeof value.method === "string") {
      // Server declarations/annotations are data. Never execute unadvertised capabilities.
      if ("id" in value) {
        if (typeof value.id !== "string" && typeof value.id !== "number") throw new McpFailure("PROTOCOL_ERROR");
        await this.post(value.method === "ping"
          ? { jsonrpc: "2.0", id: value.id, result: {} }
          : { jsonrpc: "2.0", id: value.id, error: { code: -32601, message: "Client capability not supported" } }, false);
      }
      return;
    }
    if (value.id !== expectedId || ("result" in value) === ("error" in value)) throw new McpFailure("PROTOCOL_ERROR");
    if ("error" in value) throw new McpFailure("REMOTE_ERROR");
    return { result: value.result };
  }
  private async receive(firstResponse: Response, expectedId: number): Promise<unknown> {
    let response = firstResponse;
    let total = 0;
    let lastEventId: string | undefined;
    let retryMs = 1_000;
    for (let attempt = 0; attempt < 3; attempt++) {
      const kind = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (kind !== "application/json" && kind !== "text/event-stream") {
        void response.body?.cancel().catch(() => undefined);
        throw new McpFailure("PROTOCOL_ERROR");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new McpFailure("PROTOCOL_ERROR");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let data: string[] = [];
      let eventType = "";
      try {
        while (true) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try { part = await reader.read(); }
          catch { if (kind === "text/event-stream" && lastEventId && !this.signal.aborted) break; throw new McpFailure(this.signal.aborted ? "TIMEOUT" : "SERVICE_UNAVAILABLE"); }
          if (!part.done) {
            total += part.value.byteLength;
            if (total > this.limit) throw new McpFailure("RESPONSE_TOO_LARGE");
          }
          try { buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true }); }
          catch { throw new McpFailure("PROTOCOL_ERROR"); }
          if (kind === "application/json") { if (part.done) break; continue; }
          // A final CR is a complete SSE line ending, even without a following LF.
          if (part.done && buffer.endsWith("\r")) buffer += "\n";
          while (true) {
            const lineEnd = buffer.search(/[\r\n]/);
            if (lineEnd < 0 || (buffer[lineEnd] === "\r" && lineEnd === buffer.length - 1)) break;
            const line = buffer.slice(0, lineEnd);
            const consumed = buffer[lineEnd] === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1;
            buffer = buffer.slice(lineEnd + consumed);
            if (!line) {
              if (data.length && (!eventType || eventType === "message")) {
                const payload = data.join("\n");
                if (payload.trim()) {
                  const answer = await this.envelope(parseJson(payload), expectedId);
                  if (answer) return answer.result;
                }
              }
              data = []; eventType = "";
              continue;
            }
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (field === "data") data.push(value);
            else if (field === "event") eventType = value;
            else if (field === "id") {
              if (value && !validHeader(value)) throw new McpFailure("PROTOCOL_ERROR");
              lastEventId = value || undefined;
            } else if (field === "retry" && /^\d+$/.test(value)) retryMs = Math.min(Number(value), 60_000);
          }
          if (part.done) break;
        }
        if (kind === "application/json") {
          const answer = await this.envelope(parseJson(buffer), expectedId);
          if (answer) return answer.result;
          throw new McpFailure("PROTOCOL_ERROR");
        }
      } finally { void reader.cancel().catch(() => undefined); }
      // A disconnected SSE stream is resumed by GET, never by replaying the POST.
      if (!lastEventId || attempt === 2) throw new McpFailure("PROTOCOL_ERROR");
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new McpFailure("TIMEOUT")); };
        const timer = setTimeout(() => { this.signal.removeEventListener("abort", onAbort); resolve(); }, retryMs);
        if (this.signal.aborted) onAbort(); else this.signal.addEventListener("abort", onAbort, { once: true });
      });
      response = await this.fetch({ method: "GET", headers: { ...this.headers("text/event-stream"), "Last-Event-ID": lastEventId } });
    }
    throw new McpFailure("PROTOCOL_ERROR");
  }
  private request(method: string, params?: Record<string, unknown>) {
    return this.post({ jsonrpc: "2.0", id: ++this.nextId, method, ...(params ? { params } : {}) }, true, method === "initialize");
  }
  async initialize() {
    const value = await this.request("initialize", { protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: { name: "LexOrder", version: "2.0.1" } });
    if (!isRecord(value) || typeof value.protocolVersion !== "string" || !VERSIONS.includes(value.protocolVersion) || !isRecord(value.capabilities) || !isRecord(value.serverInfo) || typeof value.serverInfo.name !== "string" || typeof value.serverInfo.version !== "string") throw new McpFailure("PROTOCOL_ERROR");
    this.protocolVersion = value.protocolVersion;
    this.supportsTools = isRecord(value.capabilities.tools);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
  }
  async listTools(): Promise<McpTool[]> {
    if (!this.supportsTools) throw new McpFailure("PROTOCOL_ERROR");
    const tools: McpTool[] = [];
    const cursors = new Set<string>();
    const names = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await this.request("tools/list", cursor ? { cursor } : undefined);
      if (!isRecord(result) || !Array.isArray(result.tools)) throw new McpFailure("PROTOCOL_ERROR");
      for (const tool of result.tools) {
        if (!isRecord(tool) || typeof tool.name !== "string" || !MCP_TOOL_NAME.test(tool.name) || names.has(tool.name) || !isRecord(tool.inputSchema) || tool.inputSchema.type !== "object") throw new McpFailure("PROTOCOL_ERROR");
        if (tools.length >= 100 || JSON.stringify(tool.inputSchema).length > 16_384) throw new McpFailure("RESPONSE_TOO_LARGE");
        names.add(tool.name);
        tools.push({ name: tool.name, ...(typeof tool.title === "string" ? { title: tool.title.slice(0, 160) } : {}), ...(typeof tool.description === "string" ? { description: tool.description.slice(0, 1_500) } : {}), inputSchema: tool.inputSchema });
      }
      if (!result.nextCursor) return tools;
      if (typeof result.nextCursor !== "string" || result.nextCursor.length > 1_024 || cursors.has(result.nextCursor)) throw new McpFailure("PROTOCOL_ERROR");
      cursor = result.nextCursor; cursors.add(cursor);
    }
    throw new McpFailure("RESPONSE_TOO_LARGE");
  }
  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.supportsTools || !MCP_TOOL_NAME.test(name)) throw new McpFailure("PROTOCOL_ERROR");
    const value = await this.request("tools/call", { name, arguments: args });
    if (!isRecord(value) || !Array.isArray(value.content) || (value.isError !== undefined && typeof value.isError !== "boolean")) throw new McpFailure("PROTOCOL_ERROR");
    return value;
  }
  async close() {
    if (!this.sessionId || this.signal.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.fetcher(this.config.endpoint, { method: "DELETE", headers: this.headers(), redirect: "error", signal: AbortSignal.any([this.signal, AbortSignal.timeout(1_000)]) }).then(response => { void response.body?.cancel().catch(() => undefined); }),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); }),
      ]);
      // DELETE is optional (405), and cleanup never replaces the operation outcome.
    } catch { /* Remote session will expire; no credential/session is persisted locally. */ }
    finally { clearTimeout(timer); }
  }
}

export async function withMcpSession<T>(configuration: Configuration, operation: (session: McpSession) => Promise<T>, fetcher: Fetcher = safeFetch): Promise<T> {
  const controller = new AbortController();
  const session = new McpSession(configuration, controller.signal, fetcher);
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(configuration.timeoutMs ?? 30_000, 1), 60_000));
  let abortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(new McpFailure("TIMEOUT"));
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([aborted, (async () => { await session.initialize(); return operation(session); })()]);
  } catch (error) {
    if (error instanceof McpFailure) throw error;
    if (controller.signal.aborted) throw new McpFailure("TIMEOUT");
    throw new McpFailure("SERVICE_UNAVAILABLE");
  } finally {
    await session.close();
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", abortListener);
    controller.abort();
  }
}
