// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evidenceCandidateSchema, processingCoverageSchema, retrievalScopeSchema,
  runtimeContextSchema, sourceLocationSchema, sourceVersionSchema,
  type Citation,
} from "@/lib/workbench/contracts";
import {
  canGroundGeneration, coverageIsComplete, validateHistoricalCitation,
} from "@/lib/workbench/source-validation";
import {
  createWorkPackage, digest, draftPracticeSource, unverifiedLegalSource,
} from "../fixtures/workbench-work-packages";

describe("来源、覆盖与候选契约", () => {
  it("模式各有明确上下文，不能附加超级管理员或混入另一模式字段", () => {
    expect(runtimeContextSchema.safeParse({ mode: "PERSONAL", actorId: "a", workspaceId: "w" }).success).toBe(true);
    expect(runtimeContextSchema.safeParse({ mode: "PERSONAL", actorId: "a", workspaceId: "w", role: "SUPER_ADMIN" }).success).toBe(false);
    expect(runtimeContextSchema.safeParse({ mode: "SERVER", actorId: "a", workspaceId: "w" }).success).toBe(false);
  });

  it("覆盖不允许重复状态、漏项或已知范围以外的单元", () => {
    for (const units of [
      [{ unit: 1, status: "READY" }, { unit: 1, status: "FAILED" }],
      [{ unit: 1, status: "READY" }],
      [{ unit: 1, status: "READY" }, { unit: 3, status: "READY" }],
    ]) {
      expect(processingCoverageSchema.safeParse({ unitKind: "PAGE", totalUnits: 2, units }).success).toBe(false);
    }
  });

  it("未知总量、失败及截断均不能声称完整解析", () => {
    expect(coverageIsComplete({ unitKind: "PAGE", totalUnits: null, units: [{ unit: 1, status: "READY" }] })).toBe(false);
    for (const status of ["PENDING", "FAILED", "UNSUPPORTED", "TRUNCATED"] as const) {
      expect(coverageIsComplete({
        unitKind: "PAGE", totalUnits: 2, units: [{ unit: 1, status: "READY" }, { unit: 2, status }],
      })).toBe(false);
    }
    expect(coverageIsComplete({ unitKind: "PAGE", totalUnits: 1, units: [{ unit: 1, status: "READY" }] })).toBe(true);
  });

  it.each([
    { kind: "PAGE", page: 0 },
    { kind: "TEXT", start: 4, end: 4 },
    { kind: "PARAGRAPH", paragraph: 1, start: 4, end: 3 },
    { kind: "TABLE", sheet: "Sheet1", rowStart: 2, rowEnd: 1, columnStart: 1, columnEnd: 1 },
    { kind: "IMAGE", x: 0.9, y: 0, width: 0.2, height: 1 },
  ])("拒绝无效真实位置：%j", location => {
    expect(sourceLocationSchema.safeParse(location).success).toBe(false);
  });

  it("来源类型不能代替法源核实、正文权益或经验审核", () => {
    expect(sourceVersionSchema.safeParse(unverifiedLegalSource).success).toBe(true);
    expect(canGroundGeneration(unverifiedLegalSource)).toBe(false);
    if (unverifiedLegalSource.kind !== "LEGAL_AUTHORITY") throw new Error("fixture kind");
    const law = { ...unverifiedLegalSource, verification: "VERIFIED" as const };
    expect(canGroundGeneration(law)).toBe(true);
    expect(canGroundGeneration({ ...law, content: "SUMMARY" })).toBe(false);
    expect(canGroundGeneration({ ...law, canGenerate: false })).toBe(false);
    expect(canGroundGeneration({ ...law, canIndex: false })).toBe(false);
    expect(canGroundGeneration(draftPracticeSource)).toBe(false);
    if (draftPracticeSource.kind !== "PRACTICE_KNOWLEDGE") throw new Error("fixture kind");
    expect(canGroundGeneration({ ...draftPracticeSource, status: "APPROVED" })).toBe(true);
    expect(canGroundGeneration({ ...draftPracticeSource, status: "WITHDRAWN" })).toBe(false);
  });

  it("候选不能自行标记为已采纳或附加批准人", () => {
    const candidate = { targetId: "e", targetRevision: "r1", kind: "CLAIM", title: "客户陈述", content: "待核实", citations: [], reviewState: "PENDING" };
    expect(evidenceCandidateSchema.parse(candidate).kind).toBe("CLAIM");
    expect(evidenceCandidateSchema.safeParse({ ...candidate, reviewState: "ACCEPTED" }).success).toBe(false);
    expect(evidenceCandidateSchema.safeParse({ ...candidate, approvedBy: "a" }).success).toBe(false);
  });

  it("历史可读引用展示当前法源与经验资格，不恢复旧审核状态", () => {
    if (unverifiedLegalSource.kind !== "LEGAL_AUTHORITY" || draftPracticeSource.kind !== "PRACTICE_KNOWLEDGE") {
      throw new Error("fixture kind");
    }
    const pairs = [
      { before: { ...unverifiedLegalSource, verification: "VERIFIED" as const }, current: { ...unverifiedLegalSource, canGenerate: false } },
      { before: { ...draftPracticeSource, status: "APPROVED" as const }, current: { ...draftPracticeSource, status: "WITHDRAWN" as const } },
    ];
    for (const pair of pairs) {
      const anchor = { ...createWorkPackage("civil").anchors[1], source: pair.before };
      const citation = { anchorId: anchor.anchorId, source: pair.before, relation: "CONTEXT" };
      const result = validateHistoricalCitation(citation, anchor, [pair.current]);
      expect(result.status).toBe("AVAILABLE");
      if (result.status === "AVAILABLE") {
        expect(result.anchor.source).toEqual(pair.current);
        expect(canGroundGeneration(result.anchor.source)).toBe(false);
      }
    }
  });
});

