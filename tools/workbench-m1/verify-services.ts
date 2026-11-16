import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceTransport, serviceError } from "../../src/server/rag/service-transport";
import { createModelClient } from "../../src/server/rag/model-client";
import { createRagFlowAdapter } from "../../src/server/rag/ragflow-adapter";
import { indexProfileSchema, type SourceAnchor, type IndexBinding } from "../../src/lib/workbench/contracts";
import { retrieveScopedEvidence } from "../../src/server/rag/retrieve";
import { digest } from "../../src/tests/fixtures/workbench-work-packages";

// Explicit Server runs must neither call Personal services nor count them as missing.
const args = process.argv.slice(2);
const mode = args.length === 0 ? "all" : args.length === 1 && args[0].startsWith("--mode=")
  ? args[0].slice("--mode=".length) : args.length === 2 && args[0] === "--mode" ? args[1] : undefined;
if (mode !== "all" && mode !== "server") throw new Error("Usage: verify-services.ts [--mode=server|all]");

const results: Array<{ check: string; status: string; code?: string }> = [];
const env = (name: string) => process.env[name];
const configuredTransport = (prefix: string) => !!env(prefix + "_BASE_URL") &&
  (env(prefix + "_AUTH") === "none" ? !!env(prefix + "_TRUSTED_ORIGIN") : !!env(prefix + "_KEY"));
const transport = (prefix: string) => createServiceTransport({ baseUrl: env(prefix + "_BASE_URL")!,
  apiKey: env(prefix + "_KEY"), trustedOrigin: env(prefix + "_TRUSTED_ORIGIN"),
  authentication: env(prefix + "_AUTH") === "none" ? "none" : "bearer", timeoutMs: 45_000 });
async function check(name: string, configured: boolean, run: () => Promise<void>) {
  if (!configured) { results.push({ check: name, status: "NOT_CONFIGURED" }); return; }
  try { await run(); results.push({ check: name, status: "PASS" }); }
  catch (error) { results.push({ check: name, status: "FAILED", code: serviceError(error) }); }
}
for (const runtime of mode === "server" ? ["SERVER"] : ["PERSONAL", "SERVER"]) {
  const prefix = "M1_" + runtime + "_MODEL";
  await check(runtime.toLowerCase() + "_generation_api", configuredTransport(prefix) && !!env(prefix + "_NAME"), async () => {
    const result = await createModelClient(transport(prefix), env(prefix + "_NAME")!, 1).generate("这是一项合成连通性检查。请只输出：M1_OK");
    if (result.trim() !== "M1_OK") throw new Error("MODEL_EXPECTATION_FAILED");
  });
}
if (mode === "all") await check("personal_real_embedding_example", configuredTransport("M1_EMBEDDING") && !!env("M1_EMBEDDING_NAME") && !!env("M1_EMBEDDING_DIMENSIONS"), async () => {
  const client = createModelClient(transport("M1_EMBEDDING"), env("M1_EMBEDDING_NAME")!, Number(env("M1_EMBEDDING_DIMENSIONS")));
  const [query, relevant, unrelated] = await client.embed(["合同付款条件", "合同约定验收完成后支付价款。", "西红柿炒鸡蛋是一道家常菜。"]);
  const similarity = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0) /
    Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) * b.reduce((sum, x) => sum + x * x, 0));
  if (similarity(query, relevant) <= similarity(query, unrelated)) throw new Error("SEMANTIC_EXAMPLE_FAILED");
});

const configured = !!env("M1_RAGFLOW_BASE_URL") && !!env("M1_RAGFLOW_KEY") && !!env("M1_RAGFLOW_DATASET_ID") &&
  !!env("M1_RAGFLOW_PROFILE_FILE") && !!env("M1_RAGFLOW_EMBEDDING_ID") && env("M1_RAGFLOW_ALLOW_SYNTHETIC_WRITES") === "1";
