/**
 * B1 私有来件暂存文件转正（内部模块，非 "use server"）。
 *
 * 2026-09-20 第五轮审计 P1-1 修复：本函数原从 "use server" 的 actions.ts 导出，
 * 作为可寻址 server action 端点可被直调（无 requireSession、userId 由调用方传入、
 * 不校验来件归属），任何经办用户可把他人私有来件文件转正到自己案件。移入内部
 * 模块后不再是 RPC 端点，并补归属校验（收件人本人，或转正目标即该来件匹配的案件）。
 */
import { Prisma, type SmsType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockSms, smsActor } from "./suggestion-service";
import { auditTx } from "@/server/audit";
import { suggestionPayload } from "@/lib/sms/suggestions";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { recordTimelineEvent } from "@/server/timeline/record";
import { ActionError, actionErrorMessage } from "@/lib/action-error";
import { checkRoleMutation } from "@/lib/roles/service";

/**
 * B1：把一条来件私有暂存区（PENDING_REVIEW、无 documentId）的文件转正为正式案件材料。
 * 读暂存盘明文 → 按部署加密策略落案件卷宗 → 建 Document（沿用短信附件分类）→ 回填映射。
 * 磁盘暂存文件不删除（历史可溯）；单文件失败不阻断其余文件。
 *
 * 归属校验（P1-1）：转正目标必须是该来件当前匹配的案件（收件人本人或本案经办/
 * 合伙人操作，案件写权由事务内 lockSms 承担）——防止把他人私有暂存文件
 * 写入无关案件（读取他人私区内容）。
 */
