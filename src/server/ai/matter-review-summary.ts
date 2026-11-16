/**
 * 案件级 AI 审查总览：仅聚合当前可读取来源的 ReviewRecord。
 *
 * read-only，无 "use server"，server component 直接调用。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanReadMatter } from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import type {
  ReviewItem,
  ReviewSeverity,
  ReviewType
} from "@/lib/ai/review-parser";

export type MatterReviewTopItem = {
  title: string;
  type: ReviewType;
  severity: ReviewSeverity;
  detail: string;
  documentId: string;
  documentName: string;
  reviewedAt: Date;
};

export type MatterReviewSummary = {
  recordCount: number;
  documentCount: number;
  totalItems: number;
  bySeverity: Record<ReviewSeverity, number>;
  topHighItems: MatterReviewTopItem[]; // 最多 3 条
  latestReviewedAt: Date | null;
};

export async function getMatterReviewSummary(
  matterId: string
): Promise<MatterReviewSummary> {
  const { user } = await requireSession("matters.read");
  await assertCanReadMatter(user.id, user.role, matterId, user.rolePermissions);
  const records = await prisma.reviewRecord.findMany({
    where: { matterId, document: { matterId, deletedAt: null } },
    orderBy: { reviewedAt: "desc" },
    select: {
      id: true,
      reviewedAt: true,
      documentId: true,
      itemsJson: true,
      document: { select: { id: true, name: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true } }
    }
  });
  // Review titles and details may quote originals. Resolve current source access
  // before aggregating or serializing any derived content, including counts.
  // The existing per-document guard retains approval-specific read grants.
  const documents = new Map(records.filter(record => record.document.matterId === matterId && !record.document.deletedAt)
    .map(record => [record.documentId, record.document]));
  const readableIds = new Set((await Promise.all([...documents].map(async ([id, document]) =>
    await canReadDocument(user.id, document) ? id : null))).filter((id): id is string => id !== null));
  const readableRecords = records.filter(record => readableIds.has(record.documentId));

  const docSet = new Set<string>();
  const bySeverity: Record<ReviewSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  let totalItems = 0;
  // 收集所有 HIGH，按 reviewedAt 倒序（records 已倒序），取最近 3 条不重复 title
  const seenTitles = new Set<string>();
  const topHigh: MatterReviewTopItem[] = [];
  let latest: Date | null = null;

  for (const r of readableRecords) {
    if (!latest) latest = r.reviewedAt;
    docSet.add(r.documentId);
    const items = (Array.isArray(r.itemsJson) ? r.itemsJson : []) as ReviewItem[];
    for (const it of items) {
      totalItems++;
      if (it.severity in bySeverity) bySeverity[it.severity]++;
      if (it.severity === "HIGH" && topHigh.length < 3) {
        const key = it.title.trim();
        if (key && !seenTitles.has(key)) {
          seenTitles.add(key);
          topHigh.push({
            title: it.title,
            type: it.type,
            severity: it.severity,
            detail: it.detail,
            documentId: r.documentId,
            documentName: r.document.name,
            reviewedAt: r.reviewedAt
          });
        }
      }
    }
  }

  return {
    recordCount: readableRecords.length,
    documentCount: docSet.size,
    totalItems,
    bySeverity,
    topHighItems: topHigh,
    latestReviewedAt: latest
  };
}
