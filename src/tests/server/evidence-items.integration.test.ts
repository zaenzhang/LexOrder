// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { RoleGrant } from "@/lib/roles/catalog";

// The coordinator supplies an explicitly migrated disposable PostgreSQL database.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("证据集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import {
  addEvidenceSource, confirmEvidenceItem, createEvidenceItem, getEvidenceItem,
  listEvidenceRevisions, removeEvidenceSource, resolveEvidenceSource, updateEvidenceItem,
} from "@/server/evidence/actions";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], roleIds: string[] = [];
function sessionFor(user: Pick<User, "id" | "role">, rolePermissions?: RoleGrant[]) {
  // Keep the request identity fixed so the real domain code must recheck database authorization.
  vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, rolePermissions }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}
async function fixture() {
  const user = await db.user.create({ data: { name: "合成证据经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成证据事项", internalCode: `EVIDENCE-TEST-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  sessionFor(user);
  return { user, matter };
}
async function manual(f: Awaited<ReturnType<typeof fixture>>, sourceDocumentId?: string) {
  return createEvidenceItem({ requestKey: randomUUID(), matterId: f.matter.id, title: "合成付款要点", content: "合成原始内容", kind: "FACT", sourceDocumentId, sourceRelation: "SUPPORTS" });
}
async function document(f: Awaited<ReturnType<typeof fixture>>, version = 1, familyId: string = randomUUID()) {
  // Metadata fixture only. These tests exercise reference persistence, not original-file download or parsing.
  const doc = await db.document.create({ data: { name: "合成来源.txt", matterId: f.matter.id, uploadedById: f.user.id,
    path: `evidence-test/${randomUUID()}.txt`, mimeType: "text/plain", sha256: "a".repeat(64), tags: [], version, familyId } });
  documentIds.push(doc.id);
  return doc;
}

describe.skipIf(!databaseUrl)("Server 证据：真实 PG 修订、来源权限和事务", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Immutable snapshots and audits remain intact; retire only this file's synthetic fixtures.
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("同版本并发保存只有一个提交，旧确认快照不可更新或删除", async () => {
    const f = await fixture(), item = await manual(f);
    await confirmEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, confirm: true });
    const attempts = await Promise.allSettled(["甲", "乙"].map(suffix => updateEvidenceItem({
      evidenceItemId: item.id, expectedRevision: 1, title: `合成修订${suffix}`, content: `合成内容${suffix}`, kind: "CLAIM",
    })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.evidenceItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ revision: 2, confirmedAt: null, confirmedById: null });
    const history = await db.evidenceItemRevision.findMany({ where: { evidenceItemId: item.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ revision: 1, title: "合成付款要点", content: "合成原始内容", confirmedById: f.user.id, sourceSnapshot: [] });
    expect(history[0].confirmedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { targetId: item.id, action: "EVIDENCE_ITEM_EDIT" } })).toBe(1);
    await expect(db.evidenceItemRevision.update({ where: { id: history[0].id }, data: { content: "禁止覆盖" } })).rejects.toThrow(/immutable/i);
    await expect(db.evidenceItemRevision.delete({ where: { id: history[0].id } })).rejects.toThrow(/immutable/i);
  });

  it("旧版确认与保存竞态不会把确认借给新稿", async () => {
    const f = await fixture(), item = await manual(f);
    const [confirmation, edit] = await Promise.allSettled([
      confirmEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, confirm: true }),
      updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, title: "合成新版", content: "合成新版内容", kind: "FACT" }),
    ]);
    // Serializable writes may reject either contender. A rejected edit is retried with the same,
    // still-current revision after confirmation, exactly as a user would reopen and save it.
    if (edit.status === "rejected") await updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, title: "合成新版", content: "合成新版内容", kind: "FACT" });
    const current = await db.evidenceItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(current).toMatchObject({ revision: 2, confirmedAt: null, confirmedById: null });
    const history = await db.evidenceItemRevision.findUniqueOrThrow({ where: { evidenceItemId_revision: { evidenceItemId: item.id, revision: 1 } } });
    expect(Boolean(history.confirmedAt)).toBe(confirmation.status === "fulfilled");
    expect(await db.auditLog.count({ where: { targetId: item.id, action: "EVIDENCE_ITEM_CONFIRM" } })).toBe(confirmation.status === "fulfilled" ? 1 : 0);
  });

  it("审计 SQL 失败时正文、确认、修订快照整体回滚", async () => {
    const f = await fixture(), item = await manual(f);
    await confirmEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, confirm: true });
    await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "evidence_test_reject_edit" CHECK (action <> 'EVIDENCE_ITEM_EDIT') NOT VALID`);
    try {
      await expect(updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, title: "不应提交", content: "不应提交", kind: "CLAIM" })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "evidence_test_reject_edit"`);
    }
    expect(await db.evidenceItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ revision: 1, content: "合成原始内容", confirmedById: f.user.id });
    expect(await db.evidenceItemRevision.count({ where: { evidenceItemId: item.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { targetId: item.id, action: "EVIDENCE_ITEM_EDIT" } })).toBe(0);
  });

  it("真实材料权限撤回遮蔽当前及历史正文，撤来源和旧会话写入均不可绕过", async () => {
    const f = await fixture(), doc = await document(f);
    const grants: RoleGrant[] = ["matters.read", "matters.write", "documents.download"].map(permissionKey => ({ permissionKey, scope: "OWN" } as RoleGrant));
    const name = `evidence-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: grants } } });
    roleIds.push(role.id);
    const user = await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    sessionFor(user, grants);
    const item = await manual(f, doc.id);
    await updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, title: "合成新标题", content: "合成新内容", kind: "FACT" });
    const source = await db.evidenceSourceLink.findFirstOrThrow({ where: { evidenceItemId: item.id } });
    expect(await resolveEvidenceSource({ evidenceItemId: item.id, sourceId: source.id, revision: 1 })).toMatchObject({ status: "AVAILABLE" });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.download" } } });
    expect((await getEvidenceItem(item.id)).item).toMatchObject({ restricted: true, content: "", canEdit: false });
    expect((await listEvidenceRevisions({ evidenceItemId: item.id })).items[0]).toMatchObject({ restricted: true, content: "" });
    expect(await resolveEvidenceSource({ evidenceItemId: item.id, sourceId: source.id, revision: 1 })).toEqual({ status: "UNAVAILABLE" });
    await expect(removeEvidenceSource({ evidenceItemId: item.id, expectedRevision: 2, sourceId: source.id })).rejects.toThrow("不可读");
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "matters.write" } } });
    await expect(manual(f)).rejects.toThrow("授权范围已变化");
    expect(await db.evidenceItem.count({ where: { matterId: f.matter.id } })).toBe(1);
  });

  it("W05 发布快照可挂反驳来源、撤销后按旧修订回查，材料新版本不替换引用", async () => {
    const f = await fixture(), doc = await document(f), item = await manual(f);
    // Fixture a published W05 contract; W05's own suite covers real parser execution.
    const text = "合成反向原文";
    const run = await db.documentParseRun.create({ data: { documentId: doc.id, generation: 1, requestedById: f.user.id, parserVersion: "evidence-fixture-v1", sourceSha256: doc.sha256! } });
    const anchorId = "synthetic-opposing-source";
    await db.documentParseRun.update({ where: { id: run.id }, data: { state: "READY", finishedAt: new Date(),
      coverage: { unitKind: "SEGMENT", totalUnits: 1, units: [{ unit: 1, status: "READY" }] },
      anchors: [{ anchorId, parseGenerationId: run.id, source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId: f.matter.id, sha256: doc.sha256 }, unit: 1, location: { kind: "TEXT", start: 0, end: text.length }, text }],
    } });
    await db.document.update({ where: { id: doc.id }, data: { parseGeneration: 1 } });
    const added = await addEvidenceSource({ evidenceItemId: item.id, expectedRevision: 1, documentId: doc.id, relation: "REBUTS", parseRunId: run.id, anchorId });
    await confirmEvidenceItem({ evidenceItemId: item.id, expectedRevision: 2, confirm: true });
    await removeEvidenceSource({ evidenceItemId: item.id, expectedRevision: 2, sourceId: added.sourceId });
    await document(f, 2, doc.familyId!);
    await db.document.update({ where: { id: doc.id }, data: { parseGeneration: 2 } });
    expect(await resolveEvidenceSource({ evidenceItemId: item.id, sourceId: added.sourceId })).toEqual({ status: "UNAVAILABLE" });
    expect(await resolveEvidenceSource({ evidenceItemId: item.id, sourceId: added.sourceId, revision: 2 })).toMatchObject({
      status: "AVAILABLE", documentVersion: 1, text, historicalParse: true, originalUrl: expect.stringContaining(doc.id),
    });
    const history = (await listEvidenceRevisions({ evidenceItemId: item.id })).items.find(entry => entry.revision === 2)!;
    expect(history.confirmedAt).not.toBeNull();
    expect(history.sources).toEqual([expect.objectContaining({ id: added.sourceId, relation: "REBUTS", documentVersion: 1 })]);
    const restored = await addEvidenceSource({ evidenceItemId: item.id, expectedRevision: 3, documentId: doc.id, relation: "REBUTS", parseRunId: run.id, anchorId });
    expect(restored).toMatchObject({ revision: 4, sourceId: added.sourceId });
    expect(await db.evidenceSourceLink.count({ where: { evidenceItemId: item.id } })).toBe(1);
    expect(await db.evidenceItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ revision: 4, confirmedAt: null });
  });
});