export async function fileSmsInboundFilesToMatter({ smsId, matterId, userId }: { smsId: string; matterId: string; userId: string }): Promise<number> {
  const actor = await smsActor();
  if (actor.id !== userId) throw new ActionError("转正操作人与会话不一致");
  const sms = await prisma.$transaction(async tx => {
    const current = await lockSms(tx, actor, smsId);
    if (current.matchedMatterId !== matterId) throw new ActionError("转正目标须为来件当前匹配的案件");
    return current;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const pending = await prisma.smsInboundFile.findMany({
    where: { smsId, documentId: null, state: "PENDING_REVIEW" }, orderBy: { id: "asc" },
  });
  let filed = 0;
  const failures: string[] = [];
  for (const file of pending) {
    let preparedPath: string | null = null;
    let documentAttempted = false;
    try {
      const buffer = await storage.readFile(file.storageKey);
      if (sha256(buffer) !== file.sha256) throw new ActionError("暂存原件已变化，请重新核对文件");
      const prepared = await prepareSmsInboundDocument({ matterId, userId, buffer, digest: file.sha256,
        filename: file.displayName ?? file.originalName, mimeType: file.mimeType, smsType: sms.smsType });
      preparedPath = prepared.path;
      const saved = await prisma.$transaction(async tx => {
        const currentSms = await lockSms(tx, actor, smsId);
        await checkRoleMutation(tx, actor, "documents.write");
        if (currentSms.matchedMatterId !== matterId) throw new ActionError("来件归属已变化，请重新核对");
        await tx.$queryRaw`SELECT id FROM "SmsInboundFile" WHERE id=${file.id} FOR UPDATE`;
        const current = await tx.smsInboundFile.findUniqueOrThrow({ where: { id: file.id } });
        if (current.documentId) return false;
        if (current.smsId !== smsId || current.state !== "PENDING_REVIEW" || current.storageKey !== file.storageKey || current.sha256 !== file.sha256 || current.updatedAt.getTime() !== file.updatedAt.getTime()) throw new ActionError("文件已被修改，请刷新后继续入卷");
        documentAttempted = true;
        const doc = await tx.document.create({ data: prepared, select: { id: true } });
        await tx.smsInboundFile.update({ where: { id: file.id }, data: { matterId, documentId: doc.id, state: "FILED" } });
        await recordTimelineEvent(tx, { matterId, eventType: "DOCUMENT_UPLOADED", title: `来件文件入卷：${prepared.name}`, occurredAt: new Date(), refType: "Document", refId: doc.id });
        await auditTx(tx, { userId, action: "SMS_FILE_FILED", targetType: "SmsInboundFile", targetId: file.id, detail: { smsId, matterId, documentId: doc.id } });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      if (saved) filed++;
      else try { await storage.deleteFile(preparedPath); } catch { /* An unused copy cannot turn another request's completed filing into a failure. */ }
    } catch (error) {
      // The decision is already saved. Keep this exact file pending, while other files continue.
      const missing = error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
      const reason = missing ? "暂存原件不存在，请人工补传" : error instanceof ActionError ? actionErrorMessage(error) : "入卷未完成，请核对原件后重试";
      failures.push(`${file.displayName ?? file.originalName}：${reason}`);
      // Before any INSERT was attempted this new path is certainly unreferenced. If the
      // commit result is uncertain, retain it instead of risking deletion of a committed original.
      if (preparedPath && !documentAttempted) try { await storage.deleteFile(preparedPath); } catch { /* Retain the private copy when cleanup is unavailable. */ }
    }
  }
  if (pending.length) await prisma.$transaction(async tx => {
    const current = await lockSms(tx, actor, smsId);
    if (current.matchedMatterId !== matterId) throw new ActionError("来件归属已变化，请核对已入卷文件");
    const remaining = await tx.smsInboundFile.count({ where: { smsId, OR: [{ state: { in: ["PENDING_REVIEW", "FAILED"] } }, { state: "FILED", documentId: null }] } });
    const results = suggestionPayload(current.parsedJson).attachmentResults;
    const fetchIncomplete = current.needsManualAction || ["PROCESSING", "NEEDS_MANUAL_FETCH"].includes(current.processingState)
      || (Array.isArray(results) && results.some(result => !["DOWNLOADED", "ALREADY_DOWNLOADED"].includes(String(suggestionPayload(result).status))));
    await tx.smsMessage.update({ where: { id: smsId }, data: {
      ...(!current.processed && current.processingState !== "NO_ACTION_NEEDED" ? { processingState: fetchIncomplete ? current.processingState : remaining ? "PARTIAL" : "READY_FOR_REVIEW" } : {}),
      processingNote: remaining ? [`本次入卷 ${filed} 个，仍有 ${remaining} 个文件待继续处理`, ...failures].join("；") : null,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return filed;
}

/** B1：暂存文件转正时按部署加密策略落案件卷宗并建正式材料（分类沿用短信附件规则） */
async function prepareSmsInboundDocument(input: {
  matterId: string;
  userId: string;
  buffer: Buffer;
  digest: string;
  filename: string;
  mimeType: string;
  smsType: SmsType;
}): Promise<Prisma.DocumentUncheckedCreateInput> {

  const category = input.smsType === "JUDGMENT_NOTICE" || /判决|裁定|裁判|调解书/.test(input.filename) ? "JUDGMENT"
    : input.smsType === "EVIDENCE_SUBMIT" || /证据|材料|举证/.test(input.filename) ? "EVIDENCE"
    : /起诉|答辩|上诉|申请书|反诉|代理词|意见/.test(input.filename) ? "PLEADING"
    : ["SERVICE_NOTICE", "FILING_NOTICE", "FEE_NOTICE"].includes(input.smsType) ? "PROCEDURE"
    : "OTHER";
  const encrypted = Boolean(process.env.STORAGE_ENCRYPTION_KEY);
  let stored = input.buffer, iv: string | null = null, authTag: string | null = null, algorithm: string | null = null;
  if (encrypted) {
    const enc = encryptBuffer(input.buffer);
    stored = enc.ciphertext; iv = enc.iv.toString("base64"); authTag = enc.authTag.toString("base64"); algorithm = enc.algorithm;
  }
  const path = await storage.writeFile(`m_${input.matterId}`, stored);
  return {
    matterId: input.matterId, name: input.filename, category, path,
    mimeType: input.mimeType, size: input.buffer.length, sha256: input.digest,
    encrypted, algorithm, iv, authTag, tags: ["法院短信", "电子送达", "来件转正"], uploadedById: input.userId,
  };
}
