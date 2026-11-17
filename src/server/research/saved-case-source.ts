import type { Prisma, PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { getSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { contextAccess, type ContextActor } from "@/server/matters/context-service";
import { prepareSource } from "@/server/evidence/source-links";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";
import { emptyLawMetadata, researchQuerySchema, researchSourceInputSchema, type SavedCaseResearchInput } from "./contracts";

const saveActions = ["YUANDIAN_CASE_SAVE", "YUANDIAN_CASE_SAVE_VECTOR"];

/** Tags and names are editable. Only an exact save audit identifies this entry point. */
export async function savedCaseDocumentIds(db: Prisma.TransactionClient, matterId: string, documents: EvidenceDocumentOption[]) {
  const eligible = documents.filter(document => document.hasIdentity);
  if (!eligible.length) return [];
  const rows = await db.auditLog.findMany({ where: { action: { in: saveActions }, targetType: "Matter", targetId: matterId },
    select: { detail: true } });
  const saved = new Set(rows.flatMap(row => row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
    && typeof row.detail.documentId === "string" ? [row.detail.documentId] : []));
  return eligible.filter(document => saved.has(document.id)).map(document => document.id);
}

function known(value: string) {
  const trimmed = value.trim();
  return /^(?:未知|—|undefined|null|（无[^）]*）)$/.test(trimmed) ? "" : trimmed;
}

/** Parse only the two fixed headers produced by save-case.ts; never search the body for identity. */
export function parseSavedCaseResearchInput(markdown: string, documentId: string, action: string, savedAt: Date): SavedCaseResearchInput {
  const vector = action === "YUANDIAN_CASE_SAVE_VECTOR";
  const prefix = vector ? "# 类案存档（语义检索）：" : "# 类案存档：";
  const fields = ["案号", "法院", "裁判日期", "案由", "案件类别", "地区", "文书种类",
    ...(vector ? ["相似度评分"] : []), "元典链接", "保存时间"];
  const lines = markdown.split("\n");
  const invalid = () => new ActionError("此材料的保存头部不完整或有歧义，不能自动填入；可返回研究手工选材并核对元信息");
  if (!saveActions.includes(action) || !lines[0]?.startsWith(prefix) || lines[1] !== ""
    || lines[fields.length + 2] !== "" || lines[fields.length + 3] !== "---" || lines[fields.length + 4] !== "") throw invalid();
  const header = lines.slice(0, fields.length + 2);
  if (header.some(line => /[\r\u0000-\u001f\u007f\u2028\u2029]/.test(line))) throw invalid();
  const metadata = new Map<string, string>();
  fields.forEach((field, index) => {
    const marker = `- **${field}**：`, line = lines[index + 2];
    if (!line?.startsWith(marker)) throw invalid();
    metadata.set(field, known(line.slice(marker.length)));
  });
  const title = known(lines[0].slice(prefix.length));
  const body = lines.slice(fields.length + 5).join("\n").trim();
  const fragment = Boolean(body && body !== "（无内容片段）");
  const link = metadata.get("元典链接")!;
  const query = researchQuerySchema.safeParse({
    sourceDocumentId: documentId,
    query: `已保存类案${fragment ? "片段" : "材料"}${title ? `：${title}` : ""}（原查询未记录）`,
    location: link, access: fragment ? "SUMMARY" : link ? "LINK" : "NONE", outcome: fragment ? "UNREAD" : "NOT_OBTAINED",
    notes: [
      "元典保存入口；材料所载元信息，待核实。",
      fragment ? "已保存返回片段；本保存记录不能证明已取得裁判全文，本次采用不表示已阅读。" : "材料中没有内容片段；本保存记录不能证明已取得裁判全文。",
      "原检索查询及检索时间未记录，取得日期与使用范围待核实。",
      ...(metadata.get("裁判日期") ? [`材料所载裁判日期：${metadata.get("裁判日期")}（不是效力期间）。`] : []),
      ...(metadata.get("保存时间") ? [`材料所载保存时间：${metadata.get("保存时间")}（上海时间）。`] : []),
      `保存审计时间：${savedAt.toISOString()}（不是检索或取得时间）。`,
    ].join("\n"),
  });
  const source = researchSourceInputSchema.safeParse({ documentId, page: null, relation: "CONTEXT", lawMetadata: {
    ...emptyLawMetadata(), kind: "CASE", title, authority: metadata.get("法院")!, number: metadata.get("案号")!,
    acquiredVia: `元典保存入口（${vector ? "语义检索保存" : "关键词检索保存"}；材料所载元信息，待核实）`,
  } });
  if (!source.success || !query.success) {
    throw new ActionError("材料所载元信息超出研究字段限额或格式无效，未自动截断；请返回研究手工选材并核对填写");
  }
  return { source: source.data, query: query.data };
}

export async function readSavedCaseResearchInput(db: PrismaClient, actor: ContextActor, matterId: string, documentId: string): Promise<SavedCaseResearchInput> {
  const input = { documentId, page: null, relation: "CONTEXT" as const };
  const initial = await db.$transaction(async tx => {
    await contextAccess(tx, actor, matterId, true);
    const source = await prepareSource(actor.id, matterId, input, tx);
    const audit = await tx.auditLog.findFirst({ where: { action: { in: saveActions }, targetType: "Matter", targetId: matterId,
      detail: { path: ["documentId"], equals: documentId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, action: true, createdAt: true } });
    if (!audit) throw new ActionError("该材料没有可核对的类案保存记录，请返回研究手工选材");
    const document = await tx.document.findUniqueOrThrow({ where: { id: documentId },
      select: { path: true, mimeType: true, size: true, encrypted: true, iv: true, authTag: true } });
    if (document.mimeType !== "text/markdown") throw new ActionError("该材料不是现有类案保存格式，请手工选材核对");
    return { source, document, audit };
  }, { timeout: 20000 });

  // No transaction or authorization lock is held across storage I/O. Reuse the recorded SHA.
  const { storage } = await import("@/lib/storage");
  const { decryptBuffer } = await import("@/lib/storage/crypto");
  let markdown: string;
  try {
    const stored = await storage.readFile(initial.document.path);
    if (initial.document.encrypted && (!initial.document.iv || !initial.document.authTag)) throw new Error("MISSING_ENCRYPTION_METADATA");
    const bytes = initial.document.encrypted ? decryptBuffer(stored, initial.document.iv!, initial.document.authTag!) : stored;
    if (initial.document.size !== null && bytes.length !== initial.document.size) throw new Error("SIZE_MISMATCH");
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ActionError("无法读取已保存类案材料，请稍后重试或检查原件");
  }

  // Same ordering as document read-release: baseline BEFORE validating the real request session.
  // Keep both outside the transaction so a one-connection pool can release the read.
  const baseline = await db.user.findUnique({ where: { id: actor.id }, select: { sessionVersion: true } });
  const session = await getSession();
  if (!baseline || !session?.user || session.user.id !== actor.id) throw new ActionError("登录状态已变化，请重新登录后打开材料");
  return db.$transaction(async tx => {
    await contextAccess(tx, session.user, matterId, true);
    const identity = await tx.user.findUnique({ where: { id: actor.id }, select: { sessionVersion: true } });
    if (identity?.sessionVersion !== baseline.sessionVersion) throw new ActionError("登录状态已变化，请重新登录后打开材料");
    const current = await prepareSource(actor.id, matterId, input, tx);
    if (current.documentSha256 !== initial.source.documentSha256) throw new ActionError("材料原件标识已变化，请重新选择");
    const result = parseSavedCaseResearchInput(markdown, documentId, initial.audit.action, initial.audit.createdAt);
    await auditTx(tx, { userId: actor.id, action: "RESEARCH_SAVED_CASE_READ", targetType: "Document", targetId: documentId,
      detail: { matterId, saveAuditId: initial.audit.id, documentSha256: current.documentSha256 } });
    return result;
  }, { timeout: 20000 });
}
