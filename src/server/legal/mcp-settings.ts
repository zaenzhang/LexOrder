import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptBuffer, decryptBuffer } from "@/lib/storage/crypto";
import { resolveRoleUser } from "@/lib/roles/service";
import { auditTx } from "@/server/audit";
import { LEGAL_MCP_PRESETS, mcpPreset } from "@/lib/legal-mcp/catalog";
import { isRecord, McpFailure, MCP_ID, MCP_TOOL_NAME, MCP_FAILURE_LABELS, mcpEndpointSchema, saveMcpSchema, type SaveMcpInput, type PublicMcpConfig, type McpCheck, type McpPhase } from "@/lib/legal-mcp/contracts";

const PREFIX = "legalMcp.config.";
const CHECK_PREFIX = "legalMcp.checks.";
const cipherSchema = z.object({ ct: z.string().max(8_192), iv: z.string().max(80), tag: z.string().max(80) });
const storedSchema = z.object({
  revision: z.string().uuid(), name: z.string().min(1).max(80), endpoint: mcpEndpointSchema,
  enabled: z.boolean(), authentication: z.enum(["bearer", "none"]), apiKeyCipher: cipherSchema.nullable(),
  allowedTools: z.array(z.string().regex(MCP_TOOL_NAME)).max(40),
});
type Stored = z.infer<typeof storedSchema>;

function encryptKey(value: string): Stored["apiKeyCipher"] {
  const result = encryptBuffer(Buffer.from(value, "utf8"));
  return { ct: result.ciphertext.toString("base64"), iv: result.iv.toString("base64"), tag: result.authTag.toString("base64") };
}
function decryptKey(value: Stored["apiKeyCipher"]) {
  if (!value) return "";
  try { return decryptBuffer(Buffer.from(value.ct, "base64"), value.iv, value.tag).toString("utf8"); }
  catch { throw new McpFailure("CREDENTIAL_ERROR"); }
}
function rawRevision(value: unknown): string | null {
  return isRecord(value) && z.string().uuid().safeParse(value.revision).success ? value.revision as string : null;
}
function emptyConfig(id: string): PublicMcpConfig {
  const preset = mcpPreset(id);
  return { id, name: preset?.name ?? "自定义法律 MCP", endpoint: preset?.endpoint ?? "", enabled: false, authentication: "bearer", revision: null, hasKey: false, allowedTools: [], state: "DISABLED", checks: {} };
}
function parseStored(value: unknown, id: string): Stored {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) throw new McpFailure("INVALID_CONFIG");
  const preset = mcpPreset(id);
  if (preset && (parsed.data.endpoint !== preset.endpoint || parsed.data.authentication !== "bearer")) throw new McpFailure("INVALID_CONFIG");
  return parsed.data;
}
function publicConfig(id: string, raw: unknown, rawChecks?: unknown): PublicMcpConfig {
  const initial = emptyConfig(id);
  if (raw === undefined) return initial;
  let config: Stored;
  try { config = parseStored(raw, id); }
  catch { return { ...initial, revision: rawRevision(raw), state: "CONFIGURATION_ERROR", configurationError: "配置格式有误，可重新填写并保存；其他服务不受影响。" }; }
  let configurationError: string | undefined;
  try { if (config.apiKeyCipher) decryptKey(config.apiKeyCipher); }
  catch { configurationError = "已保存的凭据无法解密，请重新填写或清除密钥。"; }
  const checks: PublicMcpConfig["checks"] = {};
  if (isRecord(rawChecks) && rawChecks.revision === config.revision) for (const phase of ["connection", "tools", "query"] as const) {
    const check = rawChecks[phase];
    if (isRecord(check) && typeof check.ok === "boolean" && typeof check.at === "string" && check.at.length <= 40 && !Number.isNaN(Date.parse(check.at))) checks[phase] = {
      ok: check.ok, at: check.at,
      ...(typeof check.code === "string" && Object.hasOwn(MCP_FAILURE_LABELS, check.code) ? { code: check.code as McpCheck["code"] } : {}),
      ...(typeof check.toolCount === "number" && check.toolCount >= 0 && check.toolCount <= 100 ? { toolCount: check.toolCount } : {}),
      ...(typeof check.tool === "string" && MCP_TOOL_NAME.test(check.tool) ? { tool: check.tool } : {}),
    };
  }
  return {
    id, name: config.name, endpoint: config.endpoint, enabled: config.enabled, authentication: config.authentication,
    revision: config.revision, hasKey: !!config.apiKeyCipher, allowedTools: config.allowedTools, checks, configurationError,
    state: !config.enabled ? "DISABLED" : configurationError ? "CONFIGURATION_ERROR"
      : config.authentication === "bearer" && !config.apiKeyCipher ? "UNCONFIGURED"
      : checks.connection?.ok === false ? "CONNECTION_FAILED" : checks.connection?.ok ? "CHECKED" : "UNVERIFIED",
  };
}

