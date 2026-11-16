"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { matterAssociationFilter } from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { auditTx } from "@/server/audit";
import { currentActor } from "@/server/intakes/workflow";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import type { ReviewItem, ReviewType, ReviewSeverity } from "@/lib/ai/review-parser";
import { summarizeReviewCoverage, type ReviewCoverage } from "@/lib/ai/review-coverage";
import { readReviewRecord, reviewRecordInputSchema, type ReviewRecordInput } from "./review-record-service";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

const typeLabels: Record<ReviewType, string> = { MISSING: "缺失要素", RISK: "法律风险", ISSUE: "条款问题", SUGGESTION: "优化建议" };
const severityLabels: Record<ReviewSeverity, string> = { HIGH: "高", MEDIUM: "中", LOW: "低" };

function buildMarkdown(source: { name: string; version: number }, reviewedAt: Date, coverage: ReviewCoverage, items: ReviewItem[]) {
  const counts = summarizeReviewCoverage(coverage);
  const lines = [
    `# 文书审查报告：${source.name.replace(/[\r\n]/g, " ")}`, "",
    `- 来源版本：${source.version}`,
    `- 审查时间：${shDayKey(reviewedAt)} ${shTime(reviewedAt)}`,
    `- 提取文本：${counts.totalChars} 字符 / ${counts.totalSegments} 段`,
    `- 已请求：${counts.sentChars} 字符 / ${counts.sentSegments} 段`,
    `- 有效回复：${counts.completedChars} 字符 / ${counts.completedSegments} 段`,
    `- 失败：${counts.failedChars} 字符 / ${counts.failedSegments} 段`,
    `- 未请求：${counts.notSentChars} 字符 / ${counts.notSentSegments} 段`, "",
    counts.status === "COMPLETE" ? "> 结果仅基于提取到的文本，仍需结合原件人工复核。" : "> 本次审查未完成。以下条目仅来自已取得有效回复的部分，不能视为整份材料的审查结论。", "",
  ];
  if (!items.length) lines.push("本次有效回复未列出审查条目。", "");
  for (const type of ["MISSING", "RISK", "ISSUE", "SUGGESTION"] as const) {
    const group = items.filter(item => item.type === type);
    if (!group.length) continue;
    lines.push(`## ${typeLabels[type]}（${group.length}）`, "");
    for (const item of group) lines.push(`- **${item.title}**（${severityLabels[item.severity]}）`, `  - ${item.detail}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function saveReviewToMatter(input: ReviewRecordInput): Promise<{ ok: true; documentId: string; documentName: string }> {
  const session = await requireSession("documents.write");
  const data = reviewRecordInputSchema.parse(input);
  let writtenPath: string | null = null;
  let document: { id: string; name: string };
  try {
    document = await prisma.$transaction(async tx => {
      const actor = await currentActor(tx, session.user.id, "documents.write");
      await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.matterId} FOR UPDATE`;
      const matter = await tx.matter.findFirst({ where: { id: data.matterId, deletedAt: null,
        ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) }, select: { status: true } });
      if (!matter) throw new ActionError("案件不存在或无权保存报告");
      if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，不能保存新审查报告");
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${data.documentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ReviewRecord" WHERE id=${data.recordId} FOR UPDATE`;
      const { record, document: source, items, coverage, reportReady } = await readReviewRecord(session.user.id, data, tx);
      if (!reportReady || !coverage) throw new ActionError("该审查缺少可信来源、覆盖记录或有效回复，不能生成报告");
      if (record.reportDocumentId) {
        const existing = await tx.document.findFirst({ where: { id: record.reportDocumentId, matterId: data.matterId, deletedAt: null } });
        if (!existing || !await canReadDocument(session.user.id, existing)) throw new ActionError("已保存的报告当前不可读取，请核对原记录");
        return { id: existing.id, name: existing.name };
      }

      const bytes = Buffer.from(buildMarkdown(source, record.reviewedAt, coverage, items), "utf8");
      const reportSha256 = sha256(bytes);
      const encrypted = source.encrypted ? encryptBuffer(bytes) : null;
      // Reserve the storage key before publishing: a provider can fail after the object exists.
      writtenPath = `m_${data.matterId}/${new Date().toISOString().slice(0, 7).replace("-", "")}/${randomUUID()}.bin`;
      await storage.writeFileAt(writtenPath, encrypted ? encrypted.ciphertext : bytes);
      const name = `AI审查_${source.name.replace(/[\\/:*?"<>|\r\n]/g, "").slice(0, 60)}_${shDayKey(record.reviewedAt)}.md`;
      const report = await tx.document.create({ data: {
        version: 1, isLatest: true,
        matterId: data.matterId, uploadedById: session.user.id, name, category: "OTHER", status: "DRAFT",
        path: writtenPath, mimeType: "text/markdown", size: bytes.length, sha256: reportSha256,
        encrypted: !!encrypted, algorithm: encrypted?.algorithm ?? null,
        iv: encrypted?.iv.toString("base64") ?? null, authTag: encrypted?.authTag.toString("base64") ?? null,
        tags: ["AI审查"],
      }, select: { id: true, name: true } });
      const linked = await tx.reviewRecord.updateMany({ where: {
        id: record.id, matterId: data.matterId, documentId: source.id, sourceSha256: source.sha256, reportDocumentId: null,
      }, data: { reportDocumentId: report.id } });
      if (linked.count !== 1) throw new ActionError("审查报告状态已变化，请重新打开历史记录核对");
      await auditTx(tx, { userId: session.user.id, action: "AI_REVIEW_SAVE", targetType: "ReviewRecord", targetId: record.id,
        detail: { matterId: data.matterId, sourceDocumentId: source.id, reportDocumentId: report.id, itemCount: items.length } });
      return report;
    }, { isolationLevel: "Serializable", timeout: 20000 });
  } catch (error) {
    if (writtenPath) await storage.deleteFile(writtenPath).catch(() => undefined);
    throw error;
  }
  // A refresh failure cannot erase a committed report; a retry resolves its existing record binding.
  await revalidateMatter(data.matterId);
  return { ok: true, documentId: document.id, documentName: document.name };
}
