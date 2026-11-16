// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { RoleGrant } from "@/lib/roles/catalog";
import { emptyEvidenceEventDate, type EvidenceEventDate } from "@/lib/evidence/event-date";

// The coordinator applies the reviewed migration to a dedicated disposable database.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("事实日期集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { confirmEvidenceItem, createEvidenceItem, getEvidenceItem, listEvidenceItems, listEvidenceRevisions, updateEvidenceItem } from "@/server/evidence/actions";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], roleIds: string[] = [];
function sessionFor(user: Pick<User, "id" | "role">, rolePermissions?: RoleGrant[]) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, rolePermissions }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}
async function fixture() {
  const user = await db.user.create({ data: { name: "合成日期经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成日期事项", internalCode: `FACT-DATE-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  sessionFor(user);
  return { user, matter };
}

describe.skipIf(!databaseUrl)("事实日期增量：真实 PG", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Keep immutable evidence and audit history; retire this file's synthetic fixtures only.
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("只改日期保存旧确认快照，旧调用保留日期，显式未知可确认且历史新列不可覆盖", async () => {
    const f = await fixture();
    const text = { title: "合成合同洽谈", content: "当事人称曾洽谈合同", kind: "CLAIM" as const };
    const created = await createEvidenceItem({ matterId: f.matter.id, ...text });
    expect((await getEvidenceItem(created.id)).item.eventDate).toEqual(emptyEvidenceEventDate());
    await confirmEvidenceItem({ evidenceItemId: created.id, expectedRevision: 1, confirm: true });
    const range: EvidenceEventDate = { precision: "RANGE", start: "2024-06-01", end: "2024-08-31", text: "用户依据来件人工确定的夏季范围" };
    await updateEvidenceItem({ evidenceItemId: created.id, expectedRevision: 1, ...text, eventDate: range });
    expect((await getEvidenceItem(created.id)).item).toMatchObject({ revision: 2, confirmedAt: null, eventDate: range });
    await confirmEvidenceItem({ evidenceItemId: created.id, expectedRevision: 2, confirm: true });
    await updateEvidenceItem({ evidenceItemId: created.id, expectedRevision: 2, ...text, title: "合成标题更正" });
    expect((await getEvidenceItem(created.id)).item).toMatchObject({ revision: 3, eventDate: range, confirmedAt: null });
    const unknown = { ...emptyEvidenceEventDate(), text: "后核实只能记为某年夏天" };
    await updateEvidenceItem({ evidenceItemId: created.id, expectedRevision: 3, ...text, eventDate: unknown });
    await confirmEvidenceItem({ evidenceItemId: created.id, expectedRevision: 4, confirm: true });
    expect((await getEvidenceItem(created.id)).item).toMatchObject({ revision: 4, eventDate: unknown, confirmedAt: expect.any(Date) });
    await expect(updateEvidenceItem({ evidenceItemId: created.id, expectedRevision: 3, ...text, eventDate: range })).rejects.toThrow("已有新修订");
    const history = (await listEvidenceRevisions({ evidenceItemId: created.id })).items;
    expect(history.find(row => row.revision === 1)).toMatchObject({ eventDate: emptyEvidenceEventDate(), confirmedAt: expect.any(Date) });
    expect(history.find(row => row.revision === 2)).toMatchObject({ eventDate: range, confirmedAt: expect.any(Date) });
    await expect(db.evidenceItemRevision.update({
      where: { evidenceItemId_revision: { evidenceItemId: created.id, revision: 2 } }, data: { eventDateText: "禁止改写旧日期" },
    })).rejects.toThrow(/immutable/i);
  });

  it("数据库同时约束当前项和历史的日期组合、公历范围及原文长度", async () => {
    const f = await fixture();
    const item = await createEvidenceItem({ matterId: f.matter.id, title: "合成无日期记录", content: "合成记载", kind: "FACT" });
    await expect(db.evidenceItem.update({ where: { id: item.id }, data: { eventDatePrecision: "EXACT" } })).rejects.toThrow();
    await expect(db.evidenceItem.update({ where: { id: item.id }, data: { eventDateStart: new Date("2024-01-01T00:00:00Z") } })).rejects.toThrow();
    await expect(db.evidenceItem.update({ where: { id: item.id }, data: {
      eventDatePrecision: "RANGE", eventDateStart: new Date("2024-02-01T00:00:00Z"), eventDateEnd: new Date("2024-01-01T00:00:00Z"),
    } })).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "EvidenceItem" SET "eventDatePrecision" = 'EXACT', "eventDateStart" = DATE '10000-01-01' WHERE id = ${item.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "EvidenceItem" SET "eventDatePrecision" = 'EXACT', "eventDateStart" = DATE '0001-01-01 BC' WHERE id = ${item.id}`).rejects.toThrow();
    await expect(db.evidenceItem.update({ where: { id: item.id }, data: { eventDateText: "时".repeat(501) } })).rejects.toThrow();
    const history = { evidenceItemId: item.id, revision: 99, title: "合成历史", content: "合成内容", kind: "FACT" as const, editedById: f.user.id };
    await expect(db.evidenceItemRevision.create({ data: { ...history, eventDatePrecision: "RANGE", eventDateStart: new Date("2024-01-01T00:00:00Z") } })).rejects.toThrow();
    await expect(db.evidenceItemRevision.create({ data: { ...history, eventDateText: "时".repeat(501) } })).rejects.toThrow();
    expect((await getEvidenceItem(item.id)).item.eventDate).toEqual(emptyEvidenceEventDate());
    expect(await db.evidenceItemRevision.count({ where: { evidenceItemId: item.id } })).toBe(0);
  });

  it("真实来源撤权后当前、列表和历史不返回日期边界或原文，数据库历史仍保留", async () => {
    const f = await fixture();
    const grants: RoleGrant[] = ["matters.read", "matters.write", "documents.download"].map(permissionKey => ({ permissionKey, scope: "OWN" } as RoleGrant));
    const name = `fact-date-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: grants } } });
    roleIds.push(role.id);
    const actor = await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    sessionFor(actor, grants);
    const doc = await db.document.create({ data: { name: "合成日期来源.txt", matterId: f.matter.id, uploadedById: actor.id,
      path: `fact-date-test/${randomUUID()}.txt`, mimeType: "text/plain", sha256: "b".repeat(64), tags: [] } });
    documentIds.push(doc.id);
    const date: EvidenceEventDate = { precision: "EXACT", start: "2024-02-29", end: null, text: "合成受限日期原文" };
    const text = { title: "合成来源日期", content: "来件记录", kind: "FACT" as const };
    const item = await createEvidenceItem({ matterId: f.matter.id, ...text, sourceDocumentId: doc.id, eventDate: date });
    await updateEvidenceItem({ evidenceItemId: item.id, expectedRevision: 1, ...text, title: "合成日期修订" });
    expect((await getEvidenceItem(item.id)).item.eventDate).toEqual(date);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.download" } } });
    const current = (await getEvidenceItem(item.id)).item;
    const history = (await listEvidenceRevisions({ evidenceItemId: item.id })).items;
    const listing = await listEvidenceItems(f.matter.id);
    expect(current).toMatchObject({ restricted: true, eventDate: null });
    expect(history[0]).toMatchObject({ restricted: true, eventDate: null });
    expect(listing[0].eventDate).toBeNull();
    expect(JSON.stringify({ current, history, listing })).not.toContain("合成受限日期原文");
    expect(JSON.stringify({ current, history, listing })).not.toContain("2024-02-29");
    expect(await db.evidenceItemRevision.findUniqueOrThrow({ where: { evidenceItemId_revision: { evidenceItemId: item.id, revision: 1 } } })).toMatchObject({ eventDateText: date.text });
  });
});
