import { z } from "zod";

const id = z.cuid();
export const fragmentOffset = z.number().int().min(0).max(2_000_000);
export const fragmentSelection = z.strictObject({
  documentId: id, parseRunId: id, anchorId: z.string().min(1).max(512), start: fragmentOffset, end: fragmentOffset,
}).refine(value => value.end > value.start && value.end - value.start <= 6000, "单个片段需为 1 至 6000 字符");
export const fragmentsSchema = z.array(fragmentSelection).min(1).max(80).superRefine((items, ctx) => {
  const documents = new Set(items.map(item => item.documentId));
  if (documents.size > 8 || items.reduce((sum, item) => sum + item.end - item.start, 0) > 36_000) {
    ctx.addIssue({ code: "custom", message: "单次委托最多 8 份材料与 36000 字符" });
  }
  const byAnchor = new Map<string, { start: number; end: number }[]>();
  for (const item of items) {
    const key = JSON.stringify([item.documentId, item.parseRunId, item.anchorId]);
    const prior = byAnchor.get(key) ?? [];
    if (prior.some(range => item.start < range.end && range.start < item.end)) {
      ctx.addIssue({ code: "custom", message: "同一固定位置的委托片段不可重复或重叠" });
      break;
    }
    prior.push(item);
    byAnchor.set(key, prior);
  }
});

export type FragmentSelection = z.infer<typeof fragmentSelection>;
