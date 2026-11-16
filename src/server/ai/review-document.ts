"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { decryptBuffer, sha256 } from "@/lib/storage/crypto";
import { aiChat, AiNotConfiguredError } from "@/lib/ai/client";
import { getAiSettings } from "@/lib/ai/settings";
import { parseReviewItems, type ReviewItem } from "@/lib/ai/review-parser";
import { prepareReviewSegments, summarizeReviewCoverage, type ReviewCoverage } from "@/lib/ai/review-coverage";
import { selectReviewPrompt, reviewPromptLabel } from "@/lib/ai/review-prompts";
import { currentActor } from "@/server/intakes/workflow";
import { auditTx } from "@/server/audit";
import { assertCanReviewDocument } from "./document-access";
import { readableReviewSource, reviewSourceInputSchema, type ReviewSourceInput } from "./review-record-service";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { ActionError } from "@/lib/action-error";

export type ReviewResult = {
  recordId: string;
  matterId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  reviewedAt: Date;
  items: ReviewItem[];
  coverage: ReviewCoverage;
  reportDocumentId: string | null;
  reportReady: boolean;
};

async function extractDocumentText(
  buf: Buffer,
  mimeType: string | null
): Promise<string> {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (
    mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt === "application/docx"
  ) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (mt === "application/msword") {
    throw new ActionError("不支持老 .doc 格式，请另存为 .docx 后重新上传");
  }
  if (mt.startsWith("text/")) {
    return buf.toString("utf8");
  }
  throw new ActionError(
    `不支持的文档类型 (${mimeType ?? "未知"})，目前仅支持 PDF / DOCX / 纯文本`
  );
}

export async function reviewDocument(input: ReviewSourceInput): Promise<ReviewResult> {
  const session = await requireSession("documents.write");
  const data = reviewSourceInputSchema.parse(input);
  const doc = await readableReviewSource(session.user.id, data);
  await assertCanReviewDocument(session, doc);
  const matter = await prisma.matter.findUnique({ where: { id: data.matterId }, select: { status: true } });
  if (!matter || matter.status === "ARCHIVED") throw new ActionError("案件已归档或不可用，不能发起新审查；仍可查看获准历史");
  if (!doc.sha256 || !/^[a-f0-9]{64}$/.test(doc.sha256)) throw new ActionError("原材料缺少可信版本校验信息，请补传一个材料版本");
  if (!(await getAiSettings()).configured) throw new ActionError("当前未启用可用的 AI 模型，不能发起新审查");

  const stored = await storage.readFile(doc.path);
  if (doc.encrypted && (!doc.iv || !doc.authTag)) throw new ActionError("原材料加密信息不完整");
  const bytes = doc.encrypted ? decryptBuffer(stored, doc.iv!, doc.authTag!) : stored;
  // One hash for this original read; the verified value is reused by every dispatch and final record.
  const sourceSha256 = sha256(bytes);
  if (sourceSha256 !== doc.sha256 || (doc.size !== null && bytes.length !== doc.size)) throw new ActionError("原材料与保存的版本不一致，不能审查");
  const text = (await extractDocumentText(bytes, doc.mimeType)).trim();
  if (text.length < 20) throw new ActionError("没有足够的可分析文本，请查看原件或补传可读取文本的版本");
  const prepared = prepareReviewSegments(text);
  const coverage: ReviewCoverage = { totalChars: prepared.totalChars, totalSegments: prepared.totalSegments, segments: [], stopReason: null };
  const items: ReviewItem[] = [];
  const systemPrompt = selectReviewPrompt(doc.category);
  const promptLabel = reviewPromptLabel(doc.category);

  for (const [index, segment] of prepared.segments.entries()) {
    // A long request never grants its next segment access from the initial page/session alone.
    await assertCanReviewDocument(session, { ...doc, sha256: sourceSha256 });
    await auditTx(prisma, { userId: session.user.id, action: "AI_REVIEW_ATTEMPT", targetType: "Document", targetId: doc.id,
      detail: { matterId: data.matterId, segment: index + 1, chars: segment.length } });
    let content: string;
    try {
      const response = await aiChat({ userId: session.user.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `文书名称：${doc.name}\n审查类型：${promptLabel}\n\n文书正文：\n${segment}\n\n本次为提取文本第 ${index + 1} / ${prepared.totalSegments} 段，请仅针对本段给出审查项，不能据此断言整份材料均已审查。` },
        ], maxTokens: 2000, temperature: 0.2, timeoutMs: 45_000, logAction: "review-document",
      });
      content = response.content;
    } catch (error) {
      if (error instanceof AiNotConfiguredError) {
        if (coverage.segments.length === 0) throw new ActionError("当前未启用可用的 AI 模型，未发起审查");
        coverage.stopReason = "MODEL_UNAVAILABLE";
      } else coverage.segments.push({ index: index + 1, chars: segment.length, status: "FAILED", errorCode: "REQUEST_FAILED" });
      break;
    }
    try {
      items.push(...parseReviewItems(content));
      coverage.segments.push({ index: index + 1, chars: segment.length, status: "SUCCEEDED", errorCode: null });
    } catch {
      coverage.segments.push({ index: index + 1, chars: segment.length, status: "FAILED", errorCode: "INVALID_RESPONSE" });
      break;
    }
  }

  const summary = summarizeReviewCoverage(coverage);
  const record = await prisma.$transaction(async tx => {
    await currentActor(tx, session.user.id, "documents.write");
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.matterId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${data.documentId} FOR UPDATE`;
    await assertCanReviewDocument(session, { ...doc, sha256: sourceSha256 }, tx);
    const currentMatter = await tx.matter.findUnique({ where: { id: data.matterId }, select: { status: true, deletedAt: true } });
    if (!currentMatter || currentMatter.deletedAt || currentMatter.status === "ARCHIVED") throw new ActionError("案件状态已变化，不能发布本次审查结果");
    const created = await tx.reviewRecord.create({ data: {
      matterId: data.matterId, documentId: doc.id, reviewedById: session.user.id,
      itemCount: items.length, itemsJson: items as Prisma.InputJsonValue,
      textPreviewChars: prepared.totalChars, truncated: summary.notSentChars > 0,
      sourceSha256, coverageJson: coverage as Prisma.InputJsonValue,
    }, select: { id: true, reviewedAt: true } });
    await auditTx(tx, { userId: session.user.id, action: "AI_REVIEW_DOCUMENT", targetType: "Document", targetId: doc.id,
      detail: { matterId: data.matterId, recordId: created.id, status: summary.status, sentChars: summary.sentChars,
        completedChars: summary.completedChars, failedSegments: summary.failedSegments, notSentChars: summary.notSentChars, itemCount: items.length } });
    return created;
  }, { isolationLevel: "Serializable", timeout: 20000 });
  return { recordId: record.id, matterId: data.matterId, documentId: doc.id, documentName: doc.name, documentVersion: doc.version,
    reviewedAt: record.reviewedAt, items, coverage, reportDocumentId: null, reportReady: summary.completedSegments > 0 };
}
