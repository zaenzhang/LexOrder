/**
 * B2 来件阅读与建议（docs/SYSTEM-AUDIT-REMEDIATION-V3-20260920.md §5）：
 * 文件类型核验 → 文本层提取 → 无文本层时 OCR → AI 结构化分析 → 与档案比对 → 形成建议。
 *
 * 处理顺序与降级（v3 §5.1/验收 9）：AI/OCR 未配置时保存、取件与人工确认照常，
 * 文件标 NEEDS_OCR/FAILED 可见，不显示为分析成功；AI 只产出建议，不直接写案件。
 * 建议「拒绝过的重跑不重复弹回，除非来源变化」——按 (fileId, kind, fieldKey, suggestedValue)
 * 去重并保留 REJECTED 历史。
 */
import { prisma } from "@/lib/prisma";
import { matterAssociationFilter } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { aiChat, AiNotConfiguredError } from "@/lib/ai/client";
import { extractDocumentTextLayer, NoTextLayerError, UnsupportedTextExtraction } from "@/lib/documents/text-extraction";
import { recognizeText, OcrNotConfiguredError } from "@/server/ocr/provider";
import { Prisma, type SmsSuggestionKind } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { auditTx } from "@/server/audit";

const MAX_ANALYSIS_TEXT_CHARS = 12_000;

interface AnalyzedDoc {
  docType: string;
  suggestedName: string | null;
  fields: { key: string; value: string; page?: number; excerpt?: string }[];
  events: { kind: "HEARING" | "DEADLINE"; title: string; dateText: string; timeText?: string; note?: string; page?: number; excerpt?: string }[];
  caseNumbers: string[];
  court: string | null;
}

/** 文本 → AI 结构化分析（纯函数化出口便于测试；AI 未配置抛 AiNotConfiguredError） */
export async function analyzeDocumentText(text: string, hint?: string, userId?: string): Promise<AnalyzedDoc> {
  const clipped = text.slice(0, MAX_ANALYSIS_TEXT_CHARS);
  const result = await aiChat({
    messages: [
      {
        role: "system",
        content:
          "你是法院文书结构化助手。只输出一个 JSON 对象，不要输出任何其他文字。字段：docType（文书类型，如 受理通知书/传票/举证通知书/缴费通知书/判决书/裁定书/送达回证/其他）、suggestedName（规范文件名或 null）、fields（数组，每项 {key,value,page,excerpt}，key 限 caseNumber/courtName/acceptedAt/judgeName/clerkPhone/courtRoom）、events（数组，每项 {kind:HEADING|DEADLINE 修正为 HEARING|DEADLINE,title,dateText,timeText,note,page,excerpt}，page 为来源页码（可确定时）；excerpt 须逐字引用该页原文。候选仅来自文书的明确安排）、caseNumbers（文书中出现的全部案号）、court（法院名称或 null）。dateText 用 YYYY-MM-DD；timeText 用 24 小时制 HH:MM（如 09:30、14:00），无法确定具体时刻则省略该字段，不要输出「9时」「14:30:00」等其他形态。无把握的值不要编造，省略该字段。kind 只能是 HEARING 或 DEADLINE。"
      },
      { role: "user", content: `文书文本（\\f 分页，页码按出现顺序递增）：\n${clipped}${hint ? `\n\n上下文提示：${hint}` : ""}` }
    ],
    logAction: "sms-doc-analysis",
    // 第八轮体检：外发台账记发起人。后台链路无 session，取来件的收件人
    // （粘贴该短信进系统的律师）作为发起人，口径与取件/确认一致。
    userId
  });
  const json = extractJson(result.content);
  const analyzed = normalizeAnalyzed(json);
  const pages = clipped.split("\f");
  for (const event of analyzed.events) {
    const pageText = event.page ? pages[event.page - 1] : undefined;
    if (!pageText || !event.excerpt || !pageText.includes(event.excerpt)) {
      delete event.page;
      delete event.excerpt;
    }
  }
  return analyzed;
}

function extractJson(content: string): Record<string, unknown> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ActionError("AI 输出不含 JSON");
  try {
    return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ActionError("AI 输出 JSON 解析失败");
  }
}

/**
 * AI 输出上限（第八轮体检·提示词注入面）。
 *
 * 文书正文是不可信输入：伪造短信或在扫描件里嵌指令，都能让模型按攻击者的意图
 * 输出。字段写入面已由双重白名单关闭（生成侧只认 caseNumber/courtName，应用侧
 * 再校验 ["caseNumber","handlingAgency"]），但数量与长度此前无约束——一份文书
 * 可产出任意多条建议淹没确认界面，超长字符串原样进库。这里补上限。
 */
const MAX_FIELDS = 30;
const MAX_EVENTS = 20;
const MAX_CASE_NUMBERS = 20;
const MAX_TEXT_LEN = 200;
const MAX_NOTE_LEN = 500;

