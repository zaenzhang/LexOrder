// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("保全编辑仅验证隔离的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: process.env.WORKBENCH_TEST_DATABASE_URL ? createPrismaClient(process.env.WORKBENCH_TEST_DATABASE_URL) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { resolveRoleUser } from "@/lib/roles/service";
import * as audit from "@/server/audit";
import { createPreservationCase, listPreservationCases, updatePreservationCase } from "@/server/preservations/actions-v2";

const users: string[] = [], matters: string[] = [], roles: string[] = [], properties: string[] = [];
async function newUser() {
  const user = await db.user.create({ data: { name: "合成保全律师", email: `${randomUUID()}@example.invalid`, role: "LAWYER", passwordHash: "disabled-test-only" } });
  users.push(user.id); return user;
}
async function sessionFor(user: User) {
  vi.mocked(requireSession).mockResolvedValue({ user: { ...await resolveRoleUser(user.id, user.role, db), id: user.id,
    systemRole: user.systemRole, avatar: user.avatar, runtimeMode: "SERVER" }, expires: "2099-01-01" });
}
async function newMatter(ownerId: string) {
  const matter = await db.matter.create({ data: { title: "合成保全事项", internalCode: `PRES-EDIT-${randomUUID()}`, ownerId } });
  matters.push(matter.id); return matter;
}
async function fixture() {
  const user = await newUser(), matter = await newMatter(user.id);
  await sessionFor(user); return { user, matter };
}
const include = { targets: { include: { properties: { include: { renewals: true } } } } } as const;
async function existingCase(f: Awaited<ReturnType<typeof fixture>>, changes: Partial<Prisma.PreservationCaseUncheckedCreateInput> = {}) {
  const record = await db.preservationCase.create({ data: {
    matterId: f.matter.id, ownerId: f.user.id, type: "LITIGATION", status: "RENEWED", court: "合成原法院", rulingNumber: "合成原裁定",
    note: "合成原备注", guaranteeType: "GUARANTEE_LETTER", appliedAt: new Date("2026-01-02T03:04:05.678Z"), remindDays: [21, 2], ...changes,
    targets: { create: { name: "合成被保全人", properties: { create: { propertyType: "BANK_DEPOSIT", propertyDetail: "合成财产", amount: "12345.67",
      startDate: new Date("2026-01-01"), duration: 365, expiryDate: new Date("2028-01-01"), status: "RENEWED",
      renewals: { create: { performedById: f.user.id, renewedAt: new Date("2026-11-01"), oldExpiryDate: new Date("2027-01-01"),
        newExpiryDate: new Date("2028-01-01"), renewalDuration: 365, note: "合成既有续期" } },
    } } } },
  }, include });
  properties.push(record.targets[0].properties[0].id);
  return record;
}
async function reminderRows(propertyId: string, userId: string) {
  const common = { objectType: "PRESERVATION_PROPERTY" as const, objectId: propertyId, kind: "OFFSET" as const,
    offset: -2, dayKey: "2026-11-18", userId, registeredAt: new Date() };
  const pending = await db.reminderDelivery.create({ data: { ...common, channel: "IN_APP", status: "PENDING" } });
  const sent = await db.reminderDelivery.create({ data: { ...common, channel: "EMAIL", status: "SENT", sentAt: new Date(), attempts: 1 } });
  return { pending, sent };
}
async function makeCustom(user: User, permissions: string[]) {
  const name = `pres-edit-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name, normalizedName: name,
    permissions: { create: permissions.map(permissionKey => ({ permissionKey, scope: "OWN" })) } } });
  roles.push(role.id);
  const current = await db.user.update({ where: { id: user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
  return { user: current, role };
}
function edit(record: { id: string; updatedAt: Date }, changes: Omit<Parameters<typeof updatePreservationCase>[0], "id" | "expectedUpdatedAt">) {
  return updatePreservationCase({ id: record.id, expectedUpdatedAt: record.updatedAt, ...changes });
}

describe.skipIf(!databaseUrl)("C8 保全原记录编辑 / 真实 PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.mocked(revalidatePath).mockClear(); });
  afterAll(async () => {
    // Only retire this file's synthetic subjects and pending reminders. Keep case/renewal/audit history.
    await db.reminderDelivery.updateMany({ where: { objectType: "PRESERVATION_PROPERTY", objectId: { in: properties }, status: "PENDING" }, data: { status: "CANCELLED" } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("修改原 ID，不新增记录；担保、申请日、提醒、财产和续期全部保留", async () => {
    const f = await fixture(), before = await existingCase(f);
    const count = await db.preservationCase.count({ where: { matterId: f.matter.id } });
    await edit(before, { court: " 合成更正法院 ", note: " 合成更正备注 " });
    const after = await db.preservationCase.findUniqueOrThrow({ where: { id: before.id }, include });
    expect(await db.preservationCase.count({ where: { matterId: f.matter.id } })).toBe(count);
    expect(after).toEqual({ ...before, court: "合成更正法院", note: "合成更正备注", updatedAt: after.updatedAt });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(await db.auditLog.count({ where: { targetId: before.id, action: "PRESERVATION_CASE_UPDATE" } })).toBe(1);
  });

  it("无实质变化不写版本或审计；同负责人/事项/提醒集合及备注编辑不作废提醒", async () => {
    const f = await fixture(), before = await existingCase(f), rows = await reminderRows(before.targets[0].properties[0].id, f.user.id);
    await edit(before, { matterId: before.matterId, ownerId: before.ownerId, remindDays: [2, 21, 2], note: ` ${before.note} ` });
    expect(await db.preservationCase.findUniqueOrThrow({ where: { id: before.id }, include })).toEqual(before);
    expect(await db.auditLog.count({ where: { targetId: before.id, action: "PRESERVATION_CASE_UPDATE" } })).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
    await edit(before, { matterId: before.matterId, ownerId: before.ownerId, note: "仅更新备注" });
    expect(await db.reminderDelivery.findUniqueOrThrow({ where: { id: rows.pending.id } })).toEqual(rows.pending);
    expect(await db.reminderDelivery.findUniqueOrThrow({ where: { id: rows.sent.id } })).toEqual(rows.sent);
  });

  it("真实关联和负责人变化只作废 PENDING，保留 SENT 并刷新新旧事项", async () => {
    const f = await fixture(), target = await newMatter(f.user.id), owner = await newUser(), before = await existingCase(f);
    const rows = await reminderRows(before.targets[0].properties[0].id, f.user.id);
    await edit(before, { matterId: target.id, ownerId: owner.id });
    expect(await db.preservationCase.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ matterId: target.id, ownerId: owner.id });
    expect(await db.reminderDelivery.findUniqueOrThrow({ where: { id: rows.pending.id } })).toMatchObject({ status: "SUPERSEDED" });
    expect(await db.reminderDelivery.findUniqueOrThrow({ where: { id: rows.sent.id } })).toEqual(rows.sent);
    for (const path of ["/preservation", `/matters/${f.matter.internalCode}`, `/matters/${target.internalCode}`]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it("独立保全必须明确有效且可读负责人；解除关联后按原 owner 规则转移可见性", async () => {
    const f = await fixture(), before = await existingCase(f, { ownerId: null }), other = await newUser();
    await expect(createPreservationCase({ type: "PRE_LITIGATION", remindDays: [2] })).rejects.toThrow("必须指定");
    await expect(edit(before, { matterId: null })).rejects.toThrow("必须指定");
    await db.user.update({ where: { id: other.id }, data: { active: false } });
    await expect(edit(before, { matterId: null, ownerId: other.id })).rejects.toThrow("停用");
    await db.user.update({ where: { id: other.id }, data: { active: true } });
    const custom = await makeCustom(other, []);
    await expect(edit(before, { matterId: null, ownerId: other.id })).rejects.toThrow("无权读取");
    await db.rolePermission.create({ data: { roleId: custom.role.id, permissionKey: "matters.read", scope: "OWN" } });
    await db.roleDefinition.update({ where: { id: custom.role.id }, data: { active: false } });
    await expect(edit(before, { matterId: null, ownerId: other.id })).rejects.toThrow("无权读取");
    await db.roleDefinition.update({ where: { id: custom.role.id }, data: { active: true } });
    await edit(before, { matterId: null, ownerId: other.id });
    const saved = await db.preservationCase.findUniqueOrThrow({ where: { id: before.id } });
    expect((await listPreservationCases()).some(row => row.id === before.id)).toBe(false);
    await expect(edit(saved, { note: "原人已无独立记录权限" })).rejects.toThrow("无权操作");
    await sessionFor(custom.user);
    expect((await listPreservationCases()).some(row => row.id === before.id)).toBe(true);
    // Ownership needs read permission, not a fabricated write grant; a read-only owner still cannot edit.
    await expect(edit(saved, { note: "只读负责人不能写" })).rejects.toThrow("当前角色无权");
  });

  it("当前账号/岗位、原事项与新事项权限和归档状态重新核实", async () => {
    const f = await fixture(), before = await existingCase(f), other = await newUser(), hidden = await newMatter(other.id), target = await newMatter(f.user.id);
    await expect(edit(before, { matterId: hidden.id })).rejects.toThrow("无权处理");
    await db.matter.update({ where: { id: target.id }, data: { status: "ARCHIVED" } });
    await expect(edit(before, { matterId: target.id })).rejects.toThrow("已归档");
    await expect(createPreservationCase({ matterId: target.id, type: "LITIGATION", remindDays: [2] })).rejects.toThrow("已归档");
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(edit(before, { matterId: null, ownerId: f.user.id })).rejects.toThrow("已归档");
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "IN_PROGRESS" } });
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(edit(before, { note: "停用后旧会话" })).rejects.toThrow("账号或岗位已变化");
    await db.user.update({ where: { id: f.user.id }, data: { active: true, role: "FINANCE" } });
    await expect(edit(before, { note: "换岗后旧会话" })).rejects.toThrow("账号或岗位已变化");
    await db.user.update({ where: { id: f.user.id }, data: { role: "LAWYER" } });
    const custom = await makeCustom(f.user, ["matters.read", "matters.write"]);
    await sessionFor(custom.user);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: custom.role.id, permissionKey: "matters.write" } } });
    await expect(edit(before, { note: "撤权后旧会话" })).rejects.toThrow("当前角色无权");
    expect(await db.preservationCase.findUniqueOrThrow({ where: { id: before.id }, include })).toEqual(before);
  });

  it("同一毫秒版本并发只提交一次，版本单调推进，旧版本不覆盖", async () => {
    const f = await fixture(), before = await existingCase(f, { updatedAt: new Date(Date.now() + 60000) });
    const results = await Promise.allSettled([edit(before, { note: "并发稿甲" }), edit(before, { note: "并发稿乙" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const after = await db.preservationCase.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime() + 1);
    await expect(edit(before, { note: "旧版稿" })).rejects.toThrow("已变化");
    expect(await db.auditLog.count({ where: { targetId: before.id, action: "PRESERVATION_CASE_UPDATE" } })).toBe(1);
  });

  it("审计失败同时回滚原记录和提醒；创建失败不留下首项与财产", async () => {
    const f = await fixture(), before = await existingCase(f), rows = await reminderRows(before.targets[0].properties[0].id, f.user.id);
    const failingAudit = vi.spyOn(audit, "auditTx").mockRejectedValueOnce(new Error("合成审计失败"));
    await expect(edit(before, { remindDays: [9], note: "应整体回滚" })).rejects.toThrow("合成审计失败");
    expect(await db.preservationCase.findUniqueOrThrow({ where: { id: before.id }, include })).toEqual(before);
    expect(await db.reminderDelivery.findUniqueOrThrow({ where: { id: rows.pending.id } })).toEqual(rows.pending);
    const count = await db.preservationCase.count({ where: { matterId: f.matter.id } });
    failingAudit.mockRejectedValueOnce(new Error("合成创建审计失败"));
    await expect(createPreservationCase({ matterId: f.matter.id, type: "LITIGATION", remindDays: [2], firstTarget: "不得残留的首项", firstPropertyType: "BANK_DEPOSIT" })).rejects.toThrow("合成创建审计失败");
    expect(await db.preservationCase.count({ where: { matterId: f.matter.id } })).toBe(count);
    expect(await db.preservationTarget.count({ where: { case: { matterId: f.matter.id }, name: "不得残留的首项" } })).toBe(0);
  });
});
