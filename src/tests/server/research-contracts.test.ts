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
});