function normalizeAnalyzed(raw: Record<string, unknown>): AnalyzedDoc {
  const str = (v: unknown, max = MAX_TEXT_LEN) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const fields = Array.isArray(raw.fields)
    ? (raw.fields as Record<string, unknown>[]).map(f => ({
        key: str(f.key) ?? "",
        value: str(f.value) ?? "",
        page: typeof f.page === "number" ? f.page : undefined,
        excerpt: str(f.excerpt) ?? undefined
      })).filter(f => f.key && f.value).slice(0, MAX_FIELDS)
    : [];
  const events = Array.isArray(raw.events)
    ? (raw.events as Record<string, unknown>[]).map(e => ({
        kind: e.kind === "HEARING" ? "HEARING" as const : "DEADLINE" as const,
        title: str(e.title) ?? "法院文书事项",
        dateText: str(e.dateText) ?? "",
        timeText: str(e.timeText) ?? undefined,
        note: str(e.note, MAX_NOTE_LEN) ?? undefined,
        page: typeof e.page === "number" && Number.isSafeInteger(e.page) && e.page > 0 ? e.page : undefined,
        excerpt: str(e.excerpt, MAX_NOTE_LEN) ?? undefined
      })).filter(e => e.dateText).slice(0, MAX_EVENTS)
    : [];
  return {
    docType: str(raw.docType) ?? "其他",
    suggestedName: str(raw.suggestedName),
    fields,
    events,
    caseNumbers: Array.isArray(raw.caseNumbers) ? (raw.caseNumbers as unknown[]).map(v => str(v)).filter((v): v is string => Boolean(v)).slice(0, MAX_CASE_NUMBERS) : [],
    court: str(raw.court)
  };
}

/**
 * 分析一个来件文件并落建议（幂等入口：每个文件可重复分析，建议按内容去重）。
 * 返回分析状态；不抛中断性错误——全部失败形态落 analysisState。
 */
