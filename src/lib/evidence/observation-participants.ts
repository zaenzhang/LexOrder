import { z } from "zod";

export const observationSpanSchema = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().positive(),
}).refine(span => span.start < span.end, "出处范围为空");

export const relationKindSchema = z.enum([
  "PAYS_TO", "LENDS_TO", "DELIVERS_TO", "GUARANTEES_FOR", "REPRESENTS", "CONTRACTS_WITH", "EMPLOYS", "OTHER",
]);

const participantInputSchema = z.strictObject({ span: observationSpanSchema });
const relationInputSchema = z.strictObject({
  kind: relationKindSchema,
  from: z.number().int().min(1).max(12),
  to: z.number().int().min(1).max(12),
  span: observationSpanSchema,
});
const participantSchema = participantInputSchema.extend({ text: z.string().min(1).max(100) });
const relationSchema = relationInputSchema.extend({ text: z.string().min(1).max(600) });
export type ObservationParticipant = z.infer<typeof participantSchema>;
export type ObservationRelation = z.infer<typeof relationSchema>;

export const participantInputFields = {
  participants: z.array(participantInputSchema).min(1).max(12).optional(),
  relations: z.array(relationInputSchema).min(1).max(12).optional(),
};
export const participantDataFields = {
  participants: z.array(participantSchema).min(1).max(12).optional(),
  relations: z.array(relationSchema).min(1).max(12).optional(),
};

export function validateParticipantLinks(value: {
  participants?: { span: { start: number; end: number } }[];
  relations?: z.infer<typeof relationInputSchema>[];
}, context: z.RefinementCtx) {
  const spans = (value.participants ?? []).map(participant => participant.span);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  if (sorted.some((span, index) => span.end - span.start > 100 || (index > 0 && sorted[index - 1].end > span.start))) {
    context.addIssue({ code: "custom", path: ["participants"], message: "人物或机构出处重复、重叠或过长" });
  }
  const links = new Set<string>();
  for (const [index, relation] of (value.relations ?? []).entries()) {
    const from = spans[relation.from - 1];
    const to = spans[relation.to - 1];
    const identity = relation.kind + ":" + relation.from + ":" + relation.to;
    if (!from || !to || from === to || relation.span.end - relation.span.start > 600 ||
      relation.span.start > Math.min(from.start, to.start) || relation.span.end < Math.max(from.end, to.end) || links.has(identity)) {
      context.addIssue({ code: "custom", path: ["relations", index], message: "关系出处须包含两个不同的参与人，且同一关系只能记录一次" });
    }
    links.add(identity);
  }
}
