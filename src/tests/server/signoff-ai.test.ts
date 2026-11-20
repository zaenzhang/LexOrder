// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import type { FollowUp, SignoffAiExecution, SignoffKind, SkillResult } from "@/server/skills/signoff-contract";
import { signoffMethod } from "@/server/skills/signoff-contract";

const { db, aiChat, audit, checkLease, resolveActor, access, readBase, current, readFragments, readFollowUp } = vi.hoisted(() => ({
  db: { skillCommission: { findUniqueOrThrow: vi.fn(), update: vi.fn() } },
  aiChat: vi.fn(), audit: vi.fn(), checkLease: vi.fn(), resolveActor: vi.fn(),
  access: vi.fn(), readBase: vi.fn(), current: vi.fn(), readFragments: vi.fn(), readFollowUp: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/client")>(), aiChat,
}));
vi.mock("@/server/audit", () => ({ auditTx: audit }));
vi.mock("@/server/cron/queue", () => ({ assertCurrentJobLease: checkLease }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: resolveActor }));
vi.mock("@/server/matters/context-service", () => ({ contextAccess: access }));
vi.mock("@/server/research/service", () => ({
  researchTransaction: (client: typeof db, run: (tx: typeof db) => Promise<unknown>) => run(client),
}));
vi.mock("@/server/ai/fixed-fragments", () => ({ loadFixedFragments: readFragments }));
vi.mock("@/server/skills/signoff-service", () => ({
  baselineCurrent: current, readBase, readFollowUpPriorDecision: readFollowUp,
}));

import { processSignoffAi } from "@/server/skills/signoff-ai";

const commissionId = "00000000-0000-4000-8000-000000000001";
const payload = { commissionId };
const lease = { id: "job-1", leaseToken: "synthetic-lease" };
const text = "交接清单载明签收 12 台。签收记录只核对外观。";
const range = { documentId: "c" + "a".repeat(24), parseRunId: "c" + "b".repeat(24), anchorId: "p1", start: 0, end: text.length };
const fragment = { ...range, index: 1, name: "合成交接清单", version: 1, location: "第1页", text };
const queued: SignoffAiExecution = { state: "QUEUED", model: "fixture-model", baseUrl: "https://provider.invalid/v1",
  queuedAt: "2026-11-20T10:00:00Z" };

