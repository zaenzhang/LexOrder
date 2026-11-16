import {
  adapterReplySchema,
  retrievalInputSchema,
  retrievalScopeSchema,
  sourceAnchorSchema,
  type IndexBinding,
  type IndexProfile,
  type RetrievalErrorCode,
  type RetrievalScope,
  type SourceAnchor,
} from "@/lib/workbench/contracts";
import { anchorIsInReadyCoverage, canGroundGeneration, coverageIsComplete, sourceVersionKey } from "@/lib/workbench/source-validation";

export interface AdapterRequest {
  query: string;
  limit: number;
  documents: Array<Pick<IndexBinding, "bindingId" | "target" | "indexGenerationId">>;
  profile: IndexProfile;
  includeKnowledgeCompilation: false;
}

export interface RetrievalServices {
  /** Bound to the actor/mode/matter by trusted services, never supplied by UI/model. */
  loadScope(): Promise<unknown>;
  /** Adapter resolves its remote IDs to registered local anchor IDs. */
  retrieve(request: AdapterRequest): Promise<unknown>;
  /** Reads immutable anchor records; must not trust text/locations from the provider. */
  loadAnchors(anchorIds: readonly string[]): Promise<unknown[]>;
}

export type RetrievalResult =
  | { status: "ERROR"; code: RetrievalErrorCode }
  | {
      status: "EMPTY_SCOPE" | "NO_MATCHES" | "MATCHES" | "PARTIAL";
      hits: SourceAnchor[];
      // Parsing coverage is NOT a claim that the model read these materials.
      coverage: Array<Pick<IndexBinding, "bindingId" | "source" | "state" | "coverage">>;
      retrievedAnchorIds: string[];
    };

const failure = (code: RetrievalErrorCode): RetrievalResult => ({ status: "ERROR", code });

function sameRequestedScope(before: RetrievalScope, after: RetrievalScope): boolean {
  if (before.matterId !== after.matterId ||
      JSON.stringify(before.context) !== JSON.stringify(after.context)) return false;
  const current = new Map(after.bindings.map(binding => [binding.bindingId, binding]));
  // New grants do not expand an in-flight query. Revocation/change invalidates it.
  return before.bindings.every(binding =>
    JSON.stringify(binding) === JSON.stringify(current.get(binding.bindingId)),
  );
}

/**
 * Shared prototype boundary for W04.1. No database, provider connection or route
 * is installed here. W05/W06 must connect the callbacks to live authorization
 * and immutable storage. Callers must recheck before later publication/use.
 */
export async function retrieveScopedEvidence(
  input: unknown,
  services: RetrievalServices,
): Promise<RetrievalResult> {
  const request = retrievalInputSchema.safeParse(input);
  if (!request.success) return failure("INVALID_INPUT");
  try {
    const parsed = retrievalScopeSchema.safeParse(await services.loadScope());
    if (!parsed.success) return failure("INVALID_SCOPE");
    const scope = parsed.data;
    if (scope.bindings.length === 0) {
      return { status: "EMPTY_SCOPE", hits: [], coverage: [], retrievedAnchorIds: [] };
    }
    if (scope.bindings.some(binding => binding.state === "WITHDRAWN")) {
      return failure("SCOPE_CHANGED");
    }
    if (scope.bindings.some(binding => !canGroundGeneration(binding.source))) {
      return failure("SOURCE_NOT_ELIGIBLE");
    }
    const ready = scope.bindings.filter(binding => binding.state === "READY" &&
      binding.coverage.units.some(unit => unit.status === "READY"));
    if (ready.length === 0) {
      return failure(scope.bindings.some(binding => binding.state === "RECONCILIATION_REQUIRED")
        ? "RECONCILIATION_REQUIRED" : "NOT_READY");
    }
    const profile = ready[0].profile;
    if (ready.some(binding => JSON.stringify(binding.profile) !== JSON.stringify(profile))) {
      return failure("STALE_INDEX");
    }
    if (ready.some(binding => binding.target.instanceId !== ready[0].target.instanceId)) {
      return failure("INVALID_SCOPE");
    }
    const reply = adapterReplySchema.safeParse(await services.retrieve({
      query: request.data.query,
      limit: request.data.limit,
      documents: ready.map(({ bindingId, target, indexGenerationId }) => ({ bindingId, target: { ...target }, indexGenerationId })),
      profile: { ...profile },
      includeKnowledgeCompilation: false,
    }));
    if (!reply.success) return failure("INVALID_RESULT");
    if (reply.data.status === "ERROR") return failure(reply.data.code);
    if (reply.data.hits.length > request.data.limit) return failure("INVALID_RESULT");

    const requested = new Map(ready.map(binding => [binding.bindingId, binding]));
    const anchorIds = new Set<string>();
    for (const hit of reply.data.hits) {
      const binding = requested.get(hit.bindingId);
      if (!binding) return failure("INVALID_RESULT");
      if (hit.indexGenerationId !== binding.indexGenerationId) return failure("STALE_INDEX");
      if (anchorIds.has(hit.anchorId)) return failure("INVALID_RESULT");
      anchorIds.add(hit.anchorId);
    }
    const records = await services.loadAnchors([...anchorIds]);
    const anchors = new Map<string, SourceAnchor>();
    for (const record of records) {
      const anchor = sourceAnchorSchema.safeParse(record);
      if (!anchor.success || !anchorIds.has(anchor.data.anchorId) || anchors.has(anchor.data.anchorId)) {
        return failure("INVALID_RESULT");
      }
      anchors.set(anchor.data.anchorId, anchor.data);
    }
    const hits: SourceAnchor[] = [];
    for (const hit of reply.data.hits) {
      const binding = requested.get(hit.bindingId)!;
      const anchor = anchors.get(hit.anchorId);
      if (!anchor || sourceVersionKey(anchor.source) !== sourceVersionKey(binding.source) ||
          anchor.parseGenerationId !== binding.parseGenerationId ||
          hit.quote !== anchor.text || !anchorIsInReadyCoverage(anchor, binding)) {
        return failure("INVALID_RESULT");
      }
      // Use trusted source metadata (rights/review), never the provider's version.
      hits.push({ ...anchor, source: binding.source });
    }
    // Reload AFTER all async lookups; a lookup must not hide an intervening revocation.
    const latest = retrievalScopeSchema.safeParse(await services.loadScope());
    if (!latest.success || !sameRequestedScope(scope, latest.data)) return failure("SCOPE_CHANGED");
    const partial = ready.length !== scope.bindings.length || reply.data.truncated ||
      scope.bindings.some(binding => !coverageIsComplete(binding.coverage));
    return {
      status: partial ? "PARTIAL" : hits.length ? "MATCHES" : "NO_MATCHES",
      hits,
      coverage: scope.bindings.map(({ bindingId, source, state, coverage }) => ({ bindingId, source, state, coverage })),
      retrievedAnchorIds: hits.map(hit => hit.anchorId),
    };
  } catch {
    // Raw provider/storage errors may contain credentials, queries or private text.
    return failure("SERVICE_UNAVAILABLE");
  }
}
