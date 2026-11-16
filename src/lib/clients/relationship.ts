import { z } from "zod";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import type { ClientPage } from "./history";

export const clientChannelLabels = {
  PHONE: "电话", WECHAT: "微信", EMAIL: "邮件", MEETING: "面谈", COURT: "庭审", OTHER: "其他"
} as const;

const instant = z.string().datetime({ offset: true, message: "请输入有效日期和时间" })
  .refine(value => new Date(value).getUTCFullYear() >= 1900 && new Date(value).getUTCFullYear() <= 2200, "日期超出支持范围");

export const clientActivitySchema = z.object({
  clientId: z.string().cuid(),
  requestKey: z.string().uuid(),
  channel: z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]),
  content: z.string().trim().min(1, "请填写沟通内容、跟进结果或取消原因").max(8000, "内容最多 8000 字"),
  occurredAt: instant,
  followUpId: z.string().cuid().optional(),
  closeStatus: z.enum(["COMPLETED", "CANCELLED"]).default("COMPLETED"),
  nextFollowUp: z.object({
    title: z.string().trim().min(1, "请填写下次跟进事项").max(200),
    dueAt: instant
  }).optional()
}).refine(value => value.closeStatus !== "CANCELLED" || Boolean(value.followUpId), "请选择要取消的跟进");

export type ClientActivityInput = z.input<typeof clientActivitySchema>;

/** datetime-local 在此应用中始终表示上海时间，不读取浏览器本地时区。 */
export function toShanghaiInput(value: Date | string): string {
  return `${shDayKey(value)}T${shTime(value)}`;
}

export function fromShanghaiInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请填写完整日期和时间");
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime()) || toShanghaiInput(date) !== value) throw new Error("日期或时间无效");
  return date.toISOString();
}

export type ClientRelationshipView = {
  canWrite: boolean;
  activityCount: number;
  openCount: number;
  activities: { id: string; content: string; channel: keyof typeof clientChannelLabels; occurredAt: string; authorName: string; closedTitle: string | null; closedStatus: string | null }[];
  followUps: { id: string; title: string; dueAt: string; assigneeName: string; overdue: boolean; canClose: boolean }[];
  activityNextCursor?: string | null;
  followUpNextCursor?: string | null;
};
export type ClientCommunicationPage = ClientPage<ClientRelationshipView["activities"][number]> & { total: number; canWrite: boolean };
export type ClientFollowUpPage = ClientPage<ClientRelationshipView["followUps"][number]> & { total: number; canWrite: boolean };
