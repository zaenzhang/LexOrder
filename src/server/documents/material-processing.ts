/** Server-only domain helpers. Never expose trusted actor/transaction arguments as actions. */
import { Prisma, type Document, type DocumentParseRun, type DocumentParseState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { matterAssociationFilter } from "@/lib/permissions";
import { hasCustomPermission, scopeFor } from "@/lib/roles/catalog";
import { checkRoleMutation, resolveRoleUser } from "@/lib/roles/service";
import { isArchiveFolderName } from "@/lib/archive/guard";
import { materialPresentation, type MaterialPresentation } from "@/lib/documents/presentation";
import { auditTx } from "@/server/audit";
import { assertCurrentJobLease, type JobLease } from "@/server/cron/queue";
import { processingCoverageSchema, sourceAnchorSchema, type ProcessingCoverage, type SourceAnchor } from "@/lib/workbench/contracts";
import type { ParsedMaterial } from "@/server/rag/parse-material";
import { ServiceFailure } from "@/server/rag/service-transport";

export const MATERIAL_PARSER_VERSION = "lexorder-local-material-v1";
const shaPattern = /^[a-f0-9]{64}$/;
const jobPayload = z.strictObject({ runId: z.string().min(1).max(512) });
type SourceDocument = Pick<Document, "id" | "name" | "version" | "sha256" | "mimeType" | "matterId" | "intakeId" | "uploadedById" | "deletedAt" | "parseGeneration">;
type SnapshotRun = Pick<DocumentParseRun, "id" | "documentId" | "generation" | "parserVersion" | "sourceSha256" | "state" | "anchors" | "coverage" | "finishedAt">;

export interface MaterialSourceInput { documentId: string; runId: string; anchorId: string }
export type MaterialSourceResult = ({
  status: "AVAILABLE";
  document: { id: string; name: string; version: number; sha256: string; mimeType: string | null };
  run: { id: string; generation: number; parserVersion: string; isCurrent: boolean };
  anchor: SourceAnchor;
  coverage: ProcessingCoverage;
  locationLabel: string;
} & MaterialPresentation) | { status: "UNAVAILABLE" };
export interface MaterialSourceListItem {
  documentId: string; documentName: string; documentVersion: number; documentSha256: string;
  runId: string; anchorId: string; location: SourceAnchor["location"];
  locationLabel: string; excerpt: string;
}
export interface MaterialSourceListResult { items: MaterialSourceListItem[]; nextOffset: number | null }
export interface MaterialProcessingStatusItem extends MaterialPresentation {
  documentId: string; documentName: string; generation: number; runId: string | null;
  state: DocumentParseState | "NOT_PROCESSED"; label: string; detail: string;
  inProgress: boolean; canRetry: boolean;
  coverage: { unitKind: ProcessingCoverage["unitKind"]; totalUnits: number | null; ready: number;
    pending: number[]; failed: number[]; unsupported: number[]; truncated: number[] } | null;
}

export function materialLocationLabel(location: SourceAnchor["location"]): string {
  switch (location.kind) {
    case "PAGE": return `第 ${location.page} 页`;
    case "TEXT": return `抽取文本第 ${location.start + 1}—${location.end} 字符`;
    case "PARAGRAPH": return `第 ${location.paragraph} 段`;
    case "TABLE": return `${location.sheet} · 第 ${location.rowStart}${location.rowEnd === location.rowStart ? "" : `—${location.rowEnd}`} 行，第 ${location.columnStart}${location.columnEnd === location.columnStart ? "" : `—${location.columnEnd}`} 列`;
    case "IMAGE": return "原图区域";
    case "UNLOCATED": return "位置尚未映射";
  }
}

/** Validate stored representations before using them as sources; this does not grant access. */
export function publishedMaterialSnapshot(run: SnapshotRun, doc: Pick<SourceDocument, "id" | "matterId" | "sha256">): { anchors: SourceAnchor[]; coverage: ProcessingCoverage } | null {
  if (!run.finishedAt || !["READY", "PARTIAL"].includes(run.state) || !doc.matterId ||
      !doc.sha256 || run.documentId !== doc.id || run.sourceSha256 !== doc.sha256) return null;
  const coverage = processingCoverageSchema.safeParse(run.coverage);
  const anchors = z.array(sourceAnchorSchema).safeParse(run.anchors);
  if (!coverage.success || !anchors.success || !anchors.data.length) return null;
  const ids = new Set<string>();
  for (const anchor of anchors.data) {
    if (ids.has(anchor.anchorId) || anchor.parseGenerationId !== run.id || anchor.source.kind !== "CASE_MATERIAL" ||
        anchor.source.documentId !== doc.id || anchor.source.matterId !== doc.matterId || anchor.source.sha256 !== doc.sha256 ||
        anchor.location.kind === "UNLOCATED" || !coverage.data.units.some(unit => unit.unit === anchor.unit && unit.status === "READY") ||
        (coverage.data.unitKind === "PAGE" && (anchor.location.kind !== "PAGE" || anchor.location.page !== anchor.unit))) return null;
    ids.add(anchor.anchorId);
  }
  if (coverage.data.units.some(unit => unit.status === "READY" && !anchors.data.some(anchor => anchor.unit === unit.unit))) return null;
  return { anchors: anchors.data, coverage: coverage.data };
}

/** The search cache is disposable; citations always read the immutable run. */
export function materialTextProjection(parsed: Pick<ParsedMaterial, "anchors" | "coverage">): string {
  if (parsed.coverage.unitKind === "PAGE" && parsed.coverage.totalUnits !== null) {
    const pages = Array<string>(parsed.coverage.totalUnits).fill("");
    for (const anchor of parsed.anchors) if (anchor.location.kind === "PAGE") pages[anchor.location.page - 1] = anchor.text;
    return pages.join("\f");
  }
  return parsed.anchors.map(anchor => anchor.text).join(parsed.anchors.every(anchor => anchor.location.kind === "TEXT") ? "" : "\n");
}

async function processingPermission(db: Prisma.TransactionClient, userId: string, mutation: boolean) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("材料不存在或无权处理");
  const access = await resolveRoleUser(userId, user.role, db);
  if (!access.enabled || !hasCustomPermission(access, "documents.write")) throw new ActionError("无权处理这份材料");
  const actor = { ...access, id: userId };
  if (mutation) await checkRoleMutation(db, actor, "documents.write");
  return actor;
}

