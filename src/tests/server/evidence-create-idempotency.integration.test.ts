// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { RoleGrant } from "@/lib/roles/catalog";
import { emptyEvidenceEventDate } from "@/lib/evidence/event-date";

// The coordinator alone migrates and runs this dedicated disposable PostgreSQL database.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("创建幂等集成测试仅允许独立的 _test 数据库");
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
  addEvidenceSource, confirmEvidenceItem, createEvidenceItem, removeEvidenceSource, updateEvidenceItem,
} from "@/server/evidence/actions";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], roleIds: string[] = [];
function sessionFor(user: Pick<User, "id" | "role">, rolePermissions?: RoleGrant[]) {
  // Keep the request identity stale deliberately; the real services must recheck live authorization.
  vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, rolePermissions }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}
async function actor() {
  const user = await db.user.create({ data: { name: "合成幂等经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id);
  return user;
}
async function matter(ownerId: string) {
  const row = await db.matter.create({ data: { title: "合成创建幂等事项", internalCode: `EVIDENCE-CREATE-${randomUUID()}`, ownerId } });
  matterIds.push(row.id);
  return row;
}
async function fixture() {
  const user = await actor();
  const row = await matter(user.id);
  sessionFor(user);
  return { user, matter: row };
}
async function document(f: Awaited<ReturnType<typeof fixture>>, hash = "a".repeat(64)) {
  // Metadata fixtures exercise saved identity and authorization; no file is read or hashed.
  const doc = await db.document.create({ data: { name: "合成幂等来源.pdf", matterId: f.matter.id, uploadedById: f.user.id,
    path: `evidence-create-test/${randomUUID()}.pdf`, mimeType: "application/pdf", pageCount: 3, sha256: hash, tags: [] } });
  documentIds.push(doc.id);
  return doc;
}
function inputFor(f: Awaited<ReturnType<typeof fixture>>) {
  return { requestKey: randomUUID(), matterId: f.matter.id, title: "合成付款要点", content: "合成创建原文", kind: "FACT" as const };
}
async function creationCounts(id: string) {
  return {
    sources: await db.evidenceSourceLink.count({ where: { evidenceItemId: id } }),
    revisions: await db.evidenceItemRevision.count({ where: { evidenceItemId: id } }),
    audits: await db.auditLog.count({ where: { targetType: "EvidenceItem", targetId: id } }),
  };
}

describe.skipIf(!databaseUrl)("人工创建幂等：真实 PG", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Preserve immutable evidence, source and audit history; soft-retire only these fixtures.
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("并发同键和丢响应重试只写一项一来源一审计，创建身份不可改且旧行保持空", async () => {
    const f = await fixture(), doc = await document(f);
    const input = { ...inputFor(f), sourceDocumentId: doc.id, sourcePage: 1 };
    const [first, second] = await Promise.all([
      createEvidenceItem({ ...input, requestKey: input.requestKey.toUpperCase(), title: ` ${input.title} ` }),
      createEvidenceItem({ ...input, sourceRelation: "CONTEXT", eventDate: emptyEvidenceEventDate() }),
    ]);
    expect(first).toEqual(second);
    expect(await createEvidenceItem(input)).toEqual(first);
    expect(await db.evidenceItem.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await creationCounts(first.id)).toEqual({ sources: 1, revisions: 0, audits: 1 });
    expect(await db.auditLog.count({ where: { targetId: first.id, action: "EVIDENCE_ITEM_CREATE" } })).toBe(1);
    const current = await db.evidenceItem.findUniqueOrThrow({ where: { id: first.id } });
    expect(current.requestKey).toBe(input.requestKey);
    expect(current.requestHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(db.evidenceItem.update({ where: { id: first.id }, data: { requestKey: null, requestHash: null } })).rejects.toThrow(/immutable/i);
    await expect(db.evidenceItem.update({ where: { id: first.id }, data: { requestHash: "f".repeat(64) } })).rejects.toThrow(/immutable/i);
    const another = await actor();
    await expect(db.evidenceItem.update({ where: { id: first.id }, data: { createdById: another.id } })).rejects.toThrow(/immutable/i);
    const legacy = await db.evidenceItem.create({ data: { matterId: f.matter.id, createdById: f.user.id, title: "合成旧行", content: "无原始请求身份", kind: "FACT" } });
    expect(legacy).toMatchObject({ requestKey: null, requestHash: null });
    await db.evidenceItem.update({ where: { id: legacy.id }, data: { title: "合成旧行正常更正" } });
    expect(await db.evidenceItem.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ requestKey: null, requestHash: null });
    await expect(db.evidenceItem.update({ where: { id: legacy.id }, data: { requestKey: randomUUID(), requestHash: "e".repeat(64) } })).rejects.toThrow(/immutable/i);
  });

  it("同作者同键异载荷含来源和完整日期均拒绝，不跨事项返回或新增", async () => {
    const f = await fixture(), doc = await document(f), otherDoc = await document(f, "b".repeat(64));
    const otherMatter = await matter(f.user.id);
    const input = { ...inputFor(f), sourceDocumentId: doc.id, sourcePage: 1, sourceRelation: "SUPPORTS" as const,
      eventDate: { precision: "RANGE" as const, start: "2024-06-01", end: "2024-08-31", text: "合成夏季表述" } };
    const created = await createEvidenceItem(input);
    for (const change of [
      { title: "另一个标题" }, { content: "另一个正文" }, { kind: "CLAIM" as const }, { matterId: otherMatter.id },
      { sourceDocumentId: otherDoc.id }, { sourcePage: 2 }, { sourceRelation: "REBUTS" as const },
      { eventDate: { ...input.eventDate, start: "2024-06-02" } }, { eventDate: { ...input.eventDate, end: "2024-08-30" } },
      { eventDate: { ...input.eventDate, text: "另一时间表述" } }, { eventDate: emptyEvidenceEventDate() },
    ]) await expect(createEvidenceItem({ ...input, ...change })).rejects.toThrow("此提交已保存且内容发生变化");
    expect(await db.evidenceItem.count({ where: { createdById: f.user.id } })).toBe(1);
    expect(await creationCounts(created.id)).toEqual({ sources: 1, revisions: 0, audits: 1 });
    // A genuinely new intent may reuse text; content similarity is not an identity.
    const distinct = await createEvidenceItem({ ...input, requestKey: randomUUID() });
    expect(distinct.id).not.toBe(created.id);
  });

  it("提交后的改稿、确认及来源增删保持不变，原来源和当前来源分别重验", async () => {
    const f = await fixture(), originalDoc = await document(f), currentDoc = await document(f, "b".repeat(64));
    const input = { ...inputFor(f), sourceDocumentId: originalDoc.id, sourceRelation: "SUPPORTS" as const };
    const created = await createEvidenceItem(input);
    const originalSource = await db.evidenceSourceLink.findFirstOrThrow({ where: { evidenceItemId: created.id } });
    await addEvidenceSource({ evidenceItemId: created.id, expectedRevision: 1, documentId: currentDoc.id, relation: "REBUTS", page: 2 });
    await removeEvidenceSource({ evidenceItemId: created.id, expectedRevision: 2, sourceId: originalSource.id });
    await updateEvidenceItem({ evidenceItemId: created.id, expectedRevision: 3, title: "合成后来更正", content: "合成新正文", kind: "CLAIM",
      eventDate: { precision: "EXACT", start: "2024-02-29", end: null, text: "后来核对的发生日期" } });
    await confirmEvidenceItem({ evidenceItemId: created.id, expectedRevision: 4, confirm: true });
    const current = await db.evidenceItem.findUniqueOrThrow({ where: { id: created.id } });
    const sources = await db.evidenceSourceLink.findMany({ where: { evidenceItemId: created.id }, orderBy: { id: "asc" } });
    const counts = await creationCounts(created.id);
    expect(await createEvidenceItem(input)).toEqual(created);
    expect(await db.evidenceItem.findUniqueOrThrow({ where: { id: created.id } })).toEqual(current);
    expect(await db.evidenceSourceLink.findMany({ where: { evidenceItemId: created.id }, orderBy: { id: "asc" } })).toEqual(sources);
    expect(await creationCounts(created.id)).toEqual(counts);
    expect(current).toMatchObject({ revision: 4, confirmedById: f.user.id, title: "合成后来更正" });
    await db.document.update({ where: { id: originalDoc.id }, data: { deletedAt: new Date() } });
    await expect(createEvidenceItem(input)).rejects.toThrow("来源材料不存在或已删除");
    await db.document.update({ where: { id: originalDoc.id }, data: { deletedAt: null, sha256: "c".repeat(64) } });
    await expect(createEvidenceItem(input)).rejects.toThrow("原提交的来源身份已变化");
    await db.document.update({ where: { id: originalDoc.id }, data: { sha256: originalDoc.sha256 } });
    await db.document.update({ where: { id: currentDoc.id }, data: { deletedAt: new Date() } });
    await expect(createEvidenceItem(input)).rejects.toThrow("部分来源已不可读");
    expect(await creationCounts(created.id)).toEqual(counts);
  });

  it("旧会话在材料权限、写权、账号、事项关联或归档撤回后不能重放成功", async () => {
    const f = await fixture(), doc = await document(f);
    const grants: RoleGrant[] = ["matters.read", "matters.write", "documents.download"].map(permissionKey => ({ permissionKey, scope: "OWN" } as RoleGrant));
    const name = `evidence-create-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: grants } } });
    roleIds.push(role.id);
    const user = await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    sessionFor(user, grants);
    const input = { ...inputFor(f), sourceDocumentId: doc.id };
    const created = await createEvidenceItem(input);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.download" } } });
    await expect(createEvidenceItem(input)).rejects.toThrow("无权读取来源材料");
    await db.rolePermission.create({ data: { roleId: role.id, permissionKey: "documents.download", scope: "OWN" } });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "matters.write" } } });
    await expect(createEvidenceItem(input)).rejects.toThrow("授权范围已变化");
    await db.rolePermission.create({ data: { roleId: role.id, permissionKey: "matters.write", scope: "OWN" } });
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await expect(createEvidenceItem(input)).rejects.toThrow();
    await db.user.update({ where: { id: user.id }, data: { active: true } });
    const nextOwner = await actor();
    await db.matter.update({ where: { id: f.matter.id }, data: { ownerId: nextOwner.id } });
    await expect(createEvidenceItem(input)).rejects.toThrow("无权关联");
    await db.matter.update({ where: { id: f.matter.id }, data: { ownerId: user.id, status: "ARCHIVED" } });
    await expect(createEvidenceItem(input)).rejects.toThrow("归档");
    expect(await db.evidenceItem.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await creationCounts(created.id)).toEqual({ sources: 1, revisions: 0, audits: 1 });
  });
});
