import { z } from "zod";
import { chronologyCategorySchema } from "./chronology-assessment";
import { evidenceTextSchema, revisionInputSchema } from "./item-input";

const stableUuid = z.uuid().transform(id => id.toLowerCase());

export const caseCandidateRefSchema = z.strictObject({
  runId: stableUuid, index: z.number().int().min(0).max(79),
});
export type CaseCandidateRef = z.infer<typeof caseCandidateRefSchema>;
export const caseCandidateKey = ({ runId, index }: CaseCandidateRef) => runId + ":" + index;

export const adoptMatterObservationsSchema = z.strictObject({
  matterId: z.cuid(), requestId: stableUuid,
  target: z.discriminatedUnion("type", [
    revisionInputSchema.extend({ type: z.literal("existing") }).strict(),
    evidenceTextSchema.extend({ type: z.literal("new"), chronologyCategory: chronologyCategorySchema.optional() }).strict(),
  ]),
  chosen: z.array(caseCandidateRefSchema).min(1).max(80),
}).refine(({ chosen }) => new Set(chosen.map(caseCandidateKey)).size === chosen.length,
  "同一候选只可采用一次");
