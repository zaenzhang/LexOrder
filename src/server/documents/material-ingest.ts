import { draftExtension } from "@/lib/desktop/working-format";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DocumentCategory, DocumentSourceOrigin, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer, restoreEncryptedOriginal, sha256 } from "@/lib/storage/crypto";
import { ActionError } from "@/lib/action-error";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission, scopeFor } from "@/lib/roles/catalog";
import { matterAssociationFilter } from "@/lib/permissions";
import { hasPersonalCapability } from "@/lib/runtime/capabilities";
import { isArchiveFolderName } from "@/lib/archive/guard";
import { approvalTransaction } from "@/lib/approvals/service";
import { archiveSnapshotDocumentIds } from "@/lib/archive/snapshot";
import { assertIntakeDocumentChange, intakeWorkflowReady } from "@/server/intakes/workflow";
import { auditTx } from "@/server/audit";
import { recordTimelineEvent } from "@/server/timeline/record";
import { assertCurrentJobLease, type JobLease } from "@/server/cron/queue";
import { enqueueMaterialProcessing, cancelMaterialProcessing } from "./material-processing";
import { assertDocumentDerivationAccess } from "./derivation-access";
import { contextInputSelectionsSchema, type ContextInputSelection } from "@/lib/matters/context-inputs";
import { assertContextInputSelections } from "@/server/matters/context-inputs";
import { paragraphCitationSchema, type ParagraphCitation } from "@/server/research/contracts";
import { readCitationConclusion } from "@/server/research/service";

const nullableId = z.string().min(1).nullable().default(null);
const documentInput = z.object({
  matterId: nullableId, intakeId: nullableId, procedureId: nullableId,
  stageId: nullableId, folderId: nullableId,
  name: z.string().trim().min(1).max(300), category: z.enum(DocumentCategory),
  sourceParty: z.string().max(500).nullable().default(null),
  sourceOrigin: z.enum(DocumentSourceOrigin).nullable().default(null),
  mimeType: z.string().min(1), size: z.number().int().min(0).max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), encrypted: z.boolean(),
  algorithm: z.string().nullable().default(null), iv: z.string().nullable().default(null),
  authTag: z.string().nullable().default(null), tags: z.array(z.string().max(100)).max(50).default([]),
  archiveChecklistItemId: nullableId, uploadedById: z.string().min(1)
});
export type MaterialDocumentInput = z.input<typeof documentInput>;
const metadataSchema = z.object({ document: documentInput, priorDocumentId: nullableId,
  contextInputs: contextInputSelectionsSchema.optional().default([]),
  paragraphCitation: paragraphCitationSchema.optional(),
  checkout: z.object({ jti: z.string(), baselineVersion: z.number().int(), draftOnly: z.boolean().optional() }).nullable().default(null) });

/** Only explicit validation before this invocation creates an intent may carry this marker. */
export class UploadRejectedBeforeReservation extends ActionError {}

function rejectBeforeReservation(error: unknown): never {
  if (error instanceof ActionError) throw new UploadRejectedBeforeReservation(error.message);
  if (error instanceof z.ZodError) throw new UploadRejectedBeforeReservation(error.issues.slice(0, 2).map(issue => issue.message).join("；"));
  throw error;
}