await check("ragflow_synthetic_upload_parse_retrieve_delete", configured, async () => {
  const remote = transport("M1_RAGFLOW");
  const datasetId = env("M1_RAGFLOW_DATASET_ID")!.replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(datasetId)) throw new Error("INVALID_DATASET_ID");
  const profile = indexProfileSchema.parse(JSON.parse(await readFile(env("M1_RAGFLOW_PROFILE_FILE")!, "utf8")));
  const datasetSchema = z.object({ code: z.literal(0), total_datasets: z.literal(1), data: z.array(z.object({
    id: z.literal(datasetId), embedding_model: z.literal(env("M1_RAGFLOW_EMBEDDING_ID")!), parser_id: z.literal("general"),
    parser_config: z.record(z.string(), z.unknown()), language: z.string().nullable(), pipeline_id: z.string().optional(), pipeline_version_id: z.string().optional(),
  })).length(1) });
  const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const configuration = async () => {
    const value = datasetSchema.parse(await remote.request("/api/v1/datasets?" + new URLSearchParams({ id: datasetId, page: "1", page_size: "2" })));
    if (value.data[0].pipeline_id) throw new Error("UNVERIFIED_PIPELINE");
    return canonical(value.data[0]);
  };
  const snapshot = await configuration();
  const operationId = randomUUID();
  const text = "合成验收资料，不用于真实事项。合成合同价款120000.00元，质量验收另行确认。";
  const bytes = new TextEncoder().encode(text);
  const source = { kind: "CASE_MATERIAL" as const, matterId: "m1-synthetic", documentId: operationId, sha256: digest(bytes) };
  const intent = { operationId, source, parseGenerationId: operationId + "-parse", indexGenerationId: operationId + "-index", filename: "synthetic.txt", mimeType: "text/plain" };
  const mappings = new Map<string, SourceAnchor>();
  const adapter = createRagFlowAdapter({ transport: remote, instanceId: "m1-ragflow",
    verifyConfiguration: async incoming => canonical(incoming) === canonical(profile) && await configuration() === snapshot,
    resolveChunk: async input => {
      const anchor = mappings.get(input.chunkId);
      return input.indexGenerationId === intent.indexGenerationId && anchor ? { anchorId: anchor.anchorId, quote: anchor.text } : null;
    },
  });
  let remoteId: string | undefined;
  try {
    try { remoteId = (await adapter.upload(datasetId, intent, bytes)).documentId; }
    catch { remoteId = (await adapter.reconcileUpload(datasetId, intent)).documentId; }
    if ((await adapter.reconcileUpload(datasetId, intent)).documentId !== remoteId) throw new Error("ORIGINAL_ID_MISMATCH");
    await adapter.startParsing(datasetId, remoteId);
    let complete = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = await adapter.observe(datasetId, remoteId);
      if (state.state === "COMPLETED") { complete = true; break; }
      if (["FAILED", "STOPPED", "ABSENT", "UNKNOWN"].includes(state.state)) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!complete) throw new Error("PARSING_NOT_COMPLETED");
    const chunks = await adapter.listChunks(datasetId, remoteId);
    const covered = new Set<number>();
    for (const item of chunks) {
      const chunk = z.object({ id: z.string(), content: z.string().min(1) }).parse(item);
      const start = text.indexOf(chunk.content);
      if (start < 0 || text.indexOf(chunk.content, start + 1) >= 0) throw new Error("UNVERIFIED_SOURCE_MAPPING");
      for (let offset = start; offset < start + chunk.content.length; offset++) covered.add(offset);
      mappings.set(chunk.id, { anchorId: digest(operationId + chunk.id), source, parseGenerationId: intent.parseGenerationId, unit: 1,
        location: { kind: "TEXT", start, end: start + chunk.content.length }, text: chunk.content });
    }
    if (!mappings.size) throw new Error("NO_VERIFIED_CHUNKS");
    for (let offset = 0; offset < text.length; offset++) {
      if (text[offset].trim() && !covered.has(offset)) throw new Error("INCOMPLETE_TEXT_COVERAGE");
    }
    const binding: IndexBinding = { bindingId: operationId + "-binding", source, parseGenerationId: intent.parseGenerationId,
      indexGenerationId: intent.indexGenerationId, profile, target: { backend: "RAGFLOW", instanceId: "m1-ragflow", datasetId, documentId: remoteId },
      state: "READY", coverage: { unitKind: "SEGMENT", totalUnits: 1, units: [{ unit: 1, status: "READY" }] } };
    // The single synthetic text segment is checked against original bytes above.
    const anchors = [...mappings.values()];
    const result = await retrieveScopedEvidence({ query: "合同价款", limit: 5 }, {
      loadScope: async () => ({ context: { mode: "SERVER", actorId: "m1-operator", instanceId: "m1-server" }, matterId: source.matterId, bindings: [binding] }),
      retrieve: adapter.retrieve, loadAnchors: async ids => anchors.filter(anchor => ids.includes(anchor.anchorId)),
    });
    if (!("hits" in result) || !result.hits.length) throw new Error("RETRIEVAL_FAILED");
  } finally {
    if (remoteId) await adapter.deleteDocument(datasetId, remoteId);
    else console.log(JSON.stringify({ operationId, state: "RECONCILIATION_REQUIRED" }));
  }
});
console.log(JSON.stringify({ mode, results, limits: ["Connectivity/sample evidence only; not professional acceptance", "RAGFlow cancellation race and lost-response fault injection require separate live checks", "RAGFlow profile metadata is operator supplied, not inferred from dataset display identity"] }, null, 2));
if (results.some(result => result.status !== "PASS")) process.exitCode = 2;
