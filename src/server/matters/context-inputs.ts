import type { MatterContextRecord, Prisma, PrismaClient } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import type { DocumentReadGrant, DocumentReadPurpose } from "@/lib/approvals/documents";
import { contextCursorSchema } from "@/lib/matters/context";
import { contextInputSelectionsSchema, type ContextInputChoice, type ContextInputSelection, type ContextInputSummary } from "@/lib/matters/context-inputs";
import { documentDerivationReadable } from "@/server/documents/derivation-access";
import { contextAccess, sourceView, type ContextAccess, type ContextActor } from "./context-service";
import { contextPageBoundary, decodeContextCursor, encodeContextCursor } from "./context-cursor";

type Adoption = { contextRecord: MatterContextRecord; currentRecordIdAtAdoption: string; adoptedConfirmedAt: Date | null };
const stamp = (value: Date | null) => value?.toISOString() ?? null;

async function accessForUser(tx: Prisma.TransactionClient, userId: string, matterId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new ActionError("当前账号不可用");
  return contextAccess(tx, { id: userId, role: user.role }, matterId);
}

async function choiceForRecord(tx: Prisma.TransactionClient, access: ContextAccess, row: MatterContextRecord,
  visitedDocuments: ReadonlySet<string> = new Set(), purpose: DocumentReadPurpose = "READ"): Promise<ContextInputChoice | null> {
  if (row.matterId !== access.matter.id || (row.kind !== "GOAL" && row.kind !== "INSTRUCTION") ||
    (row.visibility === "FINANCE" && !access.canReadFinance)) return null;
  const source = await sourceView(tx, access, row, visitedDocuments, purpose);
  if (source && !source.available) return null;
  const tail = await tx.matterContextRecord.findFirst({ where: { seriesId: row.seriesId, matterId: row.matterId, supersededBy: { is: null } }, select: { id: true } });
  if (!tail) return null;
  return { selection: { recordId: row.id, expectedCurrentRecordId: tail.id, expectedConfirmedAt: stamp(row.confirmedAt) },
    kind: row.kind, version: row.version, content: row.content, sourceDescription: row.sourceDescription, historical: tail.id !== row.id };
}

/** Call under the owning authorization/Matter locks. Successful replay checks rights, not old expectations. */
export async function assertContextInputSelections(tx: Prisma.TransactionClient, userId: string, matterId: string | null,
  input: readonly ContextInputSelection[], checkExpected = true) {
  const selections = contextInputSelectionsSchema.parse(input);
  if (!selections.length) return [];
  if (!matterId) throw new ActionError("目标和指示只能用于同一事项内的成果");
  const access = await accessForUser(tx, userId, matterId);
  const rows = await tx.matterContextRecord.findMany({ where: { id: { in: selections.map(row => row.recordId) }, matterId } });
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const selection of selections) {
    const row = byId.get(selection.recordId);
    const choice = row ? await choiceForRecord(tx, access, row) : null;
    if (!choice) throw new ActionError("采用的目标或客户指示不存在或已无权读取，请重新核对");
    if (checkExpected && (choice.selection.expectedCurrentRecordId !== selection.expectedCurrentRecordId ||
      choice.selection.expectedConfirmedAt !== selection.expectedConfirmedAt)) {
      throw new ActionError("采用的目标或客户指示已有新修订或确认变化，请核对所选版本后再保存");
    }
  }
  return selections.map(row => ({ contextRecordId: row.recordId, currentRecordIdAtAdoption: row.expectedCurrentRecordId,
    adoptedConfirmedAt: row.expectedConfirmedAt ? new Date(row.expectedConfirmedAt) : null }));
}

async function summarize(tx: Prisma.TransactionClient, access: ContextAccess, links: Adoption[],
  visitedDocuments: ReadonlySet<string> = new Set()): Promise<ContextInputSummary> {
  const result: ContextInputSummary = { inputs: [], unavailable: false };
  for (const link of links) {
    const choice = await choiceForRecord(tx, access, link.contextRecord, visitedDocuments);
    if (!choice) { result.unavailable = true; continue; }
    result.inputs.push({ ...choice, historical: link.contextRecord.id !== link.currentRecordIdAtAdoption,
      currentRecordIdAtAdoption: link.currentRecordIdAtAdoption, adoptedConfirmedAt: stamp(link.adoptedConfirmedAt),
      changed: choice.selection.expectedCurrentRecordId !== link.currentRecordIdAtAdoption || choice.selection.expectedConfirmedAt !== stamp(link.adoptedConfirmedAt) });
  }
  return result;
}

