// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleUser } from "@/lib/roles/catalog";

const mock = vi.hoisted(() => ({
  user: { id: "cmtestuser0000000000000001", role: "PRINCIPAL_LAWYER", runtimeMode: "SERVER" } as RoleUser & { id: string },
  findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), deleteContacts: vi.fn(),
  checkRoleMutation: vi.fn(), audit: vi.fn()
}));
vi.mock("@/lib/prisma", () => {
  const db = { client: { findMany: mock.findMany, findFirst: mock.findFirst, count: mock.count, update: mock.update }, contact: { deleteMany: mock.deleteContacts } };
  return { prisma: { ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: mock.user }) }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: mock.checkRoleMutation, roleMutation: vi.fn() }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: async () => null }));
vi.mock("@/lib/runtime/mode", () => ({ isPersonalMode: () => false }));
vi.mock("@/server/finance/facts", () => ({ getFinanceFacts: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: mock.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { canMaintainClientMaster, clientMasterWriteFilter, editableClientIds } from "@/server/clients/master-access";
import { getClientForEdit, updateClient } from "@/server/clients/actions";
import { encryptIdNumber } from "@/lib/clients/id-number-crypto";

const clientId = "cmtestclient00000000000001";
const contacts = [
  { id: "primary", clientId, name: "合成主要联系人", isPrimary: true, title: "", phone: "", email: "", wechat: "", notes: "" },
  { id: "secondary", clientId, name: "合成次要联系人", isPrimary: false, title: "", phone: "", email: "", wechat: "", notes: "" }
];
const fullClient = { id: clientId, name: "合成客户", type: "COMPANY", idType: "USCC", idNumber: null, contacts, matters: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mock.user = { id: "cmtestuser0000000000000001", role: "PRINCIPAL_LAWYER", runtimeMode: "SERVER" };
  mock.findMany.mockResolvedValue([{ id: clientId }]);
  mock.findFirst.mockResolvedValue(fullClient);
  mock.count.mockResolvedValue(1);
  mock.update.mockResolvedValue(fullClient);
});

describe("Server 客户主档维护资格", () => {
  it.each(["LAWYER", "INDEPENDENT_LAWYER", "ASSISTANT", "FINANCE"])("%s 不因主档读取或建档资格获得编辑资格", (role) => {
    expect(canMaintainClientMaster({ role, runtimeMode: "SERVER" })).toBe(false);
  });

  it("系统管理员身份与管理查看权不替代主档维护资格", async () => {
    const user = { ...mock.user, role: "LAWYER", systemRole: "SUPER_ADMIN", managerAuthorized: true, rolePermissions: [{ permissionKey: "clients.read" as const, scope: "ALL" as const }] };
    expect(canMaintainClientMaster(user)).toBe(false);
    expect(await editableClientIds(user, [clientId])).toEqual([]);
    expect(mock.findMany).not.toHaveBeenCalled();
    mock.user = user;
    await expect(getClientForEdit(clientId)).rejects.toThrow("无权编辑客户信息");
    await expect(updateClient({ id: clientId, name: "合成客户", type: "COMPANY", contacts: [], tags: [], cooperationStatus: "SIGNED" })).rejects.toThrow("无权编辑客户信息");
    expect(mock.findFirst).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("合伙人和显式获准 CUSTOM 保留资格，未获写授权的 CUSTOM 不显示入口", () => {
    expect(canMaintainClientMaster(mock.user)).toBe(true);
    expect(canMaintainClientMaster({ role: "CUSTOM", rolePermissions: [{ permissionKey: "clients.read", scope: "ALL" }] })).toBe(false);
    expect(canMaintainClientMaster({ role: "CUSTOM", rolePermissions: [{ permissionKey: "clients.write", scope: "OWN" }] })).toBe(true);
  });

  it("CUSTOM 的全所读取不覆盖本人写入范围，范围外对象在取编辑数据前拒绝", async () => {
    mock.user = { ...mock.user, role: "CUSTOM", rolePermissions: [{ permissionKey: "clients.read", scope: "ALL" }, { permissionKey: "clients.write", scope: "OWN" }] };
    const filter = clientMasterWriteFilter(mock.user);
    expect(filter).toMatchObject({ AND: [{ OR: [{ ownerUserId: mock.user.id }, { matters: expect.any(Object) }, { intakes: expect.any(Object) }] }] });
    await editableClientIds(mock.user, [clientId, "cmtestother000000000000001"]);
    expect(mock.findMany).toHaveBeenCalledWith({ where: { id: { in: [clientId, "cmtestother000000000000001"] }, deletedAt: null, AND: [filter] }, select: { id: true } });
    mock.count.mockResolvedValue(0);
    await expect(getClientForEdit(clientId)).rejects.toThrow("无权维护");
    expect(mock.findFirst).not.toHaveBeenCalled();
  });

  it("空页面不查询全库可编辑对象", async () => {
    expect(await editableClientIds(mock.user, [])).toEqual([]);
    expect(mock.findMany).not.toHaveBeenCalled();
  });
});

describe("Server 列表编辑读取完整客户主档", () => {
  it("复用详情读取全部联系人，在服务端解密后交给编辑表单", async () => {
    mock.findFirst.mockResolvedValue({ ...fullClient, idNumber: encryptIdNumber("SYNTHETIC-USCC") });
    const result = await getClientForEdit(clientId);
    expect(result.idNumber).toBe("SYNTHETIC-USCC");
    expect(result.contacts).toEqual(contacts);
    expect(mock.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } }) }));
  });

  it("保存主档修改时保留读取到的两个联系人", async () => {
    const result = await getClientForEdit(clientId);
    await updateClient({ id: result.id, name: "合成客户已更新", type: "COMPANY", contacts: result.contacts.map(({ name, isPrimary }) => ({ name, isPrimary })), tags: [], cooperationStatus: "SIGNED" });
    expect(mock.checkRoleMutation).toHaveBeenCalledOnce();
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contacts: { create: [
      expect.objectContaining({ name: "合成主要联系人", isPrimary: true }),
      expect.objectContaining({ name: "合成次要联系人", isPrimary: false })
    ] } }) }));
  });

  it("主档不存在时失败，不返回可保存的摘要", async () => {
    mock.findFirst.mockResolvedValue(null);
    await expect(getClientForEdit(clientId)).rejects.toThrow("客户不存在");
    expect(mock.update).not.toHaveBeenCalled();
  });
});
