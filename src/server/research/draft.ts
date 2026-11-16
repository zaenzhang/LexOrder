import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Document as DocxDocument, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { shDayKey } from "@/lib/ui/sh-time";
import { auditTx } from "@/server/audit";
import { contextAccess, type ContextActor } from "@/server/matters/context-service";
import { queryAccessLabels, queryOutcomeLabels, sourceRelationLabels, lawKindLabels, researchDraftSchema, type ResearchDraftInput, type ResearchRevisionView } from "./contracts";
import { assertResearchReadable, loadResearch, presentResearch, researchTransaction } from "./service";

export function researchDraftSections(view: ResearchRevisionView): { title: string; text: string }[] {
  if (!view.content) throw new ActionError("研究来源不可用，不能形成分析稿");
  const value = view.content;
  const fields = [
    { title: "研究范围", text: `问题：${value.question}\n用途：${value.purpose || "待明确"}\n法域：${value.jurisdiction || "待核实"}\n事实相关日期：${value.relevantDate || "待核实"}\n研究日期：${shDayKey(value.researchedAt)}\n范围与限制：${value.scope || "未记录"}` },
    { title: "规则与例外", text: `规则：${value.rule || "待研究"}\n例外：${value.exceptions || "未记录"}` },
    { title: "支持分析", text: value.supportingAnalysis || "未记录" },
    { title: "反向分析", text: value.opposingAnalysis || "未记录，不表示不存在反向依据" },
    { title: "结论与条件", text: value.conclusion || "待研究" },
    { title: "未决与下一步", text: `未决：${value.unresolved || "未记录，不表示核查完毕"}\n下一步：${value.nextSteps || "未记录"}` },
    { title: "查询与阅读", text: value.queryLog.length ? value.queryLog.map((query, index) =>
      `${index + 1}. ${query.query}\n位置：${query.location || "未记录"}\n${queryAccessLabels[query.access]} / ${queryOutcomeLabels[query.outcome]}\n${query.notes}`).join("\n\n") : "未记录查询或阅读过程" },
    { title: "具体来源", text: view.sources.length ? view.sources.map((source, index) => {
      const law = source.lawMetadata;
      return `${index + 1}. ${source.documentName} · V${source.version} · ${source.locationLabel} · ${sourceRelationLabels[source.relation]}\n` +
        `材料标识：${source.documentId}\n类别：${lawKindLabels[law.kind]}；法源核实：${law.verification === "CHECKED" ? "已核实" : "待核实"}\n` +
        (law.kind !== "MATERIAL" ? `法源：${law.title || "未记录"}；机关：${law.authority || "未记录"}；编号：${law.number || "未记录"}\n法域：${law.jurisdiction || "待核实"}；效力期间：${law.effectiveFrom || "起日未知"} 至 ${law.effectiveTo || "结束日未知"}\n` : "") +
        `取得：${law.acquiredOn || "日期未记录"}；${law.acquiredVia || "途径未记录"}\n使用范围：${law.usageScope || "待核实"}`;
    }).join("\n\n") : "未选择固定原文；查询记录中的链接或摘要不能替代全文" },
  ];
  return fields;
}

export async function createResearchDraft(db: PrismaClient, actor: ContextActor, input: ResearchDraftInput) {
  const parsed = researchDraftSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({ kind: "RESEARCH_ANALYSIS", matterId: parsed.matterId,
    researchRevisionId: parsed.researchRevisionId })).digest("hex");
  let ownedPath: string | null = null;
  try {
    return await researchTransaction(db, async tx => {
      const access = await contextAccess(tx, actor, parsed.matterId, true);
      if (!hasCustomPermission(access.user, "documents.write")) throw new ActionError("无权生成事项文书");
      const row = await loadResearch(tx, parsed.matterId, parsed.researchRevisionId);
      await assertResearchReadable(tx, access, row);
      const existing = await tx.document.findUnique({ where: { generationRequestKey: parsed.requestKey } });
      if (existing) {
        if (existing.uploadedById !== actor.id || existing.generationRequestHash !== requestHash || existing.matterId !== parsed.matterId) {
          throw new ActionError("生成标识已用于其他内容，请重新打开研究");
        }
        if (existing.deletedAt || !await canReadDocument(actor.id, existing, tx)) throw new ActionError("本次生成的稿件已撤回或无权读取");
        return { documentId: existing.id, fileName: existing.name, replayed: true };
      }
      const view = await presentResearch(tx, access, row);
      const sections = researchDraftSections(view);
      const children = [new Paragraph({ text: row.question, heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: `研究修订 ${row.version} · ${row.checkedAt ? "研究已核对" : "研究待核对"} · 分析草稿`, bold: true })] }),
        new Paragraph(`研究标识：${row.id}`),
        ...sections.flatMap(section => [new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
          ...section.text.split("\n").map(text => new Paragraph(text))])];
      const bytes = await Packer.toBuffer(new DocxDocument({ sections: [{ children }] }));
      const encrypted = encryptBuffer(bytes);
      // This transaction owns the path; no Document is published until its exact source relation commits.
      ownedPath = `m_${parsed.matterId}/${new Date().toISOString().slice(0, 7).replace("-", "")}/${randomUUID()}.bin`;
      await storage.writeFileAt(ownedPath, encrypted.ciphertext);
      await assertResearchReadable(tx, access, row);
      const fileName = `分析稿_${row.question.replace(/[\\/:*?"<>|]/g, "").slice(0, 70)}_研究V${row.version}.docx`;
      const document = await tx.document.create({ data: {
        matterId: parsed.matterId, name: fileName, category: "OTHER", sourceOrigin: "TEAM_PRODUCED", status: "DRAFT", familyId: randomUUID(),
        path: ownedPath, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: bytes.length, sha256: sha256(bytes), encrypted: true, algorithm: encrypted.algorithm,
        iv: encrypted.iv.toString("base64"), authTag: encrypted.authTag.toString("base64"),
        textContent: [row.question, `研究修订 ${row.version} · ${row.checkedAt ? "研究已核对" : "研究待核对"}`,
          ...sections.map(section => `${section.title}\n${section.text}`)].join("\n\n"), textSource: "MANUAL", ocrStatus: "READY",
        tags: ["研究分析稿"], uploadedById: actor.id, generationRequestKey: parsed.requestKey, generationRequestHash: requestHash,
      }, select: { id: true } });
      await tx.documentResearchSource.create({ data: { documentId: document.id, researchRevisionId: row.id } });
      await auditTx(tx, { userId: actor.id, action: "RESEARCH_DRAFT_CREATE", targetType: "Document", targetId: document.id,
        detail: { matterId: parsed.matterId, researchRevisionId: row.id, researchVersion: row.version } });
      return { documentId: document.id, fileName, replayed: false };
    });
  } catch (error) {
    if (ownedPath) {
      // A lost commit response is not proof of rollback: keep any published original.
      let committed;
      try { committed = await db.document.findUnique({ where: { generationRequestKey: parsed.requestKey }, select: { id: true } }); }
      catch { throw new ActionError("稿件生成结果尚未确认，请保留本次操作并重试查询"); }
      if (!committed) await storage.deleteFile(ownedPath);
    }
    throw error;
  }
}