async function processingActor(db: Prisma.TransactionClient, userId: string, doc: Pick<Document, "matterId" | "folderId">, allowArchivedUpload = true) {
  if (!doc.matterId) throw new ActionError("材料不存在或无权处理");
  const actor = await processingPermission(db, userId, false);
  const matter = await db.matter.findFirst({ where: {
    id: doc.matterId, deletedAt: null,
    ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(userId)),
  }, select: { status: true } });
  if (!matter) throw new ActionError("材料不存在或无权处理");
  if (matter.status === "ARCHIVED") {
    if (!allowArchivedUpload) throw new ActionError("案件已归档，材料不可重新处理");
    const folder = doc.folderId ? await db.documentFolder.findUnique({ where: { id: doc.folderId }, select: { name: true } }) : null;
    if (scopeFor(actor, "archive.supplement") !== "OWN" || !isArchiveFolderName(folder?.name)) throw new ActionError("案件已归档，材料不可重新处理");
  }
  return actor;
}

async function lockDocument(db: Prisma.TransactionClient, id: string) {
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`);
  return db.document.findUnique({ where: { id } });
}

/** Caller must supply a real transaction containing the material create/version change. */
export async function enqueueMaterialProcessing(tx: Prisma.TransactionClient, input: { documentId: string; requestedById: string; expectedGeneration?: number }): Promise<{ runId: string; generation: number }> {
  // Match upload/evidence mutations: role lock before the material row lock.
  await processingPermission(tx, input.requestedById, true);
  const doc = await lockDocument(tx, input.documentId);
  if (!doc || doc.deletedAt || !doc.matterId) throw new ActionError("仅可处理当前事项内的有效材料");
  await processingActor(tx, input.requestedById, doc, input.expectedGeneration === undefined);
  if (!doc.sha256 || !shaPattern.test(doc.sha256)) throw new ActionError("原件校验信息缺失，请补传一个材料版本");
  if (input.expectedGeneration === undefined && doc.parseGeneration > 0) {
    const existing = await tx.documentParseRun.findUnique({ where: { documentId_generation: { documentId: doc.id, generation: doc.parseGeneration } }, select: { id: true } });
    if (existing) return { runId: existing.id, generation: doc.parseGeneration };
  }
  const expected = input.expectedGeneration ?? 0;
  if (doc.parseGeneration !== expected) throw new ActionError("材料处理状态已变化，请刷新后重试");
  const generation = expected + 1;
  const changed = await tx.document.updateMany({ where: { id: doc.id, deletedAt: null, parseGeneration: expected, sha256: doc.sha256 },
    data: { parseGeneration: generation, textContent: null, textSource: null, ocrStatus: "PENDING" } });
  if (changed.count !== 1) throw new ActionError("材料处理状态已变化，请刷新后重试");
  await tx.documentParseRun.updateMany({ where: { documentId: doc.id, finishedAt: null },
    data: { state: "CANCELLED", errorCode: "SUPERSEDED", finishedAt: new Date() } });
  const run = await tx.documentParseRun.create({ data: {
    documentId: doc.id, generation, requestedById: input.requestedById,
    parserVersion: MATERIAL_PARSER_VERSION, sourceSha256: doc.sha256,
  }, select: { id: true } });
  await tx.jobQueue.create({ data: { type: "document.parse", payload: { runId: run.id }, dedupeKey: `document.parse:${run.id}` } });
  await auditTx(tx, { userId: input.requestedById, action: "DOCUMENT_PARSE_REQUEST", targetType: "Document", targetId: doc.id, detail: { runId: run.id, generation } });
  return { runId: run.id, generation };
}

/** Local withdrawal is immediate; it never waits for a running parser to stop. */
export async function cancelMaterialProcessing(tx: Prisma.TransactionClient, input: { documentId: string; reason?: "WITHDRAWN" | "SUPERSEDED" }): Promise<void> {
  const doc = await lockDocument(tx, input.documentId);
  if (!doc) return;
  await tx.document.update({ where: { id: doc.id }, data: { parseGeneration: { increment: 1 }, textContent: null, textSource: null, ocrStatus: "SKIP" } });
  await tx.documentParseRun.updateMany({ where: { documentId: doc.id, finishedAt: null },
    data: { state: "CANCELLED", errorCode: input.reason ?? "WITHDRAWN", finishedAt: new Date() } });
}

async function currentJobRun(tx: Prisma.TransactionClient, runId: string, lease: JobLease) {
  await assertCurrentJobLease(tx, lease);
  const job = await tx.jobQueue.findUnique({ where: { id: lease.id }, select: { type: true, payload: true } });
  if (job?.type !== "document.parse" || jobPayload.safeParse(job.payload).data?.runId !== runId) throw new Error("MATERIAL_JOB_MISMATCH");
  const ref = await tx.documentParseRun.findUnique({ where: { id: runId }, select: { documentId: true, requestedById: true, finishedAt: true } });
  if (!ref) throw new Error("MATERIAL_RUN_MISSING");
  if (ref.finishedAt) return null;
  let reason: string | null = null;
  try { await processingPermission(tx, ref.requestedById, true); }
  catch (error) { if (!(error instanceof ActionError)) throw error; reason = "PROCESSING_REVOKED"; }
  const doc = await lockDocument(tx, ref.documentId);
  const run = await tx.documentParseRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("MATERIAL_RUN_MISSING");
  if (run.finishedAt) return null;
  if (!doc || doc.deletedAt) reason = "WITHDRAWN";
  else if (doc.parseGeneration !== run.generation) reason = "SUPERSEDED";
  else if (doc.sha256 !== run.sourceSha256 || !doc.matterId) reason = "SOURCE_CHANGED";
  else if (!reason) {
    try { await processingActor(tx, run.requestedById, doc); }
    catch (error) { if (!(error instanceof ActionError)) throw error; reason = "PROCESSING_REVOKED"; }
  }
  if (reason || !doc) {
    await tx.documentParseRun.updateMany({ where: { id: run.id, finishedAt: null }, data: { state: "CANCELLED", errorCode: reason, finishedAt: new Date() } });
    return null;
  }
  return { run, doc };
}

/** Worker supplies its lease; the shared worker owns renewal and retry scheduling. */
export async function processMaterialJob(payload: Record<string, unknown>, lease: JobLease): Promise<void> {
  const { runId } = jobPayload.parse(payload);
  const claimed = await prisma.$transaction(async tx => {
    const current = await currentJobRun(tx, runId, lease);
    if (!current) return null;
    await tx.documentParseRun.update({ where: { id: runId }, data: { state: "RUNNING", startedAt: new Date(), errorCode: null } });
    return current;
  });
  if (!claimed) return;
  const { doc, run } = claimed;
  let parsed: ParsedMaterial;
  let failureCode: string | null = null;
  try {
    // Storage and parser are loaded only for this job; no optional service is initialized.
    const { storage } = await import("@/lib/storage");
    const { decryptBuffer } = await import("@/lib/storage/crypto");
    const stored = await storage.readFile(doc.path);
    if (doc.encrypted && (!doc.iv || !doc.authTag)) throw new Error("ORIGINAL_METADATA_INVALID");
    const bytes = doc.encrypted ? decryptBuffer(stored, doc.iv!, doc.authTag!) : stored;
    if (doc.size !== null && bytes.length !== doc.size) throw new Error("ORIGINAL_SIZE_MISMATCH");
    const { parseMaterial } = await import("@/server/rag/parse-material");
    parsed = await parseMaterial({ bytes, mimeType: doc.mimeType ?? "application/octet-stream",
      source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId: doc.matterId!, sha256: run.sourceSha256 }, parseGenerationId: run.id });
  } catch (error) {
    // File read/decryption failures may recover; hashes are checked by parseMaterial, once per read.
    const invalid = error instanceof ServiceFailure || (error instanceof Error && error.message.startsWith("ORIGINAL_"));
    failureCode = invalid ? "ORIGINAL_VALIDATION_FAILED" : "ORIGINAL_READ_FAILED";
    await prisma.$transaction(async tx => {
      const current = await currentJobRun(tx, runId, lease);
      if (!current) return;
      const job = await tx.jobQueue.findUnique({ where: { id: lease.id }, select: { attempts: true, maxAttempts: true } });
      const terminal = invalid || Boolean(job && job.attempts + 1 >= job.maxAttempts);
      await tx.documentParseRun.update({ where: { id: runId }, data: { state: "FAILED", errorCode: failureCode, finishedAt: terminal ? new Date() : null } });
      await tx.document.updateMany({ where: { id: doc.id, parseGeneration: run.generation, deletedAt: null }, data: { ocrStatus: "FAILED", textContent: null } });
    });
    if (!invalid) throw new Error(failureCode);
    return;
  }
  await prisma.$transaction(async tx => {
    const current = await currentJobRun(tx, runId, lease);
    if (!current) return;
    if (current.doc.matterId !== doc.matterId) {
      await tx.documentParseRun.update({ where: { id: runId }, data: { state: "CANCELLED", errorCode: "SOURCE_CHANGED", finishedAt: new Date() } });
      return;
    }
    const hasPending = parsed.coverage.units.some(unit => unit.status === "PENDING");
    const errorCode = hasPending ? "OCR_NOT_CONFIGURED" : parsed.state === "FAILED" ? "PARSE_FAILED"
      : parsed.state === "UNSUPPORTED" ? "UNSUPPORTED_FORMAT" : null;
    await tx.documentParseRun.update({ where: { id: run.id }, data: {
      state: parsed.state, anchors: parsed.anchors as unknown as Prisma.InputJsonValue,
      coverage: parsed.coverage as unknown as Prisma.InputJsonValue, errorCode, finishedAt: new Date(),
    } });
    const source = doc.mimeType === "application/pdf" ? "PDF_TEXT" : doc.mimeType?.includes("wordprocessingml") ? "DOCX" : doc.mimeType?.startsWith("text/") ? "MANUAL" : null;
    await tx.document.updateMany({ where: { id: doc.id, deletedAt: null, parseGeneration: run.generation, sha256: run.sourceSha256 }, data: {
      textContent: parsed.anchors.length ? materialTextProjection(parsed) : null, textSource: source,
      pageCount: parsed.coverage.unitKind === "PAGE" ? parsed.coverage.totalUnits : null,
      ocrStatus: parsed.state === "UNSUPPORTED" ? "SKIP" : parsed.state,
    } });
  });
}

export async function readMaterialSource(userId: string, input: MaterialSourceInput, db: Prisma.TransactionClient = prisma): Promise<MaterialSourceResult> {
  const doc = await db.document.findUnique({ where: { id: input.documentId } });
  if (!doc || doc.deletedAt || !await canReadDocument(userId, doc, db)) return { status: "UNAVAILABLE" };
  const run = await db.documentParseRun.findFirst({ where: { id: input.runId, documentId: doc.id } });
  if (!run) return { status: "UNAVAILABLE" };
  const snapshot = publishedMaterialSnapshot(run, doc);
  const anchor = snapshot?.anchors.find(item => item.anchorId === input.anchorId);
  if (!snapshot || !anchor || !doc.sha256) return { status: "UNAVAILABLE" };
  const current = await db.document.findFirst({ where: { id: doc.id, deletedAt: null, sha256: doc.sha256, matterId: doc.matterId } });
  if (!current || !await canReadDocument(userId, current, db)) return { status: "UNAVAILABLE" };
  return { status: "AVAILABLE", document: { id: doc.id, name: doc.name, version: doc.version, sha256: doc.sha256, mimeType: doc.mimeType },
    run: { id: run.id, generation: run.generation, parserVersion: run.parserVersion, isCurrent: current.parseGeneration === run.generation },
    anchor, coverage: snapshot.coverage, locationLabel: materialLocationLabel(anchor.location), ...materialPresentation(doc, anchor.location) };
}

export async function readMaterialSources(userId: string, input: { matterId: string; documentIds: string[]; offset?: number; limit?: number }, db: Prisma.TransactionClient = prisma): Promise<MaterialSourceListResult> {
  if (!input.documentIds.length) return { items: [], nextOffset: null };
  const docs = await db.document.findMany({ where: { id: { in: [...new Set(input.documentIds)] }, matterId: input.matterId, deletedAt: null }, orderBy: { id: "asc" }, include: { parseRuns: { where: { finishedAt: { not: null }, state: { in: ["READY", "PARTIAL"] } }, orderBy: { generation: "desc" }, take: 1 } } });
  const items: MaterialSourceListItem[] = [];
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 40;
  for (const doc of docs) {
    if (!await canReadDocument(userId, doc, db)) continue;
    const run = doc.parseRuns[0];
    if (!run || run.generation !== doc.parseGeneration) continue;
    const snapshot = publishedMaterialSnapshot(run, doc);
    if (!snapshot || !doc.sha256) continue;
    for (const anchor of snapshot.anchors) items.push({ documentId: doc.id, documentName: doc.name, documentVersion: doc.version,
      documentSha256: doc.sha256, runId: run.id, anchorId: anchor.anchorId, location: anchor.location,
      locationLabel: materialLocationLabel(anchor.location), excerpt: anchor.text.slice(0, 240) });
  }
  return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}

const labels: Record<MaterialProcessingStatusItem["state"], string> = {
  NOT_PROCESSED: "尚未建立来源", PENDING: "等待处理", RUNNING: "正在处理", READY: "处理完成",
  PARTIAL: "部分可读", FAILED: "处理失败", UNSUPPORTED: "暂不支持", CANCELLED: "已停止处理",
};
const details: Record<string, string> = {
  OCR_NOT_CONFIGURED: "扫描内容尚未识别，可查看原件或补传文本版本。", PARSE_FAILED: "未能解析原件，可重试或检查文件。",
  UNSUPPORTED_FORMAT: "此格式尚不支持内置解析，原件仍可查看或下载。", ORIGINAL_VALIDATION_FAILED: "原件与保存的校验信息不一致，请核对存储或补传新版本。",
  ORIGINAL_READ_FAILED: "暂时无法读取原件，请检查文件存储后重试。", PROCESSING_REVOKED: "处理资格已变化，请由当前经办人重新处理。",
  SOURCE_CHANGED: "材料归属或原件版本已变化，请重新处理。", SUPERSEDED: "已有新的处理代次。", WITHDRAWN: "材料已撤回。",
};

export async function readMaterialProcessingStatuses(userId: string, input: { matterId: string; documentIds: string[] }): Promise<MaterialProcessingStatusItem[]> {
  if (!input.documentIds.length) return [];
  const docs = await prisma.document.findMany({ where: { id: { in: [...new Set(input.documentIds)] }, matterId: input.matterId, deletedAt: null },
    orderBy: { createdAt: "desc" }, include: { parseRuns: { orderBy: { generation: "desc" }, take: 1 } } });
  const results: MaterialProcessingStatusItem[] = [];
  for (const doc of docs) {
    if (!await canReadDocument(userId, doc)) continue;
    const run = doc.parseRuns.find(item => item.generation === doc.parseGeneration);
    const coverage = processingCoverageSchema.safeParse(run?.coverage);
    const state = run?.state ?? "NOT_PROCESSED";
    const inProgress = Boolean(run && !run.finishedAt && ["PENDING", "RUNNING", "FAILED"].includes(state));
    let canRetry = !inProgress && Boolean(doc.sha256 && shaPattern.test(doc.sha256));
    if (canRetry) { try { await processingActor(prisma, userId, doc, false); } catch { canRetry = false; } }
    const unitNumbers = (status: ProcessingCoverage["units"][number]["status"]) => coverage.success ? coverage.data.units.filter(unit => unit.status === status).map(unit => unit.unit) : [];
    results.push({ documentId: doc.id, documentName: doc.name, generation: doc.parseGeneration, runId: run?.id ?? null, state,
      label: state === "PENDING" && run?.finishedAt ? "尚有未识别内容" : labels[state],
      detail: run?.errorCode ? details[run.errorCode] ?? "处理尚未完成，请查看原件。" : !doc.sha256 ? "原件校验信息缺失，请补传一个材料版本。" : "",
      inProgress, canRetry, ...materialPresentation(doc), coverage: coverage.success ? { unitKind: coverage.data.unitKind, totalUnits: coverage.data.totalUnits,
        ready: unitNumbers("READY").length, pending: unitNumbers("PENDING"), failed: unitNumbers("FAILED"), unsupported: unitNumbers("UNSUPPORTED"), truncated: unitNumbers("TRUNCATED") } : null });
  }
  return results;
}
