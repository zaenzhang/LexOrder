"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ReviewItem, ReviewSeverity } from "@/lib/ai/review-parser";
import type { ReviewCoverage } from "@/lib/ai/review-coverage";
import { readableReviewSource, readReviewRecord, storedReviewContent, reviewSourceInputSchema, reviewRecordInputSchema, type ReviewSourceInput, type ReviewRecordInput } from "./review-record-service";

export type ReviewHistoryEntry = {
  id: string;
  reviewedAt: Date;
  reviewedBy: { id: string; name: string };
  itemCount: number;
  coverage: ReviewCoverage | null;
  reportDocumentId: string | null;
  reportReady: boolean;
  severityCounts: Record<ReviewSeverity, number>;
};
export type ReviewHistoryDetail = {
  recordId: string;
  matterId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  reviewedAt: Date;
  items: ReviewItem[];
  coverage: ReviewCoverage | null;
  reportDocumentId: string | null;
  reportReady: boolean;
};

export async function listReviewHistory(input: ReviewSourceInput): Promise<ReviewHistoryEntry[]> {
  const session = await requireSession("documents.read");
  const data = reviewSourceInputSchema.parse(input);
  const source = await readableReviewSource(session.user.id, data);
  const records = await prisma.reviewRecord.findMany({
    where: { documentId: source.id, matterId: data.matterId },
    orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    select: { id: true, reviewedAt: true, itemsJson: true, coverageJson: true, sourceSha256: true, reportDocumentId: true,
      reviewedBy: { select: { id: true, name: true } } },
  });
  return records.map(record => {
    const { items, coverage, reportReady } = storedReviewContent(record, source.sha256);
    const severityCounts: Record<ReviewSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const item of items) severityCounts[item.severity]++;
    return { id: record.id, reviewedAt: record.reviewedAt, reviewedBy: record.reviewedBy, itemCount: items.length,
      coverage, reportDocumentId: record.reportDocumentId, reportReady, severityCounts };
  });
}

export async function getReviewRecord(input: ReviewRecordInput): Promise<ReviewHistoryDetail> {
  const session = await requireSession("documents.read");
  const data = reviewRecordInputSchema.parse(input);
  const { record, document, items, coverage, reportReady } = await readReviewRecord(session.user.id, data);
  return { recordId: record.id, matterId: record.matterId, documentId: record.documentId,
    documentName: document.name, documentVersion: document.version, reviewedAt: record.reviewedAt,
    items, coverage, reportDocumentId: record.reportDocumentId, reportReady };
}
