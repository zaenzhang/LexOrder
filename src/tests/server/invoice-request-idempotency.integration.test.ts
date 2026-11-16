// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";

// Only the coordinator migrates and runs the dedicated disposable PostgreSQL database.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("开票幂等集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { createInvoiceRequest } from "@/server/finance/actions";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], groupIds: string[] = [];
function sessionFor(user: User) {
  vi.mocked(requireSession).mockResolvedValue({ user: { ...user, runtimeMode: "SERVER" }, expires: "2099-01-01" });
}
async function actor() {
  const user = await db.user.create({ data: { name: "合成开票经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id); return user;
}
async function fixture() {
  const user = await actor(), approver = await actor();
  const matter = await db.matter.create({ data: { title: "合成开票身份案件", internalCode: `INVOICE-CREATE-${randomUUID()}`, ownerId: user.id, category: "CIVIL_COMMERCIAL" } });
  matterIds.push(matter.id);
  const doc = await db.document.create({ data: { name: "合成委托依据.pdf", matterId: matter.id, uploadedById: user.id, path: `invoice-create-test/${randomUUID()}.pdf`, mimeType: "application/pdf", sha256: "a".repeat(64), tags: [] } });
  documentIds.push(doc.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `invoice-create-${randomUUID()}`, members: { create: { userId: approver.id } }, rules: { create: { action: "INVOICE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } });
  groupIds.push(group.id); sessionFor(user);
  return { user, approver, matter, doc };
}
function inputFor(f: Awaited<ReturnType<typeof fixture>>) {
  return { requestKey: randomUUID(), matterId: f.matter.id, amount: "120.00", invoiceType: "PLAIN" as const, invoiceItem: "LAWYER_FEE" as const, buyerName: "合成开票购方", evidenceDocIds: [f.doc.id] };
}
async function counts(id: string) {
  return { audits: await db.auditLog.count({ where: { targetType: "InvoiceRequest", targetId: id, action: "INVOICE_REQUEST_CREATE" } }), notifications: await db.notification.count({ where: { refType: "InvoiceRequest", refId: id } }) };
}

describe.skipIf(!databaseUrl)("开票申请幂等：真实 PG", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Retain invoices and audit history. Retire only the synthetic access and source fixtures.
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groupIds } }, data: { active: false } });
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("并发同键与响应丢失重放只创建一次，后续批准/已开票状态及通知保持原样", async () => {
    const f = await fixture(), input = inputFor(f);
    const [first, second] = await Promise.all([
      createInvoiceRequest({ ...input, requestKey: input.requestKey.toUpperCase(), amount: 120, buyerName: ` ${input.buyerName} ` }),
      createInvoiceRequest({ ...input, evidenceDocIds: [f.doc.id, f.doc.id], requestNote: " " }),
    ]);
    expect(first).toEqual(second);
    expect(await db.invoiceRequest.count({ where: { requestedById: f.user.id } })).toBe(1);
    const initial = await counts(first.id);
    expect(initial.audits).toBe(1); expect(initial.notifications).toBeGreaterThan(0);
    // Discard the first response and repeat the exact business intent.
    expect(await createInvoiceRequest(input)).toEqual(first);
    expect(await counts(first.id)).toEqual(initial);
    // Fixtures model subsequent execution; this test does not certify approval or file issuance UI.
    for (const status of ["APPROVED", "ISSUED"] as const) {
      await db.invoiceRequest.update({ where: { id: first.id }, data: { status, processedById: f.approver.id, processedAt: new Date(), ...(status === "ISSUED" ? { invoiceNo: `SYNTHETIC-${randomUUID()}`, issuedAt: new Date() } : {}) } });
      const before = await db.invoiceRequest.findUniqueOrThrow({ where: { id: first.id } });
      expect(await createInvoiceRequest(input)).toEqual({ id: first.id, status });
      expect(await db.invoiceRequest.findUniqueOrThrow({ where: { id: first.id } })).toEqual(before);
      expect(await counts(first.id)).toEqual(initial);
    }
  });

  it("数据库唯一身份、成对格式及身份不可变；旧行双 null 不补造", async () => {
    const f = await fixture(), input = inputFor(f), created = await createInvoiceRequest(input);
    const saved = await db.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.requestKey).toBe(input.requestKey); expect(saved.requestHash).toMatch(/^[0-9a-f]{64}$/);
    const raw = { matterId: f.matter.id, requestedById: f.user.id, amount: 120, requestKey: input.requestKey, requestHash: saved.requestHash };
    await expect(db.invoiceRequest.create({ data: raw })).rejects.toThrow();
    await expect(db.invoiceRequest.create({ data: { ...raw, requestKey: randomUUID(), requestHash: null } })).rejects.toThrow();
    await expect(db.invoiceRequest.create({ data: { ...raw, requestKey: "invalid-key" } })).rejects.toThrow();
    for (const data of [{ requestKey: null, requestHash: null }, { requestHash: "b".repeat(64) }, { requestedById: f.approver.id }]) {
      await expect(db.invoiceRequest.update({ where: { id: created.id }, data })).rejects.toThrow(/immutable/i);
    }
    const legacy = await db.invoiceRequest.create({ data: { matterId: f.matter.id, requestedById: f.user.id, amount: 12, buyerName: "合成无身份历史行" } });
    expect(legacy).toMatchObject({ requestKey: null, requestHash: null });
    await db.invoiceRequest.update({ where: { id: legacy.id }, data: { requestNote: "合成历史说明" } });
    await expect(db.invoiceRequest.update({ where: { id: legacy.id }, data: { requestKey: randomUUID(), requestHash: "c".repeat(64) } })).rejects.toThrow(/immutable/i);
    expect(await db.invoiceRequest.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ requestKey: null, requestHash: null });
  });

  it("并发同键异载荷只允许一个赢家；旧会话撤销资格后不能读取重放结果", async () => {
    const f = await fixture(), input = inputFor(f);
    const attempts = await Promise.allSettled([createInvoiceRequest(input), createInvoiceRequest({ ...input, amount: "121.00" })]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("内容不同");
    const saved = await db.invoiceRequest.findUniqueOrThrow({ where: { requestedById_requestKey: { requestedById: f.user.id, requestKey: input.requestKey } } });
    const replay = { ...input, amount: saved.amount.toFixed(2) };
    const initial = await counts(saved.id);
    expect(initial.audits).toBe(1);
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(createInvoiceRequest(replay)).rejects.toThrow("当前账号或岗位已变化");
    await db.user.update({ where: { id: f.user.id }, data: { active: true } });
    await db.matter.update({ where: { id: f.matter.id }, data: { ownerId: f.approver.id } });
    await expect(createInvoiceRequest(replay)).rejects.toThrow("无权关联");
    expect(await counts(saved.id)).toEqual(initial);
    expect(await db.invoiceRequest.count({ where: { requestedById: f.user.id } })).toBe(1);
  });
});
