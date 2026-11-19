import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { contextAccess } from "@/server/matters/context-service";
import { readSourceSnapshot, sourceReferences } from "@/server/evidence/source-links";
import { emptyLawMetadata, emptyResearchContent } from "@/server/research/contracts";
import { saveResearchRevision } from "@/server/research/actions";

export const factReviewRequest = z.object({
  action: z.literal("save-fact-review"),
  matterId: z.string().cuid(), evidenceItemId: z.string().cuid(), revision: z.number().int().positive(),
  confirmedAt: z.iso.datetime({ offset: true }).nullable(), sourceId: z.string().cuid(),
  value: z.string().trim().min(1).max(2000), reason: z.string().trim().min(1).max(3000),
  requestKey: z.string().uuid(), researchedAt: z.iso.datetime({ offset: true }),
});

export async function saveFactReview(input: z.infer<typeof factReviewRequest>) {
  const { user } = await requireSession("matters.write");
  const { title, source } = await prisma.$transaction(async tx => {
    await contextAccess(tx, user, input.matterId);
    const item = await tx.evidenceItem.findFirst({
      where: { id: input.evidenceItemId, matterId: input.matterId },
      select: { revision: true, kind: true, title: true, sourceDocumentId: true, sourcePage: true,
        sources: { where: { id: input.sourceId, removedAt: null } } },
    });
    if (!item) throw new ActionError("指定争点不属于当前案件或已不可用");
    // Reconstruct the same request after a lost reply, even if a newer issue revision exists.
    const previous = item.revision === input.revision ? null : await tx.evidenceItemRevision.findUnique({
      where: { evidenceItemId_revision: { evidenceItemId: input.evidenceItemId, revision: input.revision } },
      select: { kind: true, title: true, sourceSnapshot: true },
    });
    const seen = item.revision === input.revision ? item : previous;
    const references = previous ? readSourceSnapshot(previous.sourceSnapshot) : sourceReferences(item);
    const source = references?.find(reference => reference.id === input.sourceId);
    if (seen?.kind !== "ISSUE" || !source?.relation || source.legacy || !source.documentSha256) {
      throw new ActionError("所选出处不属于这版争点或无法固定原件，请重新核对");
    }
    return { title: seen.title, source: { ...source, relation: source.relation } };
  });

  // The research save rechecks CURRENT (including confirmation time) in its write transaction.
  // The one direct citation fixes the explicitly chosen version/position. The issue snapshot retains all counterevidence.
  return saveResearchRevision({
    ...emptyResearchContent(), matterId: input.matterId, requestKey: input.requestKey, researchedAt: input.researchedAt,
    supersedesId: null, expectedVersion: null, question: title, purpose: "确定本争点的工作采用值，并保留取舍理由及双方出处。", conclusion: input.value, supportingAnalysis: input.reason,
    issueSelection: { kind: "CURRENT", issueId: input.evidenceItemId, revision: input.revision, confirmedAt: input.confirmedAt },
    sources: [{ documentId: source.documentId, relation: source.relation, lawMetadata: emptyLawMetadata(),
      ...(source.parseRunId && source.anchorId ? { parseRunId: source.parseRunId, anchorId: source.anchorId }
        : source.location.kind === "PAGE" ? { page: source.location.page } : {}) }],
  });
}
