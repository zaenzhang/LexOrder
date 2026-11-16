import { z } from "zod";

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

export const templatePrepareSchema = z.object({
  matterId: z.string().cuid(),
  templateId: z.string().cuid(),
  selection: templateSelectionSchema.optional(),
});

/** Values are used only for this rendered version and its immutable input snapshot. */
export const templateRenderSchema = z.object({
  requestKey: z.string().uuid(),
  matterId: z.string().cuid(),
  templateId: z.string().cuid(),
  templateUpdatedAt: z.string().datetime(),
  selection: templateSelectionSchema,
  folderId: z.string().cuid().nullable(),
  expectedValues: z.record(z.string().max(100), z.string().max(20000)),
  overrides: z.record(z.string().max(100), z.string().max(2000)),
  reviewed: z.literal(true, { error: "请先核对本次文书字段" }),
});
