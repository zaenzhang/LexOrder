import { fragmentsSchema } from "@/lib/workbench/fixed-fragments";
import { exactTextRange } from "@/lib/workbench/fixed-text-range";
import { describe, expect, it } from "vitest";
import { assertSkillCitations, effectiveAiExecution, signoffMethod, skillResultSchema } from "@/server/skills/signoff-contract";
import { countNewFragments, decisionParagraphs, removePriorDecision } from "@/server/skills/signoff-follow-up";

const documentId = "c" + "a".repeat(24);
const parseRunId = "c" + "b".repeat(24);
const range = { documentId, parseRunId, anchorId: "第1段", start: 0, end: 12 };
const result = {
  commissionId: "1e5ae472-8432-4d1a-98c4-a95dc1dd75dd", methodVersion: signoffMethod.version, host: "CODEX",
  candidates: [{ kind: "QUANTITY", assessment: "SUPPORTED", finding: "清单载 12 台",
    citations: [{ fragment: 1, start: 2, end: 7, quote: "清点12台", relation: "SUPPORTS" }] }],
};

describe("签收与验收委托合同", () => {
  it("拒绝重叠、过大片段和超限材料，允许同一锚点的不相邻选区", () => {
    expect(fragmentsSchema.safeParse([range, { ...range, start: 10, end: 18 }]).success).toBe(false);
    expect(fragmentsSchema.safeParse([range, { ...range, start: 14, end: 18 }]).success).toBe(true);
    expect(fragmentsSchema.safeParse([{ ...range, end: 6001 }]).success).toBe(false);
    expect(fragmentsSchema.safeParse(Array.from({ length: 9 }, (_, i) => ({ ...range, documentId: "c" + String(i).repeat(24) }))).success).toBe(false);
  });

  it("按 UTF-16 逐字回查，拒绝越权片段、伪造引文和半个代理对", () => {
    const text = [{ text: "🧾清点12台。性能待核。" }];
    const parsed = skillResultSchema.parse(result);
    expect(() => assertSkillCitations(parsed, text)).not.toThrow();
    for (const patch of [{ fragment: 2 }, { quote: "清点20台" }, { start: 1 }, { end: 300 }]) {
      const modified = { ...parsed, candidates: [{ ...parsed.candidates[0],
        citations: [{ ...parsed.candidates[0].citations[0], ...patch }] }] };
      expect(() => assertSkillCitations(modified, text)).toThrow();
    }
    expect(exactTextRange(text[0].text, 0, 2)).toBe("🧾");
  });

  it("已终止队列在列表和详情使用同一回执状态，派发后费用仍未知", () => {
    const queued = { state: "QUEUED", model: "fixture", baseUrl: "https://provider.invalid/v1", queuedAt: "2026-11-20T08:00:00Z" } as const;
    expect(effectiveAiExecution(queued, false)).toBe(queued);
    expect(effectiveAiExecution(queued, true)).toEqual({ ...queued, state: "FAILED", error: "UNAVAILABLE" });
    expect(effectiveAiExecution({ ...queued, state: "DISPATCHED" }, true))
      .toEqual({ ...queued, state: "UNCERTAIN", error: "INTERRUPTED" });
    const succeeded = { ...queued, state: "SUCCEEDED" } as const;
    expect(effectiveAiExecution(succeeded, true)).toBe(succeeded);
    expect(effectiveAiExecution(null, true)).toBeNull();
  });

  it("补件替换选定项的原段落，保留其它人工文本，拒绝误覆盖手工改值", () => {
    const decision = { candidate: 1, disposition: "NEEDS_SOURCE", value: "缺少报告。\n\n附件清单待核。", reason: "合同要求签字。" } as const;
    const prior = decisionParagraphs("PERFORMANCE", decision);
    const sections = { conclusion: "现场签收 12 台。", unresolved: "另有手工待办。\n\n" + prior.judgment + "\n\n催补原件。",
      supportingAnalysis: prior.reason + "\n\n律师手写依据。" };
    expect(removePriorDecision(sections, "PERFORMANCE", decision)).toEqual({
      conclusion: sections.conclusion, unresolved: "另有手工待办。\n\n催补原件。", supportingAnalysis: "律师手写依据。",
    });
    expect(() => removePriorDecision({ ...sections, unresolved: "律师已重写性能取舍。" }, "PERFORMANCE", decision)).toThrow("改写");
    expect(() => removePriorDecision({ ...sections, unresolved: prior.judgment + "\n\n" + prior.judgment }, "PERFORMANCE", decision)).toThrow("重复");
    expect(countNewFragments([{ ...range, end: range.end - 1 }, { ...range, end: range.end + 1 },
      { ...range, parseRunId: "c" + "x".repeat(24) }], [range])).toBe(2);
  });

  it("证据不足可明确标记，声称有依据必须引用且禁止重复候选", () => {
    const unstated = { ...result.candidates[0], citations: [] };
    expect(skillResultSchema.safeParse({ ...result, candidates: [unstated] }).success).toBe(false);
    expect(skillResultSchema.safeParse({ ...result, candidates: [{ ...unstated, assessment: "INSUFFICIENT" }] }).success).toBe(true);
    expect(skillResultSchema.safeParse({ ...result, candidates: [result.candidates[0], result.candidates[0]] }).success).toBe(false);
  });
});