function sameUpload(left: z.output<typeof metadataSchema>, right: z.output<typeof metadataSchema>) {
  // A browser retry encrypts the same original with a fresh IV. Business identity,
  // including the encryption policy, must still be exactly the reserved request.
  const comparable = (value: z.output<typeof metadataSchema>) => ({ ...value,
    document: { ...value.document, iv: null, authTag: null } });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/** Recheck current role, ownership, archive and parent relations in the commit transaction. */
async function assertUploadAuthority(tx: Prisma.TransactionClient, userId: string,
  data: z.output<typeof documentInput>, priorId: string | null, newReservation = false) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("当前账号不可用");
  const actor = await resolveRoleUser(userId, user.role, tx);
  if (!actor.enabled || !hasCustomPermission(actor, "documents.write") || data.uploadedById !== userId) {
    throw new ActionError("当前无权上传材料");
  }
  if (newReservation && !priorId && data.stageId && !data.procedureId) throw new ActionError("关联环节时必须指定所属程序");
  if (data.matterId) {
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.matterId} FOR UPDATE`;
    const matter = await tx.matter.findFirst({ where: { id: data.matterId, deletedAt: null,
      ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(userId)) },
      select: { id: true, status: true, intakeId: true } });
    if (!matter) throw new ActionError("案件不存在或无权处理");
    if (data.intakeId && matter.intakeId !== data.intakeId) throw new ActionError("收案与案件不匹配");
    const folder = data.folderId ? await tx.documentFolder.findUnique({ where: { id: data.folderId }, select: { matterId: true, name: true } }) : null;
    if (data.folderId && folder?.matterId !== matter.id) throw new ActionError("卷宗与案件不匹配");
    if (data.procedureId && !await tx.matterProcedure.count({ where: { id: data.procedureId, matterId: matter.id } })) throw new ActionError("程序与案件不匹配");
    if (data.stageId) {
      await tx.$queryRaw`SELECT id FROM "MatterStage" WHERE id=${data.stageId} FOR SHARE`;
      if (!await tx.matterStage.count({ where: { id: data.stageId, procedure: { matterId: matter.id },
        ...(data.procedureId ? { procedureId: data.procedureId } : {}),
        ...(newReservation && !priorId ? { status: "ACTIVE" } : {}) } })) throw new ActionError("环节与案件不匹配或已不可用");
    }
    if (matter.status === "ARCHIVED") {
      const maySupplement = hasPersonalCapability(actor, "archive.supplement") || scopeFor(actor, "archive.supplement") === "OWN";
      if (priorId || !maySupplement || !isArchiveFolderName(folder?.name))
        throw new ActionError("归档案件仅允许有补充归档权限者向归档卷宗追加材料");
    }
  } else {
    if (!data.intakeId) throw new ActionError("材料必须归属案件或收案");
    await tx.$queryRaw`SELECT id FROM "Intake" WHERE id=${data.intakeId} FOR UPDATE`;
    const intake = await tx.intake.findUnique({ where: { id: data.intakeId }, select: { createdById: true, ownerUserId: true, coUserIds: true, status: true } });
    if (!intake || intake.status === "DECLINED" || (actor.role !== "PRINCIPAL_LAWYER" &&
      intake.createdById !== userId && intake.ownerUserId !== userId && !intake.coUserIds.includes(userId))) throw new ActionError("收案不存在或无权上传");
    if (data.folderId || data.procedureId || data.stageId) throw new ActionError("收案材料不能关联案件程序或卷宗");
    if (await intakeWorkflowReady(tx)) await assertIntakeDocumentChange(tx, userId, data.intakeId, priorId ?? undefined);
  }
  if (data.intakeId && data.matterId && priorId && await intakeWorkflowReady(tx)) {
    const [used] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "IntakeRevision"
      WHERE "intakeId"=${data.intakeId} AND snapshot->'documents' @> ${JSON.stringify([{ id: priorId }])}::jsonb`;
    if (Number(used.count)) throw new ActionError("已固定于送审轮次的材料须保留，请另传补充材料");
  }
  if (priorId) {
    const prior = await tx.document.findUnique({ where: { id: priorId }, select: { matterId: true, intakeId: true, deletedAt: true, familyId: true } });
    if (!prior || prior.deletedAt || prior.matterId !== data.matterId || prior.intakeId !== data.intakeId) throw new ActionError("原材料版本已变化，请刷新后重传");
  }
}

