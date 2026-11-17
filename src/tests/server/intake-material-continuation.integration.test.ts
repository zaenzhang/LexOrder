// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("G11 tests require an isolated _test database");
  return { url, actor: null as WorkspaceActor | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/continuation_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: config.actor }), getSession: async () => ({ user: config.actor }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/notifications/approval", () => ({ notifyRoleApprovers: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { canReadDocument } from "@/lib/approvals/documents";
import { createIntake, convertIntakeToMatter, getIntakeById, resubmitIntake } from "@/server/intakes/actions";
import { readIntakeMaterialContinuation } from "@/server/intakes/material-continuation";
import { runCheckAndSave } from "@/server/conflicts/actions";

const users: string[] = [], matters: string[] = [], intakes: string[] = [], clients: string[] = [], groups: string[] = [], roles: string[] = [];
async function makeUser() {
  const user = await db.user.create({ data: { name: "合成转案经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(user.id); return user;
}
async function setActor(user: User) {
  config.actor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function original(intakeId: string, owner: User, extra: { matterId?: string; procedureId?: string; stageId?: string; deletedAt?: Date } = {}) {
  return db.document.create({ data: { intakeId, uploadedById: owner.id, name: "合成收案原件.txt", category: "CONTRACT",
    path: `synthetic-g11/${randomUUID()}.txt`, mimeType: "text/plain", size: 12, sha256: "a".repeat(64),
    tags: ["合成历史标签", "阶段:旧代理授权"], ...extra } });
}
async function submitted(approverIsMember = false) {
  const owner = await makeUser(), approver = await makeUser();
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成G11审批-${randomUUID()}`, members: { create: { userId: approver.id } },
    rules: { create: { action: "INTAKE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
  const client = await db.client.create({ data: { name: `合成G11主体-${randomUUID()}`, type: "INDIVIDUAL", ownerUserId: owner.id, tags: [] } }); clients.push(client.id);
  await setActor(owner);
  const intake = await createIntake({ category: "NON_LITIGATION", firstProcedureType: "NON_LITIGATION_PHASE", clientId: client.id, clientType: "INDIVIDUAL",
    contactName: "合成联络人", contactPhone: "00000000", counterclaim: false, coUserIds: approverIsMember ? [approver.id] : [], parties: [] }); intakes.push(intake.id);
  // Seed an original before submission. No original bytes are opened and no post-submission content is edited.
  const document = await original(intake.id, owner);
  await runCheckAndSave({ intakeId: intake.id, queries: [{ role: "CLIENT_PARTY", name: client.name }] });
  await resubmitIntake(intake.id);
  const revision = await db.intakeRevision.findFirstOrThrow({ where: { intakeId: intake.id }, orderBy: { round: "desc" } });
  await setActor(approver);
  return { owner, approver, intake, document, revision };
}
async function existing() {
  const owner = await makeUser();
  // Synthetic existing converted record; no approval history is invented by the production read.
  const intake = await db.intake.create({ data: { title: "合成历史转案", status: "CONVERTED", createdById: owner.id, ownerUserId: owner.id, coUserIds: [] } }); intakes.push(intake.id);
  const matter = await db.matter.create({ data: { title: "合成历史转案事项", internalCode: `G11-${randomUUID()}`, ownerId: owner.id, intakeId: intake.id } }); matters.push(matter.id);
  const procedure = await db.matterProcedure.create({ data: { matterId: matter.id, type: "FIRST_INSTANCE", customLabel: "真实程序甲", order: 8 } });
  await setActor(owner); return { owner, intake, matter, procedure };
}
function targets(result: Awaited<ReturnType<typeof readIntakeMaterialContinuation>>) {
  expect(result.status).toBe("AVAILABLE");
  if (result.status !== "AVAILABLE") throw new Error("Expected a current authorized material projection");
  return result.targets.map(target => new URL(target.href, "https://lexorder.invalid"));
}

describe.skipIf(!config.url)("G11 转案结果与当前材料接续 / PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    await db.document.updateMany({ where: { intakeId: { in: intakes } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });

  it("真实送审转案返回事务程序ID，保原件及送审快照；独立审批附件资格不开放整案材料", async () => {
    const f = await submitted();
    const result = await convertIntakeToMatter(f.intake.id, "合成G11审批：仅核工程接续"); matters.push(result.matterId);
    expect(result.materialContinuation).toEqual({ status: "DENIED", intakeHref: null });
    const saved = await db.document.findUniqueOrThrow({ where: { id: f.document.id } });
    expect(saved).toMatchObject({ matterId: result.matterId, procedureId: result.procedureId, stageId: null,
      path: f.document.path, sha256: f.document.sha256, version: f.document.version, tags: f.document.tags });
    expect(await db.intakeRevision.findUniqueOrThrow({ where: { id: f.revision.id } })).toEqual(f.revision);
    expect(await canReadDocument(f.approver.id, saved)).toBe(true);
    expect(await db.matterProcedure.findUniqueOrThrow({ where: { id: result.procedureId } })).toMatchObject({ matterId: result.matterId });
    // A newer program with a lower order must not steal the source link.
    await db.matterProcedure.create({ data: { matterId: result.matterId, type: "FIRST_INSTANCE", order: 0, customLabel: "后来排在第一的程序" } });
    await setActor(f.owner);
    const detail = await getIntakeById(f.intake.id);
    expect(detail?.materialContinuation).not.toBeNull();
    const links = targets(detail!.materialContinuation!);
    expect(links).toHaveLength(1);
    expect(links[0].searchParams.get("procedure")).toBe(result.procedureId);
    expect(links[0].searchParams.get("stage")).toBe("unassigned");
    expect(links[0].searchParams.get("workPane")).toBe("materials");
    expect(await db.auditLog.count({ where: { action: "INTAKE_APPROVE", targetId: f.intake.id } })).toBe(1);
  });

  it("历史混合关联只按同收案同案的可读真实程序去重，不按旧标签、序号或别案关联导航", async () => {
    const f = await existing();
    const second = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", customLabel: "真实程序乙", order: 1 } });
    const assigned = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", customLabel: "已有环节的程序", order: 2 } });
    const stage = await db.matterStage.create({ data: { procedureId: assigned.id, name: "已归属真实环节", order: 1 } });
    const otherMatter = await db.matter.create({ data: { title: "合成其他事项", internalCode: `G11-OTHER-${randomUUID()}`, ownerId: f.owner.id } }); matters.push(otherMatter.id);
    const foreign = await db.matterProcedure.create({ data: { matterId: otherMatter.id, type: "FIRST_INSTANCE", order: 1 } });
    await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: f.procedure.id });
    await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: f.procedure.id });
    await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: second.id });
    await original(f.intake.id, f.owner, { matterId: f.matter.id });
    await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: foreign.id });
    await original(f.intake.id, f.owner, { matterId: otherMatter.id, procedureId: foreign.id });
    await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: assigned.id, stageId: stage.id });
    const links = targets(await readIntakeMaterialContinuation(f.owner.id, f.intake.id, f.matter.id));
    expect(links).toHaveLength(3);
    expect(new Set(links.map(link => link.searchParams.get("procedure")))).toEqual(new Set([f.procedure.id, second.id, null]));
    expect(links.every(link => link.searchParams.get("stage") === "unassigned")).toBe(true);
    expect(links.every(link => link.pathname === `/matters/${f.matter.internalCode}`)).toBe(true);
  });

  it("合法只读经办可用持久入口；逐件读取、资料权限、当前岗位和经办关系撤销即时影响接续", async () => {
    const f = await existing(), reader = await makeUser();
    const roleName = `g11-read-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName,
      permissions: { create: ["matters.read", "documents.read", "documents.download"].map(permissionKey => ({ permissionKey, scope: "OWN" })) } } }); roles.push(role.id);
    const currentReader = await db.user.update({ where: { id: reader.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    await db.intake.update({ where: { id: f.intake.id }, data: { coUserIds: [reader.id] } });
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: reader.id, role: "CO_LEAD" } });
    const document = await original(f.intake.id, f.owner, { matterId: f.matter.id, procedureId: f.procedure.id });
    await setActor(currentReader);
    const detail = await getIntakeById(f.intake.id);
    expect(detail?.teamReadOnly).toBe(true);
    expect(targets(detail!.materialContinuation!)[0].searchParams.get("procedure")).toBe(f.procedure.id);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.download" } } });
    expect(await canReadDocument(reader.id, document)).toBe(false);
    expect(await readIntakeMaterialContinuation(reader.id, f.intake.id, f.matter.id)).toMatchObject({ status: "AVAILABLE", empty: true, unassigned: false });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.read" } } });
    expect(await readIntakeMaterialContinuation(reader.id, f.intake.id, f.matter.id)).toEqual({ status: "DENIED", intakeHref: `/intakes/${f.intake.id}` });
    await db.rolePermission.createMany({ data: ["documents.read", "documents.download"].map(permissionKey => ({ roleId: role.id, permissionKey, scope: "OWN" })) });
    await db.matterMember.deleteMany({ where: { matterId: f.matter.id, userId: reader.id } });
    expect(await readIntakeMaterialContinuation(reader.id, f.intake.id, f.matter.id)).toMatchObject({ status: "DENIED" });
    await db.user.update({ where: { id: reader.id }, data: { active: false } });
    expect(await readIntakeMaterialContinuation(reader.id, f.intake.id, f.matter.id)).toEqual({ status: "DENIED", intakeHref: null });
  });

  it("可选读取故障不回滚真实转案、不使可读收案失败；只保另行核实的回程，故障不当空材料", async () => {
    const f = await submitted(true);
    const findMany = db.document.findMany.bind(db.document);
    const failure = vi.spyOn(db.document, "findMany").mockImplementation((args: Parameters<typeof db.document.findMany>[0]) => {
      if (args?.where?.intakeId === f.intake.id && args.where.matterId) throw new Error("synthetic optional read outage");
      return findMany(args);
    });
    try {
      const result = await convertIntakeToMatter(f.intake.id); matters.push(result.matterId);
      expect(result.ok).toBe(true);
      expect(result.materialContinuation).toEqual({ status: "UNAVAILABLE", intakeHref: `/intakes/${f.intake.id}` });
      expect(await db.intake.findUniqueOrThrow({ where: { id: f.intake.id } })).toMatchObject({ status: "CONVERTED" });
      await setActor(f.owner);
      expect((await getIntakeById(f.intake.id))?.materialContinuation).toEqual({ status: "UNAVAILABLE", intakeHref: `/intakes/${f.intake.id}` });
      expect(await db.auditLog.count({ where: { action: "INTAKE_APPROVE", targetId: f.intake.id } })).toBe(1);
    } finally { failure.mockRestore(); }
    const convertedMatter = await db.matter.findUniqueOrThrow({ where: { intakeId: f.intake.id } });
    expect(targets(await readIntakeMaterialContinuation(f.owner.id, f.intake.id, convertedMatter.id))).toHaveLength(1);
    const roleFailure = vi.spyOn(db.user, "findUnique").mockRejectedValueOnce(new Error("synthetic actor read outage"));
    expect(await readIntakeMaterialContinuation(f.owner.id, f.intake.id, convertedMatter.id)).toEqual({ status: "UNAVAILABLE", intakeHref: null });
    roleFailure.mockRestore();
    await db.matter.update({ where: { id: convertedMatter.id }, data: { deletedAt: new Date() } });
    expect(await readIntakeMaterialContinuation(f.owner.id, f.intake.id, convertedMatter.id)).toMatchObject({ status: "DENIED" });
  });
});
