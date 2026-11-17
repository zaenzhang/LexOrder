// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyLawMetadata, emptyResearchContent, lawMetadataSchema, researchContentSchema, researchQuerySchema } from "@/server/research/contracts";

describe("研究范围与来源真实性", () => {
  it("未知法域和日期可存草稿，不默认适用最新法", () => {
    expect(researchContentSchema.parse({ ...emptyResearchContent(), question: "合成研究问题" })).toMatchObject({ jurisdiction: "", relevantDate: "" });
  });
  it("只有链接不能写成已读；无结果、失败、未取得保留不同状态", () => {
    expect(researchQuerySchema.safeParse({ query: "合成查询", location: "https://example.invalid", access: "LINK", outcome: "READ", notes: "" }).success).toBe(false);
    for (const outcome of ["NO_MATCH", "FAILED", "NOT_OBTAINED"] as const) {
      expect(researchQuerySchema.parse({ query: "合成查询", location: "", access: "NONE", outcome, notes: "" }).outcome).toBe(outcome);
    }
  });
  it("无效日历日和逆序效力期间被拒绝；法源核实需要身份与法域", () => {
    expect(researchContentSchema.safeParse({ ...emptyResearchContent(), question: "测试", relevantDate: "2025-02-30" }).success).toBe(false);
    expect(lawMetadataSchema.safeParse({ ...emptyLawMetadata(), effectiveFrom: "2025-03-01", effectiveTo: "2024-12-31" }).success).toBe(false);
    expect(lawMetadataSchema.safeParse({ ...emptyLawMetadata(), kind: "STATUTE", verification: "CHECKED" }).success).toBe(false);
  });
  it("人工查询可无材料绑定，采用的查询则保留确切材料身份", () => {
    const documentId = "cm00000000000000000000001";
    const manual = { query: "手工阅读范围", location: "", access: "NONE" as const, outcome: "NOT_OBTAINED" as const, notes: "" };
    const data = { ...emptyResearchContent(), question: "合成问题", queryLog: [manual, { ...manual, sourceDocumentId: documentId }],
      sources: [{ documentId, relation: "CONTEXT" as const, lawMetadata: emptyLawMetadata() }] };
    expect(researchContentSchema.parse(data).queryLog).toEqual(data.queryLog);
  });
  it("移除自动查询的来源或换成另一版本不能保存；自行移除查询后可继续", () => {
    const data = { ...emptyResearchContent(), question: "合成问题", queryLog: [{ query: "已编辑的采用记录", location: "", access: "SUMMARY" as const,
      outcome: "UNREAD" as const, notes: "保留手工批注", sourceDocumentId: "cm00000000000000000000001" }] };
    for (const sources of [[], [{ documentId: "cm00000000000000000000002", relation: "CONTEXT" as const, lawMetadata: emptyLawMetadata() }]]) {
      const result = researchContentSchema.safeParse({ ...data, sources });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: ["queryLog", 0, "sourceDocumentId"], message: expect.stringContaining("保留对应来源") });
    }
    expect(researchContentSchema.safeParse({ ...data, queryLog: [] }).success).toBe(true);
  });
});
