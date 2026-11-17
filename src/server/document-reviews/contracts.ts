import { z } from "zod";
import { sourceLocationSchema } from "@/lib/workbench/contracts";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";

export const reviewIssueStateLabel = { OPEN: "未处理", WAITING_CHECK: "待复核", RESOLVED: "已处理" } as const;
export const reviewDispositionLabel = { ACCEPT: "接受", PARTIAL: "部分接受", REJECT: "不接受" } as const;

// The caller chooses a real page or a published anchor. Only the server supplies
// the saved hash and location; the document identity comes from the existing FK.
export const reviewPositionInputSchema = z.strictObject({
  page: z.number().int().positive().max(10000).optional(),
  parseRunId: z.string().cuid().optional(), anchorId: z.string().min(1).max(512).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.parseRunId) !== Boolean(value.anchorId) || (value.page !== undefined) === Boolean(value.parseRunId)) {
    context.addIssue({ code: "custom", message: "请选择已知 PDF 页码或完整原文位置" });
  }
});
export type ReviewPositionInput = z.infer<typeof reviewPositionInputSchema>;
export const reviewPositionSchema = z.strictObject({
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/), location: sourceLocationSchema,
  parseRunId: z.string().cuid().nullable(), anchorId: z.string().min(1).max(512).nullable(),
}).superRefine((value, context) => {
  if (Boolean(value.parseRunId) !== Boolean(value.anchorId) || value.location.kind === "UNLOCATED" ||
    (!value.parseRunId && value.location.kind !== "PAGE")) context.addIssue({ code: "custom", message: "固定原文位置不完整" });
});
export type ReviewPosition = z.infer<typeof reviewPositionSchema>;
export type ReviewPositionView = { status: "AVAILABLE"; label: string } | { status: "UNAVAILABLE" };

const positionSlot = z.enum(["SUBJECT", "BASIS", "REVISION"]);
const draftPositionTarget = z.strictObject({
  documentId: z.string().cuid(), slot: positionSlot, sourceDocumentId: z.string().cuid().optional(),
});
export const reviewPositionOptionsSchema = draftPositionTarget.extend({ offset: z.number().int().min(0).max(100_000).optional() });
export const reviewPositionPreviewSchema = draftPositionTarget.extend({ position: reviewPositionInputSchema });
export const savedReviewPositionSchema = z.strictObject({
  issueId: z.string().cuid(), slot: positionSlot, eventId: z.string().cuid().optional(),
}).superRefine((value, context) => {
  if ((value.slot === "REVISION") !== Boolean(value.eventId)) context.addIssue({ code: "custom", message: "请选择确切的复核记录位置" });
});
export const previousReviewIssueSchema = z.strictObject({ documentId: z.string().cuid(), issueId: z.string().cuid() });

export const createReviewIssueSchema = z.object({
  requestId: z.string().uuid(), documentId: z.string().cuid(),
  title: z.string().trim().min(1, "请填写复核问题").max(2000),
  location: z.string().trim().max(500).nullable(),
  basis: z.string().trim().min(1, "请说明问题依据").max(6000),
  basisDocumentId: z.string().cuid().nullable(),
  position: reviewPositionInputSchema.nullish(), basisPosition: reviewPositionInputSchema.nullish(),
}).strict().superRefine((value, context) => {
  if (value.basisPosition && !value.basisDocumentId) context.addIssue({ code: "custom", path: ["basisDocumentId"], message: "选择依据位置前请关联实际材料" });
});
export const respondReviewIssueSchema = z.object({
  requestId: z.string().uuid(), issueId: z.string().cuid(), expectedVersion: z.number().int().positive(),
  disposition: z.enum(["ACCEPT", "PARTIAL", "REJECT"]),
  note: z.string().trim().min(1, "请说明处理理由").max(6000),
  revisionDocumentId: z.string().cuid().nullable(), revisionLocation: z.string().trim().max(500).nullable(),
  revisionPosition: reviewPositionInputSchema.nullish(),
}).strict().superRefine((input, context) => {
  if ((input.revisionLocation || input.revisionPosition) && !input.revisionDocumentId) context.addIssue({ code: "custom", path: ["revisionDocumentId"], message: "填写修订位置前请选择实际修订版本" });
  if (input.revisionDocumentId && !input.revisionLocation && !input.revisionPosition) context.addIssue({ code: "custom", path: ["revisionLocation"], message: "请填写实际修订位置或选择固定原文位置" });
});
export const checkReviewIssueSchema = z.object({
  requestId: z.string().uuid(), issueId: z.string().cuid(), expectedVersion: z.number().int().positive(),
  resolved: z.boolean(), note: z.string().trim().min(1, "请填写复核结论").max(6000),
}).strict();

export type ReviewDocumentOption = EvidenceDocumentOption;
export const reviewSourcePageSchema = z.object({
  documentId: z.string().cuid(), query: z.string().trim().max(200).default(""),
  cursor: z.string().min(1).max(1200).optional(), selectedId: z.string().cuid().optional(),
}).strict();
export type ReviewSourcePage = {
  items: ReviewDocumentOption[]; nextCursor: string | null;
  selected: { id: string; document: ReviewDocumentOption | null } | null;
};
export type ReviewEventView = {
  id: string; version: number; kind: "RESPONSE" | "CHECK";
  disposition: keyof typeof reviewDispositionLabel | null; note: string | null;
  revisionDocument: ReviewDocumentOption | null; revisionUnavailable: boolean; revisionLocation: string | null;
  revisionPosition: ReviewPositionView | null;
  resolved: boolean | null; actorName: string; createdAt: string;
};
export type ReviewIssueView = {
  id: string; version: number; state: keyof typeof reviewIssueStateLabel; title: string; location: string | null;
  position: ReviewPositionView | null; basisPosition: ReviewPositionView | null;
  basis: string | null; basisDocument: ReviewDocumentOption | null; basisUnavailable: boolean;
  authorName: string; createdAt: string; events: ReviewEventView[]; canResolve: boolean;
};
export type DocumentReviewView = {
  document: ReviewDocumentOption; matterId: string | null; canCreate: boolean; canRespond: boolean; canCheck: boolean; canBrowseSources: boolean;
  issues: ReviewIssueView[]; sourceOptions: ReviewDocumentOption[]; revisionOptions: ReviewDocumentOption[];
  sourceNextCursor: string | null; previousIssues: PreviousReviewIssueSummary[];
};
export type PreviousReviewIssueSummary = {
  id: string; document: ReviewDocumentOption; title: string; state: "OPEN" | "WAITING_CHECK"; linkedToCurrent: boolean;
};
export type PreviousReviewIssueView = { document: ReviewDocumentOption; issue: ReviewIssueView };
