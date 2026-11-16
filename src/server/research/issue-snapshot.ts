import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { evidenceEventDateSchema } from "@/lib/evidence/event-date";
import { sourceReferenceSchema } from "@/server/evidence/contracts";

/** A research input captured at an actual save, not a newly invented evidence revision. */
export const researchIssueSnapshotSchema = z.object({
  evidenceItemId: z.string().cuid(), matterId: z.string().cuid(), revision: z.number().int().positive(),
  revisionId: z.string().cuid().nullable(), title: z.string(), content: z.string(), kind: z.literal("ISSUE"),
  eventDate: evidenceEventDateSchema, sourceSnapshot: z.array(sourceReferenceSchema),
  confirmedById: z.string().cuid().nullable(), confirmedAt: z.string().datetime({ offset: true }).nullable(),
  capturedAt: z.string().datetime({ offset: true }), capturedById: z.string().cuid(),
}).refine(value => Boolean(value.confirmedAt) === Boolean(value.confirmedById), "争点核对记录不完整");
export type ResearchIssueSnapshot = z.infer<typeof researchIssueSnapshotSchema>;

type ResearchIssueInput = {
  matterId: string; issueId: string | null; issueRevisionId: string | null; issueSnapshot: Prisma.JsonValue;
  issue: { matterId: string } | null;
};
/** Null means invalid/missing history. An unlinked research has no issue snapshot. */
export function readResearchIssueSnapshot(row: ResearchIssueInput): ResearchIssueSnapshot | null {
  const parsed = researchIssueSnapshotSchema.safeParse(row.issueSnapshot);
  if (!parsed.success || !row.issueId || row.issue?.matterId !== row.matterId) return null;
  const snapshot = parsed.data;
  return snapshot.evidenceItemId === row.issueId && snapshot.matterId === row.matterId && snapshot.revisionId === row.issueRevisionId ? snapshot : null;
}
