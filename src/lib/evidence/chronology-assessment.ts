import { z } from "zod";
import { revisionInputSchema } from "./item-input";

export const chronologyCategories = {
  communication: "沟通往来",
  meeting: "会议与会谈",
  agreement: "协议或约定",
  payment: "款项往来",
  performance: "履行",
  notice: "通知与催告",
  decision: "决定与审批",
  procedure: "诉讼程序",
  other: "其他",
} as const;

export const chronologyCategorySchema = z.enum(["communication", "meeting", "agreement", "payment", "performance", "notice", "decision", "procedure", "other"]);
export const chronologyDisputes = { pending: "待定", undisputed: "无争议", disputed: "有争议" } as const;
export const chronologyStages = {
  consultation: "接受咨询", discussion: "谈案", preparation: "庭前", hearing: "庭审时", afterHearing: "庭后", closed: "结案后",
} as const;
export const chronologyStageSchema = z.enum(["consultation", "discussion", "preparation", "hearing", "afterHearing", "closed"]);
export type ChronologyStage = z.infer<typeof chronologyStageSchema>;

const relation = z.strictObject({
  targetId: z.cuid(), sourceId: z.cuid(), label: z.string().trim().min(1).max(80), quote: z.string().min(1).max(300),
});
const nature = z.enum(["occurred", "planned", "estimated"]);
const dispute = z.enum(["pending", "undisputed", "disputed"]);
export const chronologyAssessmentSchema = z.strictObject({
  category: chronologyCategorySchema.optional(),
  dispute: dispute.optional(),
  adverse: z.boolean().optional(),
  nature: nature.optional(),
  dateObservationId: z.cuid().optional(),
  amountObservationId: z.cuid().optional(),
  directions: z.array(relation.extend({ id: z.uuid() })).max(40).optional(),
});

export type ChronologyAssessment = z.infer<typeof chronologyAssessmentSchema>;
export const chronologyChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), value: chronologyCategorySchema.nullable() }),
  z.object({ kind: z.literal("dispute"), value: dispute }),
  z.object({ kind: z.literal("adverse"), value: z.boolean() }),
  z.object({ kind: z.literal("nature"), value: nature.nullable() }),
  z.object({ kind: z.literal("split"), value: z.strictObject({ observationId: z.cuid(), title: z.string().trim().min(1).max(200) }) }),
  z.object({ kind: z.literal("reviewed"), value: z.boolean() }),
  z.object({ kind: z.literal("date"), value: z.cuid().nullable() }),
  z.object({ kind: z.literal("amount"), value: z.cuid().nullable() }),
  z.object({ kind: z.literal("sourceStage"), value: chronologyStageSchema.nullable(), sourceId: z.string().max(600) }),
  z.object({ kind: z.literal("addDirection"), value: relation }),
  z.object({ kind: z.literal("removeDirection"), value: z.uuid() }),
]);
export type ChronologyChange = z.infer<typeof chronologyChangeSchema>;
export const chronologyAssessmentInput = revisionInputSchema.extend({ change: chronologyChangeSchema });

export const chronologyExportInput = z.strictObject({
  kind: z.enum(["facts", "narrative"]),
  items: z.array(z.strictObject({ id: z.cuid(), revision: z.number().int().positive() })).max(500),
}).refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, "导出项不能重复");

export const observationEventHintSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  category: chronologyCategorySchema,
  kind: z.enum(["FACT", "CLAIM", "TODO_VERIFY"]),
});
export type ObservationEventHint = z.infer<typeof observationEventHintSchema>;
