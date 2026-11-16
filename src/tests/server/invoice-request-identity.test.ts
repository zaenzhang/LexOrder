// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const { db, route, readable, role, audit, hash } = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), $queryRaw: vi.fn(), user: { findUnique: vi.fn() }, matter: { findFirst: vi.fn() }, document: { findMany: vi.fn() }, invoiceRequest: { findUnique: vi.fn(), create: vi.fn() } },
  route: vi.fn(), readable: vi.fn(), role: vi.fn(), audit: vi.fn(), hash: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: role }));
vi.mock("@/lib/approvals/service", () => ({ requireApprovalRoute: route }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: readable }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async () => null) }));
vi.mock("@/server/audit", () => ({ auditTx: audit }));
vi.mock("node:crypto", async importOriginal => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, createHash: (...args: Parameters<typeof original.createHash>) => { hash(); return original.createHash(...args); } };
});
import { createInvoiceRequestForActor, prepareInvoiceEvidenceUpload, type InvoiceRequestInput } from "@/server/invoices/request-service";

const actor = { id: "clawyer000000000000000001", role: "LAWYER", systemRole: "USER", avatar: null, runtimeMode: "SERVER" as const, name: "合成经办", email: "synthetic@example.test" };
const matterId = "cmatter000000000000000001";
const docId = "cdocument000000000000001";
const input: InvoiceRequestInput = { requestKey: "bc424d64-a21a-4723-977c-f3c9c7b85767", matterId, amount: "120.00", invoiceType: "PLAIN", invoiceItem: "LAWYER_FEE", buyerName: "合成购方", evidenceDocIds: [docId] };
type Saved = { id: string; status: "PENDING" | "APPROVED" | "ISSUED"; requestHash: string };
let saved: Saved | null;
beforeEach(() => {
  vi.clearAllMocks(); saved = null;
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.$queryRaw.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ active: true, role: actor.role });
  db.matter.findFirst.mockResolvedValue({ id: matterId, status: "ACTIVE", category: "CIVIL_COMMERCIAL", internalCode: "TEST-001", title: "合成案件" });
  db.document.findMany.mockResolvedValue([{ id: docId, matterId, intakeId: null, uploadedById: actor.id, deletedAt: null }]);
  db.invoiceRequest.findUnique.mockImplementation(async () => saved);
  db.invoiceRequest.create.mockImplementation(async ({ data }: { data: { requestHash: string } }) => {
    saved = { id: "cinvoice00000000000000001", status: "PENDING", requestHash: data.requestHash };
    return { id: saved.id, status: saved.status };
  });
  role.mockResolvedValue({ role: "LAWYER", enabled: true });
  readable.mockResolvedValue(true); route.mockResolvedValue(undefined); audit.mockResolvedValue(undefined);
});

