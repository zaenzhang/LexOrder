// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "node:http";
import { createRagFlowAdapter, ragflowOperationFilename } from "@/server/rag/ragflow-adapter";
import { createModelClient } from "@/server/rag/model-client";
import { createServiceTransport, ServiceFailure } from "@/server/rag/service-transport";
import { createWorkPackage, digest } from "../fixtures/workbench-work-packages";
import type { AdapterRequest } from "@/server/rag/retrieve";
import { parseMaterial } from "@/server/rag/parse-material";
import { Document, Packer, Paragraph } from "docx";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/net/safe-url", () => ({ safeFetch: network.fetch }));
afterEach(() => vi.clearAllMocks());
const pack = createWorkPackage("civil", "SERVER");
const doc = pack.documents[0];
const request: AdapterRequest = { query: "合同", limit: 100, documents: [doc.binding], profile: doc.binding.profile, includeKnowledgeCompilation: false };
const intent = { operationId: "78dfd581-1edc-4bd0-95d5-e8c3c67c9ab8", source: doc.binding.source,
  parseGenerationId: "p1", indexGenerationId: "i1", filename: "合同.txt", mimeType: "text/plain" };
function setup() {
  const call = vi.fn();
  const verify = vi.fn().mockResolvedValue(true);
  const resolve = vi.fn().mockResolvedValue({ anchorId: doc.anchors[1].anchorId, quote: doc.anchors[1].text });
  return { call, verify, resolve, adapter: createRagFlowAdapter({ transport: { request: call }, instanceId: "fixture-ragflow", verifyConfiguration: verify, resolveChunk: resolve }) };
}
const validReply = () => ({ code: 0, data: { total: 1, chunks: [{ id: "chunk", content: doc.anchors[1].text,
  dataset_id: pack.scope.matterId, document_id: doc.binding.target.documentId }] } });

