import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

export const fixedReviewSchema = z.object({
  matterId: z.cuid(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().nullable(),
  issues: z.array(z.object({ id: z.cuid(), version: z.number().int().positive() })),
});
export type FixedReview = z.infer<typeof fixedReviewSchema>;

/** Inside the same approval transaction as issue and draft-version mutations. */
export async function assertFixedReview(db: Prisma.TransactionClient, id: string, expected: FixedReview, latestRequired = true) {
  const seen = fixedReviewSchema.parse(expected);
  const current = await db.document.findFirst({
    where: {
      id,
      matterId: seen.matterId,
      version: seen.version,
      ...(latestRequired ? { isLatest: true } : {}),
      deletedAt: null,
      sha256: seen.sha256,
      updatedAt: new Date(seen.updatedAt),
      matter: { deletedAt: null, status: { not: "ARCHIVED" } },
    },
    select: { manualReviewIssues: { select: { id: true, version: true } } },
  });
  const revisions = new Map(seen.issues.map((issue) => [issue.id, issue.version]));
  if (
    !current ||
    revisions.size !== seen.issues.length ||
    current.manualReviewIssues.length !== revisions.size ||
    current.manualReviewIssues.some((issue) => revisions.get(issue.id) !== issue.version)
  ) {
    throw new ActionError("文书版本或复核问题已变化，请重新读取后逐项核对。");
  }
  return seen;
}
