import {
  citationSchema,
  processingCoverageSchema,
  sourceAnchorSchema,
  sourceVersionSchema,
  type IndexBinding,
  type ProcessingCoverage,
  type SourceAnchor,
  type SourceVersion,
} from "./contracts";

/** Stable source identity; a family ID or remote chunk ID is never a version. */
export function sourceVersionKey(source: SourceVersion): string {
  switch (source.kind) {
    case "CASE_MATERIAL":
      return JSON.stringify([source.kind, source.matterId, source.documentId, source.sha256]);
    case "LEGAL_AUTHORITY":
      return JSON.stringify([source.kind, source.provider, source.recordId, source.revisionId, source.sha256]);
    case "PRACTICE_KNOWLEDGE":
      return JSON.stringify([source.kind, source.audience, source.audienceScopeId, source.entryId, source.revisionId, source.sha256]);
  }
}

/** Eligibility is additional to, and never substitutes for, live authorization. */
export function canGroundGeneration(source: SourceVersion): boolean {
  switch (source.kind) {
    case "CASE_MATERIAL": return true;
    case "LEGAL_AUTHORITY":
      return source.verification === "VERIFIED" && source.content === "FULL_TEXT" &&
        source.canIndex && source.canGenerate;
    case "PRACTICE_KNOWLEDGE": return source.status === "APPROVED";
  }
}

export function coverageIsComplete(input: ProcessingCoverage): boolean {
  const coverage = processingCoverageSchema.parse(input);
  return coverage.totalUnits !== null &&
    coverage.units.every(unit => unit.status === "READY");
}

export function anchorIsInReadyCoverage(anchor: SourceAnchor, binding: IndexBinding): boolean {
  if (!binding.coverage.units.some(unit => unit.unit === anchor.unit && unit.status === "READY")) return false;
  switch (binding.coverage.unitKind) {
    case "PAGE": return anchor.location.kind === "PAGE" && anchor.location.page === anchor.unit;
    case "PARAGRAPH": return anchor.location.kind === "PARAGRAPH" && anchor.location.paragraph === anchor.unit;
    case "SEGMENT": return anchor.location.kind !== "UNLOCATED";
  }
}

/**
 * History reads use CURRENT read authorization and an immutable stored anchor.
 * They deliberately do not require the currently active retrieval generation.
 * Both the source catalog and anchor must come from trusted storage services.
 */
export function validateHistoricalCitation(
  citationInput: unknown,
  anchorInput: unknown,
  currentlyReadableSources: readonly SourceVersion[],
) {
  const citation = citationSchema.safeParse(citationInput);
  if (!citation.success) return { status: "ERROR", code: "INVALID_REFERENCE" } as const;
  const key = sourceVersionKey(citation.data.source);
  let currentSource: SourceVersion | undefined;
  for (const input of currentlyReadableSources) {
    const source = sourceVersionSchema.safeParse(input);
    if (source.success && sourceVersionKey(source.data) === key) {
      currentSource = source.data;
      break;
    }
  }
  // Do not disclose whether the anchor exists to an unauthorized caller.
  if (!currentSource) return { status: "ERROR", code: "UNAVAILABLE" } as const;
  const anchor = sourceAnchorSchema.safeParse(anchorInput);
  if (!anchor.success || anchor.data.anchorId !== citation.data.anchorId ||
      sourceVersionKey(anchor.data.source) !== key || anchor.data.location.kind === "UNLOCATED") {
    return { status: "ERROR", code: "UNAVAILABLE" } as const;
  }
  return { status: "AVAILABLE", anchor: { ...anchor.data, source: currentSource } } as const;
}
