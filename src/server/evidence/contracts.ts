import { z } from "zod";
import { observationInputSchema, type EvidenceObservationView } from "@/lib/evidence/observation-contract";
import type { MaterialPresentation } from "@/lib/documents/presentation";
import { sourceLocationSchema } from "@/lib/workbench/contracts";
import type { ChronologyAssessment, ChronologyStage } from "@/lib/evidence/chronology-assessment";
import { type EvidenceEventDate } from "@/lib/evidence/event-date";

import { evidenceKindSchema, revisionInputSchema } from "@/lib/evidence/item-input";

export const sourceRelationSchema = z.enum(["SUPPORTS", "REBUTS", "CONTEXT"]);
export const sourceRelationLabel = { SUPPORTS: "支持", REBUTS: "反驳", CONTEXT: "背景" } as const;
export const sourceInputSchema = z.object({
  documentId: z.string().cuid(),
  relation: sourceRelationSchema,
  page: z.number().int().positive().max(10000).nullable().optional(),
  parseRunId: z.string().cuid().optional(),
  anchorId: z.string().min(1).max(512).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.parseRunId) !== Boolean(value.anchorId)) context.addIssue({ code: "custom", message: "请选择完整的材料原文位置" });
  if (value.parseRunId && value.page != null) context.addIssue({ code: "custom", message: "解析位置不能同时手填页码" });
});

export const recordObservationSchema = revisionInputSchema.extend({
  sourceId: z.string().cuid(),
  requestKey: z.uuid().transform(key => key.toLowerCase()),
  supersedesId: z.string().cuid().optional(),
  observation: observationInputSchema,
});

// Snapshots contain references, never a newly inferred hash or source text.
export const sourceReferenceSchema = z.object({
  id: z.string(), documentId: z.string(), documentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  relation: sourceRelationSchema.nullable(), location: sourceLocationSchema,
  parseRunId: z.string().nullable(), anchorId: z.string().nullable(), legacy: z.boolean(),
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type EvidenceSourceView = {
  id: string; relation: z.infer<typeof sourceRelationSchema> | null; legacy: boolean;
  status: "AVAILABLE" | "UNAVAILABLE"; documentId: string | null; documentName: string | null;
  chronologyStage?: ChronologyStage | null;
  documentVersion: number | null; locationLabel: string | null; hasAnchor: boolean;
};
export type EvidenceItemView = {
  id: string; matterId: string; title: string; content: string; kind: z.infer<typeof evidenceKindSchema>;
  sourceDocumentId: string | null; sourceDocumentName: string | null; sourcePage: number | null;
  revision: number; updatedAt: Date; confirmedAt: Date | null; confirmedByName: string | null;
  createdById: string; createdByName: string | null; createdAt: Date;
  sources: EvidenceSourceView[]; restricted: boolean; canEdit: boolean;
  chronologyAssessment: ChronologyAssessment | null;
  eventDate: EvidenceEventDate | null;
  observations: EvidenceObservationView[];
};
export type EvidenceDocumentOption = { id: string; name: string; version: number; pageCount: number | null; isPdf: boolean; hasIdentity: boolean };
export type EvidenceRevisionView = {
  revision: number; title: string; content: string; kind: z.infer<typeof evidenceKindSchema>;
  createdAt: Date; editedByName: string | null; confirmedAt: Date | null; confirmedByName: string | null;
  sources: EvidenceSourceView[]; restricted: boolean;
  chronologyAssessment: ChronologyAssessment | null;
  eventDate: EvidenceEventDate | null;
  observations: EvidenceObservationView[];
};
export type EvidenceSourceResult = { status: "UNAVAILABLE" } | ({
  status: "AVAILABLE"; documentName: string; documentVersion: number; locationLabel: string;
  text: string | null; legacy: boolean; historicalParse: boolean;
} & MaterialPresentation);
