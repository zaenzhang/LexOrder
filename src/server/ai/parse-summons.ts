"use server";

/**
 * v0.44: 法院传票 OCR
 *
 * 律师上传传票图片/PDF → 本地提取优先，失败时使用已配置视觉模型
 * 失败时返回 null 字段，让律师手动填写
 */
import { requireSession } from "@/lib/auth/session";
import { aiVision, extractJson, AiNotConfiguredError } from "@/lib/ai/client";
import { ActionError } from "@/lib/action-error";
import { parseSummonsWithLocalOcr, summonsVisionImage, normalizeSummonsFields } from "./parse-summons-local";

export type ParsedSummons = {
  source?: "local_text" | "local_ocr" | "ai";
  pageLimit?: number;
  hearingDate: string | null;   // YYYY-MM-DD
  hearingTime: string | null;   // HH:mm
  courtRoom: string | null;     // 法庭（如：第三法庭）
  caseNumber: string | null;    // 案号（如：(2024)京0105民初1234号）
  judge: string | null;         // 法官姓名
  parties: string[] | null;     // 当事人列表
};

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

const PROMPT = `下方图片是一张中国法院传票（开庭传票）。请严格返回 JSON：
{
  "hearingDate": "开庭日期（YYYY-MM-DD）",
  "hearingTime": "开庭时间（HH:mm，24小时制）",
  "courtRoom": "开庭地点/法庭（如：本院第三法庭）",
  "caseNumber": "案号（如：(2024)京0105民初1234号）",
  "judge": "审判员/法官姓名",
  "parties": ["原告/上诉人名称", "被告/被上诉人名称"]
}
规则：
- 严格按照传票上的内容提取，不确定的字段返回 null
- hearingDate 格式必须为 YYYY-MM-DD，如原始日期为"二〇二四年六月十五日"则转为 2024-06-15
- hearingTime 格式为 HH:mm，如"上午九时三十分"转为 09:30
- parties 为数组，包含传票上列明的当事人
- 仅 JSON，不要解释`;

export async function parseSummons(form: FormData): Promise<ParsedSummons> {
  const session = await requireSession("documents.write");
  const file = form.get("file");
  if (!(file instanceof File)) throw new ActionError("缺少文件");
  if (!SUPPORTED.has(file.type)) {
    throw new ActionError(`仅支持图片（JPG/PNG/WebP/HEIC）或 PDF 格式，当前 ${file.type || "未知"}`);
  }
  if (file.size > 10 * 1024 * 1024) throw new ActionError("文件超过 10MB");

  // 本地解析不外发文件；仅本地不可用或无法提取时回退到已配置的视觉模型。
  try {
    return await parseSummonsWithLocalOcr(file);
  } catch {
    // 缺少可选 OCR 依赖或图片无可识别文字时继续既有 AI 通道。
  }
  try {
    const dataUrl = await summonsVisionImage(file);
    const { content } = await aiVision({
      userId: session.user.id,
      logAction: "parse-summons",
      image: { dataUrl }, prompt: PROMPT, maxTokens: 500
    });
    const result = normalizeSummonsFields(extractJson<ParsedSummons>(content));
    if (!result.hearingDate && !result.caseNumber && !result.courtRoom) {
      throw new ActionError("未识别到可靠的传票字段，请手动填写");
    }
    return { ...result, source: "ai", ...(file.type === "application/pdf" ? { pageLimit: 1 } : {}) };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      throw new ActionError("本地未能识别传票，且未配置视觉模型。可安装本地 OCR 及中文语言包，或手动填写");
    }
    throw new ActionError("传票识别未完成，请检查本地 OCR 或视觉模型配置，也可手动填写；PDF 仅处理首页");
  }
}
