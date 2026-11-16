// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClientHistoryActor } from "@/server/clients/history-service";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("客户历史仅允许独立的 _test 数据库");
  return { url };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasources: { db: { url: config.url ?? "postgresql://unused:unused@127.0.0.1:1/history_test" } } }) };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { readClientMatters, readClientHistory, readClientCommunicationPage, readClientFollowUpPage } from "@/server/clients/history-service";
import { getClientInsights } from "@/server/clients/insights";
import { mergeClients } from "@/server/clients/dedup";
import { saveMatterContext } from "@/server/matters/context-service";

const users: string[] = [], clients: string[] = [], matters: string[] = [], roles: string[] = [];
const at = new Date("2026-05-01T02:00:00.000Z");
const newId = () => `c${randomUUID().replaceAll("-", "")}`;
async function user(role: UserRole = "LAWYER", roleDefinitionId?: string): Promise<ClientHistoryActor> {
  const row = await db.user.create({ data: { role, roleDefinitionId, name: "合成历史用户", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-synthetic-only" } });
  users.push(row.id);
  return { id: row.id, role, runtimeMode: "SERVER" };
}
async function reader() {
  const name = `history-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
    { permissionKey: "clients.read", scope: "OWN" }, { permissionKey: "clients.write", scope: "OWN" },
    { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "schedule.read", scope: "OWN" },
    { permissionKey: "documents.read", scope: "OWN" }
  ] } } });
  roles.push(role.id);
  return { actor: await user("CUSTOM", role.id), role };
}
async function fixture(actor = undefined as ClientHistoryActor | undefined) {
  actor ??= await user();
  const client = await db.client.create({ data: { name: "合成历史客户", source: "合成渠道", type: "INDIVIDUAL", tags: [], ownerUserId: actor.id } });
  clients.push(client.id);
  const matter = await db.matter.create({ data: { internalCode: `HISTORY-${randomUUID()}`, title: "合成可见事项", primaryClientId: client.id, ownerId: actor.id, createdAt: at } });
  matters.push(matter.id);
  return { actor, client, matter };
}
async function member(matterId: string) {
  const result = await reader();
  await db.matterMember.create({ data: { matterId, userId: result.actor.id, role: "ASSISTANT" } });
  return result;
}
async function collect<T>(read: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 30; i++) {
    const page = await read(cursor); items.push(...page.items);
    if (!page.nextCursor) return items;
    cursor = page.nextCursor;
  }
  throw new Error("分页未在有限页内结束");
}
async function activity(clientId: string, actorId: string, content = "合成沟通") {
  return db.clientActivity.create({ data: { clientId, authorId: actorId, channel: "PHONE", content, occurredAt: at, requestKey: randomUUID(), requestHash: "synthetic" } });
}

describe.skipIf(!config.url)("M2 客户连续记录：真实 PostgreSQL 读取", () => {
  beforeAll(async () => { vi.stubEnv("NEXTAUTH_SECRET", "synthetic-history-integration-only"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("超过旧 50/100 窗口并同时间排序，软删除锚点后仍可继续", async () => {
    const r = await reader(), f = await fixture(r.actor);
    const added = Array.from({ length: 53 }, () => ({ id: newId(), internalCode: `HISTORY-${randomUUID()}`, title: "合成连续事项", ownerId: f.actor.id, primaryClientId: f.client.id, createdAt: at }));
    await db.matter.createMany({ data: added }); matters.push(...added.map(row => row.id));
    const first = await readClientMatters(db, f.actor, { clientId: f.client.id });
    expect(first.total).toBe(54); expect(first.items).toHaveLength(6); expect(first.activeCount).toBe(54);
    const anchor = first.items.at(-1)!;
    await db.matter.update({ where: { id: anchor.id }, data: { deletedAt: new Date() } });
    const after = await readClientMatters(db, f.actor, { clientId: f.client.id, cursor: first.nextCursor! });
    expect(after.total).toBe(53);
    expect(after.items.every(row => !first.items.some(prior => prior.id === row.id))).toBe(true);
    const allMatters = await collect(cursor => readClientMatters(db, f.actor, { clientId: f.client.id, cursor }));
    expect(new Set(allMatters.map(row => row.id)).size).toBe(53);

    const activities = Array.from({ length: 101 }, () => ({ id: newId(), clientId: f.client.id, authorId: f.actor.id, channel: "PHONE" as const, content: "合成连续沟通", occurredAt: at, requestKey: randomUUID(), requestHash: "synthetic" }));
    await db.clientActivity.createMany({ data: activities });
    await db.clientFollowUp.createMany({ data: activities.map(row => ({ clientId: f.client.id, title: "合成连续跟进", dueAt: at, createdById: f.actor.id, assigneeId: f.actor.id, sourceActivityId: row.id })) });
    const communication = await collect(cursor => readClientCommunicationPage(db, f.actor, { clientId: f.client.id, cursor }));
    const followUps = await collect(cursor => readClientFollowUpPage(db, f.actor, { clientId: f.client.id, cursor }));
    expect(communication).toHaveLength(101); expect(new Set(communication.map(row => row.id)).size).toBe(101);
    expect(followUps).toHaveLength(101); expect(new Set(followUps.map(row => row.id)).size).toBe(101);
    const history = await collect(cursor => readClientHistory(db, f.actor, { clientId: f.client.id, cursor }));
    expect(history).toHaveLength(255); expect(new Set(history.map(row => row.key)).size).toBe(255);
    expect(history.filter(row => row.at === at.toISOString()).map(row => row.source))
      .toEqual([...Array(53).fill("MATTER"), ...Array(101).fill("CLIENT_ACTIVITY")]);
  }, 30_000);

  it("聚合、计数和同名提示逐来源鉴权，旧 actor 撤权后不再返回正文", async () => {
    const f = await fixture(), other = await fixture(), r = await member(f.matter.id);
    await db.rolePermission.createMany({ data: [
      { roleId: r.role.id, permissionKey: "finance.read", scope: "OWN" },
      { roleId: r.role.id, permissionKey: "documents.download", scope: "OWN" }
    ] });
    const hidden = await db.matter.create({ data: { internalCode: `HISTORY-${randomUUID()}`, title: "不可见事项标题", primaryClientId: f.client.id, ownerId: other.actor.id } });
    matters.push(hidden.id);
    await db.intake.create({ data: { title: "不可见收案标题", clientId: f.client.id, createdById: other.actor.id, ownerUserId: other.actor.id } });
    await db.note.create({ data: { matterId: f.matter.id, authorId: f.actor.id, content: "可见事项沟通正文", tags: [], attachments: [], occurredAt: at } });
    await saveMatterContext(db, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), kind: "INSTRUCTION", visibility: "MATTER", content: "可见客户指示", sourceDescription: "合成电话", occurredAt: at.toISOString() });
    await saveMatterContext(db, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), kind: "CONSTRAINT", visibility: "FINANCE", content: "撤权后隐藏财务约束", sourceDescription: "合成预算", occurredAt: at.toISOString() });
    const doc = await db.document.create({ data: { name: "合成待撤权来源.txt", path: `synthetic/${randomUUID()}.txt`, tags: [], matterId: f.matter.id, uploadedById: f.actor.id } });
    await saveMatterContext(db, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), kind: "INSTRUCTION", visibility: "MATTER", content: "撤权后隐藏原件指示", sourceDescription: "合成材料", sourceDocumentId: doc.id, occurredAt: at.toISOString() });
    await db.clientActivity.createMany({ data: Array.from({ length: 21 }, () => ({ clientId: f.client.id, authorId: f.actor.id, channel: "PHONE" as const,
      content: "合成近期沟通", occurredAt: new Date("2026-10-01T00:00:00Z"), requestKey: randomUUID(), requestHash: "synthetic" })) });
    vi.mocked(requireSession).mockResolvedValue({ user: r.actor } as Awaited<ReturnType<typeof requireSession>>);
    const insights = await getClientInsights(f.client.id);
    expect(insights.matterPage.total).toBe(1); expect(insights.suspects).toEqual([]);
    expect(insights.source).toMatchObject({ sameSourceClients: 1, totalClients: 1 });
    const visible = JSON.stringify(await collect(cursor => readClientHistory(db, r.actor, { clientId: f.client.id, cursor })));
    expect(visible).toContain("可见事项沟通正文"); expect(visible).toContain("可见客户指示");
    expect(visible).toContain("撤权后隐藏财务约束"); expect(visible).toContain("撤权后隐藏原件指示");
    for (const secret of ["不可见事项标题", "不可见收案标题"]) expect(visible).not.toContain(secret);
    const oldCursor = (await readClientHistory(db, r.actor, { clientId: f.client.id })).nextCursor!;
    expect(oldCursor).toBeTruthy();
    await db.rolePermission.deleteMany({ where: { roleId: r.role.id, permissionKey: { in: ["schedule.read", "finance.read", "documents.download"] } } });
    const afterRevoke = JSON.stringify(await readClientHistory(db, r.actor, { clientId: f.client.id, cursor: oldCursor }));
    for (const secret of ["可见事项沟通正文", "撤权后隐藏财务约束", "撤权后隐藏原件指示"]) expect(afterRevoke).not.toContain(secret);
    expect(afterRevoke).toContain("可见客户指示");
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: r.role.id, permissionKey: "matters.read" } } });
    expect((await readClientMatters(db, r.actor, { clientId: f.client.id })).total).toBe(0);
    expect(JSON.stringify(await readClientHistory(db, r.actor, { clientId: f.client.id, cursor: oldCursor }))).not.toContain("可见客户指示");
  }, 30_000);

  it("连续不可读上下文不形成假终点或泄露位置，仍能读到更早记录", async () => {
    const f = await fixture(), r = await member(f.matter.id);
    const doc = await db.document.create({ data: { name: "合成受限来源.txt", path: `synthetic/${randomUUID()}.txt`, tags: [], matterId: f.matter.id, uploadedById: f.actor.id } });
    const hiddenAt = new Date("2026-07-02T03:04:05.000Z");
    const hidden = Array.from({ length: 221 }, () => { const id = newId(); return {
      id, seriesId: id, version: 1, matterId: f.matter.id, kind: "INSTRUCTION" as const, content: "隐藏来源正文",
      occurredAt: hiddenAt, sourceDescription: "合成受限原件", sourceDocumentId: doc.id, authorId: f.actor.id,
      requestKey: randomUUID(), requestHash: "synthetic"
    }; });
    await db.matterContextRecord.createMany({ data: hidden });
    const older = await activity(f.client.id, f.actor.id, "更早的授权客户沟通");
    const first = await readClientHistory(db, r.actor, { clientId: f.client.id });
    expect(first.items).toEqual([]); expect(first.nextCursor).toBeTruthy();
    const exposed = Buffer.from(first.nextCursor!, "base64url").toString("utf8");
    expect(exposed).not.toContain(hiddenAt.toISOString()); expect(exposed).not.toContain(hidden[0].id);
    const next = await readClientHistory(db, r.actor, { clientId: f.client.id, cursor: first.nextCursor! });
    expect(next.items.some(row => row.id === older.id)).toBe(true); expect(next.nextCursor).toBeNull();
    expect(JSON.stringify(next)).not.toContain("隐藏来源正文");
  }, 30_000);

  it("合并后原沟通身份仍可查，软删除客户及停用账号拒绝旧页请求", async () => {
    const owner = await user("PRINCIPAL_LAWYER"), source = await fixture(owner), target = await fixture(owner);
    const row = await activity(source.client.id, owner.id, "合并前客户沟通");
    vi.mocked(requireSession).mockResolvedValue({ user: owner } as Awaited<ReturnType<typeof requireSession>>);
    await mergeClients({ keepId: target.client.id, mergeId: source.client.id, basis: "合成同主体确认" });
    const merged = await collect(cursor => readClientHistory(db, owner, { clientId: target.client.id, cursor }));
    expect(merged.find(item => item.id === row.id)?.content).toBe("合并前客户沟通");
    await expect(readClientHistory(db, owner, { clientId: source.client.id })).rejects.toThrow("客户不存在");
    await db.user.update({ where: { id: owner.id }, data: { active: false } });
    await expect(readClientCommunicationPage(db, owner, { clientId: target.client.id })).rejects.toThrow("账号已停用");
  }, 30_000);
});
