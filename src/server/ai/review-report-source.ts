/** Trusted report/source resolution only. The material read boundary applies its existing ACL to every returned object. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reviewCoverageSchema, summarizeReviewCoverage } from "@/lib/ai/review-coverage";

export type ReviewDocumentReadRef = {
  id: string;
  uploadedById: string;
  matterId: string | null;
  intakeId: string | null;
  deletedAt: Date | null;
};
export type ReviewReportSource =
  | { kind: "UNAVAILABLE" }
  | { kind: "LEGACY"; document: ReviewDocumentReadRef }
  | { kind: "ORDINARY"; document: ReviewDocumentReadRef }
  | { kind: "SOURCE"; report: ReviewDocumentReadRef; document: ReviewDocumentReadRef };

const readRef = { id: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true } satisfies Prisma.DocumentSelect;

export async function resolveReviewReportSource(documentId: string, db: Prisma.TransactionClient = prisma): Promise<ReviewReportSource> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      ...readRef, tags: true,
      reviewReportFor: { select: {
        matterId: true, documentId: true, reportDocumentId: true, sourceSha256: true, coverageJson: true,
        document: { select: { ...readRef, sha256: true } },
      } },
    },
  });
  if (!document || document.deletedAt) return { kind: "UNAVAILABLE" };
  const record = document.reviewReportFor;
  // Old reports were saved without a source relation. Keep their existing
  // object-level read access without claiming which original they derived from.
  if (!record) return document.tags?.includes("AI审查") ? { kind: "LEGACY", document } : { kind: "ORDINARY", document };
  const source = record.document;
  const coverage = reviewCoverageSchema.safeParse(record.coverageJson);
  if (record.reportDocumentId !== document.id || record.documentId !== source.id || document.id === source.id ||
      !record.sourceSha256 || !/^[a-f0-9]{64}$/.test(record.sourceSha256) || record.sourceSha256 !== source.sha256 ||
      source.deletedAt || source.matterId !== record.matterId || document.matterId !== record.matterId ||
      !coverage.success || summarizeReviewCoverage(coverage.data).completedSegments === 0) return { kind: "UNAVAILABLE" };
  return { kind: "SOURCE", report: document, document: source };
}
