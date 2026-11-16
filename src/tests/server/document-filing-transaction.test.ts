// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: { status: "APPROVED", active: true, role: "LAWYER", failAudit: false, archived: false, audits: 0 },
  db: { user: { findUnique: vi.fn() }, matter: { findFirst: vi.fn(), findUnique: vi.fn() },
    document: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "handler", role: "LAWYER" } })) }));
vi.mock("@/lib/permissions", () => ({ assertCanHandleMatter: vi.fn(async () => undefined), matterAssociationFilter: (id: string) => ({ ownerId: id }) }));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: vi.fn(async () => undefined) }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ role: mocks.state.role, enabled: true, rolePermissions: [] })) }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async () => null) }));
vi.mock("@/server/documents/derivation-access", () => ({ assertDocumentDerivationAccess: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { fileDocument } from "@/server/documents/actions";
const updatedAt = new Date("2026-11-16T00:00:00.000Z");
const input = { documentId: "cdocument00000000000000001", expectedUpdatedAt: updatedAt };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(mocks.state, { status: "APPROVED", active: true, role: "LAWYER", failAudit: false, archived: false, audits: 0 });
  mocks.db.user.findUnique.mockImplementation(async () => ({ active: mocks.state.active, role: mocks.state.role }));
  mocks.db.matter.findFirst.mockImplementation(async () => ({ status: mocks.state.archived ? "ARCHIVED" : "ACTIVE" }));
  mocks.db.matter.findUnique.mockResolvedValue({ internalCode: "SYNTHETIC-FILING" });
  mocks.db.document.findUnique.mockImplementation(async () => ({ id: "document", matterId: "matter", intakeId: null, uploadedById: "handler", name: "合成已批稿", status: mocks.state.status, updatedAt }));
  mocks.db.document.update.mockImplementation(async ({ where, data }) => {
    if (where.status !== mocks.state.status || where.updatedAt.getTime() !== updatedAt.getTime()) throw new Error("合成版本冲突");
    mocks.state.status = data.status; return { id: "document" };
  });
  mocks.db.auditLog.create.mockImplementation(async () => { if (mocks.state.failAudit) throw new Error("合成审计不可用"); mocks.state.audits++; });
  mocks.db.$transaction.mockImplementation(async run => {
    const prior = { status: mocks.state.status, audits: mocks.state.audits };
    try { return await run(mocks.db); } catch (error) { Object.assign(mocks.state, prior); throw error; }
  });
});

describe("已批文书入卷事务", () => {
  it("内置岗位也在同一事务写状态和审计，审计失败不留下已入卷状态", async () => {
    mocks.state.failAudit = true;
    await expect(fileDocument(input)).rejects.toThrow("合成审计不可用");
    expect(mocks.db.$transaction).toHaveBeenCalledOnce();
    expect(mocks.state).toMatchObject({ status: "APPROVED", audits: 0 });
    mocks.state.failAudit = false;
    await expect(fileDocument(input)).resolves.toEqual({ ok: true });
    expect(mocks.state).toMatchObject({ status: "FILED", audits: 1 });
  });

  it("旧会话岗位变为无文书维护权的角色后拒绝入卷", async () => {
    mocks.state.role = "CUSTOM";
    await expect(fileDocument(input)).rejects.toThrow("当前无权办理材料入卷");
    expect(mocks.db.document.update).not.toHaveBeenCalled();
    expect(mocks.state.audits).toBe(0);
  });

  it("预检后案件已归档或账号停用，事务内重新检查并拒绝写入", async () => {
    mocks.state.archived = true;
    await expect(fileDocument(input)).rejects.toThrow("案件已归档");
    mocks.state.archived = false; mocks.state.active = false;
    await expect(fileDocument(input)).rejects.toThrow("当前账号不可用");
    expect(mocks.db.document.update).not.toHaveBeenCalled();
  });
});
