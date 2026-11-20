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
/** Null means the issue changed beyond an append-only addition of sources. */
export function issueSourceAdditions(previous: ResearchIssueSnapshot, current: ResearchIssueSnapshot) {
  if (previous.evidenceItemId !== current.evidenceItemId || previous.matterId !== current.matterId ||
      previous.title !== current.title || previous.content !== current.content ||
      JSON.stringify(previous.eventDate) !== JSON.stringify(current.eventDate)) return null;
  const known = new Map(previous.sourceSnapshot.map(source => [source.id, JSON.stringify(source)]));
  const currentById = new Map(current.sourceSnapshot.map(source => [source.id, JSON.stringify(source)]));
  for (const [id, source] of known) if (currentById.get(id) !== source) return null;
  return current.sourceSnapshot.filter(source => !known.has(source.id));
}

/** Null means invalid/missing history. An unlinked research has no issue snapshot. */
export function readResearchIssueSnapshot(row: ResearchIssueInput): ResearchIssueSnapshot | null {
  const parsed = researchIssueSnapshotSchema.safeParse(row.issueSnapshot);
  if (!parsed.success || !row.issueId || row.issue?.matterId !== row.matterId) return null;
  const snapshot = parsed.data;
  return snapshot.evidenceItemId === row.issueId && snapshot.matterId === row.matterId && snapshot.revisionId === row.issueRevisionId ? snapshot : null;
}
