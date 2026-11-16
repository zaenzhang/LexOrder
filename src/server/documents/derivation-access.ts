import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { prisma } from "@/lib/prisma";
import { documentReadGrant, type DocumentReadGrant, type DocumentReadSubject } from "@/lib/approvals/documents";
import { readSourceSnapshot } from "@/server/evidence/source-links";
import { resolveReviewReportSource } from "@/server/ai/review-report-source";

/** Only the explicit research inputs of this concrete output are inspected. */
export async function documentDerivationReadable(
  userId: string,
  target: Pick<DocumentReadSubject, "id" | "matterId">,
  grant: DocumentReadGrant,
  db: Prisma.TransactionClient = prisma,
  purpose: "READ" | "EXPORT" | "SUBMIT" = "READ",
  ancestors: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (ancestors.has(target.id)) return false;
  const visited = new Set(ancestors).add(target.id);
  const report = await resolveReviewReportSource(target.id, db);
  if (report.kind === "UNAVAILABLE" || (report.kind === "LEGACY" && purpose !== "READ")) return false;
  if (report.kind === "SOURCE") {
    const sourceGrant = await documentReadGrant(userId, report.document, db, purpose);
    if (!sourceGrant || !await documentDerivationReadable(userId, report.document, sourceGrant, db, purpose, visited)) return false;
  }
  const inputs = await db.documentResearchSource.findMany({
    where: { documentId: target.id },
    include: { researchRevision: { include: {
      sources: true,
      issueRevision: { select: { sourceSnapshot: true, evidenceItem: { select: { matterId: true } } } },
    } } },
  });
  if (!inputs.length) return true;

  const references: { documentId: string; documentSha256: string | null; legacy?: boolean }[] = [];
  for (const input of inputs) {
    const research = input.researchRevision;
    if (!target.matterId || research.matterId !== target.matterId) return false;
    references.push(...research.sources);
    if (research.issueRevision) {
      if (research.issueRevision.evidenceItem.matterId !== target.matterId) return false;
      const issueSources = readSourceSnapshot(research.issueRevision.sourceSnapshot);
      if (!issueSources) return false;
      references.push(...issueSources);
    }
  }
  const documents = await db.document.findMany({ where: { id: { in: [...new Set(references.map(row => row.documentId))] } },
    select: { id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true, sha256: true } });
  const byId = new Map(documents.map(row => [row.id, row]));
  for (const reference of references) {
    const source = byId.get(reference.documentId);
    // A specific approval grants the submitted body, never a withdrawn source.
    if (!source || source.deletedAt || source.matterId !== target.matterId || source.id === target.id
      || (!reference.legacy && source.sha256 !== reference.documentSha256)) return false;
  }
  if (purpose === "READ" && grant === "DOCUMENT_APPROVAL") return true;
  for (const source of documents) {
    const sourceGrant = await documentReadGrant(userId, source, db, purpose);
    if (!sourceGrant || !await documentDerivationReadable(userId, source, sourceGrant, db, purpose, visited)) return false;
  }
  return true;
}

/** Call inside the owning mutation/export transaction; attachment grants never authorize disclosure. */
export async function assertDocumentDerivationAccess(
  userId: string,
  documentId: string,
  options: { purpose: "READ" | "EXPORT" | "SUBMIT"; db?: Prisma.TransactionClient },
) {
  const db = options.db ?? prisma;
  const document = await db.document.findUnique({ where: { id: documentId },
    select: { id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true } });
  if (!document || document.deletedAt) throw new ActionError("文书不存在或已撤回");
  const grant = await documentReadGrant(userId, document, db, options.purpose);
  if (!grant || !await documentDerivationReadable(userId, document, grant, db, options.purpose)) {
    throw new ActionError("文书的来源已撤回、变更或无权读取，请核对具体版本与来源");
  }
}
