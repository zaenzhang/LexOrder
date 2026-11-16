import { createHash } from "node:crypto";
import { z } from "zod";
import { ingestionIntentSchema, type IngestionIntent, type IngestionObservation } from "@/lib/workbench/ingestion-contracts";
import type { AdapterReply, IndexProfile } from "@/lib/workbench/contracts";
import type { AdapterRequest } from "./retrieve";
import { ServiceFailure, serviceError, type ServiceTransport } from "./service-transport";

export const RAGFLOW_VERSION = "1.0.0";
export const RAGFLOW_COMMIT = "db1cd5929a7885a3074547791f5ecc4d2f891739";
const documentSchema = z.object({ id: z.string().min(1), name: z.string(), dataset_id: z.string().optional(), ingestion_status: z.string().optional() });
const listSchema = z.object({ docs: z.array(documentSchema), total: z.number().int().nonnegative() });
const retrievalSchema = z.object({ total: z.number().int().nonnegative(), chunks: z.array(z.object({
  id: z.string().min(1), content: z.string().min(1), document_id: z.string().min(1), dataset_id: z.string().min(1),
})) });
const idPath = (id: string) => {
  if (!id || id.length > 512 || /[\u0000-\u001f]/.test(id)) throw new ServiceFailure("INVALID_INPUT");
  return encodeURIComponent(id);
};
const basePath = (dataset: string) => "/api/v1/datasets/" + idPath(dataset);
const json = (method: string, value: unknown): RequestInit => ({ method,
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function ragflowOperationFilename(intent: IngestionIntent): string {
  const checked = ingestionIntentSchema.parse(intent);
  const suffix = /\.[a-zA-Z0-9]{1,10}$/.exec(checked.filename)?.[0].toLowerCase() ?? ".bin";
  return "lexorder-" + checked.operationId + suffix;
}

/** HTTP client only. Durable intents, leases, live authorization and publication are W05/W06. */
export function createRagFlowAdapter(config: {
  transport: ServiceTransport;
  instanceId: string;
  verifyConfiguration(profile: IndexProfile, datasetIds: string[]): Promise<boolean>;
  resolveChunk(input: { datasetId: string; documentId: string; chunkId: string; indexGenerationId: string }):
    Promise<{ anchorId: string; quote: string } | null>;
}) {
  const call = async (path: string, init?: RequestInit) => {
    const response = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(await config.transport.request(path, init));
    if (!response.success) throw new ServiceFailure("INVALID_RESULT");
    if (response.data.code !== 0) throw new ServiceFailure([108, 109, 401, 403].includes(response.data.code)
      ? "UNAUTHORIZED" : response.data.code === 104 ? "TIMEOUT" : response.data.code === 501 ? "UNSUPPORTED" : "SERVICE_UNAVAILABLE");
    return response.data.data;
  };
  const list = async (dataset: string, query: string) => {
    const result = listSchema.safeParse(await call(basePath(dataset) + "/documents?" + query));
    if (!result.success) throw new ServiceFailure("INVALID_RESULT");
    if (result.data.docs.some(doc => doc.dataset_id !== undefined && doc.dataset_id !== dataset)) throw new ServiceFailure("INVALID_RESULT");
    return result.data;
  };
  const observe = async (dataset: string, documentId: string): Promise<IngestionObservation> => {
    const result = await list(dataset, new URLSearchParams({ ids: documentId, page: "1", page_size: "2" }).toString());
    if (!result.docs.length && result.total === 0) return { state: "ABSENT", remoteDocumentId: documentId, observed: true };
    if (result.docs.length !== 1 || result.total !== 1 || result.docs[0].id !== documentId) throw new ServiceFailure("INVALID_RESULT");
    const states: Record<string, IngestionObservation["state"]> = { UNSTART: "UPLOADED", CREATED: "PROCESSING",
      SCHEDULED: "PROCESSING", RUNNING: "PROCESSING", STOPPING: "STOPPING", COMPLETED: "COMPLETED", STOPPED: "STOPPED", FAILED: "FAILED" };
    const state = states[result.docs[0].ingestion_status ?? ""] ?? "UNKNOWN";
    return { state, remoteDocumentId: documentId, observed: state !== "UNKNOWN" };
  };
  return {
    observe,
    async upload(dataset: string, intentInput: IngestionIntent, bytes: Uint8Array) {
      const intent = ingestionIntentSchema.parse(intentInput);
      if (hash(bytes) !== intent.source.sha256 || !bytes.length || bytes.length > 25 * 1024 * 1024) throw new ServiceFailure("INVALID_INPUT");
      const form = new FormData();
      const name = ragflowOperationFilename(intent);
      form.append("file", new Blob([new Uint8Array(bytes)], { type: intent.mimeType }), name);
      try {
        const result = z.array(documentSchema).safeParse(await call(basePath(dataset) + "/documents", { method: "POST", body: form }));
        if (!result.success || result.data.length !== 1 || result.data[0].name !== name ||
            (result.data[0].dataset_id !== undefined && result.data[0].dataset_id !== dataset)) throw new ServiceFailure("RECONCILIATION_REQUIRED");
        return { documentId: result.data[0].id, operationId: intent.operationId };
      } catch (error) {
        // Even a malformed reply may follow a committed upload. Never retry automatically.
        throw new ServiceFailure(serviceError(error) === "UNAUTHORIZED" ? "UNAUTHORIZED" : "RECONCILIATION_REQUIRED");
      }
    },
    async reconcileUpload(dataset: string, intentInput: IngestionIntent) {
      const intent = ingestionIntentSchema.parse(intentInput);
      const name = ragflowOperationFilename(intent);
      try {
        const result = await list(dataset, new URLSearchParams({ keywords: name, page: "1", page_size: "100" }).toString());
        // A duplicate/renamed retry or omitted page makes attribution ambiguous.
        if (result.total !== 1 || result.docs.length !== 1 || result.docs[0].name !== name) throw new ServiceFailure("RECONCILIATION_REQUIRED");
        const doc = result.docs[0];
        const bytes = await config.transport.request(basePath(dataset) + "/documents/" + idPath(doc.id), {}, true);
        if (!(bytes instanceof Uint8Array) || hash(bytes) !== intent.source.sha256) throw new ServiceFailure("RECONCILIATION_REQUIRED");
        return { documentId: doc.id, operationId: intent.operationId };
      } catch { throw new ServiceFailure("RECONCILIATION_REQUIRED"); }
    },
    async startParsing(dataset: string, documentId: string) {
      await call(basePath(dataset) + "/chunks", json("POST", { document_ids: [documentId] }));
      return { state: "PROCESSING", observed: false, remoteDocumentId: documentId } satisfies IngestionObservation;
    },
    async cancelParsing(dataset: string, documentId: string) {
      await call(basePath(dataset) + "/chunks", json("DELETE", { document_ids: [documentId] }));
      return { state: "STOPPING", observed: false, remoteDocumentId: documentId } satisfies IngestionObservation;
    },
    async deleteDocument(dataset: string, documentId: string) {
      const result = z.object({ deleted: z.number().int().nonnegative().max(1) }).safeParse(
        await call(basePath(dataset) + "/documents", json("DELETE", { ids: [documentId], delete_all: false })));
      if (!result.success) throw new ServiceFailure("RECONCILIATION_REQUIRED");
      const observation = await observe(dataset, documentId);
      if (observation.state !== "ABSENT") throw new ServiceFailure("RECONCILIATION_REQUIRED");
      return observation;
    },
    async listChunks(dataset: string, documentId: string) {
      const chunks: unknown[] = [];
      let total: number | undefined;
      const ids = new Set<string>();
      for (let page = 1; page <= 100; page++) {
        const result = z.object({ total: z.number().int().nonnegative().max(10000), chunks: z.array(z.object({
          id: z.string().min(1), content: z.string(), document_id: z.string().optional(), dataset_id: z.string().optional(),
        }).passthrough()) }).safeParse(await call(basePath(dataset) + "/documents/" + idPath(documentId) + "/chunks?page=" + page + "&page_size=100"));
        if (!result.success || (total !== undefined && total !== result.data.total)) throw new ServiceFailure("RECONCILIATION_REQUIRED");
        total = result.data.total;
        for (const chunk of result.data.chunks) {
          if (ids.has(chunk.id) || (chunk.document_id && chunk.document_id !== documentId) ||
              (chunk.dataset_id && chunk.dataset_id !== dataset)) throw new ServiceFailure("INVALID_RESULT");
          ids.add(chunk.id); chunks.push(chunk);
        }
        if (chunks.length === total) return chunks;
        if (chunks.length > total || !result.data.chunks.length) break;
      }
      throw new ServiceFailure("RECONCILIATION_REQUIRED");
    },
    async retrieve(request: AdapterRequest): Promise<AdapterReply> {
      try {
        if (!request.documents.length) return { status: "SUCCESS", hits: [], truncated: false };
        if (request.documents.some(doc => doc.target.backend !== "RAGFLOW" || doc.target.instanceId !== config.instanceId) ||
            request.includeKnowledgeCompilation !== false || request.limit < 1 || request.limit > 100 || !Number.isInteger(request.limit)) {
          throw new ServiceFailure("INVALID_SCOPE");
        }
        const datasetIds = [...new Set(request.documents.flatMap(doc => doc.target.backend === "RAGFLOW" ? [doc.target.datasetId] : []))];
        if (!await config.verifyConfiguration(request.profile, datasetIds)) throw new ServiceFailure("STALE_INDEX");
        const result = retrievalSchema.safeParse(await call("/api/v1/retrieval", json("POST", {
          question: request.query, dataset_ids: datasetIds, document_ids: request.documents.map(doc => doc.target.documentId),
          include_knowledge_compilation: false, use_kg: false, page: 1, page_size: request.limit,
          rerank_candidates_count: Math.max(64, request.limit),
        })));
        if (!result.success || result.data.chunks.length > request.limit) throw new ServiceFailure("INVALID_RESULT");
        const hits = [];
        const anchors = new Set<string>();
        for (const chunk of result.data.chunks) {
          const binding = request.documents.find(doc => doc.target.backend === "RAGFLOW" &&
            doc.target.datasetId === chunk.dataset_id && doc.target.documentId === chunk.document_id);
          if (!binding) throw new ServiceFailure("INVALID_RESULT");
          const mapping = await config.resolveChunk({ datasetId: chunk.dataset_id, documentId: chunk.document_id,
            chunkId: chunk.id, indexGenerationId: binding.indexGenerationId });
          if (!mapping || mapping.quote !== chunk.content || anchors.has(mapping.anchorId)) throw new ServiceFailure("INVALID_RESULT");
          anchors.add(mapping.anchorId);
          hits.push({ bindingId: binding.bindingId, anchorId: mapping.anchorId,
            indexGenerationId: binding.indexGenerationId, quote: mapping.quote });
        }
        if (!await config.verifyConfiguration(request.profile, datasetIds)) throw new ServiceFailure("STALE_INDEX");
        return { status: "SUCCESS", hits, truncated: result.data.total > result.data.chunks.length };
      } catch (error) { return { status: "ERROR", code: serviceError(error) }; }
    },
  };
}