describe.each(["civil", "arbitration"] as const)("合成工作包 %s", kind => {
  it("使用真实 UTF-8 字节与可还原文字位置；工程标注保持待专业复核", () => {
    const work = createWorkPackage(kind);
    expect(work.professionalReview).toBe("PENDING");
    for (const doc of work.documents) {
      expect(new TextDecoder().decode(doc.bytes)).toBe(doc.original);
      expect(digest(doc.bytes)).toBe(doc.binding.source.sha256);
      for (const anchor of doc.anchors) {
        if (anchor.location.kind !== "TEXT") throw new Error("fixture location");
        expect(doc.original.slice(anchor.location.start, anchor.location.end)).toBe(anchor.text);
      }
    }
    expect(work.scope.bindings.some(binding => !coverageIsComplete(binding.coverage))).toBe(true);
  });

  it("两模式使用相同材料和引用身份，分别映射到各自后端", () => {
    const personal = createWorkPackage(kind, "PERSONAL");
    const server = createWorkPackage(kind, "SERVER");
    expect(retrievalScopeSchema.safeParse(personal.scope).success).toBe(true);
    expect(retrievalScopeSchema.safeParse(server.scope).success).toBe(true);
    expect(personal.anchors).toEqual(server.anchors);
    expect(personal.scope.bindings.map(item => item.source)).toEqual(server.scope.bindings.map(item => item.source));
    const wrongMode = { ...personal.scope, bindings: server.scope.bindings };
    expect(retrievalScopeSchema.safeParse(wrongMode).success).toBe(false);
  });

  it("同族新版本不覆盖旧引用，重建索引不妨碍旧成果回看", () => {
    const work = createWorkPackage(kind);
    const second = work.documents.find(doc => doc.version === 2)!;
    const first = work.documents.find(doc => doc.familyId === second.familyId && doc.version === 1)!;
    expect(first.id).not.toBe(second.id);
    expect(first.binding.source.sha256).not.toBe(second.binding.source.sha256);
    const anchor = first.anchors[1];
    const citation: Citation = { anchorId: anchor.anchorId, source: anchor.source, relation: "SUPPORTS" };
    first.binding.indexGenerationId = "rebuilt-new-index";
    const result = validateHistoricalCitation(citation, anchor, work.scope.bindings.map(binding => binding.source));
    expect(result.status).toBe("AVAILABLE");
    if (result.status === "AVAILABLE") {
      expect(result.anchor.source).toEqual(first.binding.source);
      expect(result.anchor.text).toBe(kind === "civil" ? "客户台账累计付款40000.00元。" : "会议纪要：演示完成。");
    }
    expect(validateHistoricalCitation(citation, second.anchors[1], [first.binding.source]).status).toBe("ERROR");
  });

  it("旧引用同样受当前授权和原件 hash 限制，错误不返回正文", () => {
    const work = createWorkPackage(kind);
    const anchor = work.anchors[1];
    const citation: Citation = { anchorId: anchor.anchorId, source: anchor.source, relation: "REBUTS" };
    expect(validateHistoricalCitation(citation, anchor, [])).toEqual({ status: "ERROR", code: "UNAVAILABLE" });
    const altered = { ...anchor.source, sha256: digest(work.documents[0].original + "改") };
    expect(validateHistoricalCitation(citation, anchor, [altered])).toEqual({ status: "ERROR", code: "UNAVAILABLE" });
  });
});
