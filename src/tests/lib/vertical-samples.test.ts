// @vitest-environment node
/**
 * 纵向边界样例：
 * A. 上传入口保留原件身份、加密策略与 checkout 基线，持久版本链交给 ingest。
 *    真实版本链、原件保存和事务回滚由 material-ingest 集成用例验证，
 *    此处不在 Prisma mock 内重写一套持久化状态机。
 * B. 期限确认后，队列失败接续携带每次领取的 JobLease，旧租约不能完成重试。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    document: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    deadline: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  },
  session: { user: { id: "u1", role: "PRINCIPAL_LAWYER", rolePermissions: undefined } },
  ingest: vi.fn(), encrypt: vi.fn(), hash: vi.fn(), checkout: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => mocks.session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn(), auditStrict: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: vi.fn(), assertMatterWritable: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ assertCanAccessMatter: vi.fn(), assertCanModifyMatter: vi.fn(), assertCanHandleMatter: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ refreshScheduleReminderAfterSave: vi.fn(), retireScheduleReminders: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/documents/material-ingest", () => ({ ingestMaterial: mocks.ingest, withdrawMaterial: vi.fn() }));
vi.mock("@/lib/storage/crypto", () => ({ encryptBuffer: mocks.encrypt, sha256: mocks.hash }));
vi.mock("@/lib/desktop/checkout-token", () => ({ verifyCheckoutToken: mocks.checkout }));

import { uploadNewVersion } from "@/server/documents/actions";
import { confirmDeadline } from "@/server/deadlines/confirm";
import { failJob, completeJob, backoffMs, type JobLease } from "@/server/cron/queue";

function priorDocument() {
  return { id: "d-v1", name: "合成合同.pdf", category: "OTHER", isLatest: true, version: 1,
    sha256: "a".repeat(64), encrypted: false, deletedAt: null, familyId: "d-v1", matterId: "m1", intakeId: null,
    procedureId: null, stageId: null, folderId: null, sourceParty: null, sourceOrigin: null,
    tags: ["合成"], archiveChecklistItemId: null };
}
let prior: ReturnType<typeof priorDocument>;
let confirmed = false;
const bytes = new Uint8Array([1, 2, 3]);
const file = () => new File([bytes], "合成合同-v2.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.resetAllMocks();
  prior = priorDocument();
  confirmed = false;
  mocks.db.document.findUnique.mockImplementation(async () => prior);
  mocks.ingest.mockResolvedValue({ id: "d-v2", version: 2 });
  mocks.hash.mockReturnValue("b".repeat(64));
  mocks.encrypt.mockReturnValue({ ciphertext: Buffer.from("synthetic cipher"), iv: Buffer.from("iv"), authTag: Buffer.from("tag"), algorithm: "aes-256-gcm" });
  mocks.db.deadline.findUnique.mockImplementation(async () => ({
    id: "cidl000000000000000000001", confirmStatus: confirmed ? "CONFIRMED" : "PENDING",
    procedure: { matterId: "m1" }, sourceRuleId: "r1", dueAt: new Date(),
  }));
  mocks.db.deadline.updateMany.mockImplementation(async () => { confirmed = true; return { count: 1 }; });
  mocks.db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(mocks.db));
});

describe("纵向样例 A：上传版本边界", () => {
  it.each([false, true])("保留旧原件身份和加密策略 encrypted=%s，版本提交由 ingest 返回", async encrypted => {
    prior.encrypted = encrypted;
    const original = structuredClone(prior);
    const result = await uploadNewVersion({ documentId: prior.id, file: file() });
    expect(result).toEqual({ ok: true, id: "d-v2", version: 2 });
    expect(prior).toEqual(original);
    expect(mocks.db.document.update).not.toHaveBeenCalled();
    expect(mocks.db.document.updateMany).not.toHaveBeenCalled();
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(Buffer.from(bytes));
    const saved = mocks.ingest.mock.calls[0][0];
    expect(saved).toMatchObject({ userId: "u1", priorDocumentId: "d-v1",
      document: { matterId: "m1", sha256: "b".repeat(64), encrypted, mimeType: "application/pdf", size: 3, tags: ["合成"] } });
    if (encrypted) {
      const enc = mocks.encrypt.mock.results[0].value;
      expect(mocks.encrypt).toHaveBeenCalledExactlyOnceWith(Buffer.from(bytes));
      expect(saved.bytes).toEqual(enc.ciphertext);
      expect(saved.document).toMatchObject({ algorithm: enc.algorithm, iv: enc.iv.toString("base64"), authTag: enc.authTag.toString("base64") });
    } else {
      expect(mocks.encrypt).not.toHaveBeenCalled();
      expect(saved.bytes).toEqual(Buffer.from(bytes));
      expect(saved.document).toMatchObject({ algorithm: null, iv: null, authTag: null });
    }
  });

  it("非最新基线的新请求拒绝仍传播；已提交请求丢回执可由 ingest 幂等重放", async () => {
    prior.isLatest = false;
    mocks.ingest.mockRejectedValueOnce(new Error("原材料版本已变化，请刷新后重传"));
    await expect(uploadNewVersion({ documentId: prior.id, file: file() })).rejects.toThrow("原材料版本已变化");
    const requestKey = "d983fc86-631c-4a41-a69d-d5e935b0901f";
    expect(await uploadNewVersion({ documentId: prior.id, file: file(), requestKey })).toMatchObject({ id: "d-v2", version: 2 });
    expect(mocks.ingest).toHaveBeenLastCalledWith(expect.objectContaining({ priorDocumentId: prior.id, requestKey }));
    expect(prior).toMatchObject({ isLatest: false, version: 1, sha256: "a".repeat(64) });
  });

  it("checkout 基线冲突在入库前被拒，匹配时把基线与 jti 传到最终事务", async () => {
    mocks.checkout.mockReturnValue({ docId: prior.id, userId: "u1", baselineVersion: 2, jti: "synthetic-checkout" });
    prior.version = 3;
    await expect(uploadNewVersion({ documentId: prior.id, file: file(), checkoutToken: "verified-fixture" })).rejects.toThrow("已被他人更新为第 3 版");
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    prior.version = 2;
    mocks.ingest.mockResolvedValueOnce({ id: "d-v3", version: 3 });
    expect(await uploadNewVersion({ documentId: prior.id, file: file(), checkoutToken: "verified-fixture" })).toMatchObject({ version: 3 });
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ checkout: { jti: "synthetic-checkout", baselineVersion: 2 } }));
  });
});

describe("纵向样例 B：确认与队列接续", () => {
  it("待确认期限确认后固定；重复确认被拒", async () => {
    expect(await confirmDeadline({ id: "cidl000000000000000000001" })).toEqual({ ok: true });
    expect(confirmed).toBe(true);
    await expect(confirmDeadline({ id: "cidl000000000000000000001" })).rejects.toThrow("该期限已确认");
  });

  it("失败返回退避重试，重新领取使用新 token，旧执行与重复完成不计成功", async () => {
    const first: JobLease = { id: "j1", leaseToken: "first-attempt" };
    const retry: JobLease = { id: "j1", leaseToken: "retry-attempt" };
    mocks.db.$queryRaw.mockResolvedValueOnce([{ status: "FAILED" }]);
    expect(await failJob(first, 5, "synthetic webhook timeout")).toBe("RETRY");
    expect((mocks.db.$queryRaw.mock.calls[0][0] as Prisma.Sql).values).toContain(first.leaseToken);
    mocks.db.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await completeJob(first)).toBe(false);
    expect(await completeJob(retry)).toBe(true);
    expect(await completeJob(retry)).toBe(false);
    expect((mocks.db.$executeRaw.mock.calls[1][0] as Prisma.Sql).values).toContain(retry.leaseToken);
    expect(backoffMs(2)).toBeGreaterThanOrEqual(backoffMs(1));
  });
});
