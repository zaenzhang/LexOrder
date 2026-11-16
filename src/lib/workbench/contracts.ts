import { z } from "zod";

// W01.2 / W04.1: data contracts only. Parsing a context never grants authority.
export const identifierSchema = z.string().min(1).max(512);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ordinal = z.number().int().positive();
const offset = z.number().int().nonnegative();

export const runtimeContextSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("PERSONAL"),
    actorId: identifierSchema,
    workspaceId: identifierSchema,
  }),
  z.strictObject({
    mode: z.literal("SERVER"),
    actorId: identifierSchema,
    instanceId: identifierSchema,
  }),
]);

export const sourceVersionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CASE_MATERIAL"),
    documentId: identifierSchema,
    matterId: identifierSchema,
    sha256: sha256Schema,
  }),
  z.strictObject({
    kind: z.literal("LEGAL_AUTHORITY"),
    provider: identifierSchema,
    recordId: identifierSchema,
    revisionId: identifierSchema,
    sha256: sha256Schema,
    jurisdiction: identifierSchema,
    authorityRole: z.enum(["STATUTE", "CASE", "OTHER"]),
    effectiveFrom: z.iso.date().nullable(),
    effectiveTo: z.iso.date().nullable(),
    retrievedAt: z.iso.datetime({ offset: true }),
    verification: z.enum(["UNVERIFIED", "VERIFIED"]),
    content: z.enum(["FULL_TEXT", "SUMMARY"]),
    canIndex: z.boolean(),
    canGenerate: z.boolean(),
  }).refine(
    value => !value.effectiveFrom || !value.effectiveTo || value.effectiveFrom <= value.effectiveTo,
    { message: "法律资料有效期间倒置", path: ["effectiveTo"] },
  ),
  z.strictObject({
    kind: z.literal("PRACTICE_KNOWLEDGE"),
    entryId: identifierSchema,
    revisionId: identifierSchema,
    sha256: sha256Schema,
    status: z.enum(["DRAFT", "APPROVED", "WITHDRAWN"]),
    audience: z.enum(["PERSONAL", "FIRM"]),
    audienceScopeId: identifierSchema,
  }),
]);

// All ordinals are one-based; text offsets are zero-based UTF-16, end-exclusive,
// against the immutable text representation recorded by the parse generation.
export const sourceLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PAGE"), page: ordinal }),
  z.strictObject({ kind: z.literal("TEXT"), start: offset, end: offset })
    .refine(value => value.end > value.start, { message: "文字范围为空或倒置" }),
  z.strictObject({ kind: z.literal("PARAGRAPH"), paragraph: ordinal, start: offset, end: offset })
    .refine(value => value.end > value.start, { message: "段落文字范围为空或倒置" }),
  z.strictObject({
    kind: z.literal("TABLE"),
    sheet: identifierSchema,
    rowStart: ordinal,
    rowEnd: ordinal,
    columnStart: ordinal,
    columnEnd: ordinal,
  }).refine(
    value => value.rowEnd >= value.rowStart && value.columnEnd >= value.columnStart,
    { message: "表格范围倒置" },
  ),
  z.strictObject({
    kind: z.literal("IMAGE"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }).refine(
    value => value.x + value.width <= 1 && value.y + value.height <= 1,
    { message: "图片区域超出原图" },
  ),
  z.strictObject({
    kind: z.literal("UNLOCATED"),
    reason: z.enum(["NO_MAPPING", "UNSUPPORTED"]),
  }),
]);

export const processingCoverageSchema = z.strictObject({
  // A unit is a stable part of this parse generation, not necessarily a PDF page.
  unitKind: z.enum(["PAGE", "PARAGRAPH", "SEGMENT"]),
  totalUnits: ordinal.nullable(),
  units: z.array(z.strictObject({
    unit: ordinal,
    status: z.enum(["READY", "PENDING", "FAILED", "UNSUPPORTED", "TRUNCATED"]),
  })),
}).superRefine((coverage, context) => {
  const unique = new Set(coverage.units.map(item => item.unit));
  if (unique.size !== coverage.units.length) {
    context.addIssue({ code: "custom", path: ["units"], message: "同一处理单元不能有多个状态" });
  }
  if (coverage.totalUnits !== null && (
    coverage.units.length !== coverage.totalUnits ||
    coverage.units.some(item => item.unit > coverage.totalUnits!)
  )) {
    context.addIssue({ code: "custom", path: ["units"], message: "已知范围必须逐项记录，未处理项不得省略" });
  }
});