export async function readOptionContextInputs(tx: Prisma.TransactionClient, access: ContextAccess, optionRecordId: string,
  visitedDocuments: ReadonlySet<string> = new Set()) {
  const links = await tx.optionContextInput.findMany({ where: { optionRecordId }, orderBy: { contextRecordId: "asc" }, include: { contextRecord: true } });
  return summarize(tx, access, links, visitedDocuments);
}

/** A document attachment grant does not grant its original goals/instructions. */
export async function readDocumentContextInputs(tx: Prisma.TransactionClient, userId: string, documentId: string, matterId: string | null): Promise<ContextInputSummary> {
  const links = await tx.documentContextInput.findMany({ where: { documentId }, orderBy: { contextRecordId: "asc" }, include: { contextRecord: true } });
  if (!links.length) return { inputs: [], unavailable: false };
  if (!matterId) return { inputs: [], unavailable: true };
  try { return await summarize(tx, await accessForUser(tx, userId, matterId), links, new Set([documentId])); }
  catch (error) {
    if (error instanceof ActionError) return { inputs: [], unavailable: true };
    throw error;
  }
}

/** Check live source existence even for independent approval-body readers. No source body is returned. */
export async function documentContextInputsReadable(tx: Prisma.TransactionClient, userId: string,
  target: { id: string; matterId: string | null }, grant: DocumentReadGrant, purpose: DocumentReadPurpose,
  visitedDocuments: ReadonlySet<string>): Promise<boolean> {
  const links = await tx.documentContextInput.findMany({ where: { documentId: target.id }, include: { contextRecord: true } });
  if (!links.length) return true;
  if (!target.matterId) return false;
  const matter = await tx.matter.findFirst({ where: { id: target.matterId, deletedAt: null }, select: {
    primaryClientId: true, intake: { select: { clientId: true } }, clientLinks: { select: { clientId: true } },
  } });
  if (!matter) return false;
  const clientIds = [...new Set([matter.primaryClientId, matter.intake?.clientId, ...matter.clientLinks.map(row => row.clientId)].filter((id): id is string => Boolean(id)))];
  for (const { contextRecord: record } of links) {
    if (record.matterId !== target.matterId || (record.kind !== "GOAL" && record.kind !== "INSTRUCTION")) return false;
    if (record.sourceDocumentId) {
      const source = await tx.document.findFirst({ where: { id: record.sourceDocumentId, matterId: target.matterId, deletedAt: null }, select: { id: true, matterId: true } });
      if (!source || visitedDocuments.has(source.id)) return false;
      if (purpose === "READ" && grant === "DOCUMENT_APPROVAL" &&
        !await documentDerivationReadable(userId, source, "DOCUMENT_APPROVAL", tx, purpose, visitedDocuments, true)) return false;
    }
    if (record.sourceNoteId && !await tx.note.count({ where: { id: record.sourceNoteId, matterId: target.matterId, deletedAt: null } })) return false;
    if (record.sourceClientActivityId && !await tx.clientActivity.count({ where: { id: record.sourceClientActivityId,
      client: { id: { in: clientIds }, deletedAt: null } } })) return false;
  }
  if (purpose === "READ" && grant === "DOCUMENT_APPROVAL") return true;
  try {
    const access = await accessForUser(tx, userId, target.matterId);
    for (const link of links) if (!await choiceForRecord(tx, access, link.contextRecord, visitedDocuments, purpose)) return false;
    return true;
  } catch (error) {
    if (error instanceof ActionError) return false;
    throw error;
  }
}

export async function readContextInputOptions(db: PrismaClient, actor: ContextActor, matterId: string, cursor?: string) {
  const position = contextCursorSchema.optional().parse(cursor);
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const point = decodeContextCursor(position, matterId, actor.id, "records");
    const rows = await tx.matterContextRecord.findMany({ where: { matterId, kind: { in: ["GOAL", "INSTRUCTION"] },
      ...(access.canReadFinance ? {} : { visibility: "MATTER" }), supersededBy: { is: null }, ...contextPageBoundary("createdAt", point) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
    const shown = rows.slice(0, 50), last = shown.at(-1);
    const choices: ContextInputChoice[] = [];
    for (const row of shown) { const choice = await choiceForRecord(tx, access, row); if (choice) choices.push(choice); }
    return { choices, nextCursor: rows.length > 50 && last ? encodeContextCursor(matterId, actor.id, "records", { at: last.createdAt.toISOString(), id: last.id }) : null };
  });
}

export async function readContextInputChoice(db: PrismaClient, actor: ContextActor, matterId: string, recordId: string) {
  return db.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const row = await tx.matterContextRecord.findFirst({ where: { id: recordId, matterId } });
    const choice = row ? await choiceForRecord(tx, access, row) : null;
    if (!choice) throw new ActionError("目标或客户指示不存在或已无权读取");
    return choice;
  });
}