/** The intent is durable before file I/O; originals use a reserved non-overwriting key. */
export async function ingestMaterial(input: { userId: string; document: MaterialDocumentInput; bytes: Buffer;
  priorDocumentId?: string; requestKey?: string; checkout?: { jti: string; baselineVersion: number; draftOnly?: boolean } | null;
  contextInputs?: ContextInputSelection[]; paragraphCitation?: ParagraphCitation }) {
  const priorDocumentId = input.priorDocumentId ?? null;
  let data: z.output<typeof documentInput>, id: string, metadata: z.output<typeof metadataSchema>;
  try {
    data = documentInput.parse(input.document);
    id = input.requestKey ? z.uuid().parse(input.requestKey) : randomUUID();
    metadata = metadataSchema.parse({ document: data, priorDocumentId, checkout: input.checkout ?? null,
      contextInputs: input.contextInputs, paragraphCitation: input.paragraphCitation });
    if (metadata.paragraphCitation && (!data.matterId || !priorDocumentId)) throw new ActionError("引用必须写入案内工作稿的新版本");
  } catch (error) { rejectBeforeReservation(error); }
  const existing = await prisma.materialIngestIntent.findUnique({ where: { id } });
  if (existing) {
    const previous = metadataSchema.parse(existing.metadata);
    if (existing.requestedById !== input.userId || !sameUpload(previous, metadata)) throw new ActionError("上传请求标识已用于其他内容，请重新选择文件");
    return resumeMaterialIngest(id, input.userId, { replay: { bytes: input.bytes, document: data } });
  }
  const storagePath = `${data.matterId ? `m_${data.matterId}` : `i_${data.intakeId}`}/${new Date().toISOString().slice(0, 7).replace("-", "")}/${id}.bin`;
  try { await approvalTransaction(async tx => {
    // Mark inside the callback: approvalTransaction also translates database failures
    // into ordinary ActionError, which must never imply that no intent was reserved.
    try {
      await assertUploadAuthority(tx, input.userId, data, priorDocumentId, true);
      if (priorDocumentId && input.contextInputs === undefined && await tx.documentContextInput.count({ where: { documentId: priorDocumentId } })) {
        throw new ActionError("请明确沿用或调整原稿采用的目标和指示，再保存新版本");
      }
      await assertContextInputSelections(tx, input.userId, data.matterId, metadata.contextInputs);
    } catch (error) { rejectBeforeReservation(error); }
    await tx.materialIngestIntent.create({ data: { id, storagePath, requestedById: input.userId,
      matterId: data.matterId, intakeId: data.matterId ? null : data.intakeId, priorDocumentId,
      sourceSha256: data.sha256, size: data.size, metadata: metadata as Prisma.InputJsonValue } });
    await tx.jobQueue.create({ data: { type: "document.ingest-reconcile", payload: { intentId: id },
      dedupeKey: `document.ingest:${id}`, runAt: new Date(Date.now() + 120_000), maxAttempts: 3 } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted); } catch (error) {
    const raced = await prisma.materialIngestIntent.findUnique({ where: { id } });
    if (raced) {
      if (raced.requestedById === input.userId && sameUpload(metadataSchema.parse(raced.metadata), metadata)) return resumeMaterialIngest(id, input.userId, { replay: { bytes: input.bytes, document: data } });
      throw new ActionError("上传请求标识已用于其他内容，请核对原上传");
    }
    throw error;
  }
  let publishPhase = "storage";
  try {
    await storage.writeFileAt(storagePath, input.bytes);
    publishPhase = "intent";
    await prisma.materialIngestIntent.updateMany({ where: { id, state: { not: "COMMITTED" }, documentId: null,
      OR: [{ errorCode: null }, { errorCode: { not: "UPLOAD_ABANDONED" } }] }, data: { state: "STORED", errorCode: null } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    console.warn("[material-ingest] write failed", publishPhase,
      typeof code === "string" && /^[A-Z0-9_]{1,36}$/.test(code) ? code : error instanceof Error ? error.name : "UnknownError");
    await prisma.materialIngestIntent.updateMany({ where: { id, state: { not: "COMMITTED" }, documentId: null,
      OR: [{ errorCode: null }, { errorCode: { not: "UPLOAD_ABANDONED" } }] }, data: { state: "FAILED", errorCode: "STORAGE_WRITE_FAILED" } });
    throw new ActionError("原件保存未完成，可在材料区查看未完成上传并重试");
  }
  return commitStoredIngest(id, input.userId);
}

async function commitStoredIngest(intentId: string, userId: string, lease?: JobLease) {
  return approvalTransaction(async tx => {
    if (lease) await assertCurrentJobLease(tx, lease);
    await tx.$queryRaw`SELECT id FROM "MaterialIngestIntent" WHERE id=${intentId} FOR UPDATE`;
    const intent = await tx.materialIngestIntent.findUniqueOrThrow({ where: { id: intentId } });
    if (intent.requestedById !== userId) throw new ActionError("无权处理此上传");
    if (intent.errorCode === "UPLOAD_ABANDONED") throw new ActionError("此上传已关闭，请重新选择文件开始新上传");
    const { document: data, priorDocumentId, checkout, contextInputs, paragraphCitation } = metadataSchema.parse(intent.metadata);
    await assertUploadAuthority(tx, userId, data, priorDocumentId);
    const adopted = await assertContextInputSelections(tx, userId, data.matterId, contextInputs, !intent.documentId);
    if (paragraphCitation) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true } });
      await readCitationConclusion(tx, user, data.matterId!, paragraphCitation.researchRevisionId);
    }
    if (intent.documentId) return tx.document.findUniqueOrThrow({ where: { id: intent.documentId }, select: { id: true, version: true } });
    if (intent.state !== "STORED") throw new ActionError("原件尚未确认保存，请重新上传");
    let familyId: string | null = null;
    let version = 1;
    let templateId: string | null = null;
    let templateContextSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    let researchInputs: { researchRevisionId: string }[] = [];
    if (priorDocumentId) {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${priorDocumentId} FOR UPDATE`;
      const prior = await tx.document.findUnique({ where: { id: priorDocumentId } });
      if (!prior || prior.deletedAt || !prior.isLatest || prior.matterId !== data.matterId || prior.intakeId !== data.intakeId) throw new ActionError("原材料版本已变化，请刷新后重传");
      if (paragraphCitation && (prior.version !== paragraphCitation.expectedVersion || draftExtension(prior) !== ".docx")) {
        throw new ActionError("目标文书已变化，请重新预览当前 DOCX 工作稿");
      }
      if (checkout?.draftOnly && !draftExtension(prior)) throw new ActionError("当前材料状态只能查看，本机工作稿已保留");
      if (prior.tags.includes("AI审查") || await tx.reviewRecord.count({ where: { reportDocumentId: prior.id } })) {
        throw new ActionError("审查报告为固定记录，请重新审查原材料或独立上传修订文件");
      }
      await assertNotIntakeSnapshot(tx, prior.intakeId, prior.id);
      if (prior.procedureId !== data.procedureId || prior.stageId !== data.stageId || prior.folderId !== data.folderId) {
        throw new ActionError("原材料归属已变化，请刷新后核对并重传");
      }
      await assertDocumentDerivationAccess(userId, prior.id, { purpose: "SUBMIT", db: tx });
      if (checkout && checkout.baselineVersion !== prior.version) throw new ActionError("取件基线已变化，请基于最新版另存");
      templateId = prior.templateId;
      templateContextSnapshot = prior.templateContextSnapshot === null ? Prisma.JsonNull : prior.templateContextSnapshot;
      researchInputs = await tx.documentResearchSource.findMany({ where: { documentId: prior.id }, select: { researchRevisionId: true } });
      familyId = prior.familyId ?? prior.id;
      version = prior.version + 1;
      await tx.document.updateMany({ where: { familyId, isLatest: true }, data: { isLatest: false } });
      if (!prior.familyId) await tx.document.update({ where: { id: prior.id }, data: { isLatest: false, familyId } });
    }
    if (paragraphCitation && !researchInputs.some(source => source.researchRevisionId === paragraphCitation.researchRevisionId)) {
      researchInputs.push({ researchRevisionId: paragraphCitation.researchRevisionId });
    }
    const created = await tx.document.create({ data: { ...data, path: intent.storagePath, familyId, version, isLatest: true,
      templateId, templateContextSnapshot } });
    if (adopted.length) await tx.documentContextInput.createMany({ data: adopted.map(input => ({ documentId: created.id, ...input })) });
    if (researchInputs.length) await tx.documentResearchSource.createMany({ data: researchInputs.map(source => ({ documentId: created.id, researchRevisionId: source.researchRevisionId })) });
    if (!familyId) await tx.document.update({ where: { id: created.id }, data: { familyId: created.id } });
    if (data.matterId) await enqueueMaterialProcessing(tx, { documentId: created.id, requestedById: userId });
    await tx.materialIngestIntent.update({ where: { id: intentId }, data: { state: "COMMITTED", documentId: created.id, errorCode: null } });
    await auditTx(tx, { userId, action: priorDocumentId ? "DOCUMENT_NEW_VERSION" : "DOCUMENT_UPLOAD",
      targetType: "Document", targetId: created.id,
      detail: { matterId: data.matterId, intakeId: data.intakeId, intentId, version, priorId: priorDocumentId,
        ...(checkout ? { controlledReturn: true, checkoutJti: checkout.jti, baselineVersion: checkout.baselineVersion } : {}),
        ...(paragraphCitation ? { paragraphCitation } : {}) } });
    if (data.matterId) await recordTimelineEvent(tx, { matterId: data.matterId, eventType: "DOCUMENT_UPLOADED",
      title: `上传材料：${data.name}`, occurredAt: new Date(), refType: "Document", refId: created.id });
    return { id: created.id, version: created.version };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}

type Replay = { bytes: Buffer; document?: z.output<typeof documentInput> };
type ResumeOptions = { lease?: JobLease; replay?: Replay; caseUpload?: { matterId: string; file?: Buffer } };

function reservedBytes(replay: Replay, reserved: z.output<typeof documentInput>) {
  const plain = replay.document?.encrypted
    ? decryptBuffer(replay.bytes, replay.document.iv!, replay.document.authTag!) : replay.bytes;
  if (reserved.encrypted) {
    if (!reserved.iv || !reserved.authTag) throw new ActionError("原上传的加密登记不完整");
    return restoreEncryptedOriginal(plain, { size: reserved.size, sha256: reserved.sha256, iv: reserved.iv, authTag: reserved.authTag });
  }
  if (plain.length !== reserved.size || sha256(plain) !== reserved.sha256) throw new ActionError("重传原件与上传登记不一致");
  return plain;
}

async function readReservedOriginal(storagePath: string, retry: () => Buffer | undefined) {
  try { return await storage.readFile(storagePath); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT" || ["NoSuchKey", "NotFound"].includes((error as Error)?.name);
    if (!missing) throw error;
    const replacement = retry();
    if (!replacement) throw error;
    try {
      await storage.writeFileAt(storagePath, replacement);
      return replacement;
    } catch {
      // Another retry may have won exclusive publication or its reply was lost.
      return storage.readFile(storagePath);
    }
  }
}

/** Recovery examines this intent's object only, never scans or re-hashes the material store. */
export async function resumeMaterialIngest(intentId: string, userId: string, { lease, replay, caseUpload }: ResumeOptions = {}) {
  const intent = await prisma.materialIngestIntent.findUnique({ where: { id: intentId, ...(caseUpload && { matterId: caseUpload.matterId, priorDocumentId: null }) } });
  if (!intent || intent.requestedById !== userId) throw new ActionError("上传记录不存在或无权处理");
  if (intent.errorCode === "UPLOAD_ABANDONED") throw new ActionError("此上传已关闭，请重新选择文件开始新上传");
  if (intent.state === "COMMITTED" && !caseUpload?.file) return commitStoredIngest(intentId, userId, lease);
  if (intent.state === "PENDING" && Date.now() - intent.createdAt.getTime() < 120_000) throw new ActionError("原件仍在保存，请稍后在材料区继续此上传");
  const { document: data } = metadataSchema.parse(intent.metadata);
  await approvalTransaction(async tx => {
    if (lease) await assertCurrentJobLease(tx, lease);
    await assertUploadAuthority(tx, userId, data, intent.priorDocumentId);
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  const replacement = caseUpload?.file && reservedBytes({ bytes: caseUpload.file }, data);
  if (intent.state === "COMMITTED") return commitStoredIngest(intentId, userId, lease);
  const recoverState = async (state: "FAILED" | "STORED", errorCode: string | null) => approvalTransaction(async tx => {
    if (lease) await assertCurrentJobLease(tx, lease);
    await tx.materialIngestIntent.updateMany({ where: { id: intentId, state: state === "FAILED" ? intent.state : { not: "COMMITTED" }, documentId: null,
      OR: [{ errorCode: null }, { errorCode: { not: "UPLOAD_ABANDONED" } }] }, data: { state, errorCode } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  let bytes: Buffer | undefined;
  try {
    const stored = await readReservedOriginal(intent.storagePath, () => replacement ?? (replay && reservedBytes(replay, data)));
    if (stored !== replacement) bytes = data.encrypted ? decryptBuffer(stored, data.iv!, data.authTag!) : stored;
  } catch {
    await recoverState("FAILED", "ORIGINAL_UNAVAILABLE");
    throw new ActionError("未找到完整原件，请重新选择文件上传");
  }
  if (bytes && (bytes.length !== intent.size || sha256(bytes) !== intent.sourceSha256)) throw new ActionError("原件与上传记录不一致，不能继续提交");
  await recoverState("STORED", null);
  return commitStoredIngest(intentId, userId, lease);
}

export async function reconcileMaterialIngest(payload: Record<string, unknown>, lease: JobLease) {
  const intent = await prisma.materialIngestIntent.findUnique({ where: { id: z.string().min(1).parse(payload.intentId) } });
  if (!intent || intent.state === "COMMITTED" || intent.errorCode === "UPLOAD_ABANDONED") return;
  await resumeMaterialIngest(intent.id, intent.requestedById, { lease });
}

export async function withdrawMaterial(userId: string, documentId: string, purge: boolean) {
  return approvalTransaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
    if (!user?.active) throw new ActionError("当前账号不可用");
    const actor = await resolveRoleUser(userId, user.role, tx);
    if (!actor.enabled || !hasCustomPermission(actor, "documents.write")) throw new ActionError("当前无权维护材料");
    if (purge && actor.role !== "PRINCIPAL_LAWYER") throw new ActionError("仅主任律师可清理原件");
    const ref = await tx.document.findUnique({ where: { id: documentId }, select: { matterId: true } });
    if (!ref) return null;
    if (ref.matterId) await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${ref.matterId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${documentId} FOR UPDATE`;
    const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
    await assertNotIntakeSnapshot(tx, doc.intakeId, documentId);
    if (doc.matterId) {
      const matter = await tx.matter.findFirst({ where: { id: doc.matterId, deletedAt: null,
        ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(userId)) },
        select: { status: true, ownerId: true, members: { where: { userId, role: { in: ["LEAD", "CO_LEAD"] } }, select: { userId: true } } } });
      if (!matter || matter.status === "ARCHIVED") throw new ActionError("案件不存在、无权处理或已经归档");
      if (!purge && doc.uploadedById !== userId && matter.ownerId !== userId && !matter.members.length) throw new ActionError("仅上传人或本案主办/协办可撤回材料");
      const pending = await tx.archiveRecord.findMany({ where: { matterId: doc.matterId, status: "PENDING_REVIEW" }, select: { checklistJson: true } });
      if (pending.some(a => archiveSnapshotDocumentIds(a.checklistJson).includes(documentId))) throw new ActionError("材料已列入待审归档申请，暂不能撤回");
    } else if (doc.intakeId) {
      await assertIntakeDocumentChange(tx, userId, doc.intakeId, documentId);
      if (!purge && doc.uploadedById !== userId && actor.role !== "PRINCIPAL_LAWYER") throw new ActionError("只能撤回自己上传的材料");
    } else if (!purge && doc.uploadedById !== userId) throw new ActionError("无权撤回材料");
    if (purge) await assertDocumentCanBePurged(tx, documentId);
    if (!doc.deletedAt) {
      await tx.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
      await cancelMaterialProcessing(tx, { documentId, reason: "WITHDRAWN" });
      await auditTx(tx, { userId, action: "DOCUMENT_DELETE", targetType: "Document", targetId: documentId,
        detail: { matterId: doc.matterId, intakeId: doc.intakeId } });
    }
    if (purge) {
      await tx.jobQueue.upsert({ where: { dedupeKey: `document.purge:${documentId}` }, update: {},
        create: { type: "document.purge", payload: { documentId, requestedById: userId }, dedupeKey: `document.purge:${documentId}` } });
      await auditTx(tx, { userId, action: "DOCUMENT_PURGE_REQUEST", targetType: "Document", targetId: documentId });
    }
    return { matterId: doc.matterId, intakeId: doc.intakeId };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}

export async function assertDocumentCanBePurged(tx: Prisma.TransactionClient, documentId: string) {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  await assertNotIntakeSnapshot(tx, doc.intakeId, documentId);
  const [legacy, links, contexts, family, reviews, invoices, seals, billings, adjustments, templates,
    researchSources, researchOutputs, contextInputs, manualIssues, manualRevisions, deliveryItems, deliveryProofs] = await Promise.all([
    tx.evidenceItem.count({ where: { sourceDocumentId: documentId } }),
    tx.evidenceSourceLink.count({ where: { documentId } }),
    tx.matterContextRecord.count({ where: { sourceDocumentId: documentId } }),
    tx.document.count({ where: { familyId: doc.familyId ?? doc.id } }),
    tx.reviewRecord.count({ where: { OR: [{ documentId }, { reportDocumentId: documentId }] } }),
    tx.invoiceRequest.count({ where: { OR: [{ contractScanId: documentId }, { invoiceFileId: documentId }, { evidenceDocIds: { has: documentId } }] } }),
    tx.sealRequest.count({ where: { OR: [{ draftDocId: documentId }, { stampedDocId: documentId }] } }),
    tx.billingAttachment.count({ where: { documentId } }),
    tx.invoiceAdjustment.count({ where: { documentId } }),
    tx.documentTemplate.count({ where: { docxBlobId: documentId } }),
    tx.researchSource.count({ where: { documentId } }),
    tx.documentResearchSource.count({ where: { documentId } }),
    tx.documentContextInput.count({ where: { documentId } }),
    tx.documentReviewIssue.count({ where: { OR: [{ documentId }, { basisDocumentId: documentId }] } }),
    tx.documentReviewEvent.count({ where: { revisionDocumentId: documentId } }),
    tx.deliveryItem.count({ where: { documentId } }),
    tx.deliveryEvent.count({ where: { proofDocumentId: documentId } }),
  ]);
  const archives = doc.matterId ? await tx.archiveRecord.findMany({ where: { matterId: doc.matterId }, select: { checklistJson: true, coverDocId: true, catalogDocId: true } }) : [];
  if (legacy || links || contexts || family > 1 || reviews || invoices || seals || billings || adjustments || templates ||
    researchSources || researchOutputs || contextInputs || manualIssues || manualRevisions || deliveryItems || deliveryProofs || doc.tags.includes("AI审查") || doc.version > 1 || doc.status !== "DRAFT" ||
    archives.some(a => a.coverDocId === documentId || a.catalogDocId === documentId || archiveSnapshotDocumentIds(a.checklistJson).includes(documentId))) {
    throw new ActionError("材料已进入来源、版本或审批历史，须保留原件，仅可撤回");
  }
  return doc;
}

async function assertNotIntakeSnapshot(tx: Prisma.TransactionClient, intakeId: string | null, documentId: string) {
  if (!intakeId || !await intakeWorkflowReady(tx)) return;
  const [used] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "IntakeRevision"
    WHERE "intakeId"=${intakeId} AND snapshot->'documents' @> ${JSON.stringify([{ id: documentId }])}::jsonb`;
  if (Number(used.count)) throw new ActionError("材料已固定于收案送审历史，须保留原件，请另传补充材料");
}

export async function abandonMaterialIngest(intentId: string, userId: string, caseMatterId?: string) {
  return approvalTransaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "MaterialIngestIntent" WHERE id=${intentId} FOR UPDATE`;
    const intent = await tx.materialIngestIntent.findUnique({ where: { id: intentId, ...(caseMatterId && { matterId: caseMatterId, priorDocumentId: null }) } });
    if (!intent || intent.requestedById !== userId) throw new ActionError("上传记录不存在或无权处理");
    const { document: data } = metadataSchema.parse(intent.metadata);
    await assertUploadAuthority(tx, userId, data, intent.priorDocumentId);
    if (intent.state === "COMMITTED" || intent.documentId) throw new ActionError("材料已经保存，请刷新查看");
    if (intent.state === "PENDING" && Date.now() - intent.createdAt.getTime() < 120_000) throw new ActionError("原件仍在保存，请稍后处理");
    await tx.materialIngestIntent.update({ where: { id: intentId }, data: { state: "FAILED", errorCode: "UPLOAD_ABANDONED" } });
    await tx.jobQueue.updateMany({ where: { dedupeKey: `document.ingest:${intentId}`, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "用户已关闭未完成上传" } });
    await auditTx(tx, { userId, action: "DOCUMENT_UPLOAD_ABANDON", targetType: "MaterialIngestIntent", targetId: intentId });
    return { matterId: intent.matterId, intakeId: intent.intakeId };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}

/** Durable withdrawal precedes the irreversible file delete; retries keep the same object identity. */
export async function purgeWithdrawnDocument(payload: Record<string, unknown>, lease: JobLease) {
  const documentId = z.string().min(1).parse(payload.documentId);
  const userId = z.string().min(1).parse(payload.requestedById);
  const doc = await approvalTransaction(async tx => {
    await assertCurrentJobLease(tx, lease);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
    if (!user?.active || user.role !== "PRINCIPAL_LAWYER") throw new ActionError("清理原件资格已失效");
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${documentId} FOR UPDATE`;
    const current = await assertDocumentCanBePurged(tx, documentId);
    if (!current.deletedAt) throw new ActionError("材料尚未撤回，不能清理原件");
    await auditTx(tx, { userId, action: "DOCUMENT_PURGE_STARTED", targetType: "Document", targetId: documentId, detail: { jobId: lease.id } });
    return current;
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await storage.deleteFile(doc.path);
  await approvalTransaction(async tx => {
    await assertCurrentJobLease(tx, lease);
    await auditTx(tx, { userId, action: "DOCUMENT_PURGED", targetType: "Document", targetId: documentId, detail: { jobId: lease.id } });
  });
}
