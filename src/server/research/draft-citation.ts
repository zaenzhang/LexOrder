import { ActionError } from "@/lib/action-error";
import { draftExtension } from "@/lib/desktop/working-format";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer, encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { listDraftParagraphs, writeDraftParagraph } from "@/server/documents/docx-paragraphs";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { ingestMaterial, resumeMaterialIngest } from "@/server/documents/material-ingest";
import { assertContextInputSelections } from "@/server/matters/context-inputs";
import type { ContextActor } from "@/server/matters/context-service";
import { paragraphCitationSchema, saveParagraphCitationSchema, type ParagraphCitation } from "./contracts";
import { readCitationConclusion } from "./service";

const officeMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const citationDraftFilter = {
  isLatest: true, status: "DRAFT", sourceOrigin: "TEAM_PRODUCED", mimeType: officeMime,
} as const;

async function prepareCitation(actor: ContextActor, matterId: string, documentId: string, researchId: string) {
  const { doc, research, contextInputs } = await prisma.$transaction(async tx => {
    const research = await readCitationConclusion(tx, actor, matterId, researchId);
    const doc = await tx.document.findFirst({
      where: { id: documentId, matterId, deletedAt: null, ...citationDraftFilter },
      include: { contextInputs: { orderBy: { contextRecordId: "asc" }, select: {
        contextRecordId: true, currentRecordIdAtAdoption: true, adoptedConfirmedAt: true,
      } } },
    });
    if (!doc || draftExtension(doc) !== ".docx") throw new ActionError("请选择本案当前的 DOCX 工作稿");
    await assertDocumentDerivationAccess(actor.id, doc.id, { purpose: "SUBMIT", db: tx });
    const contextInputs = doc.contextInputs.map(row => ({
      recordId: row.contextRecordId,
      expectedCurrentRecordId: row.currentRecordIdAtAdoption,
      expectedConfirmedAt: row.adoptedConfirmedAt?.toISOString() ?? null,
    }));
    await assertContextInputSelections(tx, actor.id, matterId, contextInputs);
    return { doc, research, contextInputs };
  });
  return { doc, research, contextInputs };
}

async function original(doc: Awaited<ReturnType<typeof prepareCitation>>["doc"]) {
  try {
    const bytes = await storage.readFile(doc.path);
    return doc.encrypted ? decryptBuffer(bytes, doc.iv!, doc.authTag!) : bytes;
  } catch {
    throw new ActionError("无法打开工作稿原件，请检查材料版本后重试");
  }
}

export async function readDraftCitation(actor: ContextActor, matterId: string, documentId: string, researchId: string) {
  const { doc, research } = await prepareCitation(actor, matterId, documentId, researchId);
  return { document: { id: doc.id, name: doc.name, version: doc.version },
    research, paragraphs: await listDraftParagraphs(await original(doc)) };
}

export async function saveDraftCitation(actor: ContextActor, input: unknown) {
  const { matterId, documentId, requestKey, ...citation } = saveParagraphCitationSchema.parse(input);
  const existing = await prisma.materialIngestIntent.findUnique({
    where: { id: requestKey }, select: { requestedById: true, matterId: true, priorDocumentId: true, documentId: true, metadata: true },
  });
  if (existing) {
    const metadata = existing.metadata as { paragraphCitation?: unknown };
    const reserved = paragraphCitationSchema.safeParse(metadata.paragraphCitation);
    if (existing.requestedById !== actor.id || existing.matterId !== matterId || existing.priorDocumentId !== documentId
      || !reserved.success || Object.keys(citation).some(key => {
        const field = key as keyof ParagraphCitation;
        return citation[field] !== reserved.data[field];
      })) throw new ActionError("本次保存标识已用于其他引用，请重新预览");
    if (existing.documentId) return resumeMaterialIngest(requestKey, actor.id);
  }
  const { doc, research, contextInputs } = await prepareCitation(actor, matterId, documentId, citation.researchRevisionId);
  if (doc.version !== citation.expectedVersion) throw new ActionError("目标文书版本已变化，请重新预览");
  const bytes = await writeDraftParagraph(await original(doc), citation.position, citation.mode, research.conclusion);
  const encrypted = doc.encrypted ? encryptBuffer(bytes) : null;
  return ingestMaterial({ userId: actor.id, priorDocumentId: doc.id, requestKey, paragraphCitation: citation, contextInputs,
    bytes: encrypted?.ciphertext ?? bytes,
    document: { matterId, intakeId: doc.intakeId, procedureId: doc.procedureId, stageId: doc.stageId,
      folderId: doc.folderId, name: doc.name, category: doc.category, sourceParty: doc.sourceParty, sourceOrigin: doc.sourceOrigin,
      mimeType: officeMime, size: bytes.length, sha256: sha256(bytes), encrypted: doc.encrypted,
      algorithm: encrypted?.algorithm, iv: encrypted?.iv.toString("base64"), authTag: encrypted?.authTag.toString("base64"),
      tags: doc.tags, archiveChecklistItemId: doc.archiveChecklistItemId, uploadedById: actor.id,
    },
  });
}
