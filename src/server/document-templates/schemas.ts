import { z } from "zod";
import { contextInputSelectionsSchema } from "@/lib/matters/context-inputs";

export const templateListFilterSchema = z.object({
  category: z
    .enum([
      "INTAKE",
      "RETAINER",
      "LITIGATION",
      "EXECUTION",
      "HEARING",
      "WORK_PRODUCT",
      "ARCHIVE",
      "CLOSING",
      "BLANK"
    ])
    .optional(),
  matterCategory: z
    .enum([
      "CIVIL_COMMERCIAL",
      "CRIMINAL",
      "ADMINISTRATIVE",
      "NON_LITIGATION",
      "LEGAL_COUNSEL",
      "SPECIAL_PROJECT"
    ])
    .optional(),
  onlyEnabled: z.boolean().default(true)
});

export const templateToggleSchema = z.object({
  id: z.string().cuid(),
  enabled: z.boolean()
});

export const templateSelectionSchema = z.object({
  clientId: z.string().cuid().nullable(),
  opposingPartyId: z.string().cuid().nullable(),
  thirdPartyId: z.string().cuid().nullable(),
  procedureId: z.string().cuid().nullable(),
}).strict();

const subjectIds = z.array(z.string().max(100));
export const templateSubjectsSchema = z.object({
  client: subjectIds.optional(), opposing: subjectIds.optional(), third: subjectIds.optional(), proceeding: subjectIds.optional(),
  plaintiffs: subjectIds.optional(), defendants: subjectIds.optional(), thirds: subjectIds.optional(),
}).strict();

export const templatePrepareSchema = z.object({
  matterId: z.string().cuid(),
  templateId: z.string().cuid(),
  selection: templateSelectionSchema.optional(),
  overrides: z.record(z.string().max(200), z.string().max(2000)).optional().default({}),
  expectedSubjects: templateSubjectsSchema.optional(),
});

/** Values are used only for this rendered version and its immutable input snapshot. */
export const templateRenderSchema = z.object({
  contextInputs: contextInputSelectionsSchema.optional().default([]),
  requestKey: z.string().uuid(),
  matterId: z.string().cuid(),
  templateId: z.string().cuid(),
  templateUpdatedAt: z.string().datetime(),
  selection: templateSelectionSchema,
  folderId: z.string().cuid().nullable(),
  expectedValues: z.record(z.string().max(200), z.string().max(20000)),
  expectedSubjects: templateSubjectsSchema,
  overrides: z.record(z.string().max(200), z.string().max(2000)),
  reviewed: z.literal(true, { error: "请先核对本次文书字段" }),
});