export const indexProfileSchema = z.strictObject({
  parserVersion: identifierSchema,
  chunkerVersion: identifierSchema,
  embeddingProvider: identifierSchema,
  embeddingModel: identifierSchema,
  embeddingRevision: identifierSchema,
  dimensions: ordinal,
  preprocessingVersion: identifierSchema,
  // Hash of endpoint identity, protocol and non-secret input-affecting options.
  optionsFingerprint: sha256Schema,
});

export const indexTargetSchema = z.discriminatedUnion("backend", [
  z.strictObject({
    backend: z.literal("LANCEDB"),
    instanceId: identifierSchema,
    tableId: identifierSchema,
    documentId: identifierSchema,
  }),
  z.strictObject({
    backend: z.literal("RAGFLOW"),
    instanceId: identifierSchema,
    datasetId: identifierSchema,
    documentId: identifierSchema,
  }),
]);

export const indexBindingSchema = z.strictObject({
  bindingId: identifierSchema,
  source: sourceVersionSchema,
  parseGenerationId: identifierSchema,
  indexGenerationId: identifierSchema,
  profile: indexProfileSchema,
  target: indexTargetSchema,
  state: z.enum(["READY", "PROCESSING", "FAILED", "WITHDRAWN", "RECONCILIATION_REQUIRED"]),
  coverage: processingCoverageSchema,
});

export const retrievalScopeSchema = z.strictObject({
  context: runtimeContextSchema,
  matterId: identifierSchema,
  bindings: z.array(indexBindingSchema),
}).superRefine((scope, context) => {
  const bindings = new Set<string>();
  const targets = new Set<string>();
  for (const [index, binding] of scope.bindings.entries()) {
    const target = JSON.stringify(binding.target);
    if (bindings.has(binding.bindingId) || targets.has(target)) {
      context.addIssue({ code: "custom", path: ["bindings", index], message: "检索绑定必须唯一" });
    }
    bindings.add(binding.bindingId);
    targets.add(target);
    if ((scope.context.mode === "PERSONAL") !== (binding.target.backend === "LANCEDB")) {
      context.addIssue({ code: "custom", path: ["bindings", index], message: "检索后端与运行模式不匹配" });
    }
    if (binding.source.kind === "CASE_MATERIAL" && binding.source.matterId !== scope.matterId) {
      context.addIssue({ code: "custom", path: ["bindings", index], message: "材料不属于当前事项" });
    }
  }
});

export const sourceAnchorSchema = z.strictObject({
  anchorId: identifierSchema,
  source: sourceVersionSchema,
  parseGenerationId: identifierSchema,
  unit: ordinal,
  location: sourceLocationSchema,
  text: z.string().min(1),
});

export const citationSchema = z.strictObject({
  anchorId: identifierSchema,
  source: sourceVersionSchema,
  relation: z.enum(["SUPPORTS", "REBUTS", "CONTEXT"]),
});

export const evidenceCandidateSchema = z.strictObject({
  targetId: identifierSchema,
  targetRevision: identifierSchema,
  kind: z.enum(["FACT", "CLAIM", "ANALYSIS", "ISSUE", "TODO_VERIFY"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  citations: z.array(citationSchema),
  // The model cannot set ACCEPTED, APPROVED or DELIVERED.
  reviewState: z.literal("PENDING"),
});

export const retrievalInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(6000),
  limit: z.number().int().min(1).max(100),
});

export const retrievalErrorCodeSchema = z.enum([
  "INVALID_INPUT", "INVALID_SCOPE", "UNAUTHORIZED", "SCOPE_CHANGED",
  "NOT_READY", "SOURCE_NOT_ELIGIBLE", "STALE_INDEX", "INVALID_RESULT",
  "UNSUPPORTED", "RATE_LIMITED", "TIMEOUT", "CANCELLED",
  "SERVICE_UNAVAILABLE", "RECONCILIATION_REQUIRED",
]);

export const adapterReplySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("SUCCESS"),
    hits: z.array(z.strictObject({
      bindingId: identifierSchema,
      anchorId: identifierSchema,
      indexGenerationId: identifierSchema,
      quote: z.string().min(1),
    })),
    truncated: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("ERROR"),
    code: retrievalErrorCodeSchema,
  }),
]);

export type RuntimeContext = z.infer<typeof runtimeContextSchema>;
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export type ProcessingCoverage = z.infer<typeof processingCoverageSchema>;
export type IndexProfile = z.infer<typeof indexProfileSchema>;
export type IndexBinding = z.infer<typeof indexBindingSchema>;
export type RetrievalScope = z.infer<typeof retrievalScopeSchema>;
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type RetrievalErrorCode = z.infer<typeof retrievalErrorCodeSchema>;
export type AdapterReply = z.infer<typeof adapterReplySchema>;
