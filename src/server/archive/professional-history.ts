import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { readResearchIssueSnapshot } from "@/server/research/issue-snapshot";
import { reviewPositionSchema } from "@/server/document-reviews/contracts";

type ReferenceRole = "RESEARCH_OUTPUT" | "RESEARCH_SOURCE" | "ISSUE_SOURCE" | "REVIEW_DOCUMENT" |
  "REVIEW_BASIS" | "REVIEW_REVISION" | "DELIVERY_ITEM" | "DELIVERY_PROOF" | "CONTEXT_OUTPUT" | "CONTEXT_SOURCE";
type DocumentReference = {
  documentId: string; documentName: string; documentVersion: number; documentSha256: string; roles: ReferenceRole[];
};
const personSelect = { id: true, name: true } as const;
const documentSelect = { id: true, matterId: true, deletedAt: true, name: true, version: true, sha256: true } as const;

/** Called once in the existing archive approval transaction. Extra references never add physical files. */
export async function buildArchiveProfessionalHistory(db: Prisma.TransactionClient, matterId: string, selectedDocumentIds: string[]) {
  const selected = [...new Set(selectedDocumentIds)];
  const [research, reviews, deliveries, contextInputs] = await Promise.all([
    db.researchRevision.findMany({ where: { matterId, outputDocuments: { some: { documentId: { in: selected } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
        id: true, matterId: true, seriesId: true, version: true, supersedesId: true, issueId: true, issueRevisionId: true, issueSnapshot: true,
        question: true, purpose: true, jurisdiction: true, relevantDate: true, researchedAt: true, scope: true,
        queryLog: true, rule: true, exceptions: true, supportingAnalysis: true, opposingAnalysis: true,
        conclusion: true, unresolved: true, nextSteps: true, createdAt: true, checkedAt: true, checkNote: true,
        author: { select: personSelect }, checkedBy: { select: personSelect },
        sources: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
          id: true, documentId: true, documentSha256: true, relation: true, location: true, locationKey: true,
          parseRunId: true, anchorId: true, lawMetadata: true, createdAt: true,
        } },
        outputDocuments: { where: { documentId: { in: selected } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, documentId: true, createdAt: true } },
        issue: { select: { matterId: true } },
      } }),
    db.documentReviewIssue.findMany({ where: { documentId: { in: selected }, document: { matterId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
        id: true, documentId: true, title: true, location: true, position: true, basis: true, basisDocumentId: true, basisPosition: true,
        createdBy: { select: personSelect }, createdAt: true, version: true, state: true,
        events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
          id: true, kind: true, disposition: true, note: true, revisionDocumentId: true, revisionLocation: true, revisionPosition: true,
          resolved: true, actor: { select: personSelect }, createdAt: true, version: true,
        } },
      } }),
    db.deliveryRecord.findMany({ where: { matterId, items: { some: {}, every: { documentId: { in: selected } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
        id: true, purpose: true, recipientClientId: true, recipientName: true, recipientContact: true,
        disclosureScope: true, unresolvedItems: true, supersedesId: true, createdBy: { select: personSelect }, createdAt: true,
        items: { orderBy: [{ position: "asc" }, { id: "asc" }], select: {
          id: true, documentId: true, position: true, documentName: true, documentVersion: true, documentSha256: true, size: true,
        } },
        events: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }], select: {
          id: true, kind: true, occurredAt: true, recordedAt: true, actor: { select: personSelect },
          channel: true, note: true, proofDocumentId: true, correctsEventId: true,
        } },
      } }),
    db.documentContextInput.findMany({ where: { documentId: { in: selected }, document: { matterId } },
      orderBy: [{ documentId: "asc" }, { contextRecordId: "asc" }], select: {
        documentId: true, contextRecordId: true, currentRecordIdAtAdoption: true, adoptedConfirmedAt: true,
        document: { select: { createdAt: true, uploadedBy: { select: personSelect } } },
        contextRecord: { select: { id: true, matterId: true, seriesId: true, version: true, kind: true, visibility: true,
          content: true, reason: true, sourceDescription: true, sourceDocumentId: true, sourceNoteId: true, sourceClientActivityId: true,
          occurredAt: true, createdAt: true, author: { select: personSelect } } },
      } }),
  ]);

  const references = new Map<string, { roles: Set<ReferenceRole>; hashes: Set<string>; versions: Set<number> }>();
  function addReference(documentId: string, role: ReferenceRole, hash?: string | null, version?: number) {
    const entry = references.get(documentId) ?? { roles: new Set<ReferenceRole>(), hashes: new Set<string>(), versions: new Set<number>() };
    entry.roles.add(role);
    if (hash) entry.hashes.add(hash);
    if (version !== undefined) entry.versions.add(version);
    references.set(documentId, entry);
  }
  for (const row of research) {
    row.outputDocuments.forEach(output => addReference(output.documentId, "RESEARCH_OUTPUT"));
    row.sources.forEach(source => addReference(source.documentId, "RESEARCH_SOURCE", source.documentSha256));
    if (row.issueId || row.issueRevisionId || row.issueSnapshot !== null) {
      const issue = readResearchIssueSnapshot(row);
      if (!issue) throw new ActionError("研究所引争点的固定输入缺失或不属于本案，请先核对");
      issue.sourceSnapshot.forEach(source => addReference(source.documentId, "ISSUE_SOURCE", source.documentSha256));
    }
  }
  for (const row of reviews) {
    const fixedHash = (position: Prisma.JsonValue | null) => {
      if (position === null) return null;
      const parsed = reviewPositionSchema.safeParse(position);
      if (!parsed.success) throw new ActionError("人工复核的固定原文位置不完整，请先核对原记录");
      return parsed.data.documentSha256;
    };
    addReference(row.documentId, "REVIEW_DOCUMENT", fixedHash(row.position));
    if (row.basisDocumentId) addReference(row.basisDocumentId, "REVIEW_BASIS", fixedHash(row.basisPosition));
    for (const event of row.events) if (event.revisionDocumentId) addReference(event.revisionDocumentId, "REVIEW_REVISION", fixedHash(event.revisionPosition));
  }
  for (const row of deliveries) {
    row.items.forEach(item => addReference(item.documentId, "DELIVERY_ITEM", item.documentSha256, item.documentVersion));
    for (const event of row.events) if (event.proofDocumentId) addReference(event.proofDocumentId, "DELIVERY_PROOF");
  }
  for (const row of contextInputs) {
    addReference(row.documentId, "CONTEXT_OUTPUT");
    if (row.contextRecord.sourceDocumentId) addReference(row.contextRecord.sourceDocumentId, "CONTEXT_SOURCE");
  }

  const documents = await db.document.findMany({ where: { id: { in: [...references.keys()] } }, select: documentSelect });
  const byId = new Map(documents.map(document => [document.id, document]));
  const documentReferences: DocumentReference[] = [];
  for (const [documentId, expected] of [...references.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const document = byId.get(documentId);
    if (!document || document.deletedAt || document.matterId !== matterId) throw new ActionError("专业历史引用的材料不存在、已撤回或不属于本案，请先核对");
    if (!document.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new ActionError("专业历史引用的材料缺少原件标识，请先回材料区核对");
    if ([...expected.hashes].some(hash => hash !== document.sha256) || [...expected.versions].some(version => version !== document.version)) {
      throw new ActionError("专业历史中的具体材料版本已变化，不能用当前材料补造历史");
    }
    documentReferences.push({ documentId, documentName: document.name, documentVersion: document.version,
      documentSha256: document.sha256, roles: [...expected.roles].sort() });
  }

  return {
    matterId, selectedDocumentIds: selected, documentReferences,
    documentContextInputs: contextInputs.map(({ document, contextRecord, adoptedConfirmedAt, ...input }) => ({
      ...input, adoptedConfirmedAt: adoptedConfirmedAt?.toISOString() ?? null,
      adoptedAt: document.createdAt.toISOString(), adoptedBy: document.uploadedBy,
      record: { ...contextRecord, occurredAt: contextRecord.occurredAt.toISOString(), createdAt: contextRecord.createdAt.toISOString() },
    })),
    research: research.map(({ createdAt, researchedAt, checkedAt, sources, outputDocuments, issue, ...row }) => {
      // The current relation serves authorization only; the archived input is issueSnapshot.
      void issue;
      return {
        ...row, createdAt: createdAt.toISOString(), researchedAt: researchedAt.toISOString(), checkedAt: checkedAt?.toISOString() ?? null,
        sources: sources.map(({ createdAt, ...source }) => ({ ...source, createdAt: createdAt.toISOString() })),
        outputDocuments: outputDocuments.map(({ createdAt, ...output }) => ({ ...output, createdAt: createdAt.toISOString() })),
      };
    }),
    reviews: reviews.map(({ createdAt, events, ...row }) => ({ ...row, createdAt: createdAt.toISOString(),
      events: events.map(({ createdAt, ...event }) => ({ ...event, createdAt: createdAt.toISOString() })),
    })),
    deliveries: deliveries.map(({ createdAt, events, ...row }) => ({ ...row, createdAt: createdAt.toISOString(),
      events: events.map(({ occurredAt, recordedAt, ...event }) => ({ ...event,
        occurredAt: occurredAt.toISOString(), recordedAt: recordedAt.toISOString(),
      })),
    })),
  };
}

export type ArchiveProfessionalHistory = Awaited<ReturnType<typeof buildArchiveProfessionalHistory>>;

/** The caller separately checks complete-package/archive/finance authority. No history bodies are refreshed here. */
export async function assertArchiveProfessionalHistoryAccess(db: Prisma.TransactionClient, userId: string, frozen: ArchiveProfessionalHistory) {
  if (!frozen || !Array.isArray(frozen.documentReferences) || !Array.isArray(frozen.selectedDocumentIds)) {
    throw new ActionError("归档专业历史快照缺失，请核对原归档记录");
  }
  const references = frozen.documentReferences;
  const documents = await db.document.findMany({ where: { id: { in: references.map(reference => reference.documentId) } }, select: documentSelect });
  const byId = new Map(documents.map(document => [document.id, document]));
  for (const reference of references) {
    const current = byId.get(reference.documentId);
    if (!current || current.deletedAt || current.matterId !== frozen.matterId) throw new ActionError("归档专业历史引用的材料已撤回、缺失或不属于本案，无法导出完整案卷");
    if (current.version !== reference.documentVersion || current.sha256 !== reference.documentSha256) {
      throw new ActionError("归档专业历史引用的具体版本已变化，无法导出完整案卷");
    }
    await assertDocumentDerivationAccess(userId, current.id, { purpose: "EXPORT", db });
  }
}
