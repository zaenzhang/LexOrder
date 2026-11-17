import { z } from "zod";

export const reviewIssueStateLabel = { OPEN: "未处理", WAITING_CHECK: "待复核", RESOLVED: "已处理" } as const;
export const reviewDispositionLabel = { ACCEPT: "接受", PARTIAL: "部分接受", REJECT: "不接受" } as const;

export const createReviewIssueSchema = z.object({
  requestId: z.string().uuid(), documentId: z.string().cuid(),
  title: z.string().trim().min(1, "请填写复核问题").max(2000),
  location: z.string().trim().max(500).nullable(),
  basis: z.string().trim().min(1, "请说明问题依据").max(6000),
  basisDocumentId: z.string().cuid().nullable(),
}).strict();
export const respondReviewIssueSchema = z.object({
  requestId: z.string().uuid(), issueId: z.string().cuid(), expectedVersion: z.number().int().positive(),
  disposition: z.enum(["ACCEPT", "PARTIAL", "REJECT"]),
  note: z.string().trim().min(1, "请说明处理理由").max(6000),
  revisionDocumentId: z.string().cuid().nullable(), revisionLocation: z.string().trim().max(500).nullable(),
}).strict().superRefine((input, context) => {
  if (input.revisionLocation && !input.revisionDocumentId) context.addIssue({ code: "custom", path: ["revisionDocumentId"], message: "填写修订位置前请选择实际修订版本" });
  if (input.revisionDocumentId && !input.revisionLocation) context.addIssue({ code: "custom", path: ["revisionLocation"], message: "请填写实际修订位置" });
});
export const checkReviewIssueSchema = z.object({
  requestId: z.string().uuid(), issueId: z.string().cuid(), expectedVersion: z.number().int().positive(),
  resolved: z.boolean(), note: z.string().trim().min(1, "请填写复核结论").max(6000),
}).strict();

export type ReviewDocumentOption = { id: string; name: string; version: number };
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
  resolved: boolean | null; actorName: string; createdAt: string;
};
export type ReviewIssueView = {
  id: string; version: number; state: keyof typeof reviewIssueStateLabel; title: string; location: string | null;
  basis: string | null; basisDocument: ReviewDocumentOption | null; basisUnavailable: boolean;
  authorName: string; createdAt: string; events: ReviewEventView[]; canResolve: boolean;
};
export type DocumentReviewView = {
  document: ReviewDocumentOption; canCreate: boolean; canRespond: boolean; canCheck: boolean; canBrowseSources: boolean;
  issues: ReviewIssueView[]; sourceOptions: ReviewDocumentOption[]; revisionOptions: ReviewDocumentOption[];
  sourceNextCursor: string | null;
};
