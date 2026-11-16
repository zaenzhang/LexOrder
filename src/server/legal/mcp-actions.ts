"use server";

import { z } from "zod";
import { requireSystemAdmin } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { auditStrict } from "@/server/audit";
import { isRecord, McpFailure, MCP_ID, MCP_TOOL_NAME, parseMcpArguments, type SaveMcpInput, type McpPhase, type McpCheck, type McpTool, type McpQueryResult } from "@/lib/legal-mcp/contracts";
import { listMcpSettings, saveMcpConfiguration, readMcpConfiguration, assertCurrentMcpConfiguration, recordMcpChecks } from "./mcp-settings";
import { withMcpSession } from "./mcp-transport";

const operationSchema = z.object({ id: z.string().regex(MCP_ID), revision: z.string().uuid() }).strict();
const querySchema = operationSchema.extend({ tool: z.string().regex(MCP_TOOL_NAME), argumentsJson: z.string().max(16_384) }).strict();

export async function getLegalMcpSettingsPublic() {
  await requireSystemAdmin();
  return listMcpSettings();
}
export async function saveLegalMcpSettingsAction(input: SaveMcpInput) {
  const actor = await requireSystemAdmin();
  try { return await saveMcpConfiguration(input, actor.user.id); }
  catch (error) { if (error instanceof McpFailure) throw new ActionError(error.message); throw error; }
}
function redact(value: string, secret: string) {
  if (!secret) return value;
  return value.split(secret).join("[凭据已移除]").split(encodeURIComponent(secret)).join("[凭据已移除]");
}
function safeJson(value: unknown, secret: string) {
  // Remote schemas/results may echo credentials in property names as well as values.
  // Sanitize the decoded structure before JSON escaping, and never assign untrusted
  // property names onto an object with a prototype setter (for example __proto__).
  function sanitize(item: unknown, depth: number): unknown {
    if (depth > 64) throw new McpFailure("PROTOCOL_ERROR");
    if (typeof item === "string") return redact(item, secret);
    if (Array.isArray(item)) return item.map(child => sanitize(child, depth + 1));
    if (!isRecord(item)) return item;
    const clean: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(item)) clean[redact(key, secret)] = sanitize(child, depth + 1);
    return clean;
  }
  return JSON.stringify(sanitize(value, 0), null, 2) ?? "";
}
function queryResult(raw: Record<string, unknown>, config: Awaited<ReturnType<typeof readMcpConfiguration>>, id: string, tool: string): McpQueryResult {
  const sources: McpQueryResult["sources"] = [];
  const seen = new Set<string>();
  function visit(value: unknown, depth = 0) {
    if (depth > 8 || sources.length >= 40 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 100)) visit(child, depth + 1); return; }
    const object = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      if (["url", "uri", "link", "source_url"].includes(key) && typeof child === "string" && child.length <= 2_000 && redact(child, config.apiKey) === child) {
        try {
          const url = new URL(child);
          if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !seen.has(url.href)) {
            seen.add(url.href);
            sources.push({ title: redact(String(object.title ?? object.name ?? url.hostname).slice(0, 180), config.apiKey), url: url.href });
          }
        } catch { /* Non-web resource identifiers stay in the plain-text response. */ }
      }
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  }
  visit(raw);
  const content = (raw.content as unknown[]).slice(0, 100).map(item => {
    if (!isRecord(item)) throw new McpFailure("PROTOCOL_ERROR");
    if (item.type === "text" && typeof item.text === "string") return item.text;
    if (item.type === "resource_link") return safeJson(item, config.apiKey);
    if (item.type === "resource" && isRecord(item.resource)) {
      const resource = { ...item.resource };
      delete resource.blob;
      return safeJson(resource, config.apiKey);
    }
    return `【未展示 ${String(item.type).slice(0, 30)} 类型内容；本页仅展示文字与来源】`;
  });
  if (isRecord(raw.structuredContent)) content.push(safeJson(raw.structuredContent, config.apiKey));
  const text = redact(content.join("\n\n"), config.apiKey);
  return { serviceId: id, serviceName: config.name, endpoint: config.endpoint, tool, queriedAt: new Date().toISOString(), isError: raw.isError === true,
    content: text.length > 200_000 ? `${text.slice(0, 200_000)}\n【结果较长，仅展示前 200,000 字符】` : text,
    sources: sources.slice(0, 40) };
}