describe("开票申请提交身份", () => {
  it("创建与审计同事务，规范金额、空字段和重复依据；同一身份重放不重复写", async () => {
    const first = await createInvoiceRequestForActor(actor, { ...input, buyerName: " 合成购方 ", amount: 120, evidenceDocIds: [docId, docId], requestNote: " " });
    const second = await createInvoiceRequestForActor(actor, input);
    expect(second).toMatchObject({ id: first.id, status: "PENDING", replayed: true });
    expect(db.invoiceRequest.create).toHaveBeenCalledOnce(); expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0][0]).toBe(db);
    expect(db.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "ReadCommitted" });
    expect(db.invoiceRequest.create.mock.calls[0][0].data).toMatchObject({ amount: new Prisma.Decimal("120.00"), requestedById: actor.id, requestKey: input.requestKey, evidenceDocIds: [docId], requestNote: null });
  });
  it.each(["APPROVED", "ISSUED"] as const)("重放读取当前 %s，不重置状态或重新要求创建前置", async status => {
    await createInvoiceRequestForActor(actor, input);
    saved!.status = status;
    db.matter.findFirst.mockResolvedValue({ id: matterId, status: "ARCHIVED", category: "CIVIL_COMMERCIAL" });
    route.mockRejectedValue(new Error("当前已无审批路线"));
    expect(await createInvoiceRequestForActor(actor, input)).toMatchObject({ status, replayed: true });
    expect(route).toHaveBeenCalledOnce(); expect(db.invoiceRequest.create).toHaveBeenCalledOnce();
  });
  it("同键改金额明确拒绝，不另建申请", async () => {
    await createInvoiceRequestForActor(actor, input);
    await expect(createInvoiceRequestForActor(actor, { ...input, amount: "121" })).rejects.toThrow("内容不同");
    expect(db.invoiceRequest.create).toHaveBeenCalledOnce();
  });
  it("真实请求唯一冲突后只读取胜出申请；指纹在整次请求仅计算一次", async () => {
    db.invoiceRequest.create.mockImplementationOnce(async ({ data }: { data: { requestHash: string } }) => {
      saved = { id: "cwinner000000000000000001", status: "APPROVED", requestHash: data.requestHash };
      throw { code: "P2002", meta: { modelName: "InvoiceRequest", target: ["requestedById", "requestKey"] } };
    });
    expect(await createInvoiceRequestForActor(actor, input)).toMatchObject({ id: "cwinner000000000000000001", status: "APPROVED", replayed: true });
    expect(hash).toHaveBeenCalledOnce(); expect(db.$transaction).toHaveBeenCalledTimes(2); expect(audit).not.toHaveBeenCalled();
  });
  it("其他唯一约束错误原样失败，不伪装成已保存", async () => {
    const error = { code: "P2002", meta: { modelName: "InvoiceRequest", target: ["invoiceNo"] } };
    db.invoiceRequest.create.mockRejectedValueOnce(error);
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toBe(error);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
  it("串行化冲突有界重试，整次请求复用一次权威指纹", async () => {
    db.$transaction.mockRejectedValueOnce({ code: "P2034" }).mockRejectedValueOnce({ code: "P2034" });
    expect(await createInvoiceRequestForActor(actor, input)).toMatchObject({ replayed: false });
    expect(hash).toHaveBeenCalledOnce(); expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it("撤权后不得读取同键结果", async () => {
    await createInvoiceRequestForActor(actor, input);
    role.mockResolvedValue({ role: "CUSTOM", enabled: false, rolePermissions: [] });
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toThrow("无权");
    expect(db.invoiceRequest.findUnique).toHaveBeenCalledOnce();
  });
  it("当前账号或角色变化后不得读取同键结果", async () => {
    await createInvoiceRequestForActor(actor, input);
    db.user.findUnique.mockResolvedValue({ active: false, role: actor.role });
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toThrow("当前账号或岗位已变化");
    expect(db.invoiceRequest.findUnique).toHaveBeenCalledOnce();
  });
  it("新申请要求提交键，拒绝已归档案件、跨案或无权依据", async () => {
    await expect(createInvoiceRequestForActor(actor, { ...input, requestKey: "" })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
    db.matter.findFirst.mockResolvedValue({ id: matterId, status: "ARCHIVED" });
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toThrow("已归档");
    db.matter.findFirst.mockResolvedValue({ id: matterId, status: "ACTIVE", category: "CIVIL_COMMERCIAL" });
    db.document.findMany.mockResolvedValueOnce([]);
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toThrow("本案有效材料");
    readable.mockResolvedValue(false);
    await expect(createInvoiceRequestForActor(actor, input)).rejects.toThrow("无权访问");
    expect(db.invoiceRequest.create).not.toHaveBeenCalled();
  });
  it("上传前预检无审批人时失败，不产生申请或重复指纹；最终创建仍要求依据", async () => {
    route.mockRejectedValueOnce(new Error("未配置合格审批人"));
    await expect(prepareInvoiceEvidenceUpload(actor, { ...input, evidenceDocIds: [] })).rejects.toThrow("合格审批人");
    await expect(prepareInvoiceEvidenceUpload(actor, { ...input, evidenceDocIds: [] })).resolves.toBeUndefined();
    expect(hash).not.toHaveBeenCalled(); expect(db.invoiceRequest.create).not.toHaveBeenCalled();
    await expect(createInvoiceRequestForActor(actor, { ...input, evidenceDocIds: [] })).rejects.toThrow("至少一份开票依据");
  });
});
