import { z } from "zod";

export const contextKindLabels = {
  GOAL: "客户目标", CONSTRAINT: "约束", INSTRUCTION: "客户指示", OPTION: "备选方案", DECISION: "决定"
} as const;
export const contextVisibilityLabels = { MATTER: "事项可见人员", FINANCE: "具备事项财务权限的人员" } as const;
export type ContextKind = keyof typeof contextKindLabels;
export type ContextVisibility = keyof typeof contextVisibilityLabels;
export type ContextSourceType = "DOCUMENT" | "NOTE" | "CLIENT_ACTIVITY";
export const contextCursorSchema = z.string().min(1, "分页位置无效，请重新读取").max(1200, "分页位置无效，请重新读取");
export const contextSourcePageSchema = z.object({
  type: z.enum(["DOCUMENT", "NOTE", "CLIENT_ACTIVITY"]), cursor: contextCursorSchema,
}).strict();
export type ContextSourcePageInput = z.input<typeof contextSourcePageSchema>;

const optionalId = z.string().cuid("来源标识无效").nullable().optional();
const instant = z.string().datetime({ offset: true, message: "请输入有效日期和时间" })
  .refine(value => new Date(value).getUTCFullYear() >= 1900 && new Date(value).getUTCFullYear() <= 2200, "日期超出支持范围");

export const contextRecordSchema = z.object({
  matterId: z.string().cuid("事项标识无效"),
  requestKey: z.string().uuid("提交标识无效，请重新打开表单"),
  supersedesId: optionalId,
  kind: z.enum(["GOAL", "CONSTRAINT", "INSTRUCTION", "OPTION", "DECISION"]),
  visibility: z.enum(["MATTER", "FINANCE"]),
  content: z.string().trim().min(1, "请填写记录内容").max(8000, "记录最多 8000 字"),
  occurredAt: instant,
  reason: z.string().trim().max(3000, "理由最多 3000 字").nullable().optional(),
  sourceDescription: z.string().trim().min(1, "请说明指示人、沟通方式或其他依据").max(1200, "来源说明最多 1200 字"),
  sourceNoteId: optionalId,
  sourceClientActivityId: optionalId,
  sourceDocumentId: optionalId
}).strict().refine(value => [value.sourceNoteId, value.sourceClientActivityId, value.sourceDocumentId].filter(Boolean).length <= 1,
  "每条记录选择一个主要来源；其他依据可在来源说明中记录");

export const contextConfirmSchema = z.object({
  matterId: z.string().cuid("事项标识无效"),
  id: z.string().cuid("记录标识无效"),
  expectedVersion: z.number().int().positive(),
  acknowledged: z.literal(true, { message: "请先核对内容及来源" })
}).strict();

export type ContextRecordInput = z.input<typeof contextRecordSchema>;
export type ContextConfirmInput = z.input<typeof contextConfirmSchema>;

export type ContextSourceChoice = { type: ContextSourceType; id: string; label: string };
export type ContextSourceView = {
  type: ContextSourceType;
  id: string | null;
  label: string | null;
  available: boolean;
};
export type ContextRecordView = {
  id: string;
  seriesId: string;
  version: number;
  kind: ContextKind;
  visibility: ContextVisibility;
  content: string | null;
  reason: string | null;
  sourceDescription: string | null;
  source: ContextSourceView | null;
  readable: boolean;
  occurredAt: string;
  createdAt: string;
  authorName: string;
  confirmationStatus: "PENDING" | "CONFIRMED";
  confirmedByName: string | null;
  confirmedAt: string | null;
  canRevise: boolean;
  canConfirm: boolean;
};
export type MatterContextView = {
  canWrite: boolean;
  canReadFinance: boolean;
  canConfirm: boolean;
  records: ContextRecordView[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type ContextHistoryView = { records: ContextRecordView[]; nextBeforeVersion: number | null };
export type ContextSourceContent = { type: ContextSourceType; label: string; content: string | null; href: string | null };
export type ContextSourceOptions = { choices: ContextSourceChoice[]; nextCursors: Record<ContextSourceType, string | null> };

export type MatterBrief = {
  matterId: string;
  context: MatterContextView;
  serviceScope: string | null;
  deliverables: string | null;
  nextActions: { id: string; title: string; dueAt: string | null; assigneeName: string | null; accepted: boolean | null }[];
  deadlines: { id: string; title: string; dueAt: string; confirmationStatus: string; assigneeName: string | null }[];
  clientFollowUps: { id: string; clientId: string; clientName: string; title: string; dueAt: string; assigneeName: string }[];
  recentClientActivities: { id: string; clientId: string; clientName: string; channel: string; occurredAt: string }[];
  businessTimeZone: "Asia/Shanghai";
  coverage: { tasksTruncated: boolean; deadlinesTruncated: boolean; clientFollowUpsTruncated: boolean; clientActivitiesTruncated: boolean };
};
