import { z } from "zod";
import { isEvidenceCalendarDay } from "./event-date";
import { observationSpanSchema as spanSchema, participantDataFields, participantInputFields, validateParticipantLinks } from "./observation-participants";

export const dateValueSchema = z.discriminatedUnion("precision", [
  z.strictObject({ precision: z.literal("EXACT"), day: z.string().refine(isEvidenceCalendarDay, "日期无效") }),
  z.strictObject({ precision: z.literal("MONTH"), month: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/) }),
  z.strictObject({ precision: z.literal("RANGE"), start: z.string().refine(isEvidenceCalendarDay), end: z.string().refine(isEvidenceCalendarDay) }),
  z.strictObject({ precision: z.literal("UNKNOWN") }),
]);

export const amountValueSchema = z.strictObject({
  currency: z.enum(["CNY", "USD", "EUR", "HKD"]),
  value: z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/),
});

export const statementSchema = z.enum(["RECORD", "PARTY_STATEMENT", "COURT_FINDING"]);
export const dateRoleSchema = z.enum(["OCCURRENCE", "AGREEMENT", "SIGNATURE", "FILING", "SERVICE"]);
export const amountNatureSchema = z.enum(["ACTUAL_TRANSFER", "AGREED_PRINCIPAL", "CLAIMED_RELIEF", "BALANCE", "OTHER"]);

export const observationInputSchema = z.strictObject({
  statement: statementSchema,
  excerpt: spanSchema.optional(),
  date: z.strictObject({
    role: dateRoleSchema,
    span: spanSchema,
    suggested: dateValueSchema.optional(),
  }).optional(),
  amount: z.strictObject({
    nature: amountNatureSchema,
    span: spanSchema,
    unitSpan: spanSchema.optional(),
    suggested: amountValueSchema.optional(),
  }).optional(),
  ...participantInputFields,
}).refine(value => value.excerpt || value.date || value.amount || value.participants?.length, "至少记录一条原文或字段出处")
  .superRefine(validateParticipantLinks);

export const observationDataSchema = z.strictObject({
  statement: statementSchema,
  excerpt: z.strictObject({ span: spanSchema, text: z.string().min(1).max(300) }).optional(),
  date: z.strictObject({ role: dateRoleSchema, span: spanSchema, text: z.string(), value: dateValueSchema }).optional(),
  amount: z.strictObject({
    nature: amountNatureSchema, span: spanSchema, unitSpan: spanSchema.optional(), unit: z.string().optional(),
    text: z.string(), value: amountValueSchema.nullable(),
  }).optional(),
  ...participantDataFields,
}).refine(value => value.excerpt || value.date || value.amount || value.participants?.length, "至少记录一条原文或字段出处")
  .superRefine(validateParticipantLinks);

export type ObservationData = z.infer<typeof observationDataSchema>;
export type ObservationInput = z.input<typeof observationInputSchema>;
export type DateValue = z.infer<typeof dateValueSchema>;
export type AmountValue = z.infer<typeof amountValueSchema>;

export type EvidenceObservationView = {
  id: string;
  sourceId: string;
  revision: number;
  data: ObservationData;
};
