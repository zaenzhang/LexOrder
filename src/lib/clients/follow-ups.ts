import { z } from "zod";

export const followUpFilters = { all: "全部待跟进", today: "今日", overdue: "已逾期" } as const;
export const personalFollowUpQuerySchema = z.object({
  filter: z.enum(["all", "today", "overdue"]).default("all"),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
}).strict();
export const personalFollowUpTargetSchema = z.object({ followUpId: z.string().cuid(), clientId: z.string().cuid() }).strict();
const instant = z.string().datetime({ offset: true, message: "请输入带时区的有效日期和时间" })
  .refine(value => new Date(value).getUTCFullYear() >= 1900 && new Date(value).getUTCFullYear() <= 2200, "日期超出支持范围")
  .transform(value => new Date(value).toISOString());
export const clientFollowUpRescheduleSchema = personalFollowUpTargetSchema.extend({
  expectedUpdatedAt: instant,
  dueAt: instant,
  reason: z.string().trim().min(1, "请填写改期原因").max(1000, "改期原因最多 1000 字"),
  requestKey: z.string().uuid(),
}).strict();
export const clientFollowUpRescheduleAuditSchema = clientFollowUpRescheduleSchema.extend({
  beforeDueAt: instant,
  afterDueAt: instant,
  beforeUpdatedAt: instant,
  afterUpdatedAt: instant,
}).strict().refine(value => value.beforeUpdatedAt === value.expectedUpdatedAt && value.afterDueAt === value.dueAt
  && value.beforeDueAt !== value.afterDueAt && Date.parse(value.afterUpdatedAt) > Date.parse(value.beforeUpdatedAt));
export const personalFollowUpHistoryQuerySchema = personalFollowUpTargetSchema.extend({ cursor: z.string().cuid().optional() }).strict();
export type PersonalFollowUpQuery = z.input<typeof personalFollowUpQuerySchema>;
export type PersonalFollowUpTarget = z.infer<typeof personalFollowUpTargetSchema>;
export type ClientFollowUpRescheduleInput = z.input<typeof clientFollowUpRescheduleSchema>;
export type PersonalFollowUpHistoryQuery = z.infer<typeof personalFollowUpHistoryQuerySchema>;
export type PersonalFollowUpHistoryPage = {
  items: { id: string; beforeDueAt: string; afterDueAt: string; reason: string; actorName: string | null; at: string }[];
  nextCursor: string | null;
};
export type PersonalFollowUpMode = "result" | "reschedule";
export type PersonalFollowUp = {
  id: string; title: string; dueAt: string; updatedAt: string; overdue: boolean; canClose: boolean;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  client: { id: string; name: string }; assigneeName: string;
};
export type PersonalFollowUpPage = {
  available: boolean; items: PersonalFollowUp[]; total: number; page: number; pageSize: number;
  filter: keyof typeof followUpFilters; observedAt: string;
};

export function personalFollowUpHref(query: PersonalFollowUpQuery = {}, target?: PersonalFollowUpTarget, mode: PersonalFollowUpMode = "result") {
  const data = personalFollowUpQuerySchema.parse(query), params = new URLSearchParams();
  if (data.filter !== "all") params.set("filter", data.filter);
  if (data.page > 1) params.set("page", String(data.page));
  if (target) {
    const identity = personalFollowUpTargetSchema.parse(target);
    params.set("followUp", identity.followUpId); params.set("client", identity.clientId);
    if (mode === "reschedule") params.set("mode", mode);
  }
  return `/clients/follow-ups${params.size ? `?${params}` : ""}`;
}

/** The queue has only these URL fields; invalid identities never fall back to a different row. */
export function personalFollowUpLocation(input: Record<string, string | string[] | undefined>) {
  const page = input.page === undefined ? 1 : typeof input.page === "string" && /^[1-9]\d*$/.test(input.page) ? Number(input.page) : NaN;
  const query = personalFollowUpQuerySchema.safeParse({ filter: input.filter, page });
  const target = input.followUp === undefined && input.client === undefined ? null
    : personalFollowUpTargetSchema.safeParse({ followUpId: input.followUp, clientId: input.client });
  const validMode = input.mode === undefined || (input.mode === "reschedule" && target?.success);
  return {
    query: query.success ? query.data : null,
    target: target?.success && validMode ? target.data : null,
    mode: input.mode === "reschedule" && validMode ? "reschedule" as const : "result" as const,
    error: !query.success ? "跟进筛选或页码无效，请重新选择" : (target && !target.success) || !validMode ? "跟进位置无效，请从列表重新打开" : "",
  };
}
