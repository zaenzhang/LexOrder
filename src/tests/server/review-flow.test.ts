// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), actor: vi.fn(), readable: vi.fn(), outbound: vi.fn(), chat: vi.fn(), settings: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
  storage: { readFile: vi.fn(), writeFileAt: vi.fn(), deleteFile: vi.fn() },
  db: { $transaction: vi.fn(), $queryRaw: vi.fn(),
    document: { findFirst: vi.fn(), create: vi.fn() },
    matter: { findUnique: vi.fn(), findFirst: vi.fn() },
    reviewRecord: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.readable }));
vi.mock("@/server/intakes/workflow", () => ({ currentActor: mocks.actor }));
vi.mock("@/server/ai/document-access", () => ({ assertCanReviewDocument: mocks.outbound }));
vi.mock("@/lib/ai/settings", () => ({ getAiSettings: mocks.settings }));
vi.mock("@/lib/ai/client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/ai/client")>(), aiChat: mocks.chat }));
vi.mock("@/lib/storage", () => ({ storage: mocks.storage }));
vi.mock("@/lib/storage/crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/storage/crypto")>();
  return { ...actual, sha256: vi.fn(actual.sha256) };
});
vi.mock("@/server/audit", () => ({ auditTx: mocks.audit }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: mocks.revalidate }));

import { reviewDocument } from "@/server/ai/review-document";
import { getReviewRecord, listReviewHistory } from "@/server/ai/review-history";
import { saveReviewToMatter } from "@/server/ai/save-review";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { sha256 } from "@/lib/storage/crypto";
import { summarizeReviewCoverage, type ReviewCoverage } from "@/lib/ai/review-coverage";

const input = { matterId: "matter-a", documentId: "document-a" };
const recordInput = { ...input, recordId: "review-a" };
const item = { type: "RISK", severity: "HIGH", title: "合成条款问题", detail: "需要人工核对合成条款。" };
const reviewedAt = new Date("2026-11-16T10:00:00Z");
let bytes: Buffer;
let source: ReturnType<typeof makeSource>;
let record: ReturnType<typeof makeRecord>;
let savedReport: { id: string; name: string; matterId: string; uploadedById: string; deletedAt: null } | null;

function makeSource(text: string) {
  bytes = Buffer.from(text);
  return { id: input.documentId, matterId: input.matterId, intakeId: null, name: "合成材料.txt", version: 3,
    uploadedById: "actor", deletedAt: null, path: "synthetic/source", mimeType: "text/plain", category: "OTHER",
    size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encrypted: false,
    algorithm: null, iv: null, authTag: null };
}
function makeRecord() {
  const coverageJson: ReviewCoverage = { totalChars: 30, totalSegments: 1, segments: [{ index: 1, chars: 30, status: "SUCCEEDED", errorCode: null }], stopReason: null };
  return { id: recordInput.recordId, ...input, reviewedAt, reviewedBy: { id: "actor", name: "合成人员" },
    itemsJson: [item], coverageJson: coverageJson as ReviewCoverage | null,
    sourceSha256: source.sha256 as string | null, reportDocumentId: null as string | null };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sha256).mockImplementation(data => createHash("sha256").update(data).digest("hex"));
  source = makeSource("甲".repeat(30));
  record = makeRecord();
  savedReport = null;
  mocks.session.mockResolvedValue({ user: { id: "actor", role: "PRINCIPAL_LAWYER" } });
  mocks.actor.mockResolvedValue({ id: "actor", role: "PRINCIPAL_LAWYER" });
  mocks.readable.mockResolvedValue(true);
  mocks.outbound.mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ configured: true });
  mocks.chat.mockResolvedValue({ content: JSON.stringify([item]) });
  mocks.db.$transaction.mockImplementation(callback => callback(mocks.db));
  mocks.db.$queryRaw.mockResolvedValue([]);
  mocks.db.matter.findUnique.mockResolvedValue({ status: "ACTIVE", deletedAt: null });
  mocks.db.matter.findFirst.mockResolvedValue({ status: "ACTIVE" });
  mocks.db.document.findFirst.mockImplementation(async args => args.where.id === source.id ? source : savedReport?.id === args.where.id ? savedReport : null);
  mocks.db.document.create.mockImplementation(async args => {
    savedReport = { id: "creport000000000000000001", name: args.data.name, matterId: input.matterId, uploadedById: "actor", deletedAt: null };
    return savedReport;
  });
  mocks.db.reviewRecord.findFirst.mockImplementation(async args => args.where.id === record.id && args.where.documentId === record.documentId && args.where.matterId === record.matterId ? record : null);
  mocks.db.reviewRecord.findMany.mockResolvedValue([record]);
  mocks.db.reviewRecord.create.mockResolvedValue({ id: record.id, reviewedAt });
  mocks.db.reviewRecord.updateMany.mockImplementation(async args => { record.reportDocumentId = args.data.reportDocumentId; return { count: 1 }; });
  mocks.storage.readFile.mockImplementation(async () => bytes);
  mocks.storage.writeFileAt.mockResolvedValue(undefined);
  mocks.storage.deleteFile.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.revalidate.mockResolvedValue(undefined);
});