export async function listMcpSettings(): Promise<PublicMcpConfig[]> {
  const rows = await prisma.systemSetting.findMany({ where: { OR: [{ key: { startsWith: PREFIX } }, { key: { startsWith: CHECK_PREFIX } }] }, select: { key: true, value: true }, take: 100 });
  const values = new Map(rows.map(row => [row.key, row.value]));
  const ids = [...LEGAL_MCP_PRESETS.map(preset => preset.id as string), ...rows.filter(row => row.key.startsWith(`${PREFIX}custom-`) && MCP_ID.test(row.key.slice(PREFIX.length))).map(row => row.key.slice(PREFIX.length))];
  return [...new Set(ids)].map(id => publicConfig(id, values.get(PREFIX + id), values.get(CHECK_PREFIX + id)));
}
export async function readMcpConfiguration(id: string) {
  if (!MCP_ID.test(id)) throw new McpFailure("INVALID_CONFIG");
  const row = await prisma.systemSetting.findUnique({ where: { key: PREFIX + id } });
  if (!row) throw new McpFailure("UNCONFIGURED");
  const config = parseStored(row.value, id);
  if (!config.enabled) throw new McpFailure("DISABLED");
  const apiKey = config.authentication === "bearer" ? decryptKey(config.apiKeyCipher) : "";
  if (config.authentication === "bearer" && !apiKey) throw new McpFailure("UNCONFIGURED");
  return { ...config, apiKey };
}
export async function assertCurrentMcpConfiguration(id: string, revision: string) {
  const row = await prisma.systemSetting.findUnique({ where: { key: PREFIX + id } });
  if (!row || rawRevision(row.value) !== revision || !isRecord(row.value) || row.value.enabled !== true) throw new McpFailure("CONFIG_CHANGED");
}
async function lockConfiguration(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`legal-mcp:${id}`}, 0))`;
}
async function checkAdministrator(tx: Prisma.TransactionClient, userId: string) {
  // Same permission mutation lock as the existing admin services.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, systemRole: true, role: true } });
  if (!user?.active || user.systemRole !== "SUPER_ADMIN" || !(await resolveRoleUser(userId, user.role, tx)).enabled) throw new McpFailure("UNAUTHORIZED");
}
export async function saveMcpConfiguration(input: SaveMcpInput, userId: string) {
  const data = saveMcpSchema.parse(input);
  const id = data.id ?? `custom-${randomUUID()}`;
  const preset = mcpPreset(id);
  if (preset && (data.endpoint !== preset.endpoint || data.authentication !== "bearer")) throw new McpFailure("INVALID_CONFIG");
  return prisma.$transaction(async tx => {
    await checkAdministrator(tx, userId);
    await lockConfiguration(tx, id);
    const row = await tx.systemSetting.findUnique({ where: { key: PREFIX + id } });
    if (rawRevision(row?.value) !== data.expectedRevision) throw new McpFailure("CONFIG_CHANGED");
    if (!row && id.startsWith("custom-") && await tx.systemSetting.count({ where: { key: { startsWith: `${PREFIX}custom-` } } }) >= 20) throw new McpFailure("INVALID_CONFIG");
    const oldCipher = isRecord(row?.value) ? cipherSchema.safeParse(row.value.apiKeyCipher) : null;
    const next: Stored = {
      revision: randomUUID(), name: preset?.name ?? data.name, endpoint: data.endpoint, enabled: data.enabled,
      authentication: data.authentication, allowedTools: [...new Set(data.allowedTools)],
      apiKeyCipher: data.clearKey || data.authentication === "none" ? null : data.apiKey ? encryptKey(data.apiKey) : oldCipher?.success ? oldCipher.data : null,
    };
    await tx.systemSetting.upsert({ where: { key: PREFIX + id }, create: { key: PREFIX + id, value: next }, update: { value: next } });
    await tx.systemSetting.deleteMany({ where: { key: CHECK_PREFIX + id } });
    await auditTx(tx, { userId, action: "LEGAL_MCP_CONFIG_SAVE", targetType: "SystemSetting", targetId: id, detail: { enabled: next.enabled, authentication: next.authentication, allowedToolCount: next.allowedTools.length, credentialChanged: !!data.apiKey || data.clearKey, revision: next.revision } });
    return publicConfig(id, next);
  });
}

/** Persist phase outcomes only; never persist queries, remote bodies, tokens or sessions. */
export async function recordMcpChecks(id: string, revision: string, userId: string, checks: Partial<Record<McpPhase, McpCheck>>) {
  await prisma.$transaction(async tx => {
    await checkAdministrator(tx, userId);
    await lockConfiguration(tx, id);
    const row = await tx.systemSetting.findUnique({ where: { key: PREFIX + id } });
    if (!row || rawRevision(row.value) !== revision || !isRecord(row.value) || row.value.enabled !== true) throw new McpFailure("CONFIG_CHANGED");
    const prior = await tx.systemSetting.findUnique({ where: { key: CHECK_PREFIX + id } });
    const previous = isRecord(prior?.value) && prior.value.revision === revision ? prior.value : {};
    const value: Record<string, unknown> = { ...previous, revision };
    for (const phase of ["connection", "tools", "query"] as const) {
      const old = previous[phase];
      if (checks[phase] && (!isRecord(old) || typeof old.at !== "string" || old.at <= checks[phase]!.at)) value[phase] = checks[phase];
    }
    await tx.systemSetting.upsert({ where: { key: CHECK_PREFIX + id }, create: { key: CHECK_PREFIX + id, value: value as object }, update: { value: value as object } });
    await auditTx(tx, { userId, action: "LEGAL_MCP_OPERATION_RESULT", targetType: "SystemSetting", targetId: id, detail: { revision, phases: checks } });
  });
}