describe("RAGFlow fixed-version boundary", () => {
  it("does not send an empty document scope", async () => {
    const { adapter, call, verify } = setup();
    expect(await adapter.retrieve({ ...request, documents: [] })).toEqual({ status: "SUCCESS", hits: [], truncated: false });
    expect(call).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it("sends explicit whitelist, no compilation/KG, and enough candidates for limit 100", async () => {
    const { adapter, call } = setup(); call.mockResolvedValue(validReply());
    expect((await adapter.retrieve(request)).status).toBe("SUCCESS");
    expect(JSON.parse(call.mock.calls[0][1].body)).toMatchObject({ document_ids: [doc.binding.target.documentId],
      include_knowledge_compilation: false, use_kg: false, page_size: 100, rerank_candidates_count: 100 });
  });
  it.each([[108, "UNAUTHORIZED"], [109, "UNAUTHORIZED"], [104, "TIMEOUT"], [501, "UNSUPPORTED"]])("handles business code %s without leaking its message", async (code, expected) => {
    const { adapter, call } = setup(); call.mockResolvedValue({ code, message: "secret provider content" });
    expect(await adapter.retrieve(request)).toEqual({ status: "ERROR", code: expected });
  });
  it.each(["foreign-document", "unknown-chunk", "changed-quote"])("rejects %s", async variant => {
    const { adapter, call, resolve } = setup(); const reply = validReply();
    if (variant === "foreign-document") reply.data.chunks[0].document_id = "other";
    if (variant === "unknown-chunk") resolve.mockResolvedValue(null);
    if (variant === "changed-quote") reply.data.chunks[0].content = "changed";
    call.mockResolvedValue(reply);
    expect(await adapter.retrieve(request)).toEqual({ status: "ERROR", code: "INVALID_RESULT" });
  });
  it("rechecks effective configuration after retrieval", async () => {
    const { adapter, call, verify } = setup(); call.mockResolvedValue(validReply()); verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await adapter.retrieve(request)).toEqual({ status: "ERROR", code: "STALE_INDEX" });
  });
  it("does not retry an upload after a lost response", async () => {
    const { adapter, call } = setup(); call.mockRejectedValue(new ServiceFailure("TIMEOUT"));
    await expect(adapter.upload("dataset", intent, doc.bytes)).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("reconciles only one exact operation name and downloaded SHA-256", async () => {
    const { adapter, call } = setup(); call.mockResolvedValueOnce({ code: 0, data: { total: 1,
      docs: [{ id: "remote", name: ragflowOperationFilename(intent) }] } }).mockResolvedValueOnce(doc.bytes);
    expect(await adapter.reconcileUpload("dataset", intent)).toEqual({ documentId: "remote", operationId: intent.operationId });
  });
  it.each([0, 2])("keeps %s upload candidates uncertain", async count => {
    const { adapter, call } = setup(); call.mockResolvedValue({ code: 0, data: { total: count, docs: [] } });
    await expect(adapter.reconcileUpload("dataset", intent)).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
  });
  it("does not confuse cancel acknowledgment with STOPPED", async () => {
    const { adapter, call } = setup(); call.mockResolvedValueOnce({ code: 0, data: true }).mockResolvedValueOnce({ code: 0, data: {
      total: 1, docs: [{ id: "doc", name: "x", ingestion_status: "STOPPING" }] } });
    expect(await adapter.cancelParsing("dataset", "doc")).toMatchObject({ state: "STOPPING", observed: false });
    expect(await adapter.observe("dataset", "doc")).toMatchObject({ state: "STOPPING", observed: true });
  });
  it("keeps unknown remote processing status unknown", async () => {
    const { adapter, call } = setup(); call.mockResolvedValue({ code: 0, data: { total: 1, docs: [{ id: "doc", name: "x", ingestion_status: "NEW_STATE" }] } });
    expect(await adapter.observe("dataset", "doc")).toMatchObject({ state: "UNKNOWN", observed: false });
  });
  it("requires observed absence after deletion", async () => {
    const { adapter, call } = setup(); call.mockResolvedValueOnce({ code: 0, data: { deleted: 0 } })
      .mockResolvedValueOnce({ code: 0, data: { total: 1, docs: [{ id: "doc", name: "x" }] } });
    await expect(adapter.deleteDocument("dataset", "doc")).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect(JSON.parse(call.mock.calls[0][1].body)).toEqual({ ids: ["doc"], delete_all: false });
  });
  it("accepts idempotent deletion only after a successful empty ids observation", async () => {
    const { adapter, call } = setup(); call.mockResolvedValueOnce({ code: 0, data: { deleted: 0 } })
      .mockResolvedValueOnce({ code: 0, data: { total: 0, docs: [] } });
    expect(await adapter.deleteDocument("dataset", "doc")).toMatchObject({ state: "ABSENT", observed: true });
    expect(call.mock.calls[1][0]).toContain("ids=doc");
  });
  it("does not publish a changing or incomplete chunk page set", async () => {
    const { adapter, call } = setup(); call.mockResolvedValueOnce({ code: 0, data: { total: 2, chunks: [{ id: "1", content: "a" }] } })
      .mockResolvedValueOnce({ code: 0, data: { total: 3, chunks: [{ id: "2", content: "b" }] } });
    await expect(adapter.listChunks("dataset", "doc")).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
  });
});

describe("independent model protocol", () => {
  it.each(["length", "content_filter", "tool_calls", undefined])("rejects incomplete completion %s", async reason => {
    const client = createModelClient({ request: async () => ({ choices: [{ finish_reason: reason, message: { content: "partial" } }] }) }, "model", 2);
    await expect(client.generate("synthetic")).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });
  it("accepts explicit completion", async () => {
    const client = createModelClient({ request: async () => ({ model: "model", choices: [{ finish_reason: "stop", message: { content: "complete" } }] }) }, "model", 2);
    expect(await client.generate("synthetic")).toBe("complete");
  });
  it("rejects an embedding model identity mismatch", async () => {
    const client = createModelClient({ request: async () => ({ model: "other", data: [{ index: 0, embedding: [1, 2] }] }) }, "model", 2);
    await expect(client.embed(["synthetic"])).rejects.toMatchObject({ code: "STALE_INDEX" });
  });
  it.each([[{ index: 0, embedding: [1] }], [{ index: 1, embedding: [1, 2] }], [{ index: 0, embedding: [0, 0] }]])("rejects incompatible embedding result", async data => {
    const client = createModelClient({ request: async () => ({ data }) }, "model", 2);
    await expect(client.embed(["synthetic"])).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });
});

describe("explicit service transport", () => {
  it("keeps a private URL out of the default public route", () => {
    expect(() => createServiceTransport({ baseUrl: "http://127.0.0.1:1234", apiKey: "test" })).toThrow();
    expect(() => createServiceTransport({ baseUrl: "https://example.com", authentication: "none" })).toThrow();
  });
  it("covers a stalled DNS/public request with the configured timeout", async () => {
    network.fetch.mockImplementation(() => new Promise(() => undefined));
    const transport = createServiceTransport({ baseUrl: "https://example.com", apiKey: "synthetic", timeoutMs: 20 });
    await expect(transport.request("/test")).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("supports explicit keyless local services and refuses redirects", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/redirect") { response.writeHead(302, { Location: "/echo" }).end(); return; }
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ authorization: request.headers.authorization ?? null }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("test server");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const transport = createServiceTransport({ baseUrl: origin, trustedOrigin: origin, authentication: "none" });
      expect(await transport.request("/echo")).toEqual({ authorization: null });
      await expect(transport.request("/redirect")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe("material parsing counterexamples", () => {
  it("uses immutable text offsets rather than guessing DOCX paragraphs from line breaks", async () => {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("first\n\nsecond"), new Paragraph("third")] }] }));
    const source = { ...doc.binding.source, sha256: digest(bytes) };
    const result = await parseMaterial({ bytes, source, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", parseGenerationId: "p" });
    expect(result.state).toBe("READY"); expect(result.anchors.every(anchor => anchor.location.kind === "TEXT")).toBe(true);
  });
  it("keeps unconfigured OCR pending and rejects unverified multipage formats", async () => {
    const bytes = new Uint8Array([1, 2]); const source = { ...doc.binding.source, sha256: digest(bytes) };
    expect((await parseMaterial({ bytes, source, mimeType: "image/png", parseGenerationId: "p" })).state).toBe("PENDING");
    expect((await parseMaterial({ bytes, source, mimeType: "image/tiff", parseGenerationId: "p" })).state).toBe("UNSUPPORTED");
  });
  it("rejects mismatched original bytes before parsing", async () => {
    await expect(parseMaterial({ bytes: new Uint8Array([1]), source: doc.binding.source, mimeType: "text/plain", parseGenerationId: "p" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
