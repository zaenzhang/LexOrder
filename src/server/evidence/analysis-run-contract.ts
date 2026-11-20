import { z } from "zod";
import { fragmentsSchema } from "@/lib/workbench/fixed-fragments";
import { normalizedObservationCandidateSchema } from "./ai-observation-contract";

export const observationMethodVersion = "evidence-observations/12";
export const matterObservationMethodVersion = "matter-observations/12";
export const observationRunJob = "evidence.observations";
export const observationJobKey = (id: string) => observationRunJob + ":" + id;

export const observationRangeSchema = z.strictObject({
  sourceId: z.cuid(), start: z.number().int().min(0).max(2_000_000), end: z.number().int().positive().max(2_000_000),
});
const authorizedRangeSchema = observationRangeSchema.extend({
  documentId: z.cuid(), parseRunId: z.cuid(), anchorId: z.string().min(1).max(512),
});
export const observationRangesSchema = z.array(authorizedRangeSchema).min(1).max(8);
export const observationRunIdSchema = z.uuid().transform(id => id.toLowerCase());
export const startObservationRunSchema = z.strictObject({
  matterId: z.cuid(), evidenceItemId: z.cuid(), expectedRevision: z.number().int().positive(),
  runId: observationRunIdSchema, confirmed: z.literal(true), model: z.string().min(1).max(160), origin: z.url().max(400),
  ranges: z.array(observationRangeSchema).min(1).max(8),
}).refine(({ ranges }) => ranges.every(range => range.end > range.start && range.end - range.start <= 6000)
  && ranges.reduce((size, range) => size + range.end - range.start, 0) <= 36_000,
"单段最多 6000 字符，合计最多 36000 字符");

export const matterObservationRangesSchema = fragmentsSchema.refine(ranges => ranges.length <= 8, "单个分析批次最多 8 个固定片段");
export const startMatterObservationRunSchema = z.strictObject({
  matterId: z.cuid(), runId: observationRunIdSchema, confirmed: z.literal(true),
  model: z.string().min(1).max(160), origin: z.url().max(400), ranges: matterObservationRangesSchema,
});

export const adoptObservationRunSchema = z.strictObject({
  matterId: z.cuid(), evidenceItemId: z.cuid(), expectedRevision: z.number().int().positive(),
  runId: observationRunIdSchema, chosen: z.array(z.number().int().min(0).max(79)).min(1).max(80),
}).refine(input => new Set(input.chosen).size === input.chosen.length, "同一候选只可采用一次");
export const observationCandidatesSchema = z.array(normalizedObservationCandidateSchema).max(80);

export const observationAdoptionSchema = z.strictObject({
  chosen: z.array(z.number().int().min(0).max(79)).min(1).max(80), revision: z.number().int().positive(),
  observationIds: z.array(z.cuid()).min(1).max(80),
});

export const observationRunReceiptSchema = z.strictObject({
  dispatchedAt: z.iso.datetime({ offset: true }).optional(), finishedAt: z.iso.datetime({ offset: true }).optional(),
  sentCharacters: z.number().int().min(0).max(36_000).optional(),
  usage: z.strictObject({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).optional(),
  localRecords: z.number().int().min(1).max(80).optional(),
  skippedFields: z.number().int().nonnegative().optional(),
  rejected: z.array(z.strictObject({
    index: z.number().int().min(0).max(79), fragment: z.number().int().min(1).max(80).optional(),
    reason: z.enum(["SCHEMA", "RANGE", "SOURCE", "DUPLICATE"]),
  })).max(80).optional(),
  error: z.enum(["PERMISSION", "STALE", "PROVIDER", "UNAVAILABLE", "INVALID_RESULT", "INTERRUPTED"]).optional(),
});

export const observationProviderUsageSchema = z.object({
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }),
});
