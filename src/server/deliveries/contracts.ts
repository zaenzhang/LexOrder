import { z } from "zod";
import { contextInputSelectionsSchema } from "@/lib/matters/context-inputs";

const id = z.string().cuid("对象标识无效，请重新打开");
const requestKey = z.string().uuid("保存标识无效，请重新打开").transform(value => value.toLowerCase());
const instant = z.string().datetime({ offset: true, message: "请填写有效的发生时间" })
  .refine(value => new Date(value).getUTCFullYear() >= 1900 && new Date(value).getUTCFullYear() <= 2200, "发生时间超出支持范围");

export const prepareDeliverySchema = z.object({
  matterId: id,
  requestKey,
  documentIds: z.array(id).min(1, "请选择至少一份具体材料").max(30, "一次交付最多 30 份材料")
    .refine(values => new Set(values).size === values.length, "清单不能重复选入同一材料"),
  sourceDeclarations: z.array(z.object({ documentId: id, kind: z.enum(["TEAM_PRODUCED", "EXTERNAL_ATTACHMENT"]) }).strict()).default([]),
  recipientClientId: id.nullable().default(null),
  recipientName: z.string().trim().min(1, "请填写接收人").max(200),
  recipientContact: z.string().trim().min(1, "请填写本次实际联系方式或交接地点").max(500),
  purpose: z.string().trim().min(1, "请填写交付目的").max(300),
  disclosureScope: z.string().trim().min(1, "请确认本次披露范围").max(2000),
  unresolvedItems: z.string().trim().max(4000).default(""),
  supersedesId: id.nullable().default(null),
}).strict().superRefine((value, ctx) => {
  const ids = value.sourceDeclarations.map(item => item.documentId);
  if (new Set(ids).size !== ids.length || ids.some(documentId => !value.documentIds.includes(documentId))) {
    ctx.addIssue({ code: "custom", path: ["sourceDeclarations"], message: "材料来源声明必须对应清单中的具体版本且不能重复" });
  }
});

export const deliveryEventLabels = {
  EXPORTED: "已导出",
  SENT: "已登记发送",
  RECEIVED: "已登记收悉",
  REPLIED: "客户回复",
  CONTENT_CONFIRMED: "客户确认内容",
  SEND_CORRECTION: "发送登记更正",
} as const;
export type DeliveryEventKind = keyof typeof deliveryEventLabels;

export const registerDeliveryEventSchema = z.object({
  deliveryId: id,
  requestKey,
  kind: z.enum(["SENT", "RECEIVED", "REPLIED", "CONTENT_CONFIRMED", "SEND_CORRECTION"]),
  occurredAt: instant,
  channel: z.string().trim().max(100).default(""),
  note: z.string().trim().min(1, "请填写实际发生情况或客户原意").max(8000),
  proofDocumentId: id.nullable().default(null),
  correctsEventId: id.nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if ((value.kind === "SENT" || value.kind === "SEND_CORRECTION") && !value.channel) {
    ctx.addIssue({ code: "custom", path: ["channel"], message: "请填写实际发送渠道" });
  }
  if ((value.kind === "SEND_CORRECTION") !== Boolean(value.correctsEventId)) {
    ctx.addIssue({ code: "custom", path: ["correctsEventId"], message: "发送更正须明确关联原登记；其他事件不能改写原登记" });
  }
});

export const briefSchema = z.object({
  contextInputs: contextInputSelectionsSchema.optional(),
  matterId: id,
  requestKey,
  title: z.string().trim().min(1, "请填写简报标题").max(200),
  content: z.string().trim().min(1, "请填写简报正文").max(40000),
  priorDocumentId: id.nullable().default(null),
}).strict();

export const exportDeliverySchema = z.object({ requestKey }).strict();
export const deliveryIdSchema = id;
export type PrepareDeliveryInput = z.input<typeof prepareDeliverySchema>;
export type RegisterDeliveryEventInput = z.input<typeof registerDeliveryEventSchema>;
export type BriefInput = z.input<typeof briefSchema>;

export type DeliveryItemView = {
  id: string; documentId: string; position: number; documentName: string; documentVersion: number;
  newerVersionAvailable: boolean;
};
export type DeliveryEventView = {
  id: string; kind: DeliveryEventKind; occurredAt: string; recordedAt: string; actorName: string;
  channel: string | null; note: string | null; proofDocumentId: string | null; proofName: string | null; proofUnavailable: boolean;
  correctsEventId: string | null;
};
export type DeliverySummary = {
  id: string; purpose: string | null; recipientName: string | null; createdAt: string; sentAt: string | null;
  state: "PREPARED" | "EXPORTED" | "SENT" | "UNAVAILABLE"; itemCount: number;
};
export type DeliveryDetail = {
  id: string; matterId: string; recipientClientId: string | null; purpose: string;
  recipientName: string; recipientContact: string; disclosureScope: string; unresolvedItems: string;
  supersedesId: string | null; createdAt: string; createdByName: string; canWrite: boolean;
  items: DeliveryItemView[]; events: DeliveryEventView[];
};
export type DeliveryOptions = {
  canPrepare: boolean; canCreateBrief: boolean;
  documents: { id: string; name: string; version: number; status: string; canDeliver: boolean; blockedReason: string | null; needsSourceDeclaration?: boolean }[];
  clients: { id: string; name: string; contact: string }[];
};

export function deliveryState(events: { kind: string }[]): DeliverySummary["state"] {
  if (events.some(event => event.kind === "SENT")) return "SENT";
  return events.some(event => event.kind === "EXPORTED") ? "EXPORTED" : "PREPARED";
}

export const deliveryStateLabels: Record<DeliverySummary["state"], string> = {
  PREPARED: "已准备", EXPORTED: "已导出，未登记发送", SENT: "已登记发送", UNAVAILABLE: "记录暂不可查看",
};
