import type { EvidenceSourceLink, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { ActionError } from "@/lib/action-error";
import { materialPresentation } from "@/lib/documents/presentation";
import { sourceAnchorSchema, sourceLocationSchema } from "@/lib/workbench/contracts";
import { readMaterialSource } from "@/server/documents/material-processing";
import { sourceReferenceSchema, type EvidenceDocumentOption, type EvidenceSourceResult, type EvidenceSourceView, type SourceInput, type SourceReference } from "./contracts";

const documentSelect = {
  id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
  sha256: true, name: true, version: true, mimeType: true, pageCount: true,
} satisfies Prisma.DocumentSelect;
type SourceDocument = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
type ItemSources = { sourceDocumentId: string | null; sourcePage: number | null; sources: EvidenceSourceLink[] };

export function sourceReferences(item: ItemSources): SourceReference[] {
  const references: SourceReference[] = item.sources.filter(source => !source.removedAt).map(source => sourceReferenceSchema.parse({
    id: source.id, documentId: source.documentId, documentSha256: source.documentSha256,
    relation: source.relation, location: source.location, parseRunId: source.parseRunId, anchorId: source.anchorId, legacy: false,
  }));
  if (item.sourceDocumentId) references.unshift({
    id: `legacy:${item.sourceDocumentId}`, documentId: item.sourceDocumentId, documentSha256: null,
    relation: null, location: item.sourcePage ? { kind: "PAGE", page: item.sourcePage } : { kind: "UNLOCATED", reason: "NO_MAPPING" },
    parseRunId: null, anchorId: null, legacy: true,
  });
  return references;
}

export function readSourceSnapshot(snapshot: Prisma.JsonValue): SourceReference[] | null {
  const parsed = sourceReferenceSchema.array().safeParse(snapshot);
  return parsed.success ? parsed.data : null;
}

export function locationLabel(location: SourceReference["location"]): string {
  switch (location.kind) {
    case "PAGE": return `第 ${location.page} 页`;
    case "TEXT": return `抽取文本 ${location.start + 1}–${location.end} 字符`;
    case "PARAGRAPH": return `第 ${location.paragraph} 段`;
    case "TABLE": return `${location.sheet} · 行 ${location.rowStart}–${location.rowEnd}，列 ${location.columnStart}–${location.columnEnd}`;
    case "IMAGE": return "图片选区";
    case "UNLOCATED": return "原件（暂无精确位置）";
  }
}

/** Request-local lookup only: no permission or source cache survives a request. */
export async function sourceReader(userId: string, matterId: string, references: SourceReference[], db: Prisma.TransactionClient = prisma) {
  const ids = [...new Set(references.map(reference => reference.documentId))];
  const documents = ids.length ? await db.document.findMany({ where: { id: { in: ids }, matterId }, select: documentSelect }) : [];
  const allowed = new Map<string, SourceDocument>();
  await Promise.all(documents.map(async document => {
    if (!document.deletedAt && await canReadDocument(userId, document, db)) allowed.set(document.id, document);
  }));
  function documentFor(reference: SourceReference) {
    const document = allowed.get(reference.documentId);
    return document && (reference.legacy || document.sha256 === reference.documentSha256) ? document : null;
  }
  function view(reference: SourceReference): EvidenceSourceView {
    const document = documentFor(reference);
    return {
      id: reference.id, relation: reference.relation, legacy: reference.legacy,
      status: document ? "AVAILABLE" : "UNAVAILABLE", documentId: document?.id ?? null, documentName: document?.name ?? null,
      documentVersion: document?.version ?? null, locationLabel: document ? locationLabel(reference.location) : null,
      hasAnchor: Boolean(reference.parseRunId && reference.anchorId),
    };
  }
  return { view, documentFor };
}

export async function prepareSource(userId: string, matterId: string, input: SourceInput, db: Prisma.TransactionClient) {
  // Lock the concrete version through the mutation; do not read or re-hash the original.
  await db.$queryRaw`SELECT id FROM "Document" WHERE id = ${input.documentId} FOR SHARE`;
  const document = await db.document.findUnique({ where: { id: input.documentId }, select: documentSelect });
  if (!document || document.deletedAt) throw new ActionError("来源材料不存在或已删除");
  if (document.matterId !== matterId) throw new ActionError("来源材料不属于该案件");
  if (!await canReadDocument(userId, document, db)) throw new ActionError("无权读取来源材料");
  if (!document.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new ActionError("该材料尚无可靠的原件标识，请先核对材料");
  let location: SourceReference["location"] = { kind: "UNLOCATED", reason: "NO_MAPPING" };
  let locationKey = "UNLOCATED";
  if (input.parseRunId && input.anchorId) {
    const result = await readMaterialSource(userId, { documentId: document.id, runId: input.parseRunId, anchorId: input.anchorId }, db);
    if (result.status !== "AVAILABLE" || result.run.id !== input.parseRunId) throw new ActionError("该原文位置已不可用，请重新选择");
    const anchor = sourceAnchorSchema.parse(result.anchor);
    if (anchor.source.kind !== "CASE_MATERIAL" || anchor.source.documentId !== document.id ||
      anchor.source.matterId !== matterId || anchor.source.sha256 !== document.sha256 || anchor.anchorId !== input.anchorId) {
      throw new ActionError("来源身份不匹配，请重新选择材料");
    }
    location = anchor.location;
    locationKey = `ANCHOR:${input.parseRunId}:${input.anchorId}`;
  } else if (input.page != null) {
    if (document.mimeType?.toLowerCase() !== "application/pdf" || !document.pageCount || input.page > document.pageCount) {
      throw new ActionError("页码须在已知 PDF 原件页数内；其他材料请选择原文位置或不填页码");
    }
    location = { kind: "PAGE", page: input.page };
    locationKey = `PAGE:${input.page}`;
  }
  return {
    documentId: document.id, documentSha256: document.sha256, relation: input.relation, location: location as Prisma.InputJsonValue,
    locationKey, parseRunId: input.parseRunId ?? null, anchorId: input.anchorId ?? null,
  };
}

export async function resolveReference(userId: string, matterId: string, reference: SourceReference, db: Prisma.TransactionClient = prisma): Promise<EvidenceSourceResult> {
  const reader = await sourceReader(userId, matterId, [reference], db);
  const document = reader.documentFor(reference);
  if (!document) return { status: "UNAVAILABLE" };
  if (reference.parseRunId && reference.anchorId) {
    const savedLocation = sourceLocationSchema.safeParse(reference.location);
    if (!savedLocation.success) return { status: "UNAVAILABLE" };
    const result = await readMaterialSource(userId, { documentId: reference.documentId, runId: reference.parseRunId, anchorId: reference.anchorId }, db);
    if (result.status !== "AVAILABLE" || result.document.sha256 !== reference.documentSha256 ||
      JSON.stringify(sourceLocationSchema.parse(result.anchor.location)) !== JSON.stringify(savedLocation.data)) return { status: "UNAVAILABLE" };
    return { status: "AVAILABLE", documentName: document.name, documentVersion: document.version,
      locationLabel: result.locationLabel, previewKind: result.previewKind, previewUrl: result.previewUrl, downloadUrl: result.downloadUrl,
      text: result.anchor.text, legacy: false, historicalParse: !result.run.isCurrent };
  }
  return { status: "AVAILABLE", documentName: document.name, documentVersion: document.version,
    locationLabel: locationLabel(reference.location), ...materialPresentation(document, reference.location),
    text: null, legacy: reference.legacy, historicalParse: false };
}

export async function readableDocumentOptions(userId: string, matterId: string): Promise<EvidenceDocumentOption[]> {
  const documents = await prisma.document.findMany({
    where: { matterId, deletedAt: null }, select: documentSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const options = await Promise.all(documents.map(async document => await canReadDocument(userId, document) ? {
    id: document.id, name: document.name, version: document.version, pageCount: document.pageCount,
    isPdf: document.mimeType?.toLowerCase() === "application/pdf", hasIdentity: Boolean(document.sha256 && /^[a-f0-9]{64}$/.test(document.sha256)),
  } : null));
  return options.filter((option): option is EvidenceDocumentOption => option !== null);
}
