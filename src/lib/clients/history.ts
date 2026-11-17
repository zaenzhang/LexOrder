import { z } from "zod";
import type { MatterCategory, MatterStatus } from "@prisma/client";
import { shDayBoundary } from "@/lib/ui/sh-time";

export const CLIENT_HISTORY_PAGE_SIZE = 20;
export const CLIENT_MATTER_PAGE_SIZE = 6;
export const clientPageInputSchema = z.object({
  clientId: z.string().cuid("客户标识无效"),
  cursor: z.string().min(1).max(1200, "分页位置无效，请刷新").optional()
}).strict();
export type ClientPageInput = z.input<typeof clientPageInputSchema>;
export const historySourceLabels = {
  CLIENT_ACTIVITY: "客户沟通", CONTACT: "联系人", CONTEXT: "事项上下文", DELIVERY: "简报与交付", FEE: "确认到账",
  FOLLOW_UP: "安排跟进", INTAKE: "收案", MATTER: "事项", NOTE: "事项沟通"
} as const;
export type HistorySource = keyof typeof historySourceLabels;
export const historySourceSchema = z.enum(["CLIENT_ACTIVITY", "CONTACT", "CONTEXT", "DELIVERY", "FEE", "FOLLOW_UP", "INTAKE", "MATTER", "NOTE"]);
const historyDay = z.string().refine(value => Boolean(shDayBoundary(value)), "请输入有效日期（YYYY-MM-DD）").optional();
const filterFields = { from: historyDay, to: historyDay, source: historySourceSchema.optional(), matterId: z.string().cuid("事项标识无效").optional() };
const validRange = (value: { from?: string; to?: string }) => !value.from || !value.to || value.from <= value.to;
const rangeError = { message: "开始日期不能晚于结束日期", path: ["to"] };
export const clientHistoryFiltersSchema = z.object(filterFields).strict().refine(validRange, rangeError);
export type ClientHistoryFilters = z.infer<typeof clientHistoryFiltersSchema>;
export const clientHistoryInputSchema = clientPageInputSchema.extend(filterFields).refine(validRange, rangeError);
export type ClientHistoryInput = z.input<typeof clientHistoryInputSchema>;
/** A fixed ordering for both request identity and encrypted history cursor scope. */
export function clientHistoryFiltersKey(filters: ClientHistoryFilters) {
  return JSON.stringify([filters.from ?? "", filters.to ?? "", filters.source ?? "", filters.matterId ?? ""]);
}
export const clientHistoryLocationSchema = z.object({
  tab: z.string().optional(),
  returnTo: z.string().optional(),
  historyCursor: clientPageInputSchema.shape.cursor,
  rowId: z.string().refine(value => value.startsWith("CONTEXT:") && z.string().cuid().safeParse(value.slice(8)).success,
    "客户动态位置无效，请重新打开客户动态").optional(),
  historyFrom: historyDay, historyTo: historyDay,
  historySource: filterFields.source, historyMatterId: filterFields.matterId,
}).strict().refine(value => validRange({ from: value.historyFrom, to: value.historyTo }), {
  message: "开始日期不能晚于结束日期", path: ["historyTo"],
}).transform(({ historyFrom, historyTo, historySource, historyMatterId, ...location }) => ({
  ...location, filters: { from: historyFrom, to: historyTo, source: historySource, matterId: historyMatterId },
}));
export type ClientPage<T> = { items: T[]; nextCursor: string | null };
export type ClientMatterItem = {
  id: string; internalCode: string | null; title: string; status: MatterStatus;
  category: MatterCategory; year: string; ownerName: string | null;
  procedure: string | null; stage: string | null; contract: number | null;
};
export type ClientMatterPage = ClientPage<ClientMatterItem> & { total: number; activeCount: number };
export type ClientHistoryItem = {
  key: string; source: HistorySource; id: string; at: string; recordedAt: string;
  title: string; meta: string; content: string | null; href: string; linkLabel: string;
};
export type ClientHistoryMatter = Pick<ClientMatterItem, "id" | "title" | "internalCode">;
export type ClientHistoryMatterPage = ClientPage<ClientHistoryMatter>;
export type ClientHistoryPage = ClientPage<ClientHistoryItem> & { selectedMatter: ClientHistoryMatter | null };
