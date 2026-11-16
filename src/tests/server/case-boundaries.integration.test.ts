// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { RoleGrant } from "@/lib/roles/catalog";
import { sealIdNumber } from "@/lib/clients/id-number-crypto";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("仅允许独立测试数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/approvals/service", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/approvals/service")>(),
  requireApprovalRoute: vi.fn(async () => {}),
}));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { createIntake } from "@/server/intakes/actions";
import { saveIntakeRevision } from "@/server/intakes/revision-actions";
import { checkClientDuplicate } from "@/server/clients/dedup";
import { addMatterLink, removeMatterLink, searchMattersForLink, updateMatterBasicInfo, updateMatterTeam, updateProcedureInfo } from "@/server/matters/actions";
import { reopenMatter } from "@/server/matters/lifecycle";
import { addProcedure, updateProcedure } from "@/server/procedures/actions";

const users: string[] = [], matters: string[] = [], clients: string[] = [], roles: string[] = [];
function session(user: Pick<User, "id" | "role">, rolePermissions?: RoleGrant[]) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, rolePermissions, runtimeMode: "SERVER" }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}
async function makeUser(role: User["role"] = "LAWYER") {
  const user = await db.user.create({ data: { name: "合成经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "test-only", role } });
  users.push(user.id);
  return user;
}
async function makeMatter(ownerId: string, status: "IN_PROGRESS" | "CLOSED" | "ARCHIVED" = "IN_PROGRESS", title = "合成案件") {
  const matter = await db.matter.create({ data: { internalCode: `CASE-${randomUUID()}`, title, ownerId, status } });
  matters.push(matter.id);
  return matter;
}
async function makeClient(ownerId: string, name: string, number?: string, deletedAt?: Date) {
  const client = await db.client.create({ data: { ownerUserId: ownerId, name, type: "INDIVIDUAL", deletedAt,
    ...(number ? { idType: "PASSPORT" as const, ...sealIdNumber(number) } : {}) } });
  clients.push(client.id);
  return client;
}
const input = (clientId?: string) => ({ category: "NON_LITIGATION" as const, firstProcedureType: "NON_LITIGATION_PHASE" as const,
  clientId, clientType: "INDIVIDUAL" as const, contactName: "合成联系人", contactPhone: "00000000", counterclaim: false, coUserIds: [], parties: [] });
const procedure = (matterId: string, engagement: "ENGAGED" | "INFORMATIONAL" = "ENGAGED") => ({ matterId, type: "FIRST_INSTANCE" as const, engagement, isExternalLead: false });
async function prohibitAudit(action: string, fn: () => Promise<void>) {
  await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "case_boundary_test_audit" CHECK (action <> '${action}') NOT VALID`);
  try { await fn(); }
  finally { await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "case_boundary_test_audit"'); }
}

describe.skipIf(!databaseUrl)("收案与案件事务边界：隔离 PG", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect();
  });

  it("收案只能选择当前可见的有效客户；普通律师不改客户联系人", async () => {
    const user = await makeUser(), other = await makeUser();
    const own = await makeClient(user.id, "合成本人客户"), foreign = await makeClient(other.id, "合成他人客户");
    const retired = await makeClient(user.id, "合成停用客户", undefined, new Date());
    session(user);
    await expect(createIntake(input(foreign.id))).rejects.toThrow("客户不存在或无权选择");
    await expect(createIntake(input(retired.id))).rejects.toThrow("客户不存在或无权选择");
    expect(await db.intake.count({ where: { clientId: { in: [foreign.id, retired.id] } } })).toBe(0);
    const saved = await createIntake(input(own.id));
    expect((await db.intake.findUniqueOrThrow({ where: { id: saved.id } })).contactName).toBe("合成联系人");
    expect(await db.contact.count({ where: { clientId: own.id } })).toBe(0);
  });

  it("客户查重隐藏无权或停用档案，且证件重复仍被阻止", async () => {
    const user = await makeUser(), other = await makeUser(), number = `T${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const foreign = await makeClient(other.id, "合成保密客户", number);
    session(user);
    const result = await checkClientDuplicate({ idType: "PASSPORT", idNumber: number, name: foreign.name });
    expect(result).toEqual({ idNumberExists: true, idNumberDuplicate: null, nameDuplicates: [] });
    await expect(createIntake({ ...input(), clientName: "合成新客户", clientIdType: "PASSPORT", clientIdNumber: number })).rejects.toThrow("客户证件号已登记");
    expect(await db.client.count({ where: { name: "合成新客户" } })).toBe(0);
    const ownNumber = `T${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const own = await makeClient(user.id, "合成可见客户", ownNumber);
    expect((await checkClientDuplicate({ idType: "PASSPORT", idNumber: ownNumber })).idNumberDuplicate?.id).toBe(own.id);
    await db.client.update({ where: { id: own.id }, data: { deletedAt: new Date() } });
    expect(await checkClientDuplicate({ idType: "PASSPORT", idNumber: ownNumber })).toEqual({ idNumberExists: true, idNumberDuplicate: null, nameDuplicates: [] });
  });

  it("选中客户时拒绝不一致身份，并用主档身份生成冲突检索条件", async () => {
    const user = await makeUser(), number = `T${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const client = await makeClient(user.id, "合成真实委托方", number);
    session(user);
    await expect(createIntake({ ...input(client.id), clientName: "合成其他主体", clientIdNumber: number, clientIdType: "PASSPORT" })).rejects.toThrow("身份与所选客户不一致");
    await expect(createIntake({ ...input(client.id), clientName: client.name, clientIdNumber: "WRONG123", clientIdType: "PASSPORT" })).rejects.toThrow("身份与所选客户不一致");
    const saved = await createIntake(input(client.id));
    const intake = await db.intake.findUniqueOrThrow({ where: { id: saved.id }, include: { client: true, parties: true } });
    expect(intake.parties.find(party => party.role === "CLIENT_PARTY")).toMatchObject({ name: client.name, idNumber: number.toUpperCase() });
    expect(buildIntakeConflictQueries(intake, decryptIdNumber)).toContainEqual({ role: "CLIENT_PARTY", name: client.name, idNumber: number.toUpperCase() });
  });

  it("客户主档更名后补正原收案时保留已有主体名称", async () => {
    const user = await makeUser(), client = await makeClient(user.id, "合成原名称");
    session(user);
    const saved = await createIntake(input(client.id));
    await db.client.update({ where: { id: client.id }, data: { name: "合成新名称" } });
    await saveIntakeRevision(saved.id, 0, { ...input(client.id), clientName: "合成原名称" });
    expect(await db.party.findFirst({ where: { intakeId: saved.id, role: "CLIENT_PARTY" }, select: { name: true } })).toEqual({ name: "合成原名称" });
  });

  it("旧会话中的全所客户权限被收窄后，创建和补正均按实时范围执行", async () => {
    const other = await makeUser();
    const number = `T${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const foreign = await makeClient(other.id, "合成受限客户", number);
    const name = `合成岗位-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "intakes.create", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" },
      { permissionKey: "clients.read", scope: "OWN" }, { permissionKey: "clients.write", scope: "OWN" }
    ] } } });
    roles.push(role.id);
    const user = await db.user.create({ data: { name: "合成岗位用户", email: `${randomUUID()}@example.invalid`, passwordHash: "test-only", role: "CUSTOM", roleDefinitionId: role.id } });
    users.push(user.id);
    session(user, [{ permissionKey: "intakes.create", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" }, { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "clients.read", scope: "ALL" }, { permissionKey: "clients.write", scope: "OWN" }]);
    expect(await checkClientDuplicate({ idType: "PASSPORT", idNumber: number, name: foreign.name })).toEqual({ idNumberExists: true, idNumberDuplicate: null, nameDuplicates: [] });
    const matter = await makeMatter(user.id);
    await expect(searchMattersForLink(matter.id, "合成")).rejects.toThrow("当前角色无权执行此操作");
    await expect(createIntake(input(foreign.id))).rejects.toThrow("无权选择");
    const own = await makeClient(user.id, "合成本人档案");
    const intake = await db.intake.create({ data: { title: "合成待补正收案", category: "NON_LITIGATION", status: "INTAKE", clientId: own.id, createdById: user.id, ownerUserId: user.id } });
    await expect(saveIntakeRevision(intake.id, 0, input(foreign.id))).rejects.toThrow("无权关联");
    expect((await db.intake.findUniqueOrThrow({ where: { id: intake.id } })).clientId).toBe(own.id);
  });

  it("收案审计失败时自动客户和收案一起回滚；正常建档仍可用", async () => {
    const user = await makeUser(), name = `合成回滚-${randomUUID()}`;
    session(user);
    await prohibitAudit("INTAKE_CREATE", async () => {
      await expect(createIntake({ ...input(), clientName: name })).rejects.toThrow();
    });
    expect(await db.client.count({ where: { name } })).toBe(0);
    const saved = await createIntake({ ...input(), clientName: name });
    clients.push(saved.clientId!);
    expect(await db.client.count({ where: { id: saved.clientId!, ownerUserId: user.id } })).toBe(1);
    expect(await db.contact.count({ where: { clientId: saved.clientId! } })).toBe(1);
  });

  it("关联两端均须未归档，搜索不泄露其他经办人的案件", async () => {
    const user = await makeUser(), other = await makeUser();
    const first = await makeMatter(user.id), second = await makeMatter(user.id), archived = await makeMatter(user.id, "ARCHIVED");
    const hidden = await makeMatter(other.id, "IN_PROGRESS", "合成唯一隐私案件标题");
    session(user);
    expect(await searchMattersForLink(first.id, "合成唯一隐私案件标题")).toEqual([]);
    await expect(addMatterLink(first.id, archived.id)).rejects.toThrow("已归档");
    await expect(addMatterLink(archived.id, first.id)).rejects.toThrow("已归档");
    await addMatterLink(first.id, second.id);
    await removeMatterLink(second.id, first.id);
    expect(await db.matterLink.count({ where: { matterId: first.id, relatedMatterId: second.id } })).toBe(0);
    expect(await db.matter.findUnique({ where: { id: hidden.id } })).not.toBeNull();
  });

  it("程序、动态与审计一起回滚，正常程序按唯一顺序创建", async () => {
    const user = await makeUser(), matter = await makeMatter(user.id);
    session(user);
    await prohibitAudit("PROCEDURE_CREATE", async () => {
      await expect(addProcedure(procedure(matter.id))).rejects.toThrow();
    });
    expect(await db.matterProcedure.count({ where: { matterId: matter.id } })).toBe(0);
    expect(await db.timelineEvent.count({ where: { matterId: matter.id, eventType: "PROCEDURE_ADDED" } })).toBe(0);
    const [first, second] = await Promise.all([addProcedure(procedure(matter.id)), addProcedure(procedure(matter.id, "INFORMATIONAL"))]);
    const rows = await db.matterProcedure.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { order: "asc" } });
    expect(rows.map(row => row.order)).toEqual([1, 2]);
    expect(rows.find(row => row.engagement === "INFORMATIONAL")?.status).toBe("CONCLUDED");
    expect(rows.find(row => row.engagement === "ENGAGED")?.status).toBe("PENDING");
  });

  it("归档先提交时，已发出的重新开放请求不得覆盖归档", async () => {
    const user = await makeUser(), matter = await makeMatter(user.id, "CLOSED");
    session(user);
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const archiving = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await tx.matter.update({ where: { id: matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      acquired();
      await gate;
    }, { timeout: 20000 });
    await locked;
    const attempted = reopenMatter(matter.id).then(() => null, error => error);
    try {
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 72606101 AND NOT granted) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await archiving;
    expect((await attempted)?.message).toContain("已归档");
    expect((await db.matter.findUniqueOrThrow({ where: { id: matter.id } })).status).toBe("ARCHIVED");
    expect(await db.timelineEvent.count({ where: { matterId: matter.id, eventType: "MATTER_REOPENED" } })).toBe(0);
  });

  it("归档先提交后，等待中的案件、团队及程序编辑均不得覆盖归档", async () => {
    const user = await makeUser(), matter = await makeMatter(user.id);
    const proc = await db.matterProcedure.create({ data: { matterId: matter.id, type: "FIRST_INSTANCE", order: 1 } });
    session(user);
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const archiving = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await tx.matter.update({ where: { id: matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      acquired(); await gate;
    }, { timeout: 20000 });
    await locked;
    const attempts = [
      updateMatterBasicInfo({ id: matter.id, title: "不应保存", expectedUpdatedAt: matter.updatedAt }),
      updateMatterTeam({ matterId: matter.id, expectedOwnerId: user.id, expectedMembers: [], coLeadIds: [], assistantIds: [] }),
      updateProcedureInfo({ procedureId: proc.id, expectedUpdatedAt: proc.updatedAt, caseNumber: "不应保存" }),
      updateProcedure({ id: proc.id, caseNumber: "不应保存" }),
    ].map(promise => promise.then(() => null, error => error));
    try {
      let waiting = 0;
      for (let i = 0; i < 200 && waiting < attempts.length; i++) {
        const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND objid=72606101 AND NOT granted`;
        waiting = row.count;
        if (waiting < attempts.length) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThanOrEqual(attempts.length);
    } finally { release(); }
    await archiving;
    for (const outcome of await Promise.all(attempts)) expect(outcome?.message).toContain("已归档");
    expect(await db.matter.findUniqueOrThrow({ where: { id: matter.id } })).toMatchObject({ title: matter.title, status: "ARCHIVED" });
    expect(await db.matterProcedure.findUniqueOrThrow({ where: { id: proc.id } })).toMatchObject({ caseNumber: null });
    expect(await db.auditLog.count({ where: { userId: user.id, action: { in: ["MATTER_BASIC_UPDATE", "MATTER_TEAM_UPDATE", "PROCEDURE_INFO_UPDATE", "PROCEDURE_UPDATE"] } } })).toBe(0);
  }, 30000);
});
