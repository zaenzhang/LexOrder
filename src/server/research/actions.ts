"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { revalidateMatter } from "@/server/matters/route";
import { checkResearch, listResearch, previewResearchSource, readResearch, readResearchHistory, readResearchOptions, readResearchSource, saveResearch } from "./service";
import { createResearchDraft } from "./draft";
import { researchSourceInputSchema, type ResearchCheckInput, type ResearchDraftInput, type ResearchSaveInput, type ResearchSourceInput } from "./contracts";

const id = z.string().cuid("事项或研究标识无效");
export async function getResearchList(matterId: string, beforeId?: string) {
  const { user } = await requireSession("matters.read");
  return listResearch(prisma, user, id.parse(matterId), id.optional().parse(beforeId));
}
export async function getResearch(matterId: string, researchId: string) {
  const { user } = await requireSession("matters.read");
  return readResearch(prisma, user, id.parse(matterId), id.parse(researchId));
}
export async function getResearchHistory(matterId: string, researchId: string, beforeVersion?: number) {
  const { user } = await requireSession("matters.read");
  return readResearchHistory(prisma, user, id.parse(matterId), id.parse(researchId), z.number().int().positive().optional().parse(beforeVersion));
}
export async function getResearchOptions(matterId: string) {
  const { user } = await requireSession("matters.write");
  return readResearchOptions(prisma, user, id.parse(matterId));
}
export async function getResearchSource(matterId: string, researchId: string, sourceId: string) {
  const { user } = await requireSession("matters.read");
  return readResearchSource(prisma, user, id.parse(matterId), id.parse(researchId), id.parse(sourceId));
}
export async function getResearchSourcePreview(matterId: string, source: ResearchSourceInput) {
  const { user } = await requireSession("matters.write");
  return previewResearchSource(prisma, user, id.parse(matterId), researchSourceInputSchema.parse(source));
}
export async function saveResearchRevision(input: ResearchSaveInput) {
  const { user } = await requireSession("matters.write");
  const result = await saveResearch(prisma, user, input);
  await revalidateMatter(input.matterId);
  return result;
}
export async function checkResearchRevision(input: ResearchCheckInput) {
  const { user } = await requireSession("matters.write");
  const result = await checkResearch(prisma, user, input);
  await revalidateMatter(input.matterId);
  return result;
}
export async function formResearchDraft(input: ResearchDraftInput) {
  const { user } = await requireSession("documents.write");
  const result = await createResearchDraft(prisma, user, input);
  await revalidateMatter(input.matterId);
  return result;
}
