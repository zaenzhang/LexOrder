import { z } from "zod";
import { caseCandidateKey, caseCandidateRefSchema } from "./case-adoption";

export const caseGroupingLimits = { candidates: 30, characters: 16_000 } as const;
export const caseGroupingIdSchema = z.uuid().transform(id => id.toLowerCase());
const selected = z.array(caseCandidateRefSchema).min(2).max(caseGroupingLimits.candidates).refine(
  refs => new Set(refs.map(caseCandidateKey)).size === refs.length, "候选不可重复");
export const caseGroupingPreviewSchema = z.strictObject({ matterId: z.cuid(), selected });
export const startCaseGroupingSchema = caseGroupingPreviewSchema.extend({
  groupingId: caseGroupingIdSchema, confirmed: z.literal(true),
  model: z.string().min(1).max(160), origin: z.url().max(400),
});

export const caseGroupingResultSchema = z.strictObject({
  groups: z.array(z.strictObject({
    reason: z.enum(["SHARED_REFERENCE", "RELATED_DESCRIPTION", "DISPUTED_EVENT"]),
    members: z.array(z.strictObject({
      observation: z.number().int().min(1).max(caseGroupingLimits.candidates),
      quote: z.string().min(1).max(160),
    })).min(2).max(caseGroupingLimits.candidates),
  })).max(15),
});
export type CaseGroupingResult = z.infer<typeof caseGroupingResultSchema>;
