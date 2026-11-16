import { createHash } from "node:crypto";
import { z } from "zod";
import { indexProfileSchema, type AdapterReply, type IndexBinding, type IndexProfile, type SourceAnchor } from "@/lib/workbench/contracts";
import { indexWriteSchema } from "@/lib/workbench/ingestion-contracts";
import { anchorIsInReadyCoverage, canGroundGeneration, sourceVersionKey } from "@/lib/workbench/source-validation";
import type { AdapterRequest } from "./retrieve";
import { ServiceFailure, serviceError } from "./service-transport";

// Narrow SDK port; the M1 runner supplies a real @lancedb/lancedb 0.41.0 table.
export interface LanceQuery {
  where(predicate: string): LanceQuery;
  limit(count: number): LanceQuery;
  toArray(): Promise<unknown[]>;
}
export interface LanceTable {
  query(): { nearestToText(query: string, columns: string[]): LanceQuery };
  vectorSearch(vector: number[]): { distanceType(metric: "cosine"): LanceQuery };
  mergeInsert(column: string): {
    whenMatchedUpdateAll(): { whenNotMatchedInsertAll(): { execute(rows: Record<string, unknown>[]): Promise<unknown> } };
  };
  delete(predicate: string): Promise<unknown>;
}
const rowSchema = z.object({
  anchorId: z.string(), bindingId: z.string(), documentId: z.string(), indexGenerationId: z.string(),
  profileFingerprint: z.string(), text: z.string().min(1),
});
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
// Preserve quote text. Add exact numeric components to the separate lexical
// representation so 120000 also finds 120000.00, and a year can find a date.
export function materialLexicalText(text: string): string {
  const normalized = text.normalize("NFKC");
  const numbers = normalized.match(/\d+(?:[.\-/]\d+)*/g) ?? [];
  return normalized + "\n" + [...new Set(numbers.flatMap(value => [value, ...value.split(/[.\-/]/)]))].join(" ");
}
export function indexProfileFingerprint(profile: IndexProfile): string {
  return createHash("sha256").update(JSON.stringify(indexProfileSchema.parse(profile))).digest("hex");
}
const predicateFor = (binding: Pick<IndexBinding, "bindingId" | "indexGenerationId" | "target">) =>
  `(bindingId = ${quote(binding.bindingId)} AND documentId = ${quote(binding.target.documentId)} AND indexGenerationId = ${quote(binding.indexGenerationId)})`;

export function createLanceAdapter(config: {
  table: LanceTable; instanceId: string; tableId: string; profile: IndexProfile;
  embed(texts: readonly string[]): Promise<number[][]>;
  retrievalMode?: "LEXICAL" | "HYBRID";
}) {
  const profile = indexProfileSchema.parse(config.profile);
  const fingerprint = indexProfileFingerprint(profile);
  const checkBinding = (binding: Pick<IndexBinding, "target">) => {
    if (binding.target.backend !== "LANCEDB" || binding.target.instanceId !== config.instanceId ||
        binding.target.tableId !== config.tableId) throw new ServiceFailure("INVALID_SCOPE");
  };
  const vectorsFor = async (texts: string[]) => {
    const vectors = await config.embed(texts);
    if (vectors.length !== texts.length || vectors.some(vector => vector.length !== profile.dimensions ||
        vector.some(value => !Number.isFinite(value)) || vector.every(value => value === 0))) {
      throw new ServiceFailure("INVALID_RESULT");
    }
    return vectors;
  };
  return {
    async write(bindingInput: IndexBinding, anchorsInput: SourceAnchor[]) {
      const { binding, anchors } = indexWriteSchema.parse({ binding: bindingInput, anchors: anchorsInput });
      checkBinding(binding);
      if (binding.state !== "READY" || !canGroundGeneration(binding.source) ||
          indexProfileFingerprint(binding.profile) !== fingerprint || new Set(anchors.map(a => a.anchorId)).size !== anchors.length ||
          anchors.some(a => sourceVersionKey(a.source) !== sourceVersionKey(binding.source) ||
            a.parseGenerationId !== binding.parseGenerationId || !anchorIsInReadyCoverage(a, binding))) {
        throw new ServiceFailure("INVALID_INPUT");
      }
      const vectors = await vectorsFor(anchors.map(a => a.text));
      const rows = anchors.map((anchor, i) => ({
        // A reindex may keep the same stable anchor. It must not overwrite another generation.
        rowId: JSON.stringify([binding.bindingId, binding.indexGenerationId, anchor.anchorId]),
        anchorId: anchor.anchorId, bindingId: binding.bindingId, documentId: binding.target.documentId,
        indexGenerationId: binding.indexGenerationId, profileFingerprint: fingerprint, text: anchor.text,
        lexicalText: materialLexicalText(anchor.text), vector: vectors[i],
      }));
      await config.table.mergeInsert("rowId").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows);
    },
    async deleteGeneration(binding: Pick<IndexBinding, "bindingId" | "indexGenerationId" | "target">) {
      checkBinding(binding);
      await config.table.delete(predicateFor(binding));
    },
    async retrieve(request: AdapterRequest): Promise<AdapterReply> {
      try {
        if (!request.documents.length) return { status: "SUCCESS", hits: [], truncated: false };
        if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100 ||
            request.includeKnowledgeCompilation !== false) throw new ServiceFailure("INVALID_INPUT");
        if (indexProfileFingerprint(request.profile) !== fingerprint) throw new ServiceFailure("STALE_INDEX");
        request.documents.forEach(checkBinding);
        const predicate = `(${request.documents.map(predicateFor).join(" OR ")}) AND profileFingerprint = ${quote(fingerprint)}`;
        const count = request.limit + 1;
        const lexical = await config.table.query().nearestToText(request.query.normalize("NFKC"), ["lexicalText"]).where(predicate).limit(count).toArray();
        const lists = [lexical];
        if (config.retrievalMode !== "LEXICAL") {
          const [vector] = await vectorsFor([request.query]);
          lists.push(await config.table.vectorSearch(vector).distanceType("cosine").where(predicate).limit(count).toArray());
        }
        const ranked = new Map<string, { row: z.infer<typeof rowSchema>; score: number }>();
        for (const list of lists) for (const [rank, value] of list.entries()) {
          const parsed = rowSchema.safeParse(value);
          if (!parsed.success) throw new ServiceFailure("INVALID_RESULT");
          const row = parsed.data;
          if (row.profileFingerprint !== fingerprint || !request.documents.some(document =>
            document.bindingId === row.bindingId && document.target.documentId === row.documentId &&
            document.indexGenerationId === row.indexGenerationId)) throw new ServiceFailure("INVALID_RESULT");
          const existing = ranked.get(row.anchorId);
          if (existing && (existing.row.text !== row.text || existing.row.bindingId !== row.bindingId)) throw new ServiceFailure("INVALID_RESULT");
          ranked.set(row.anchorId, { row, score: (existing?.score ?? 0) + 1 / (60 + rank + 1) });
        }
        const sorted = [...ranked.values()].sort((a, b) => b.score - a.score || a.row.anchorId.localeCompare(b.row.anchorId));
        return { status: "SUCCESS", truncated: sorted.length > request.limit || lists.some(list => list.length === count),
          hits: sorted.slice(0, request.limit).map(({ row }) => ({ bindingId: row.bindingId, anchorId: row.anchorId,
            indexGenerationId: row.indexGenerationId, quote: row.text })) };
      } catch (error) { return { status: "ERROR", code: serviceError(error) }; }
    },
  };
}
