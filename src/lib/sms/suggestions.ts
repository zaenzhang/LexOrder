import { z } from "zod";

const id = z.string().cuid();
const version = z.coerce.date();

export const smsEventChoice = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("CREATE"), procedureId: id,
    title: z.string().trim().min(1, "请核对事项标题").max(200),
    dateText: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请核对日期"),
    timeText: z.string().regex(/^\d{2}:\d{2}$/, "请填写已核实的时刻；未确定时可先保留建议"),
  }),
  z.object({ mode: z.literal("LINK"), procedureId: id, targetId: id, expectedTargetUpdatedAt: version }),
]);

export const smsDecisionInput = z.object({
  smsId: id,
  expectedMatchedMatterId: id.nullable(),
  items: z.array(z.object({ id, expectedUpdatedAt: version, event: smsEventChoice.optional() })).min(1).max(50)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "同一建议不能重复选择"),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().max(500).default(""),
});

export type SmsEventChoice = z.input<typeof smsEventChoice>;
export type SmsDecisionInput = z.input<typeof smsDecisionInput>;
export type SmsDecisionResult = {
  suggestionId: string;
  outcome: "CREATED" | "LINKED" | "UPDATED" | "UNCHANGED" | "REJECTED";
  targetType: "Hearing" | "Deadline" | "MatterProcedure" | "Matter" | null;
  targetId: string | null;
  matterId: string | null;
  replayed: boolean;
};

export function suggestionPayload(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only a saved server receipt describes what was applied; legacy ACCEPTED has no inferred target. */
export function savedSmsDecision(value: unknown) {
  const receipt = suggestionPayload(suggestionPayload(value).decisionReceipt);
  const result = suggestionPayload(receipt.result);
  if (!receipt.request || typeof receipt.request !== "object" || !["CREATED", "LINKED", "UPDATED", "UNCHANGED", "REJECTED"].includes(String(result.outcome))) return null;
  return { request: receipt.request, result: result as Omit<SmsDecisionResult, "replayed"> };
}