async function operate(input: z.infer<typeof operationSchema>, phase: McpPhase, query?: { tool: string; args: Record<string, unknown> }) {
  const actor = await requireSystemAdmin();
  let config: Awaited<ReturnType<typeof readMcpConfiguration>> | undefined;
  const checks: Partial<Record<McpPhase, McpCheck>> = {};
  let currentPhase: McpPhase = "connection";
  try {
    config = await readMcpConfiguration(input.id);
    if (config.revision !== input.revision) throw new McpFailure("CONFIG_CHANGED");
    if (query && !config.allowedTools.includes(query.tool)) throw new McpFailure("TOOL_NOT_ALLOWED");
    // No queries, document bodies, tool responses or secrets enter the audit log.
    await auditStrict({ userId: actor.user.id, action: "LEGAL_MCP_OPERATION_REQUEST", targetType: "SystemSetting", targetId: input.id, detail: { phase, revision: config.revision, ...(query ? { tool: query.tool } : {}) } });
    const selected = config;
    const value = await withMcpSession({ endpoint: selected.endpoint, apiKey: selected.apiKey }, async client => {
      checks.connection = { ok: true, at: new Date().toISOString() };
      if (phase === "connection") return {};
      currentPhase = "tools";
      const tools = await client.listTools();
      checks.tools = { ok: true, at: new Date().toISOString(), toolCount: tools.length };
      if (!query) return { tools: JSON.parse(safeJson(tools, selected.apiKey)) as McpTool[] };
      currentPhase = "query";
      if (!tools.some(tool => tool.name === query.tool)) throw new McpFailure("TOOL_UNAVAILABLE");
      // A discovery round trip may outlive admin rights or a configuration change.
      await requireSystemAdmin();
      await assertCurrentMcpConfiguration(input.id, selected.revision);
      const raw = await client.callTool(query.tool, query.args);
      const result = queryResult(raw, selected, input.id, query.tool);
      checks.query = { ok: !result.isError, at: result.queriedAt, tool: query.tool, ...(result.isError ? { code: "REMOTE_ERROR" as const } : {}) };
      return { result };
    });
    // Disabling/changing the service or revoking the admin while a call runs blocks publication.
    await requireSystemAdmin();
    await recordMcpChecks(input.id, config.revision, actor.user.id, checks);
    return { ok: true as const, ...value, checks };
  } catch (error) {
    if (!(error instanceof McpFailure)) throw error;
    if (config && config.revision === input.revision && !["CONFIG_CHANGED", "TOOL_NOT_ALLOWED", "DISABLED", "UNCONFIGURED"].includes(error.code)) {
      checks[currentPhase] = { ok: false, at: new Date().toISOString(), code: error.code };
      await requireSystemAdmin();
      try { await recordMcpChecks(input.id, config.revision, actor.user.id, checks); }
      catch (recordError) {
        if (recordError instanceof McpFailure) return { ok: false as const, code: recordError.code, message: recordError.message };
        throw recordError;
      }
    }
    return { ok: false as const, code: error.code, message: error.message, checks };
  }
}

/** Explicit initialize only; no tools/list or business query is implied by a successful check. */
export async function testLegalMcpConnection(input: z.infer<typeof operationSchema>) {
  return operate(operationSchema.parse(input), "connection");
}
/** Explicit discovery; annotations never grant permission or populate the allowlist. */
export async function discoverLegalMcpTools(input: z.infer<typeof operationSchema>) {
  return operate(operationSchema.parse(input), "tools");
}
/** Admin preview of one explicitly approved read-only tool; no automatic evidence/context writes. */
export async function queryLegalMcpTool(input: z.infer<typeof querySchema>) {
  await requireSystemAdmin();
  const data = querySchema.parse(input);
  try { return await operate({ id: data.id, revision: data.revision }, "query", { tool: data.tool, args: parseMcpArguments(data.argumentsJson) }); }
  catch (error) { if (error instanceof McpFailure) return { ok: false as const, code: error.code, message: error.message }; throw error; }
}