describe("新审查的来源与覆盖", () => {
  it("实际读取的原件只 hash 一次，并将版本/覆盖与记录一起保存", async () => {
    const result = await reviewDocument(input);
    expect(sha256).toHaveBeenCalledTimes(1);
    expect(mocks.storage.readFile).toHaveBeenCalledWith(source.path);
    expect(result).toMatchObject({ ...input, recordId: record.id, documentVersion: 3, reportReady: true });
    expect(mocks.db.reviewRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceSha256: source.sha256, coverageJson: result.coverage, itemsJson: [item] }) }));
    expect(mocks.outbound).toHaveBeenCalledTimes(3); // entry, first request, publication
    expect(mocks.outbound).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ id: source.id, sha256: source.sha256 }), mocks.db);
  });

  it("原件变化或读取无权，均在模型请求前终止", async () => {
    mocks.storage.readFile.mockResolvedValue(Buffer.from("changed"));
    await expect(reviewDocument(input)).rejects.toThrow("原材料与保存的版本不一致");
    expect(mocks.chat).not.toHaveBeenCalled();
    mocks.readable.mockResolvedValue(false);
    await expect(reviewDocument(input)).rejects.toThrow("无权读取");
    expect(mocks.db.reviewRecord.create).not.toHaveBeenCalled();
  });

  it("未配置模型不读原件、不创建完成记录", async () => {
    mocks.settings.mockResolvedValue({ configured: false });
    await expect(reviewDocument(input)).rejects.toThrow("未启用");
    expect(mocks.storage.readFile).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.db.reviewRecord.create).not.toHaveBeenCalled();
  });

  it("中途传输失败保留前段有效项，失败和未请求范围分别记录", async () => {
    source = makeSource("甲".repeat(15000));
    mocks.chat.mockResolvedValueOnce({ content: JSON.stringify([item]) }).mockRejectedValueOnce(new Error("transport failed"));
    const result = await reviewDocument(input);
    expect(result.items).toEqual([item]);
    expect(summarizeReviewCoverage(result.coverage)).toMatchObject({ status: "PARTIAL", completedChars: 6000, failedChars: 6000, notSentChars: 3000 });
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(result.reportReady).toBe(true);
  });

  it("不合合同的模型回复是失败，不生成空清单假成功", async () => {
    mocks.chat.mockResolvedValue({ content: '[{"type":"RISK","severity":"UNKNOWN","title":"x","detail":"y"}]' });
    const result = await reviewDocument(input);
    expect(summarizeReviewCoverage(result.coverage).status).toBe("FAILED");
    expect(result.coverage.segments[0].errorCode).toBe("INVALID_RESPONSE");
    expect(result.reportReady).toBe(false);
  });

  it("模型在第一段之后停用时，下一段仍属未请求", async () => {
    source = makeSource("甲".repeat(12000));
    mocks.chat.mockResolvedValueOnce({ content: "[]" }).mockRejectedValueOnce(new AiNotConfiguredError());
    const result = await reviewDocument(input);
    expect(result.coverage.stopReason).toBe("MODEL_UNAVAILABLE");
    expect(summarizeReviewCoverage(result.coverage)).toMatchObject({ sentSegments: 1, completedSegments: 1, failedSegments: 0, notSentSegments: 1 });
  });

  it("中途撤回/撤权在下一段前终止，不发布迟到结果", async () => {
    source = makeSource("甲".repeat(12000));
    mocks.outbound.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("材料已撤回"));
    await expect(reviewDocument(input)).rejects.toThrow("材料已撤回");
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.db.reviewRecord.create).not.toHaveBeenCalled();
  });

  it("完成模型请求后来源失效，发布事务仍拒绝", async () => {
    mocks.outbound.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("原材料版本已变化"));
    await expect(reviewDocument(input)).rejects.toThrow("原材料版本已变化");
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.db.reviewRecord.create).not.toHaveBeenCalled();
  });
});

describe("历史读取仍受原材料资格限制", () => {
  it("无原文权限不触达历史正文查询", async () => {
    mocks.readable.mockResolvedValue(false);
    await expect(listReviewHistory(input)).rejects.toThrow("无权读取");
    await expect(getReviewRecord(recordInput)).rejects.toThrow("无权读取");
    expect(mocks.db.reviewRecord.findMany).not.toHaveBeenCalled();
    expect(mocks.db.reviewRecord.findFirst).not.toHaveBeenCalled();
  });

  it("详情绑定案件、材料和记录，不能凭 recordId 读取别的材料", async () => {
    record.documentId = "different-document";
    await expect(getReviewRecord(recordInput)).rejects.toThrow("不属于当前材料");
    expect(mocks.db.reviewRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: recordInput.recordId, ...input } }));
  });

  it("历史不依赖可用模型；旧记录范围为未知且不能发布报告", async () => {
    record.sourceSha256 = null;
    record.coverageJson = null;
    const detail = await getReviewRecord(recordInput);
    expect(detail).toMatchObject({ coverage: null, reportReady: false, items: [item] });
    expect((await listReviewHistory(input))[0]).toMatchObject({ coverage: null, reportReady: false });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("来源 hash 变化使历史读取显式失败", async () => {
    record.sourceSha256 = "f".repeat(64);
    await expect(getReviewRecord(recordInput)).rejects.toThrow("版本不一致");
  });
});

