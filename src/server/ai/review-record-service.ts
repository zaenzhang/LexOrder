/** Current document/record checks shared by the review actions. Trusted server helpers, not RPCs. */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { identifierSchema } from "@/lib/workbench/contracts";
import { reviewItemsSchema } from "@/lib/ai/review-parser";
import { reviewCoverageSchema, summarizeReviewCoverage } from "@/lib/ai/review-coverage";
import { ActionError } from "@/lib/action-error";

export const reviewSourceInputSchema = z.strictObject({ matterId: identifierSchema, documentId: identifierSchema });
export const reviewRecordInputSchema = reviewSourceInputSchema.extend({ recordId: identifierSchema });
export type ReviewSourceInput = z.infer<typeof reviewSourceInputSchema>;
export type ReviewRecordInput = z.infer<typeof reviewRecordInputSchema>;

export const reviewSourceSelect = {
  id: true, name: true, version: true, sha256: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
  category: true, mimeType: true, path: true, size: true, encrypted: true, algorithm: true, iv: true, authTag: true,
} satisfies Prisma.DocumentSelect;
export type ReviewSource = Prisma.DocumentGetPayload<{ select: typeof reviewSourceSelect }>;

export async function readableReviewSource(userId: string, input: ReviewSourceInput, db: Prisma.TransactionClient = prisma): Promise<ReviewSource> {
  const document = await db.document.findFirst({
    where: { id: input.documentId, matterId: input.matterId, deletedAt: null, matter: { deletedAt: null } },
    select: reviewSourceSelect,
  });
  if (!document || !await canReadDocument(userId, document, db)) throw new ActionError("原材料不存在或当前无权读取");
  return document;
}

export function storedReviewContent(record: { itemsJson: unknown; coverageJson: unknown; sourceSha256: string | null }, sourceSha256: string | null) {
  if (record.sourceSha256 !== null && record.sourceSha256 !== sourceSha256) throw new ActionError("审查来源与当前材料版本不一致，无法读取结果");
  const items = reviewItemsSchema.safeParse(record.itemsJson);
  if (!items.success) throw new ActionError("审查记录内容不完整，无法读取结果");
  const parsed = record.coverageJson === null ? null : reviewCoverageSchema.safeParse(record.coverageJson);
  if (parsed && !parsed.success) throw new ActionError("审查覆盖记录不完整，无法读取结果");
  const coverage = parsed?.success ? parsed.data : null;
  const reportReady = !!record.sourceSha256 && /^[a-f0-9]{64}$/.test(record.sourceSha256) && !!coverage && summarizeReviewCoverage(coverage).completedSegments > 0;
  return { items: items.data, coverage, reportReady };
}

export async function readReviewRecord(userId: string, input: ReviewRecordInput, db: Prisma.TransactionClient = prisma) {
  const document = await readableReviewSource(userId, input, db);
  const record = await db.reviewRecord.findFirst({
    where: { id: input.recordId, matterId: input.matterId, documentId: input.documentId },
    include: { reviewedBy: { select: { id: true, name: true } } },
  });
  if (!record) throw new ActionError("审查记录不存在或不属于当前材料");
  return { document, record, ...storedReviewContent(record, document.sha256) };
}
