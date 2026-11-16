"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { assertCanHandleMatter } from "@/lib/permissions";
import { assertDocumentWritable } from "@/lib/archive/guard";
import { canReadDocument } from "@/lib/approvals/documents";
import { revalidateMatter } from "@/server/matters/route";
import { enqueueMaterialProcessing, readMaterialProcessingStatuses, readMaterialSource, readMaterialSources,
  type MaterialProcessingStatusItem, type MaterialSourceResult, type MaterialSourceListResult } from "./material-processing";

const id = z.string().min(1).max(512);
const selection = z.strictObject({ matterId: id, documentIds: z.array(id).max(500) });

export async function getMaterialProcessingStatuses(input: { matterId: string; documentIds: string[] }): Promise<MaterialProcessingStatusItem[]> {
  const user = (await requireSession("documents.read")).user;
  return readMaterialProcessingStatuses(user.id, selection.parse(input));
}

export async function retryMaterialProcessing(input: { documentId: string; expectedGeneration: number }): Promise<{ runId: string; generation: number }> {
  const user = (await requireSession("documents.write")).user;
  const value = z.strictObject({ documentId: id, expectedGeneration: z.number().int().min(0) }).parse(input);
  const doc = await prisma.document.findUnique({ where: { id: value.documentId } });
  if (!doc || doc.deletedAt || !doc.matterId || !await canReadDocument(user.id, doc)) throw new ActionError("材料不存在或无权处理");
  await assertCanHandleMatter(user, doc.matterId);
  await assertDocumentWritable(doc.matterId, { kind: "modify", allowPrincipal: true });
  const result = await prisma.$transaction(tx => enqueueMaterialProcessing(tx, { ...value, requestedById: user.id }));
  await revalidateMatter(doc.matterId);
  return result;
}

export async function getMaterialSource(input: { documentId: string; runId: string; anchorId: string }): Promise<MaterialSourceResult> {
  const user = (await requireSession("documents.read")).user;
  return readMaterialSource(user.id, z.strictObject({ documentId: id, runId: id, anchorId: id }).parse(input));
}

export async function listMaterialSources(input: { matterId: string; documentIds: string[]; offset?: number; limit?: number }): Promise<MaterialSourceListResult> {
  const user = (await requireSession("documents.read")).user;
  const value = selection.extend({ offset: z.number().int().min(0).max(100_000).optional(), limit: z.number().int().min(1).max(100).optional() }).parse(input);
  return readMaterialSources(user.id, value);
}
