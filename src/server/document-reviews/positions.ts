import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { prepareSource, resolveReference, locationLabel } from "@/server/evidence/source-links";
import type { EvidenceSourceResult, SourceReference } from "@/server/evidence/contracts";
import { reviewPositionSchema, type ReviewPositionInput, type ReviewPositionView } from "./contracts";

/** The review service has already checked the exact subject/basis/revision role. */
export async function prepareReviewPosition(db: Prisma.TransactionClient, userId: string,
  document: { id: string; matterId: string | null }, input: ReviewPositionInput | null | undefined) {
  if (!input) return null;
  if (!document.matterId) throw new ActionError("此文书尚未关联案件，请保留人工文字位置与原件");
  const prepared = await prepareSource(userId, document.matterId, { ...input, documentId: document.id, relation: "CONTEXT" }, db);
  return reviewPositionSchema.parse({ documentSha256: prepared.documentSha256, location: prepared.location,
    parseRunId: prepared.parseRunId, anchorId: prepared.anchorId });
}

export function reviewPositionView(value: Prisma.JsonValue | null, document: { sha256: string | null } | null): ReviewPositionView | null {
  if (value === null) return null;
  const position = reviewPositionSchema.safeParse(value);
  return position.success && document?.sha256 === position.data.documentSha256
    ? { status: "AVAILABLE", label: locationLabel(position.data.location) } : { status: "UNAVAILABLE" };
}

/** No client-supplied document, hash, run or anchor participates in a saved read. */
export async function readReviewPosition(db: Prisma.TransactionClient, userId: string, matterId: string | null,
  documentId: string, value: Prisma.JsonValue | null): Promise<EvidenceSourceResult> {
  const position = reviewPositionSchema.safeParse(value);
  if (!matterId || !position.success) return { status: "UNAVAILABLE" };
  const reference: SourceReference = { ...position.data, id: "review-position", documentId, relation: "CONTEXT", legacy: false };
  return resolveReference(userId, matterId, reference, db);
}

export async function assertSavedReviewPosition(db: Prisma.TransactionClient, userId: string, matterId: string | null,
  documentId: string, value: Prisma.JsonValue | null) {
  if (value !== null && (await readReviewPosition(db, userId, matterId, documentId, value)).status !== "AVAILABLE") {
    throw new ActionError("原复核记录的固定来源当前不可读取，请核对原件与读取资格");
  }
}
