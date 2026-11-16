// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), record: vi.fn(), invoice: vi.fn(), readMatter: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/prisma", () => ({ prisma: { invoiceRequest: { findUniqueOrThrow: mocks.invoice }, document: { findMany: async () => [] } } }));
vi.mock("@/server/approval-permissions/records", () => ({ requireApprovalRecord: mocks.record }));
vi.mock("@/lib/permissions", () => ({ assertCanReadMatter: mocks.readMatter }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { getApprovalDetail } from "@/server/approval-permissions/inbox";

const id = "cinvoice0000000000000000001";
const matter = { id: "cmatter00000000000000000001", internalCode: "LL-2026-CC-0001", title: "合成事项", deletedAt: null };
const user = { id: "creview00000000000000000001", role: "CUSTOM", rolePermissions: [{ permissionKey: "matters.read", scope: "OWN" }] };
const returnTo = "/matters/LL-2026-CC-0001?view=work&workPane=facts&procedure=one&stage=two&detail=source&evidence=point&source=original#position";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user });
  mocks.record.mockResolvedValue({ row: { action: "INVOICE_APPROVE", history: [], status: "PENDING", title: "合成申请", requester: "合成申请人", submittedAt: new Date(), requesterId: "another" }, task: "approve" });
  mocks.invoice.mockResolvedValue({ id, title: "合成申请", amount: "100.00", requestedBy: { name: "合成申请人" }, matter, evidenceDocIds: [] });
});

describe("获准审批详情的返回案件资格", () => {
  it("审批对象授权成功之后，核同案真实编号和当前案件读取资格，位置原样返回", async () => {
    const result = await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo });
    expect(result.returnTarget).toEqual({ status: "AVAILABLE", href: returnTo });
    expect(mocks.record).toHaveBeenCalledWith(user, { action: "INVOICE_APPROVE", id });
    expect(mocks.readMatter).toHaveBeenCalledWith(user.id, user.role, matter.id, user.rolePermissions);
    expect(mocks.record.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoice.mock.invocationCallOrder[0]);
  });
  it("未授权审批不查返回对象，也不透露目标是否存在", async () => {
    mocks.record.mockRejectedValue(new Error("审批申请不可查看"));
    await expect(getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo })).rejects.toThrow("不可查看");
    expect(mocks.invoice).not.toHaveBeenCalled(); expect(mocks.readMatter).not.toHaveBeenCalled();
  });
  it.each(["/matters/OTHER", `/matters/${matter.id}`, "//outside.invalid/matters/LL-2026-CC-0001", "/matters/LL-2026-CC-0001?detail=create", "/matters/LL-2026-CC-0001?returnTo=%2Fmatters", ""])("显式不合法目标只显示不可用，不退回别案 %s", async target => {
    const result = await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo: target });
    expect(result.returnTarget).toEqual({ status: "UNAVAILABLE", href: null });
    expect(mocks.readMatter).not.toHaveBeenCalled();
  });
  it("具备审批资格不等于有案件读取权限", async () => {
    mocks.session.mockResolvedValue({ user: { ...user, rolePermissions: [] } });
    expect((await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo })).returnTarget).toEqual({ status: "UNAVAILABLE", href: null });
    expect(mocks.readMatter).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ user }); mocks.readMatter.mockRejectedValue(new Error("已撤销本案读取资格"));
    expect((await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo })).returnTarget).toEqual({ status: "UNAVAILABLE", href: null });
  });
  it("当前审批改属另一案件或无案件时，原返回地址失效", async () => {
    mocks.invoice.mockResolvedValue({ id, amount: "100", requestedBy: { name: "合成申请人" }, matter: { ...matter, internalCode: "LL-2026-CC-0002" }, evidenceDocIds: [] });
    expect((await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo })).returnTarget?.status).toBe("UNAVAILABLE");
    mocks.invoice.mockResolvedValue({ id, amount: "100", requestedBy: { name: "合成申请人" }, matter: null, evidenceDocIds: [] });
    expect((await getApprovalDetail({ action: "INVOICE_APPROVE", id, returnTo })).returnTarget?.status).toBe("UNAVAILABLE");
  });
  it("无显式来源时不推断案件入口，也不额外读取案件资格", async () => {
    expect((await getApprovalDetail({ action: "INVOICE_APPROVE", id })).returnTarget).toBeNull();
    expect(mocks.readMatter).not.toHaveBeenCalled();
  });
});
