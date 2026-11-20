import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { draftExtension } from "../desktop/working-format";

function isBusinessTag(value: string) {
  const label = value.normalize("NFKC").trim();
  return label !== "AI审查" && !label.startsWith("阶段:");
}

export const materialTagSchema = z.string().trim().min(1).max(100)
  .refine(isBusinessTag, "标签由系统使用，请换一个业务标签");

export const materialTagsSchema = z.array(materialTagSchema).max(50)
  .transform(values => [...new Set(values)].sort());

export const materialCatalogSelect = {
  id: true, familyId: true, name: true, version: true, isLatest: true, mimeType: true, status: true, folderId: true,
  category: true, sourceOrigin: true, sourceParty: true, procedureId: true, stageId: true, tags: true,
} satisfies Prisma.DocumentSelect;

type CatalogFields = Prisma.DocumentGetPayload<{ select: typeof materialCatalogSelect }>;

export type MaterialCatalogEntry = CatalogFields & { editable: boolean };

/** Project metadata only after the caller has authorized this exact version. */
export function materialCatalogEntry({
  id, familyId, name, version, isLatest, mimeType, status, folderId, category,
  sourceOrigin, sourceParty, procedureId, stageId, tags,
}: CatalogFields): MaterialCatalogEntry {
  return {
    id, familyId, name, version, isLatest, mimeType, status, folderId, category,
    sourceOrigin, sourceParty, procedureId, stageId, tags: tags.filter(isBusinessTag),
    editable: isLatest && !tags.includes("AI审查") && Boolean(draftExtension({ status, sourceOrigin, mimeType })),
  };
}
