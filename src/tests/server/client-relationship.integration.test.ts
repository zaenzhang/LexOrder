// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, type UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveClientActivity } from "@/server/clients/relationship-service";
import { clientRelationshipFilter, type RelationshipUser } from "@/server/clients/relationship-access";
import { clientVisibilityFilter } from "@/lib/permissions";
import type { ClientActivityInput } from "@/lib/clients/relationship";
import { mergeClients } from "@/server/clients/dedup";
import { requireSession } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// 此套件只接受显式提供、名称以 _test 结尾的独立 PostgreSQL 数据库。
const url = process.env.WORKBENCH_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("CRM 集成测试仅允许独立的 _test 数据库");
const db = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
const userIds: string[] = [];
const clientIds: string[] = [];
const roleIds: string[] = [];

async function fixture(role: UserRole = "LAWYER") {
  const user = await db.user.create({ data: { name: "合成验收用户", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role } });
  userIds.push(user.id);
  const client = await db.client.create({ data: { name: "合成验收客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } });
  clientIds.push(client.id);
  return { user: { id: user.id, role } as RelationshipUser, client };
}
function input(clientId: string, extra: Partial<ClientActivityInput> = {}): ClientActivityInput {
  return { clientId, requestKey: randomUUID(), channel: "PHONE", content: "合成测试：核对材料", occurredAt: new Date().toISOString(), ...extra };
}
const next = () => ({ title: "合成测试：下次确认", dueAt: new Date(Date.now() + 86400_000).toISOString() });

describe.skipIf(!url)("客户维护：真实 PostgreSQL 事务与权限", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // 保留真实审计保护及测试证据；只停用本套件的合成账号和客户。
    await db.client.updateMany({ where: { id: { in: clientIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("无案件客户对负责人可见，对其他律师不可见且不可写", async () => {
    const a = await fixture(), b = await fixture();
    expect(await db.client.count({ where: { id: a.client.id, AND: [clientVisibilityFilter(a.user.id, a.user.role)] } })).toBe(1);
    expect(await db.client.count({ where: { id: a.client.id, AND: [clientRelationshipFilter(b.user, "read")] } })).toBe(0);
    await expect(saveClientActivity(db, b.user, input(a.client.id))).rejects.toThrow("无权");
    expect(await db.clientActivity.count({ where: { clientId: a.client.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: b.user.id } })).toBe(0);
  });

  it("同键并发创建只保存一份沟通、待跟进与审计", async () => {
    const f = await fixture(), data = input(f.client.id, { nextFollowUp: next() });
    const results = await Promise.all([saveClientActivity(db, f.user, data), saveClientActivity(db, f.user, data)]);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await db.clientFollowUp.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.user.id } })).toBe(2);
    await expect(saveClientActivity(db, f.user, { ...data, content: "变更内容" })).rejects.toThrow("内容发生变化");
  });

  it("并发完成只产生一次结果和下一项", async () => {
    const f = await fixture();
    await saveClientActivity(db, f.user, input(f.client.id, { nextFollowUp: next() }));
    const task = await db.clientFollowUp.findFirstOrThrow({ where: { clientId: f.client.id } });
    const results = await Promise.allSettled([1, 2].map(() => saveClientActivity(db, f.user, input(f.client.id, { followUpId: task.id, nextFollowUp: next() }))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(2);
    expect(await db.clientFollowUp.count({ where: { clientId: f.client.id, status: "OPEN" } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "CLIENT_FOLLOWUP_COMPLETE" } })).toBe(1);
    expect((await db.clientFollowUp.findUniqueOrThrow({ where: { id: task.id } })).resultActivityId).not.toBeNull();
  });

  it("审计失败时回滚已完成状态、结果和下一项", async () => {
    const f = await fixture();
    await saveClientActivity(db, f.user, input(f.client.id, { nextFollowUp: next() }));
    const task = await db.clientFollowUp.findFirstOrThrow({ where: { clientId: f.client.id } });
    // 在独立测试库暂设约束，使真正的 SQL INSERT 失败，验证 PostgreSQL 回滚。
    await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "workbench_test_reject_activity" CHECK (action <> 'CLIENT_ACTIVITY_CREATE') NOT VALID`);
    try {
      await expect(saveClientActivity(db, f.user, input(f.client.id, { followUpId: task.id, nextFollowUp: next() }))).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "workbench_test_reject_activity"`);
    }
    expect((await db.clientFollowUp.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("OPEN");
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await db.clientFollowUp.count({ where: { clientId: f.client.id } })).toBe(1);
  });

  it("拒绝跨客户跟进 ID，取消必须保存原因", async () => {
    const f = await fixture();
    const second = await db.client.create({ data: { name: "合成第二客户", type: "INDIVIDUAL", tags: [], ownerUserId: f.user.id } });
    clientIds.push(second.id);
    await saveClientActivity(db, f.user, input(f.client.id, { nextFollowUp: next() }));
    const task = await db.clientFollowUp.findFirstOrThrow({ where: { clientId: f.client.id } });
    await expect(saveClientActivity(db, f.user, input(second.id, { followUpId: task.id }))).rejects.toThrow("跟进不存在");
    await saveClientActivity(db, f.user, input(f.client.id, { followUpId: task.id, closeStatus: "CANCELLED", content: "合成测试：客户调整计划" }));
    expect((await db.clientFollowUp.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("CANCELLED");
  });

  it("管理读取、系统管理员身份、财务主档权限不扩大写入范围", async () => {
    const owner = await fixture(), manager = await fixture(), finance = await fixture("FINANCE");
    await db.user.update({ where: { id: manager.user.id }, data: { managerAuthorized: true, systemRole: "SUPER_ADMIN" } });
    await expect(saveClientActivity(db, { ...manager.user, managerAuthorized: true }, input(owner.client.id))).rejects.toThrow("无权");
    await expect(saveClientActivity(db, finance.user, input(owner.client.id))).rejects.toThrow("无权");
  });

  it("自定义角色 OWN 可维护未成案客户，撤权后旧会话被拒", async () => {
    const f = await fixture();
    const name = `crm-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [{ permissionKey: "clients.read", scope: "OWN" }, { permissionKey: "clients.write", scope: "OWN" }] } } });
    roleIds.push(role.id);
    await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    const user: RelationshipUser = { ...f.user, role: "CUSTOM", rolePermissions: [{ permissionKey: "clients.read", scope: "OWN" }, { permissionKey: "clients.write", scope: "OWN" }] };
    await saveClientActivity(db, user, input(f.client.id));
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "clients.write" } } });
    await expect(saveClientActivity(db, user, input(f.client.id))).rejects.toThrow("授权范围已变化");
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(1);
  });

  it("账号变更先持有授权锁时，等待中的旧岗位写入被拒", async () => {
    const f = await fixture("PRINCIPAL_LAWYER");
    let release!: () => void;
    let announce!: () => void;
    const acquired = new Promise<void>(resolve => { announce = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const disable = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await tx.user.update({ where: { id: f.user.id }, data: { active: false } });
      announce();
      await gate;
    });
    await acquired;
    const mutation = saveClientActivity(db, f.user, input(f.client.id));
    release();
    await disable;
    await expect(mutation).rejects.toThrow("账号或岗位已变化");
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(0);
  });

  it("已软删除客户拒绝包括合伙人在内的新增写入", async () => {
    const f = await fixture("PRINCIPAL_LAWYER");
    await db.client.update({ where: { id: f.client.id }, data: { deletedAt: new Date() } });
    await expect(saveClientActivity(db, f.user, input(f.client.id))).rejects.toThrow("客户不存在");
  });

  it("合并迁移沟通和跟进，并拒绝跨负责人合并", async () => {
    const f = await fixture("PRINCIPAL_LAWYER"), other = await fixture();
    const target = await db.client.create({ data: { name: "合成合并目标", type: "INDIVIDUAL", tags: [], ownerUserId: f.user.id } });
    clientIds.push(target.id);
    vi.mocked(requireSession).mockResolvedValue({ user: f.user, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
    await saveClientActivity(db, f.user, input(f.client.id, { nextFollowUp: next() }));
    await mergeClients({ keepId: target.id, mergeId: f.client.id, basis: "合成测试同一主体" });
    const task = await db.clientFollowUp.findFirstOrThrow({ where: { clientId: target.id }, include: { sourceActivity: true } });
    expect(task.sourceActivity.clientId).toBe(target.id);
    expect((await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).deletedAt).not.toBeNull();
    await expect(mergeClients({ keepId: target.id, mergeId: other.client.id, basis: "合成跨负责人测试" })).rejects.toThrow("负责人不同");
  });
});