function commission() {
  return { id: commissionId, matterId: "matter-1", authorId: "local-author", baseResearchId: "research-1",
    ranges: [range], followUp: null as FollowUp | null, aiExecution: { ...queued }, result: null as SkillResult | null, submittedAt: null as Date | null };
}
let row: ReturnType<typeof commission>;
function providerReply(index: number, quote: string, kind: SignoffKind = "QUANTITY") {
  return { raw: { usage: { prompt_tokens: 347, completion_tokens: 79 } },
    content: JSON.stringify({ candidates: [{ kind, assessment: "SUPPORTED", finding: "清单显示签收数量",
      citations: [{ fragment: index, quote, relation: "SUPPORTS" }] }] }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  row = commission();
  db.skillCommission.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
  db.skillCommission.update.mockImplementation(async ({ data }: { data: Partial<typeof row> }) => Object.assign(row, data));
  resolveActor.mockResolvedValue({ id: row.authorId });
  access.mockResolvedValue({ canWrite: true });
  readBase.mockResolvedValue({ issue: { title: "现场签收几台设备？" } });
  current.mockReturnValue(true);
  readFragments.mockResolvedValue([fragment]);
});

describe("应用内签收核对作业", () => {
  it.each([
    { kind: "PERFORMANCE", state: "SUCCEEDED" },
    { kind: "QUANTITY", state: "FAILED" },
  ] as const)("补件只发送本批片段，只允许保存选定项：$kind", async ({ kind, state }) => {
    row.followUp = { kind: "PERFORMANCE", carried: [{ kind: "QUANTITY", commissionId }], newFragments: 1 };
    readFollowUp.mockResolvedValue({ disposition: "NEEDS_SOURCE", value: "旧待核意见", reason: "旧依据" });
    const supplement = "A-118：双方确认十二台设备的性能测试全部通过。";
    row.ranges = [{ ...range, end: supplement.length }];
    readFragments.mockResolvedValue([{ ...fragment, end: supplement.length, text: supplement }]);
    aiChat.mockResolvedValueOnce(providerReply(1, "性能测试全部通过", kind));
    await processSignoffAi(payload, lease);
    const [request] = aiChat.mock.calls[0];
    expect(request.messages[0].content).toContain("kind 必须为 PERFORMANCE");
    expect(JSON.parse(request.messages[1].content)).toEqual({
      question: "现场签收几台设备？", focus: "PERFORMANCE", fragments: [{ index: 1, text: supplement }],
    });
    expect(row.aiExecution).toMatchObject({ state, sentCharacters: supplement.length });
    expect(row.result?.candidates.map(item => item.kind) ?? null).toEqual(state === "SUCCEEDED" ? ["PERFORMANCE"] : null);
    expect(readFollowUp).toHaveBeenCalledTimes(state === "SUCCEEDED" ? 2 : 1);
  });

  it("原取舍的权限在派发前撤回时零模型调用", async () => {
    row.followUp = { kind: "PERFORMANCE", carried: [], newFragments: 1 };
    readFollowUp.mockRejectedValue(new ActionError("权限撤回"));
    await processSignoffAi(payload, lease);
    expect(aiChat).not.toHaveBeenCalled();
    expect(row.aiExecution).toMatchObject({ state: "FAILED", error: "PERMISSION" });
  });
  it("只委托一次已授权片段，按原句落位并保存供应方报告的用量", async () => {
    const quote = "签收 12 台";
    aiChat.mockImplementationOnce(async () => {
      expect(row.aiExecution.state).toBe("DISPATCHED");
      return providerReply(1, quote);
    });
    await processSignoffAi(payload, lease);
    await processSignoffAi(payload, lease);
    expect(aiChat).toHaveBeenCalledTimes(1);
    const [request] = aiChat.mock.calls[0];
    expect(request.expectedDestination).toEqual({ baseUrl: queued.baseUrl, model: queued.model });
    expect(JSON.parse(request.messages[1].content)).toEqual({ question: "现场签收几台设备？", fragments: [{ index: 1, text }] });
    expect(readFragments).toHaveBeenCalledTimes(2);
    expect(checkLease).toHaveBeenCalledWith(db, lease);
    expect(row.aiExecution).toMatchObject({ state: "SUCCEEDED", sentCharacters: text.length,
      usage: { inputTokens: 347, outputTokens: 79 } });
    expect(row.aiExecution.error).toBeUndefined();
    expect(row.submittedAt).toBeInstanceOf(Date);
    expect(row.result).toMatchObject({ commissionId, host: "INTERNAL_AI", methodVersion: signoffMethod.version,
      candidates: [{ citations: [{ fragment: 1, quote, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length }] }] });
  });

  it.each([
    { label: "超出委托片段序号", index: 2, quote: "签收 12 台" },
    { label: "引文在片段内重复", index: 1, quote: "签收" },
    { label: "引文未在原文出现", index: 1, quote: "签收 15 台" },
  ])("$label 时保留费用和错误，不写待核稿", async ({ index, quote }) => {
    aiChat.mockResolvedValueOnce(providerReply(index, quote));
    await processSignoffAi(payload, lease);
    expect(aiChat).toHaveBeenCalledTimes(1);
    expect(row.aiExecution).toMatchObject({ state: "FAILED", error: "RESULT", usage: { inputTokens: 347, outputTokens: 79 } });
    expect(row.result).toBeNull();
    expect(row.submittedAt).toBeNull();
  });

  it("已派发的中断作业恢复为费用未知，重新领取也不会再次调用模型", async () => {
    row.aiExecution = { ...queued, state: "DISPATCHED", dispatchedAt: queued.queuedAt };
    await processSignoffAi(payload, lease);
    await processSignoffAi(payload, lease);
    expect(aiChat).not.toHaveBeenCalled();
    expect(readFragments).not.toHaveBeenCalled();
    expect(row.aiExecution).toMatchObject({ state: "UNCERTAIN", error: "INTERRUPTED" });
    expect(row.aiExecution.usage).toBeUndefined();
    expect(row.result).toBeNull();
    expect(db.skillCommission.update).toHaveBeenCalledTimes(1);
  });

  it("模型已返回但来源读取权已撤回时，仅保留执行回执", async () => {
    readFragments.mockResolvedValueOnce([fragment]).mockRejectedValueOnce(new ActionError("材料已撤回"));
    aiChat.mockResolvedValueOnce(providerReply(1, "签收 12 台"));
    await processSignoffAi(payload, lease);
    expect(row.aiExecution).toMatchObject({ state: "FAILED", error: "PERMISSION", usage: { inputTokens: 347, outputTokens: 79 } });
    expect(row.result).toBeNull();
    expect(row.submittedAt).toBeNull();
  });
});
