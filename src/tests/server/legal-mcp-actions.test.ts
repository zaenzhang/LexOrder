import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  revoked: false,
  config: { revision: "c07b856c-ed11-4e81-b462-f62c66bc3300", name: "合成服务", endpoint: "https://example.test/mcp", enabled: true, authentication: "bearer" as const, apiKey: "synthetic-private-token", apiKeyCipher: null, allowedTools: [] as string[] },
  list: vi.fn(), call: vi.fn(), current: vi.fn(), record: vi.fn(), transport: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSystemAdmin: vi.fn(async () => { if (state.revoked) throw new Error("synthetic access revoked"); return { user: { id: "synthetic-admin" } }; }) }));
vi.mock("@/server/audit", () => ({ auditStrict: vi.fn(async () => undefined) }));
vi.mock("@/server/legal/mcp-settings", () => ({
  readMcpConfiguration: vi.fn(async () => state.config), assertCurrentMcpConfiguration: state.current,
  recordMcpChecks: state.record, listMcpSettings: vi.fn(), saveMcpConfiguration: vi.fn(),
}));
vi.mock("@/server/legal/mcp-transport", () => ({ withMcpSession: state.transport }));
import { discoverLegalMcpTools, queryLegalMcpTool } from "@/server/legal/mcp-actions";
import { McpFailure } from "@/lib/legal-mcp/contracts";
import { auditStrict } from "@/server/audit";

const input = { id: "pkulaw-law", revision: "c07b856c-ed11-4e81-b462-f62c66bc3300", tool: "law_search", argumentsJson: '{"query":"合成合同","limit":1}' };
beforeEach(() => {
  vi.clearAllMocks(); state.revoked = false; state.config.allowedTools = ["law_search"]; state.config.apiKey = "synthetic-private-token";
  state.current.mockResolvedValue(undefined); state.record.mockResolvedValue(undefined);
  state.list.mockResolvedValue([{ name: "law_search", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]);
  state.call.mockResolvedValue({ content: [{ type: "text", text: "合成结果 synthetic-private-token" }, { type: "resource_link", name: "合成来源", uri: "https://example.test/law/1" }] });
  state.transport.mockImplementation(async (_config, callback) => callback({ listTools: state.list, callTool: state.call }));
});

it("blocks an unapproved tool before any transport regardless of its readOnlyHint", async () => {
  state.config.allowedTools = [];
  expect(await queryLegalMcpTool(input)).toMatchObject({ ok: false, code: "TOOL_NOT_ALLOWED" });
  expect(state.transport).not.toHaveBeenCalled();
});

it("reports a removed tool separately from missing administrator approval", async () => {
  state.list.mockResolvedValue([]);
  const response = await queryLegalMcpTool(input);
  expect(response).toMatchObject({ ok: false, code: "TOOL_UNAVAILABLE", checks: { connection: { ok: true }, tools: { ok: true }, query: { ok: false } } });
  expect(state.call).not.toHaveBeenCalled();
});

it("forwards only the explicit JSON arguments, preserves source metadata and removes echoed credentials", async () => {
  const response = await queryLegalMcpTool(input);
  expect(response.ok).toBe(true);
  expect(state.call).toHaveBeenCalledWith("law_search", { query: "合成合同", limit: 1 });
  expect(JSON.stringify(response)).not.toContain("synthetic-private-token");
  expect(response).toMatchObject({ result: { sources: [{ title: "合成来源", url: "https://example.test/law/1" }], serviceId: "pkulaw-law", tool: "law_search", isError: false } });
  expect(JSON.stringify(vi.mocked(auditStrict).mock.calls)).not.toContain("合成合同");
  expect(JSON.stringify(state.record.mock.calls)).not.toContain("合成结果");
});

it("removes escaped credentials from structured content and credential-bearing source links", async () => {
  state.config.apiKey = 'synthetic-"quoted"-token';
  state.call.mockResolvedValue({ content: [{ type: "resource_link", name: "unsafe echo", uri: `https://example.test/law?key=${encodeURIComponent(state.config.apiKey)}` }], structuredContent: { echo: state.config.apiKey } });
  const response = await queryLegalMcpTool(input);
  expect(response).toMatchObject({ ok: true, result: { sources: [] } });
  expect(JSON.stringify(response)).not.toContain(encodeURIComponent(state.config.apiKey));
  expect(JSON.stringify(response)).not.toContain('quoted');
});

it("redacts credential-bearing keys in discovered schemas and structured/resource query results", async () => {
  const secret = 'schema-key-secret-"quoted"\\token';
  state.config.apiKey = secret;
  state.list.mockResolvedValue([{ name: "law_search", inputSchema: { type: "object", properties: {
    [secret]: { type: "string", description: secret },
    nested: { type: "object", properties: { [encodeURIComponent(secret)]: { type: "string" } } },
  } } }]);
  const discovered = await discoverLegalMcpTools({ id: input.id, revision: input.revision });
  expect(discovered).toMatchObject({ ok: true, tools: [{ inputSchema: { properties: { "[凭据已移除]": { type: "string", description: "[凭据已移除]" } } } }] });
  expect(JSON.stringify(discovered)).not.toContain("schema-key-secret");
  state.call.mockResolvedValue({ content: [{ type: "resource", resource: { uri: "https://example.test/law/1", [secret]: "echoed property", ["__proto__"]: { polluted: true } } }],
    structuredContent: { [secret]: secret, nested: [{ [encodeURIComponent(secret)]: secret }] } });
  const response = await queryLegalMcpTool(input);
  expect(response.ok).toBe(true);
  expect(JSON.stringify(response)).not.toContain("schema-key-secret");
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

it("rejects a stale configuration after discovery before sending a tool request", async () => {
  state.current.mockRejectedValue(new McpFailure("CONFIG_CHANGED"));
  expect(await queryLegalMcpTool(input)).toMatchObject({ ok: false, code: "CONFIG_CHANGED" });
  expect(state.call).not.toHaveBeenCalled();
});

it("does not publish a completed response after its configuration has changed", async () => {
  state.record.mockRejectedValue(new McpFailure("CONFIG_CHANGED"));
  const response = await queryLegalMcpTool(input);
  expect(response).toMatchObject({ ok: false, code: "CONFIG_CHANGED" });
  expect(response).not.toHaveProperty("result");
});

it("rechecks the administrator after the external operation and withholds results after revocation", async () => {
  state.call.mockImplementation(async () => { state.revoked = true; return { content: [{ type: "text", text: "must not publish" }] }; });
  await expect(queryLegalMcpTool(input)).rejects.toThrow("synthetic access revoked");
  expect(state.record).not.toHaveBeenCalled();
});
