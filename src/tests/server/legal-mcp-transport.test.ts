import { describe, expect, it, vi } from "vitest";
import { withMcpSession } from "@/server/legal/mcp-transport";
import { parseMcpArguments } from "@/lib/legal-mcp/contracts";

vi.mock("@/lib/net/safe-url", () => ({ safeFetch: vi.fn(() => { throw new Error("Tests must never use the network"); }) }));
type Request = { method: string; headers: Headers; body: Record<string, unknown> };
function fixture(handler?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  const fetcher = vi.fn(async (_url: string, init?: Record<string, unknown>) => {
    const request = { method: String(init?.method), headers: new Headers(init?.headers as HeadersInit), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} };
    requests.push(request);
    expect(init?.redirect).toBe("error");
    const response = handler?.(request);
    if (response) return response;
    if (request.method === "DELETE") return new Response(null, { status: 405 });
    if (!request.body.method || request.body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.body.method === "initialize") return rpc(request.body.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } }, { "Mcp-Session-Id": "synthetic-session" });
    if (request.body.method === "tools/list") return rpc(request.body.id, { tools: [{ name: "law_search", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } }] });
    return rpc(request.body.id, { content: [{ type: "text", text: "synthetic result" }] });
  });
  return { fetcher, requests };
}
function rpc(id: unknown, result: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "Content-Type": "application/json", ...headers } }); }
function sse(chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
const config = { endpoint: "https://example.test/mcp/", apiKey: "synthetic-token", timeoutMs: 1_000 };

describe("legal MCP Streamable HTTP (synthetic responses only)", () => {
  it("negotiates before discovery and carries session/version on notifications, requests and DELETE", async () => {
    const test = fixture();
    await withMcpSession(config, async client => {
      const tools = await client.listTools();
      expect(tools[0]).not.toHaveProperty("annotations");
      await client.callTool("law_search", { query: "合成检索" });
    }, test.fetcher);
    expect(test.requests.map(request => request.body.method ?? request.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call", "DELETE"]);
    expect(test.requests[0].headers.has("MCP-Protocol-Version")).toBe(false);
    for (const request of test.requests.slice(1)) {
      expect(request.headers.get("MCP-Protocol-Version")).toBe("2025-11-25");
      expect(request.headers.get("Mcp-Session-Id")).toBe("synthetic-session");
      expect(request.headers.get("Authorization")).toBe("Bearer synthetic-token");
    }
    expect(test.requests[3].body.params).toEqual({ name: "law_search", arguments: { query: "合成检索" } });
  });

  it("parses split CRLF and multiline SSE, answers ping, and rejects unadvertised server capabilities", async () => {
    const test = fixture(request => request.body.method === "tools/list" ? sse([
      ': keepalive\r', '\nid: first\r\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\r\n\r\n',
      'data: {"jsonrpc":"2.0","id":"server-ping","method":"ping"}\n\n',
      'data: {"jsonrpc":"2.0","id":"server-read","method":"roots/list"}\n\n',
      `data: {"jsonrpc":"2.0",\ndata: "id":${request.body.id},"result":{"tools":[]}}\r\r`,
    ]) : undefined);
    expect(await withMcpSession(config, client => client.listTools(), test.fetcher)).toEqual([]);
    expect(test.requests.find(request => request.body.id === "server-ping")?.body).toEqual({ jsonrpc: "2.0", id: "server-ping", result: {} });
    expect(test.requests.find(request => request.body.id === "server-read")?.body.error).toMatchObject({ code: -32601 });
  });

  it("resumes a closed SSE response by GET with Last-Event-ID without replaying tools/call", async () => {
    const test = fixture(request => {
      if (request.body.method === "tools/call") return sse(["id: checkpoint\nretry: 0\ndata:\n\n"]);
      if (request.method === "GET") return sse(['data: {"jsonrpc":"2.0","id":2,"result":{"content":[]}}\n\n']);
    });
    await withMcpSession(config, client => client.callTool("law_search", { query: "合成" }), test.fetcher);
    expect(test.requests.filter(request => request.body.method === "tools/call")).toHaveLength(1);
    const resumed = test.requests.find(request => request.method === "GET")!;
    expect(resumed.headers.get("Last-Event-ID")).toBe("checkpoint");
    expect(resumed.headers.get("Mcp-Session-Id")).toBe("synthetic-session");
    expect(resumed.headers.get("Accept")).toBe("text/event-stream");
  });

  it.each([
    ["mismatched response id", (request: Request) => rpc(Number(request.body.id) + 1, { tools: [] }), "PROTOCOL_ERROR"],
    ["oversized response", (request: Request) => rpc(request.body.id, { tools: [], padding: "x".repeat(3_000) }), "RESPONSE_TOO_LARGE"],
    ["expired session", () => new Response(null, { status: 404 }), "SESSION_EXPIRED"],
    ["unexpected content type", () => new Response("<html>upstream error</html>", { headers: { "Content-Type": "text/html" } }), "PROTOCOL_ERROR"],
  ] as const)("fails closed for %s", async (_label, respond, code) => {
    const test = fixture(request => request.body.method === "tools/list" ? respond(request) : undefined);
    await expect(withMcpSession({ ...config, maxResponseBytes: 1_024 }, client => client.listTools(), test.fetcher)).rejects.toMatchObject({ code });
    expect(test.requests.filter(request => request.body.method === "tools/list")).toHaveLength(1);
  });

  it("rejects unsupported protocol versions before a notification or business request", async () => {
    const test = fixture(request => request.body.method === "initialize" ? rpc(request.body.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: {} }) : undefined);
    await expect(withMcpSession(config, client => client.listTools(), test.fetcher)).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(test.requests).toHaveLength(1);
  });

  it("times out the entire operation, including a nonresponsive fetch, without repeating a tool request", async () => {
    const test = fixture(request => request.body.method === "tools/call" ? new Promise<Response>(() => undefined) : undefined);
    await expect(withMcpSession({ ...config, timeoutMs: 30 }, client => client.callTool("law_search", {}), test.fetcher)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(test.requests.filter(request => request.body.method === "tools/call")).toHaveLength(1);
  });

  it("rejects repeated pagination cursors", async () => {
    const test = fixture(request => request.body.method === "tools/list" ? rpc(request.body.id, { tools: [], nextCursor: "repeated" }) : undefined);
    await expect(withMcpSession(config, client => client.listTools(), test.fetcher)).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(test.requests.filter(request => request.body.method === "tools/list")).toHaveLength(2);
  });
});

it("bounds explicit arguments and rejects prototype keys, arrays and excessive nesting", () => {
  expect(parseMcpArguments('{"query":"合成","limit":2}')).toEqual({ query: "合成", limit: 2 });
  for (const value of ['[]', '{"__proto__":{"admin":true}}', JSON.stringify({ query: "x".repeat(17_000) }), '{"a":'.repeat(10) + '0' + '}'.repeat(10)]) expect(() => parseMcpArguments(value)).toThrow();
});
