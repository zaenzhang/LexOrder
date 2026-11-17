import { z } from "zod";

export const followUpFilters = { all: "全部待跟进", today: "今日", overdue: "已逾期" } as const;
export const personalFollowUpQuerySchema = z.object({
  filter: z.enum(["all", "today", "overdue"]).default("all"),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
}).strict();
export const personalFollowUpTargetSchema = z.object({ followUpId: z.string().cuid(), clientId: z.string().cuid() }).strict();
export type PersonalFollowUpQuery = z.input<typeof personalFollowUpQuerySchema>;
export type PersonalFollowUpTarget = z.infer<typeof personalFollowUpTargetSchema>;
export type PersonalFollowUp = {
  id: string; title: string; dueAt: string; overdue: boolean; canClose: boolean;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  client: { id: string; name: string }; assigneeName: string;
};
export type PersonalFollowUpPage = {
  available: boolean; items: PersonalFollowUp[]; total: number; page: number; pageSize: number;
  filter: keyof typeof followUpFilters; observedAt: string;
};

export function personalFollowUpHref(query: PersonalFollowUpQuery = {}, target?: PersonalFollowUpTarget) {
  const data = personalFollowUpQuerySchema.parse(query), params = new URLSearchParams();
  if (data.filter !== "all") params.set("filter", data.filter);
  if (data.page > 1) params.set("page", String(data.page));
  if (target) { params.set("followUp", target.followUpId); params.set("client", target.clientId); }
  return `/clients/follow-ups${params.size ? `?${params}` : ""}`;
}

/** The queue has only these URL fields; invalid identities never fall back to a different row. */
export function personalFollowUpLocation(input: Record<string, string | string[] | undefined>) {
  const page = input.page === undefined ? 1 : typeof input.page === "string" && /^[1-9]\d*$/.test(input.page) ? Number(input.page) : NaN;
  const query = personalFollowUpQuerySchema.safeParse({ filter: input.filter, page });
  const target = input.followUp === undefined && input.client === undefined ? null
    : personalFollowUpTargetSchema.safeParse({ followUpId: input.followUp, clientId: input.client });
  return {
    query: query.success ? query.data : null,
    target: target?.success ? target.data : null,
    error: !query.success ? "跟进筛选或页码无效，请重新选择" : target && !target.success ? "跟进位置无效，请从列表重新打开" : "",
  };
}
