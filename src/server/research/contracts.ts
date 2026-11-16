import { z } from "zod";
import { sourceInputSchema, type EvidenceDocumentOption, type EvidenceSourceResult } from "@/server/evidence/contracts";

const text = (max: number) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请输入完整日期").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
const optionalDay = day.or(z.literal(""));

export const queryOutcomeLabels = {
  READ: "已阅读", NOT_OBTAINED: "尚未取得", UNREAD: "已取得未读", NO_MATCH: "核查范围内未见",
  NO_ACCESS: "无权访问", FAILED: "查询失败",
} as const;
export const queryAccessLabels = { FULLTEXT: "全文", SUMMARY: "摘要", LINK: "仅链接", NONE: "无资料" } as const;
export const lawKindLabels = { MATERIAL: "事项材料", STATUTE: "法规", CASE: "裁判", OTHER: "其他法源" } as const;
export const sourceRelationLabels = { SUPPORTS: "支持依据", REBUTS: "反向依据", CONTEXT: "背景资料" } as const;

export const researchQuerySchema = z.object({
  query: text(1000).min(1, "请填写查询或阅读范围"),
  location: text(2000),
  access: z.enum(["FULLTEXT", "SUMMARY", "LINK", "NONE"]),
  outcome: z.enum(["READ", "NOT_OBTAINED", "UNREAD", "NO_MATCH", "NO_ACCESS", "FAILED"]),
  notes: text(3000),
}).superRefine((value, ctx) => {
  if (value.outcome === "READ" && (value.access === "NONE" || value.access === "LINK")) {
    ctx.addIssue({ code: "custom", path: ["outcome"], message: "仅有链接或没有资料时不能记录为已阅读原文或摘要" });
  }
});
export type ResearchQuery = z.infer<typeof researchQuerySchema>;

export const lawMetadataSchema = z.object({
  kind: z.enum(["MATERIAL", "STATUTE", "CASE", "OTHER"]),
  title: text(300), authority: text(300), number: text(150), jurisdiction: text(150),
  effectiveFrom: optionalDay, effectiveTo: optionalDay,
  verification: z.enum(["PENDING", "CHECKED"]),
  acquiredOn: optionalDay, acquiredVia: text(1500), usageScope: text(1000),
}).superRefine((value, ctx) => {
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "效力结束日期不能早于开始日期" });
  }
  if (value.kind !== "MATERIAL" && value.verification === "CHECKED" && (!value.title || !value.jurisdiction || !value.authority)) {
    ctx.addIssue({ code: "custom", path: ["verification"], message: "核实法源前请填写名称、机关和法域" });
  }
});
export type LawMetadata = z.infer<typeof lawMetadataSchema>;
export const emptyLawMetadata = (): LawMetadata => ({ kind: "MATERIAL", title: "", authority: "", number: "", jurisdiction: "",
  effectiveFrom: "", effectiveTo: "", verification: "PENDING", acquiredOn: "", acquiredVia: "", usageScope: "" });

export const researchSourceInputSchema = sourceInputSchema.and(z.object({ lawMetadata: lawMetadataSchema }));
export type ResearchSourceInput = z.infer<typeof researchSourceInputSchema>;

export const researchContentSchema = z.object({
  question: text(300).min(1, "请填写研究问题"), purpose: text(2000), jurisdiction: text(150),
  relevantDate: optionalDay, researchedAt: z.string().datetime({ offset: true }),
  scope: text(5000), queryLog: z.array(researchQuerySchema).max(40),
  rule: text(15000), exceptions: text(10000), supportingAnalysis: text(15000), opposingAnalysis: text(15000),
  conclusion: text(15000), unresolved: text(10000), nextSteps: text(5000),
  issueId: z.string().cuid().nullable(), issueRevisionId: z.string().cuid().nullable(),
  sources: z.array(researchSourceInputSchema).max(50),
}).superRefine((value, ctx) => {
  if (Boolean(value.issueId) !== Boolean(value.issueRevisionId)) {
    ctx.addIssue({ code: "custom", path: ["issueId"], message: "请选择争点的具体修订" });
  }
});
export type ResearchContent = z.infer<typeof researchContentSchema>;
export const researchSaveSchema = researchContentSchema.and(z.object({
  matterId: z.string().cuid(), requestKey: z.string().uuid(),
  supersedesId: z.string().cuid().nullable(), expectedVersion: z.number().int().positive().nullable(),
})).superRefine((value, ctx) => {
  if (Boolean(value.supersedesId) !== Boolean(value.expectedVersion)) ctx.addIssue({ code: "custom", message: "原研究版本无效，请重新打开" });
});
export type ResearchSaveInput = z.infer<typeof researchSaveSchema>;
export const researchCheckSchema = z.object({
  matterId: z.string().cuid(), id: z.string().cuid(), expectedVersion: z.number().int().positive(),
  acknowledged: z.literal(true, { error: "请确认已核对研究范围、来源与仍待核实项" }), note: text(2000).min(1, "请记录核对结论及仍待核实项"),
});
export type ResearchCheckInput = z.infer<typeof researchCheckSchema>;
export const researchDraftSchema = z.object({
  matterId: z.string().cuid(), researchRevisionId: z.string().cuid(), requestKey: z.string().uuid(),
});
export type ResearchDraftInput = z.infer<typeof researchDraftSchema>;

export type ResearchSourceView = ResearchSourceInput & {
  id: string; documentName: string; version: number; locationLabel: string; changed: boolean;
};
export type ResearchRevisionView = {
  id: string; seriesId: string; version: number; current: boolean;
  createdAt: string; authorName: string | null; checkedAt: string | null; checkedByName: string | null; checkNote: string | null;
  readable: boolean; content: ResearchContent | null; sources: ResearchSourceView[];
  issue: { id: string; revisionId: string; revision: number; title: string; changed: boolean } | null;
  canRevise: boolean; canCheck: boolean; canDraft: boolean;
};
export type ResearchListRow = Pick<ResearchRevisionView, "id" | "seriesId" | "version" | "createdAt" | "authorName" | "checkedAt" | "readable"> & { question: string | null };
export type ResearchList = { records: ResearchListRow[]; canWrite: boolean; nextCursor: string | null };
export type ResearchOptions = {
  documents: EvidenceDocumentOption[];
  issues: { id: string; revisionId: string; revision: number; title: string }[];
};
export type ResearchSourceResult = EvidenceSourceResult;

export function emptyResearchContent(): ResearchContent {
  return { question: "", purpose: "", jurisdiction: "", relevantDate: "", researchedAt: new Date().toISOString(), scope: "", queryLog: [],
    rule: "", exceptions: "", supportingAnalysis: "", opposingAnalysis: "", conclusion: "", unresolved: "", nextSteps: "",
    issueId: null, issueRevisionId: null, sources: [] };
}