export async function analyzeInboundFile(fileId: string, initiatedById?: string): Promise<{ state: string; suggestionCount: number }> {
  const file = await prisma.smsInboundFile.findUnique({
    where: { id: fileId },
    include: { document: true, sms: { select: { id: true, matchedMatterId: true, smsType: true, parsedJson: true, receivedById: true } } }
  });
  if (!file) throw new ActionError("来件文件不存在");

  await prisma.smsInboundFile.update({ where: { id: fileId }, data: { analysisState: "ANALYZING", analysisError: null } });
  try {
    const doc = file.document;
    if (doc?.deletedAt || !(doc?.path || file.storageKey)) throw new ActionError("来源文件不可读取");
    const stored = await storage.readFile(doc?.path ?? file.storageKey);
    const buffer = doc?.encrypted ? decryptBuffer(stored, doc.iv!, doc.authTag!) : stored;
    let text: string;
    let pageCount: number | null = null;
    try {
      const extracted = await extractDocumentTextLayer(buffer, file.mimeType);
      text = extracted.text;
      pageCount = extracted.pageCount;
    } catch (err) {
      if (err instanceof NoTextLayerError) {
        const ocr = await recognizeText({ data: buffer, mimeType: file.mimeType, hint: file.displayName ?? file.originalName, userId: file.sms.receivedById });
        text = ocr.text;
      } else if (err instanceof UnsupportedTextExtraction) {
        // 图片等非文档类型直接走 OCR
        const ocr = await recognizeText({ data: buffer, mimeType: file.mimeType, hint: file.displayName ?? file.originalName, userId: file.sms.receivedById });
        text = ocr.text;
      } else {
        throw err;
      }
    }
    if (!text.trim()) throw new ActionError("未取得可分析文本");

    const analyzed = await analyzeDocumentText(text, `来源：法院短信来件（${file.sms.smsType}）`, file.sms.receivedById);
    const pageCountFinal = pageCount ?? countPages(text);

    await prisma.smsInboundFile.update({
      where: { id: fileId },
      data: { analysisState: "ANALYZED", analyzedAt: new Date(), docType: analyzed.docType, displayName: file.displayName ?? analyzed.suggestedName ?? undefined, extractedPages: pageCountFinal }
    });

    // 分类已保存在文件上；这里只产生需要人工决定的业务建议。
    const created = await persistSuggestions(file.smsId, fileId, analyzed, file.downloadedById, initiatedById);
    return { state: "ANALYZED", suggestionCount: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败";
    // AI 未配置 / OCR 未配置同属能力不可用：降级 NEEDS_OCR 可见，不算失败
    const state = err instanceof OcrNotConfiguredError || err instanceof AiNotConfiguredError ? "NEEDS_OCR" : "FAILED";
    await prisma.smsInboundFile.update({ where: { id: fileId }, data: { analysisState: state, analysisError: message } });
    return { state, suggestionCount: 0 };
  }
}

function countPages(text: string): number {
  return text.split("\f").filter(p => p.trim()).length || 1;
}

async function persistSuggestions(
  smsId: string,
  fileId: string,
  analyzed: AnalyzedDoc,
  createdById: string,
  initiatedById?: string,
): Promise<number> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SmsMessage" WHERE id=${smsId} FOR UPDATE`;
    const sms = await tx.smsMessage.findUnique({ where: { id: smsId }, select: { matchedMatterId: true, processingState: true, processed: true } });
    if (!sms) throw new ActionError("来件不存在");
    const matchedMatterId = sms.matchedMatterId;
    const rows: {
      smsId: string; fileId: string; kind: SmsSuggestionKind; targetType?: string; targetId?: string;
      fieldKey?: string; currentValue?: string; suggestedValue?: string; sourcePage?: number; sourceExcerpt?: string;
      payload?: object;
    }[] = [];

    const actor = await tx.user.findUnique({ where: { id: createdById }, select: { role: true, active: true } });
    if (!actor?.active) throw new ActionError("建议创建人当前不可用");
    const matchingProcedures = analyzed.caseNumbers.length ? await tx.matterProcedure.findMany({
      where: { caseNumber: { in: analyzed.caseNumbers }, ...(matchedMatterId ? { matterId: matchedMatterId } : {}),
        matter: { deletedAt: null, ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(createdById)) } },
      select: { id: true, matterId: true, caseNumber: true, handlingAgency: true, engagement: true, matter: { select: { internalCode: true, title: true } } },
    }) : [];
    const matchedMatters = [...new Set(matchingProcedures.map(procedure => procedure.matterId))];
    if (!matchedMatterId && matchedMatters.length === 1) {
      const match = matchingProcedures[0];
      rows.push({ smsId, fileId, kind: "MATTER_MATCH", targetType: "Matter", targetId: match.matterId,
        suggestedValue: `${match.matter.internalCode} · ${match.matter.title}`, sourceExcerpt: analyzed.caseNumbers.join("、"), payload: { caseNumbers: analyzed.caseNumbers } });
    }
    // Only a unique exact case-number match is a proposed procedure. Never select by list order.
    const target = matchingProcedures.length === 1 ? matchingProcedures[0] : undefined;
    if (matchedMatterId) {
      if (target) {
        for (const f of analyzed.fields) {
          if (f.key === "caseNumber") {
            if (f.value && (!target.caseNumber || target.caseNumber !== f.value)) {
              rows.push({ smsId, fileId, kind: "FIELD_CHANGE", targetType: "MatterProcedure", targetId: target.id, fieldKey: "caseNumber", currentValue: target.caseNumber ?? "", suggestedValue: f.value, sourcePage: f.page, sourceExcerpt: f.excerpt });
            }
          } else if (f.key === "courtName") {
            if (f.value && (!target.handlingAgency || !target.handlingAgency.includes(f.value))) {
              rows.push({ smsId, fileId, kind: "FIELD_CHANGE", targetType: "MatterProcedure", targetId: target.id, fieldKey: "handlingAgency", currentValue: target.handlingAgency ?? "", suggestedValue: f.value, sourcePage: f.page, sourceExcerpt: f.excerpt });
            }
          }
        }
      }
    }

    // 事项建议：开庭/期限（确认后建立；缴费通知建待办不自动记支付——v3 §5.3）
    for (const e of analyzed.events) {
      rows.push({
        smsId, fileId, kind: e.kind === "HEARING" ? "HEARING" : "DEADLINE",
        suggestedValue: `${e.title} ${e.dateText}${e.timeText ? ` ${e.timeText}` : ""}`,
        sourcePage: e.page,
        sourceExcerpt: e.excerpt,
        payload: { title: e.title, dateText: e.dateText, timeText: e.timeText, note: e.note, caseNumbers: analyzed.caseNumbers, ...(target?.engagement === "ENGAGED" ? { procedureId: target.id } : {}) }
      });
    }

    // 去重：REJECTED 的建议不重复弹回，除非建议值变化（v3 §5.2）
    let created = 0;
    for (const row of rows) {
      const dup = await tx.smsSuggestion.findFirst({
        where: { smsId, fileId, kind: row.kind, fieldKey: row.fieldKey ?? null, suggestedValue: row.suggestedValue ?? "" },
        select: { id: true, status: true }
      });
      if (dup) continue;
      await tx.smsSuggestion.create({
        data: {
          smsId: row.smsId, fileId: row.fileId, kind: row.kind,
          targetType: row.targetType ?? null, targetId: row.targetId ?? null,
          fieldKey: row.fieldKey ?? null, currentValue: row.currentValue ?? null,
          suggestedValue: row.suggestedValue ?? null,
          sourcePage: row.sourcePage ?? null, sourceExcerpt: row.sourceExcerpt ?? null,
          payload: (row.payload ?? {}) as object, createdById
        }
      });
      created++;
    }
    if (created > 0 && sms.processingState === "ORGANIZED" && !sms.processed) {
      await tx.smsMessage.update({ where: { id: smsId }, data: { processingState: "READY_FOR_REVIEW" } });
      await auditTx(tx, { userId: initiatedById ?? null, action: "SMS_ANALYSIS_ADDED_PENDING_SUGGESTIONS", targetType: "SmsMessage", targetId: smsId,
        detail: { fileId, created, sourceDownloadedById: createdById, source: initiatedById ? "MANUAL_ANALYSIS" : "BACKGROUND_ANALYSIS" } });
    }
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
