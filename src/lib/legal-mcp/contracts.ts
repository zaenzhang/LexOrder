import { z } from "zod";

export const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
export const MCP_ID = /^(pkulaw-law|wk-integrated|yuandian-law|jufa-law|custom-[0-9a-f-]{36})$/;
export const mcpEndpointSchema = z.string().trim().max(600).url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}, "请使用不带用户名、查询参数或片段的远程 HTTPS MCP 地址");

export const saveMcpSchema = z.object({
  id: z.string().regex(MCP_ID).optional(),
  expectedRevision: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  endpoint: mcpEndpointSchema,
  enabled: z.boolean(),
  authentication: z.enum(["bearer", "none"]),
  apiKey: z.string().trim().max(4096).refine(value => !value || /^[\x21-\x7e]+$/.test(value), "Bearer 凭据不能包含空白或非 ASCII 字符").optional(),
  clearKey: z.boolean().default(false),
  allowedTools: z.array(z.string().regex(MCP_TOOL_NAME, "工具名须与发现结果完全一致，不支持通配符")).max(40),
  confirmReadOnly: z.boolean(),
}).strict().refine(value => value.allowedTools.length === 0 || value.confirmReadOnly, "请先确认白名单中的工具仅用于读取或检索");

export type SaveMcpInput = z.input<typeof saveMcpSchema>;
export type McpFailureCode = "INVALID_CONFIG" | "DISABLED" | "UNCONFIGURED" | "CREDENTIAL_ERROR" | "TIMEOUT" | "UNAUTHORIZED" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "PROTOCOL_ERROR" | "RESPONSE_TOO_LARGE" | "REMOTE_ERROR" | "SESSION_EXPIRED" | "TOOL_NOT_ALLOWED" | "TOOL_UNAVAILABLE" | "INVALID_ARGUMENTS" | "CONFIG_CHANGED";
export const MCP_FAILURE_LABELS: Record<McpFailureCode, string> = {
  INVALID_CONFIG: "配置格式有误，请重新保存服务配置。",
  DISABLED: "该服务已禁用。",
  UNCONFIGURED: "请先保存服务地址和所需凭据。",
  CREDENTIAL_ERROR: "无法解密已保存的凭据，请重新填写或清除密钥。",
  TIMEOUT: "服务响应超时；本次调用未自动重发。",
  UNAUTHORIZED: "服务拒绝凭据或账号未获授权，请核对服务端权限。",
  SERVICE_UNAVAILABLE: "无法连接服务，请核对地址和服务可用性。",
  RATE_LIMITED: "服务请求受限，请稍后再试。",
  PROTOCOL_ERROR: "服务未返回本客户端支持的 Streamable HTTP MCP 响应。",
  RESPONSE_TOO_LARGE: "服务返回的数据超过本次读取上限。",
  REMOTE_ERROR: "服务报告本次操作失败，请核对工具参数和平台授权。",
  SESSION_EXPIRED: "服务会话已失效，请再次点击执行以建立新会话。",
  TOOL_NOT_ALLOWED: "该工具尚未由管理员明确加入只读白名单。",
  TOOL_UNAVAILABLE: "该工具未出现在当前服务的工具清单中，请重新发现工具并核对白名单。",
  INVALID_ARGUMENTS: "检索参数须为不超过 16 KB、嵌套不超过 8 层的 JSON 对象。",
  CONFIG_CHANGED: "服务配置已变化，本次结果未发布，请刷新后重新执行。",
};
export class McpFailure extends Error {
  constructor(readonly code: McpFailureCode) { super(MCP_FAILURE_LABELS[code]); this.name = "McpFailure"; }
}

export type McpPhase = "connection" | "tools" | "query";
export interface McpCheck { ok: boolean; at: string; code?: McpFailureCode; toolCount?: number; tool?: string }
export interface PublicMcpConfig {
  id: string; name: string; endpoint: string; enabled: boolean; authentication: "bearer" | "none";
  revision: string | null; hasKey: boolean; allowedTools: string[];
  state: "DISABLED" | "UNCONFIGURED" | "UNVERIFIED" | "CHECKED" | "CONNECTION_FAILED" | "CONFIGURATION_ERROR";
  configurationError?: string; checks: Partial<Record<McpPhase, McpCheck>>;
}
export const MCP_STATE_LABELS: Record<PublicMcpConfig["state"], string> = {
  DISABLED: "已禁用", UNCONFIGURED: "未配置", UNVERIFIED: "已配置 · 未验证", CHECKED: "连接已检查", CONNECTION_FAILED: "连接检查失败", CONFIGURATION_ERROR: "配置需修复",
};
export interface McpTool { name: string; title?: string; description?: string; inputSchema: Record<string, unknown> }
export interface McpQueryResult {
  serviceId: string; serviceName: string; endpoint: string; tool: string; queriedAt: string;
  isError: boolean; content: string; sources: { title: string; url: string }[];
}

/** Only explicit input is accepted. No matter/document lookup or remote schema resolution. */
export function parseMcpArguments(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).length > 16_384) throw new McpFailure("INVALID_ARGUMENTS");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new McpFailure("INVALID_ARGUMENTS"); }
  if (!isRecord(value)) throw new McpFailure("INVALID_ARGUMENTS");
  let count = 0;
  function visit(item: unknown, depth: number) {
    if (depth > 8 || ++count > 1_000) throw new McpFailure("INVALID_ARGUMENTS");
    if (typeof item === "number" && !Number.isFinite(item)) throw new McpFailure("INVALID_ARGUMENTS");
    if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new McpFailure("INVALID_ARGUMENTS");
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
