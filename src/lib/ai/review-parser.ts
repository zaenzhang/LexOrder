/** The model and stored records use the same explicit review-item contract. */
import { z } from "zod";
import { extractJson } from "./client";
import { ActionError } from "@/lib/action-error";

export const reviewItemsSchema = z.array(z.strictObject({
  type: z.enum(["MISSING", "RISK", "ISSUE", "SUGGESTION"]),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
}));
export type ReviewItem = z.infer<typeof reviewItemsSchema>[number];
export type ReviewType = ReviewItem["type"];
export type ReviewSeverity = ReviewItem["severity"];
const severityOrder: Record<ReviewSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function parseReviewItems(content: string): ReviewItem[] {
  const parsed = reviewItemsSchema.safeParse(extractJson<unknown>(content));
  if (!parsed.success) throw new ActionError("AI 返回内容无法解析为完整审查清单");
  return parsed.data.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