describe("报告保存只消费可信记录", () => {
  it("服务端生成正文、版本与覆盖，记录和报告在同一事务关联", async () => {
    const result = await saveReviewToMatter(recordInput);
    const body = mocks.storage.writeFileAt.mock.calls[0][1].toString("utf8");
    expect(body).toContain("来源版本：3");
    expect(body).toContain(item.title);
    expect(body).toContain("有效回复：30 字符 / 1 段");
    expect(mocks.db.document.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, tags: ["AI审查"] }) }));
    expect(mocks.db.document.create.mock.calls[0][0].data).not.toHaveProperty("id");
    expect(mocks.db.document.create.mock.calls[0][0].data).toMatchObject({ familyId: expect.any(String), sourceOrigin: "TEAM_PRODUCED" });
    expect(mocks.db.reviewRecord.updateMany).toHaveBeenCalledWith({ where: { id: record.id, ...input, sourceSha256: source.sha256, reportDocumentId: null }, data: { reportDocumentId: result.documentId } });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ action: "AI_REVIEW_SAVE", targetId: record.id }));
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
    expect(sha256).toHaveBeenCalledTimes(1);
  });

  it("同一记录重试返回已绑定报告，不再次写文件或计算 hash", async () => {
    const first = await saveReviewToMatter(recordInput);
    const second = await saveReviewToMatter(recordInput);
    expect(second).toEqual(first);
    expect(mocks.storage.writeFileAt).toHaveBeenCalledTimes(1);
    expect(mocks.db.document.create).toHaveBeenCalledTimes(1);
    expect(sha256).toHaveBeenCalledTimes(1);
  });

  it("客户端不能提交报告正文、冒名材料或审查条目", async () => {
    await expect(saveReviewToMatter({ ...recordInput, items: [item] } as typeof recordInput)).rejects.toThrow();
    expect(mocks.storage.writeFileAt).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(["unknown", "failed", "revoked", "archived"])("%s 记录/资格不能保存报告", async condition => {
    if (condition === "unknown") { record.sourceSha256 = null; record.coverageJson = null; }
    if (condition === "failed") record.coverageJson!.segments[0] = { index: 1, chars: 30, status: "FAILED", errorCode: "INVALID_RESPONSE" };
    if (condition === "revoked") mocks.readable.mockResolvedValue(false);
    if (condition === "archived") mocks.db.matter.findFirst.mockResolvedValue({ status: "ARCHIVED" });
    await expect(saveReviewToMatter(recordInput)).rejects.toThrow();
    expect(mocks.storage.writeFileAt).not.toHaveBeenCalled();
    expect(mocks.db.document.create).not.toHaveBeenCalled();
  });

  it("文件已发布但写调用返回失败时，仍按预分配路径清理", async () => {
    mocks.storage.writeFileAt.mockRejectedValue(new Error("sync failed after publish"));
    await expect(saveReviewToMatter(recordInput)).rejects.toThrow("sync failed after publish");
    const reserved = mocks.storage.writeFileAt.mock.calls[0][0];
    expect(reserved).toMatch(/^m_matter-a\/\d{6}\/[a-f0-9-]+\.bin$/);
    expect(mocks.storage.deleteFile).toHaveBeenCalledWith(reserved);
    expect(mocks.db.document.create).not.toHaveBeenCalled();
  });

  it("审计失败回滚并清理已写文件；不把失败报告返回成功", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(saveReviewToMatter(recordInput)).rejects.toThrow("audit unavailable");
    expect(mocks.storage.deleteFile).toHaveBeenCalledWith(mocks.storage.writeFileAt.mock.calls[0][0]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("提交后的刷新失败不会删除已绑定文件，重试仍返回同一报告", async () => {
    mocks.revalidate.mockRejectedValueOnce(new Error("refresh failed"));
    await expect(saveReviewToMatter(recordInput)).rejects.toThrow("refresh failed");
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
    const result = await saveReviewToMatter(recordInput);
    expect(result.documentId).toBe(record.reportDocumentId);
    expect(mocks.storage.writeFileAt).toHaveBeenCalledTimes(1);
  });

  it("提交响应不明确时不删除可能已提交的报告原件", async () => {
    mocks.db.$transaction.mockImplementationOnce(async callback => {
      await callback(mocks.db);
      throw new Error("commit response lost");
    });
    await expect(saveReviewToMatter(recordInput)).rejects.toThrow("commit response lost");
    expect(mocks.storage.writeFileAt).toHaveBeenCalledOnce();
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
  });
});
