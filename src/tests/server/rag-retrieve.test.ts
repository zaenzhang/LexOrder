// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { retrieveScopedEvidence, type RetrievalServices } from "@/server/rag/retrieve";
import type { RetrievalScope } from "@/lib/workbench/contracts";
import { createWorkPackage, successfulReply, unverifiedLegalSource } from "../fixtures/workbench-work-packages";

function harness(kind: "civil" | "arbitration" = "civil", mode: "PERSONAL" | "SERVER" = "PERSONAL") {
  const work = createWorkPackage(kind, mode);
  let scope: RetrievalScope = structuredClone(work.scope);
  const services = {
    loadScope: vi.fn(async (): Promise<unknown> => scope),
    retrieve: vi.fn(async (): Promise<unknown> => successfulReply(work)),
    loadAnchors: vi.fn(async (ids: readonly string[]): Promise<unknown[]> => work.anchors.filter(anchor => ids.includes(anchor.anchorId))),
  } satisfies RetrievalServices;
  return { work, services, current: () => scope, replace: (next: RetrievalScope) => { scope = next; } };
}

const query = { query: "交付、验收和付款有何材料？", limit: 10 };

describe("共用检索边界", () => {
  it.each(["PERSONAL", "SERVER"] as const)("同一工作包在 %s 适配契约下保留真实部分覆盖", async mode => {
    const h = harness("civil", mode);
    const result = await retrieveScopedEvidence(query, h.services);
    expect(result.status).toBe("PARTIAL");
    if (result.status === "ERROR") throw new Error(result.code);
    expect(result.retrievedAnchorIds).toEqual([h.work.documents[0].anchors[1].anchorId]);
    expect(result.hits[0].source).toEqual(h.work.documents[0].binding.source);
    expect(result.coverage.at(-1)?.coverage.units.at(-1)?.status).toBe("PENDING");
    expect(h.services.retrieve).toHaveBeenCalledWith(expect.objectContaining({ includeKnowledgeCompilation: false }));
  });

  it("空授权范围不会触发后端或原文查询", async () => {
    const h = harness();
    h.current().bindings = [];
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "EMPTY_SCOPE", hits: [], coverage: [], retrievedAnchorIds: [] });
    expect(h.services.retrieve).not.toHaveBeenCalled();
    expect(h.services.loadAnchors).not.toHaveBeenCalled();
  });

  it("普通输入不能指定 actor、模式或文档白名单", async () => {
    const h = harness();
    for (const extra of [{ actorId: "admin" }, { mode: "PERSONAL" }, { documentIds: [] }]) {
      expect(await retrieveScopedEvidence({ ...query, ...extra }, h.services)).toEqual({ status: "ERROR", code: "INVALID_INPUT" });
    }
    expect(h.services.loadScope).not.toHaveBeenCalled();
  });

  it("另案或重复映射在请求前拒绝", async () => {
    const h = harness();
    const binding = h.current().bindings[0];
    if (binding.source.kind !== "CASE_MATERIAL") throw new Error("fixture kind");
    binding.source.matterId = "another-matter";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_SCOPE" });
    h.replace(structuredClone(h.work.scope));
    h.current().bindings.push(structuredClone(h.current().bindings[0]));
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_SCOPE" });
    expect(h.services.retrieve).not.toHaveBeenCalled();
  });

  it("未知后端绑定在读取锚点前被拒绝，不披露原文", async () => {
    const h = harness();
    const reply = successfulReply(h.work);
    if (reply.status !== "SUCCESS") throw new Error("fixture reply");
    reply.hits[0].bindingId = "another-private-document";
    h.services.retrieve.mockResolvedValue(reply);
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_RESULT" });
    expect(h.services.loadAnchors).not.toHaveBeenCalled();
  });

  it("远端旧代次不能作为新结果发布", async () => {
    const h = harness();
    h.current().bindings[0].indexGenerationId = "new-generation";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "STALE_INDEX" });
  });

  it("不能混用相同维度的不同嵌入模型或不同后端实例", async () => {
    const h = harness();
    h.current().bindings[1].profile.embeddingModel = "another-model-same-dimensions";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "STALE_INDEX" });
    h.replace(structuredClone(h.work.scope));
    h.current().bindings[1].target.instanceId = "different-instance";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_SCOPE" });
    expect(h.services.retrieve).not.toHaveBeenCalled();
  });

  it("请求期间的配置改变同样使结果失效", async () => {
    const h = harness();
    h.services.retrieve.mockImplementation(async () => {
      h.current().bindings[0].profile.preprocessingVersion = "new-preprocessing";
      return successfulReply(h.work);
    });
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "SCOPE_CHANGED" });
  });

  it.each(["version", "parse", "quote", "unlocated", "unread"] as const)("拒绝片段不一致：%s", async mismatch => {
    const h = harness();
    h.services.loadAnchors.mockImplementation(async ids => h.work.anchors.filter(anchor => ids.includes(anchor.anchorId)).map(original => {
      const anchor = structuredClone(original);
      if (mismatch === "version") anchor.source.sha256 = "0".repeat(64);
      if (mismatch === "parse") anchor.parseGenerationId = "old-parse";
      if (mismatch === "quote") anchor.text = "篡改后的片段";
      if (mismatch === "unlocated") anchor.location = { kind: "UNLOCATED", reason: "NO_MAPPING" };
      if (mismatch === "unread") anchor.unit = 999;
      return anchor;
    }));
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_RESULT" });
  });

  it("第 2 页失败，不能用第 1 页 READY 状态包装其引用", async () => {
    const h = harness();
    h.current().bindings[0].coverage = { unitKind: "PAGE", totalUnits: 2, units: [{ unit: 1, status: "READY" }, { unit: 2, status: "FAILED" }] };
    h.services.loadAnchors.mockImplementation(async ids => h.work.anchors.filter(anchor => ids.includes(anchor.anchorId))
      .map(anchor => ({ ...anchor, unit: 1, location: { kind: "PAGE", page: 2 } })));
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_RESULT" });
  });

  it.each(["retrieve", "anchors"] as const)("在 %s 等待期间撤权后不返回任何材料", async stage => {
    const h = harness("arbitration", "SERVER");
    if (stage === "retrieve") {
      h.services.retrieve.mockImplementation(async () => {
        h.current().bindings = [];
        return successfulReply(h.work);
      });
    } else {
      h.services.loadAnchors.mockImplementation(async ids => {
        h.current().bindings = [];
        return h.work.anchors.filter(anchor => ids.includes(anchor.anchorId));
      });
    }
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "SCOPE_CHANGED" });
  });

  it("A 成员撤权不修改 B 的材料，材料整体撤回阻断后续查询", async () => {
    const a = harness("arbitration", "SERVER");
    const b = harness("arbitration", "SERVER");
    a.current().bindings = [];
    expect((await retrieveScopedEvidence(query, a.services)).status).toBe("EMPTY_SCOPE");
    expect((await retrieveScopedEvidence(query, b.services)).status).toBe("PARTIAL");
    for (const binding of b.current().bindings) binding.state = "WITHDRAWN";
    expect(await retrieveScopedEvidence(query, b.services)).toEqual({ status: "ERROR", code: "SCOPE_CHANGED" });
    expect(b.services.retrieve).toHaveBeenCalledTimes(1);
  });

  it("未核实法源不能被来源类型自动升级成可用于生成的依据", async () => {
    const h = harness();
    h.current().bindings[0].source = unverifiedLegalSource;
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "SOURCE_NOT_ELIGIBLE" });
    expect(h.services.retrieve).not.toHaveBeenCalled();
  });

  it("全未就绪及远端待核对与成功无命中分开", async () => {
    const h = harness();
    for (const binding of h.current().bindings) binding.state = "PROCESSING";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "NOT_READY" });
    h.current().bindings[0].state = "RECONCILIATION_REQUIRED";
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "RECONCILIATION_REQUIRED" });
    expect(h.services.retrieve).not.toHaveBeenCalled();
  });

  it("真正无命中、部分覆盖无命中与后端截断分开", async () => {
    const h = harness();
    h.services.retrieve.mockResolvedValue({ status: "SUCCESS", hits: [], truncated: false });
    expect((await retrieveScopedEvidence(query, h.services)).status).toBe("PARTIAL");
    h.current().bindings = h.current().bindings.slice(0, 1);
    expect((await retrieveScopedEvidence(query, h.services)).status).toBe("NO_MATCHES");
    h.services.retrieve.mockResolvedValue({ status: "SUCCESS", hits: [], truncated: true });
    expect((await retrieveScopedEvidence(query, h.services)).status).toBe("PARTIAL");
  });

  it.each(["UNAUTHORIZED", "RATE_LIMITED", "TIMEOUT", "UNSUPPORTED", "CANCELLED", "RECONCILIATION_REQUIRED"] as const)(
    "后端 %s 不变成成功空结果", async code => {
      const h = harness();
      h.services.retrieve.mockResolvedValue({ status: "ERROR", code });
      expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code });
    },
  );

  it("异常与恶意额外字段不泄漏原始响应或凭据", async () => {
    const h = harness();
    h.services.retrieve.mockRejectedValue(new Error("secret-token private-text"));
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "SERVICE_UNAVAILABLE" });
    h.services.retrieve.mockResolvedValue({ status: "SUCCESS", hits: [], truncated: false, debug: "private-text" });
    expect(await retrieveScopedEvidence(query, h.services)).toEqual({ status: "ERROR", code: "INVALID_RESULT" });
  });
});
