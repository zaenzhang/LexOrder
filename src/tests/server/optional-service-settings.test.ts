import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const setting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
    findMany: vi.fn(async ({ where }: { where: { OR: { key: { startsWith: string } }[] } }) => [...rows].filter(([key]) => where.OR.some(filter => key.startsWith(filter.key.startsWith))).map(([key, value]) => ({ key, value }))),
    count: vi.fn(async ({ where }: { where: { key: { startsWith: string } } }) => [...rows.keys()].filter(key => key.startsWith(where.key.startsWith)).length),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => { rows.set(where.key, rows.has(where.key) ? update.value : create.value); return {}; }),
    updateMany: vi.fn(async ({ where, data }: { where: { key: string; value: { equals: unknown } }; data: { value: unknown } }) => {
      if (JSON.stringify(rows.get(where.key)) !== JSON.stringify(where.value.equals)) return { count: 0 };
      rows.set(where.key, data.value); return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => { rows.delete(where.key); return { count: 1 }; }),
  };
  const transaction = { systemSetting: setting, $queryRaw: vi.fn(async () => [{ locked: 1 }]), user: { findUnique: vi.fn(async () => ({ active: true, systemRole: "SUPER_ADMIN", role: "LAWYER" })) } };
  return { rows, setting, prisma: { ...transaction, $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: database.prisma }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ enabled: true })) }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/client", () => ({ aiVision: vi.fn(() => { throw new Error("No remote OCR in settings tests"); }) }));
import { listMcpSettings, saveMcpConfiguration, readMcpConfiguration, recordMcpChecks } from "@/server/legal/mcp-settings";
import { readPublicAiSettings, getAiSettings, saveAiSettings } from "@/lib/ai/settings";
import { readPublicOcrSettings, readOcrSettings, saveOcrSettings } from "@/server/ocr/provider";

beforeAll(() => vi.stubEnv("STORAGE_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")));
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => { database.rows.clear(); vi.clearAllMocks(); });
const administrator = "synthetic-admin";
const input = { expectedRevision: null, name: "合成法律服务", endpoint: "https://example.test/mcp", enabled: false, authentication: "bearer" as const, apiKey: "synthetic-secret-token", allowedTools: [], confirmReadOnly: false };

describe("optional settings remain local and repairable", () => {
  it("starts presets disabled and stores only ciphertext while keeping save unverified", async () => {
    const presets = await listMcpSettings();
    expect(presets).toHaveLength(4);
    expect(presets.every(config => config.state === "DISABLED" && !config.hasKey && config.allowedTools.length === 0)).toBe(true);
    const saved = await saveMcpConfiguration({ ...input, enabled: true }, administrator);
    expect(saved.state).toBe("UNVERIFIED");
    expect(saved.checks).toEqual({});
    expect(JSON.stringify([...database.rows.values()])).not.toContain(input.apiKey);
    expect(JSON.stringify(saved)).not.toContain(input.apiKey);
    expect((await readMcpConfiguration(saved.id)).apiKey).toBe(input.apiKey);
  });

  it("requires an explicit read-only allowlist confirmation and rejects stale edits", async () => {
    await expect(saveMcpConfiguration({ ...input, allowedTools: ["write_case"] }, administrator)).rejects.toThrow();
    expect(database.rows.size).toBe(0);
    const saved = await saveMcpConfiguration(input, administrator);
    await expect(saveMcpConfiguration({ ...input, id: saved.id }, administrator)).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    expect((await listMcpSettings()).find(item => item.id === saved.id)?.revision).toBe(saved.revision);
  });

  it("isolates a corrupt provider and keeps connection/discovery/query outcomes separate", async () => {
    const saved = await saveMcpConfiguration({ ...input, enabled: true }, administrator);
    const bad = await saveMcpConfiguration({ ...input, name: "坏凭据服务", enabled: true }, administrator);
    const stored = database.rows.get(`legalMcp.config.${bad.id}`) as Record<string, unknown>;
    database.rows.set(`legalMcp.config.${bad.id}`, { ...stored, apiKeyCipher: { ct: "broken", iv: "broken", tag: "broken" } });
    await recordMcpChecks(saved.id, saved.revision!, administrator, { connection: { ok: true, at: "2026-11-16T10:00:00.000Z" } });
    const list = await listMcpSettings();
    expect(list.find(item => item.id === bad.id)).toMatchObject({ state: "CONFIGURATION_ERROR", hasKey: true });
    expect(list.find(item => item.id === saved.id)?.checks).toEqual({ connection: { ok: true, at: "2026-11-16T10:00:00.000Z" } });
    const repaired = await saveMcpConfiguration({ ...input, id: bad.id, expectedRevision: bad.revision, apiKey: "replacement-synthetic-key" }, administrator);
    expect(repaired.configurationError).toBeUndefined();
    const changed = await saveMcpConfiguration({ ...input, id: saved.id, expectedRevision: saved.revision, enabled: true }, administrator);
    await expect(recordMcpChecks(saved.id, saved.revision!, administrator, { query: { ok: true, at: "2026-11-16T11:00:00.000Z" } })).rejects.toMatchObject({ code: "CONFIG_CHANGED" });
    expect(changed.checks).toEqual({});
  });

  it("does not disclose any AI key fragment and a broken key can be replaced without decrypting it", async () => {
    database.rows.set("aiSettings", { apiKeyCipher: { ct: "broken", iv: "broken", tag: "broken" }, enabled: true });
    expect(await readPublicAiSettings()).toMatchObject({ configured: false, credentialSaved: true, apiKeyMasked: "已保存", configurationError: expect.any(String) });
    expect((await getAiSettings()).configured).toBe(false);
    await saveAiSettings({ apiKey: "short", enabled: true });
    expect(JSON.stringify(await readPublicAiSettings())).not.toContain("short");
    await saveAiSettings({ enabled: false });
    expect(await getAiSettings()).toMatchObject({ configured: false, apiKey: "" });
  });

  it("migrates a legacy OCR plaintext key once using compare-and-swap and never returns it publicly", async () => {
    database.rows.set("ocrSettings", { endpoint: "https://example.test/ocr", apiKey: "synthetic-legacy-key", supportsPdf: true });
    expect(await readPublicOcrSettings()).toMatchObject({ apiKey: "已保存", enabled: true });
    expect(JSON.stringify(database.rows.get("ocrSettings"))).not.toContain("synthetic-legacy-key");
    expect(database.rows.get("ocrSettings")).not.toHaveProperty("apiKey");
    expect(await readOcrSettings()).toMatchObject({ apiKey: "synthetic-legacy-key", supportsPdf: true });
    await readPublicOcrSettings();
    expect(database.setting.updateMany).toHaveBeenCalledTimes(1);
  });

  it("leaves a disabled broken OCR gateway unavailable and permits replacement or explicit key clearing", async () => {
    database.rows.set("ocrSettings", { endpoint: "https://example.test/ocr", enabled: false, apiKeyCipher: { ct: "broken", iv: "broken", tag: "broken" } });
    expect(await readOcrSettings()).toBeNull();
    expect((await readPublicOcrSettings()).configurationError).toBeTruthy();
    await saveOcrSettings({ endpoint: "https://example.test/ocr", apiKey: "replacement-synthetic-key", enabled: true });
    expect(await readOcrSettings()).toMatchObject({ apiKey: "replacement-synthetic-key" });
    await saveOcrSettings({ endpoint: "https://example.test/ocr", clearKey: true });
    expect((await readPublicOcrSettings()).apiKey).toBe("");
  });
});
