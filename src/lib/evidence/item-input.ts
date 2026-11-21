import { z } from "zod";
import { evidenceEventDateSchema } from "./event-date";

export const evidenceKindSchema = z.enum(["FACT", "CLAIM", "ANALYSIS", "ISSUE", "TODO_VERIFY"]);
export const evidenceTextSchema = z.object({
  title: z.string().trim().min(1, "标题必填").max(200),
  content: z.string().trim().min(1, "内容必填").max(5000),
  kind: evidenceKindSchema,
  // Omitted by old callers. Updates must preserve the current date in that case.
  eventDate: evidenceEventDateSchema.optional(),
});
export const revisionInputSchema = z.object({
  evidenceItemId: z.string().cuid(),
  expectedRevision: z.number().int().positive(),
});
