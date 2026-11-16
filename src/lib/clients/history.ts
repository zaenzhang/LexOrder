import { z } from "zod";
import type { MatterCategory, MatterStatus } from "@prisma/client";

export const CLIENT_HISTORY_PAGE_SIZE = 20;
export const CLIENT_MATTER_PAGE_SIZE = 6;
export const clientPageInputSchema = z.object({
  clientId: z.string().cuid("客户标识无效"),
  cursor: z.string().min(1).max(1200, "分页位置无效，请刷新").optional()
}).strict();
export type ClientPageInput = z.input<typeof clientPageInputSchema>;
export type ClientPage<T> = { items: T[]; nextCursor: string | null };
export type ClientMatterItem = {
  id: string; internalCode: string; title: string; status: MatterStatus;
  category: MatterCategory; year: string; ownerName: string | null;
  procedure: string | null; stage: string | null; contract: number | null;
};
export type ClientMatterPage = ClientPage<ClientMatterItem> & { total: number; activeCount: number };
export const historySourceLabels = {
  CLIENT_ACTIVITY: "客户沟通", CONTACT: "联系人", CONTEXT: "事项上下文", FEE: "确认到账",
  FOLLOW_UP: "安排跟进", INTAKE: "收案", MATTER: "事项", NOTE: "事项沟通"
} as const;
export type HistorySource = keyof typeof historySourceLabels;
export type ClientHistoryItem = {
  key: string; source: HistorySource; id: string; at: string; recordedAt: string;
  title: string; meta: string; content: string | null; href: string; linkLabel: string;
};
export type ClientHistoryPage = ClientPage<ClientHistoryItem>;
