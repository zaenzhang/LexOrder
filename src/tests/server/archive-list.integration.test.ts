// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const state = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("归档列表测试仅允许独立的 _test 数据库");
  return { url, actor: null as WorkspaceActor | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: state.url ? createPrismaClient(state.url) : undefined };
});
// Request session and Next cache only. Record queries/count, role projection,
// matter visibility, cursor authentication and transactions use the real implementation.
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: state.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { resolveRoleUser } from "@/lib/roles/service";
import { listArchivedMatters } from "@/server/archive/actions";

const users: string[] = [], roles: string[] = [], matters: string[] = [];
const stamp = new Date("2026-01-01T00:00:00.000Z");
async function fixture(count = 1) {
  const label = `archive-list-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name: label, normalizedName: label,
    permissions: { create: [{ permissionKey: "archive.read", scope: "OWN" }, { permissionKey: "matters.read", scope: "OWN" }] } } }); roles.push(role.id);
  const user = await db.user.create({ data: { name: "合成归档查找人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-synthetic-only", role: "CUSTOM", roleDefinitionId: role.id } }); users.push(user.id);
  const matter = await db.matter.create({ data: { title: `合成归档查找-${label}`, internalCode: label, firmCaseNo: `所内-${label}`, ownerId: user.id, status: "ARCHIVED" } }); matters.push(matter.id);
  const actor: WorkspaceActor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
  // Synthetic historical records deliberately have no fixed material snapshot;
  // this suite tests the ledger only, not approval or package generation.
  const original = await db.archiveRecord.create({ data: { matterId: matter.id, archiveNo: `${label}-original`, status: "APPROVED",
    summary: "合成归档记录", checklistJson: {}, missingItems: [], archivedBy: user.name, archivedById: user.id, archivedAt: stamp } });
  if (count > 1) await db.archiveRecord.createMany({ data: Array.from({ length: count - 1 }, (_, index) => ({ matterId: matter.id,
    archiveNo: `${label}-supplement-${index}`, supplementOfId: original.id, status: "APPROVED" as const, summary: "合成补充归档记录",
    checklistJson: {}, missingItems: [], archivedBy: user.name, archivedById: user.id, archivedAt: stamp })) });
  return { actor, user, role, matter, original, label };
}

describe.skipIf(!state.url)("G07 归档记录有界查找：真实 PG", () => {
  beforeAll(async () => { vi.stubEnv("NEXTAUTH_SECRET", "synthetic-archive-pagination-secret"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("超过200条仍可连续读取；同案补充记录分别计数且同时间不遗漏重复", async () => {
    const f = await fixture(205), other = await fixture(); state.actor = f.actor;
    await db.matter.update({ where: { id: other.matter.id }, data: { title: f.matter.title } });
    await db.archiveRecord.create({ data: { matterId: f.matter.id, archiveNo: `${f.label}-pending`, status: "PENDING_REVIEW",
      summary: "合成待审不入台账", checklistJson: {}, missingItems: [], archivedBy: f.user.name } });
    const expected = await db.archiveRecord.findMany({ where: { matterId: f.matter.id, status: "APPROVED" }, orderBy: [{ archivedAt: "desc" }, { id: "desc" }], select: { id: true } });
    const first = await listArchivedMatters({ query: ` ${f.matter.title} ` });
    expect(first.recordTotal).toBe(205); expect(first.items).toHaveLength(50);
    expect(first.items.every(row => row.matter.id === f.matter.id && row.materialSnapshotVerified === false)).toBe(true);
    const seen = first.items.map(row => row.id); let cursor = first.nextCursor;
    while (cursor) {
      const page = await listArchivedMatters({ query: f.matter.title, cursor });
      expect(page.recordTotal).toBe(205); expect(page.items.length).toBeLessThanOrEqual(50);
      seen.push(...page.items.map(row => row.id)); cursor = page.nextCursor;
    }
    expect(seen).toEqual(expected.map(row => row.id)); expect(new Set(seen).size).toBe(205);
    expect(vi.mocked(requireSession)).toHaveBeenLastCalledWith("archive.read");
    expect(f.actor.rolePermissions).toContainEqual(expect.objectContaining({ permissionKey: "archive.read", scope: "OWN" }));
    expect((await listArchivedMatters({ query: f.original.archiveNo })).recordTotal).toBe(1);
    expect((await listArchivedMatters({ query: f.matter.firmCaseNo! })).recordTotal).toBe(205);
  });

  it("真实程序案号检索与计数同授权范围，信息程序亦可命中", async () => {
    const f = await fixture(2), other = await fixture(); state.actor = f.actor;
    const caseNumber = `(2026)合成民初${randomUUID()}号`;
    for (const item of [f, other]) await db.matterProcedure.create({ data: { matterId: item.matter.id, type: "FIRST_INSTANCE", order: 1, engagement: "INFORMATIONAL", caseNumber } });
    const page = await listArchivedMatters({ query: caseNumber });
    expect(page.recordTotal).toBe(2); expect(page.items).toHaveLength(2);
    expect(page.items.every(row => row.matter.id === f.matter.id)).toBe(true);
    expect(new Set(page.items.map(row => row.id)).size).toBe(2);
  });

  it("游标不能跨查询/用户或伪造；后续读取按当前事项范围重算列表和记录数", async () => {
    const f = await fixture(51), other = await fixture(); state.actor = f.actor;
    const cursor = (await listArchivedMatters({ query: f.label })).nextCursor!;
    await expect(listArchivedMatters({ query: "其他查询", cursor })).rejects.toThrow("位置已失效");
    await expect(listArchivedMatters({ query: f.label, cursor: `${cursor}x` })).rejects.toThrow("位置已失效");
    state.actor = other.actor;
    await expect(listArchivedMatters({ query: f.label, cursor })).rejects.toThrow("位置已失效");
    state.actor = f.actor;
    await db.matter.update({ where: { id: f.matter.id }, data: { ownerId: other.user.id } });
    expect(await listArchivedMatters({ query: f.label, cursor })).toEqual({ items: [], recordTotal: 0, nextCursor: null });
  });
});
