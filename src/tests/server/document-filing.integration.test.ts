// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("入卷验证仅允许独立的 _test 数据库");
const session = vi.hoisted(() => ({ user: { id: "", role: "LAWYER" } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { fileDocument } from "@/server/documents/actions";
import { intakeState } from "@/server/intakes/workflow";

const userIds: string[] = [], matterIds: string[] = [], roleIds: string[] = [];
async function fixture(role: UserRole = "LAWYER") {
  let roleId: string | null = null;
  if (role === "CUSTOM") {
    const name = `filing-${randomUUID()}`;
    const definition = await db.roleDefinition.create({ data: { name, normalizedName: name,
      permissions: { create: [{ permissionKey: "documents.write", scope: "OWN" }] } } });
    roleIds.push(definition.id); roleId = definition.id;
  }
  const user = await db.user.create({ data: { name: "合成文书经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role, roleDefinitionId: roleId } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成文书入卷事项", internalCode: `FILE-TEST-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  const document = await db.document.create({ data: { name: "合成批准稿.txt", matterId: matter.id, uploadedById: user.id,
    category: "PLEADING", status: "APPROVED", path: `synthetic-only/${randomUUID()}`, mimeType: "text/plain", size: 1, sha256: "a".repeat(64) } });
  session.user = { id: user.id, role };
  return { user, matter, document, roleId };
}
function input(document: { id: string; updatedAt: Date }) { return { documentId: document.id, expectedUpdatedAt: document.updatedAt }; }

describe.skipIf(!databaseUrl)("文书入卷：真实 PG 事务与具体版本", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Keep immutable business/audit history; only retire this file's fixtures.
    await db.document.updateMany({ where: { uploadedById: { in: userIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it.each(["LAWYER", "PRINCIPAL_LAWYER", "CUSTOM"] as const)("%s 入卷与唯一成功审计在同一事务，重复调用不再次成功", async role => {
    const f = await fixture(role);
    await expect(fileDocument(input(f.document))).resolves.toEqual({ ok: true });
    await expect(fileDocument(input(f.document))).rejects.toThrow("只有已批准");
    expect((await db.document.findUniqueOrThrow({ where: { id: f.document.id } })).status).toBe("FILED");
    expect(await db.auditLog.count({ where: { action: "DOCUMENT_FILE", targetId: f.document.id } })).toBe(1);
  });

  it.each(["LAWYER", "CUSTOM"] as const)("%s 的审计失败不会留下已入卷状态", async role => {
    const f = await fixture(role);
    const constraint = `filing_test_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "${constraint}" CHECK (action <> 'DOCUMENT_FILE' OR "targetId" IS DISTINCT FROM '${f.document.id}') NOT VALID`);
    try {
      await expect(fileDocument(input(f.document))).rejects.toThrow();
      expect((await db.document.findUniqueOrThrow({ where: { id: f.document.id } })).status).toBe("APPROVED");
      expect(await db.auditLog.count({ where: { action: "DOCUMENT_FILE", targetId: f.document.id } })).toBe(0);
    } finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "${constraint}"`); }
  });

  it("并发入卷只接受一次，另一请求不产生第二条成功审计", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([fileDocument(input(f.document)), fileDocument(input(f.document))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "DOCUMENT_FILE", targetId: f.document.id } })).toBe(1);
  });

  it("客户端看过批准状态后，归档、撤回、账号停用和角色撤权仍实时拒绝", async () => {
    const archived = await fixture();
    await db.matter.update({ where: { id: archived.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await expect(fileDocument(input(archived.document))).rejects.toThrow("案件已归档");
    const withdrawn = await fixture();
    await db.document.update({ where: { id: withdrawn.document.id }, data: { deletedAt: new Date() } });
    await expect(fileDocument(input(withdrawn.document))).rejects.toThrow("已撤回");
    const inactive = await fixture();
    await db.user.update({ where: { id: inactive.user.id }, data: { active: false } });
    await expect(fileDocument(input(inactive.document))).rejects.toThrow("账号不可用");
    const revoked = await fixture("CUSTOM");
    await db.rolePermission.deleteMany({ where: { roleId: revoked.roleId! } });
    await expect(fileDocument(input(revoked.document))).rejects.toThrow("无权办理");
    expect(await db.auditLog.count({ where: { action: "DOCUMENT_FILE", targetId: { in: [archived.document.id, withdrawn.document.id, inactive.document.id, revoked.document.id] } } })).toBe(0);
  });

  it("只按看过的具体批准版入卷，不要求上传人或族最新版，也不改变新版草稿", async () => {
    const f = await fixture();
    await db.document.update({ where: { id: f.document.id }, data: { isLatest: false } });
    const newer = await db.document.create({ data: { name: "合成新草稿.txt", matterId: f.matter.id, uploadedById: f.user.id,
      familyId: f.document.familyId, version: 2, category: "PLEADING", status: "DRAFT", path: `synthetic-only/${randomUUID()}` } });
    const colleague = await db.user.create({ data: { name: "合成协办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
    userIds.push(colleague.id);
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: colleague.id, role: "CO_LEAD" } });
    session.user = { id: colleague.id, role: "LAWYER" };
    const original = await db.document.findUniqueOrThrow({ where: { id: f.document.id } });
    await expect(fileDocument({ documentId: original.id, expectedUpdatedAt: new Date(original.updatedAt.getTime() - 1000) })).rejects.toThrow("材料已变化");
    await fileDocument(input(original));
    expect((await db.document.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("FILED");
    expect((await db.document.findUniqueOrThrow({ where: { id: newer.id } })).status).toBe("DRAFT");
  });

  it("已固定收案送审原件转入案件后，仍不能通过入卷改写其状态", async () => {
    const f = await fixture("PRINCIPAL_LAWYER");
    const intake = await db.intake.create({ data: { title: "合成已成案收案", createdById: f.user.id, ownerUserId: f.user.id } });
    await db.document.update({ where: { id: f.document.id }, data: { matterId: null, intakeId: intake.id } });
    const state = await intakeState(db, intake.id);
    const check = await db.conflictCheck.create({ data: { intakeId: intake.id, queryPayload: state.queries,
      subjectFingerprint: state.subjectFingerprint, conclusion: "DIFFERENT", decidedById: f.user.id, decidedAt: new Date(), note: "合成固定原件" } });
    await db.intakeRevision.create({ data: { intakeId: intake.id, round: 1, snapshot: state.snapshot, fingerprint: state.fingerprint, checkId: check.id, submittedById: f.user.id } });
    await db.$transaction(async tx => {
      await tx.intake.update({ where: { id: intake.id }, data: { status: "CONVERTED" } });
      await tx.matter.update({ where: { id: f.matter.id }, data: { intakeId: intake.id } });
      await tx.document.update({ where: { id: f.document.id }, data: { matterId: f.matter.id } });
    });
    const document = await db.document.findUniqueOrThrow({ where: { id: f.document.id } });
    await expect(fileDocument(input(document))).rejects.toThrow("固定于收案");
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "DOCUMENT_FILE", targetId: document.id } })).toBe(0);
  });
});
