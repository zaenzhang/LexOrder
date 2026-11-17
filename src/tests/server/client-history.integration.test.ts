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
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/history_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { readClientMatters, readClientHistory, readClientHistoryMatters, readClientCommunicationPage, readClientFollowUpPage } from "@/server/clients/history-service";
import { getClientHistoryPage, getClientHistoryMatterPage } from "@/server/clients/history-actions";
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
    const choices = await collect(cursor => readClientHistoryMatters(db, f.actor, { clientId: f.client.id, cursor }));
    expect(new Set(choices.map(row => row.id)).size).toBe(53);
    expect(choices.every(row => Object.keys(row).sort().join() === "id,internalCode,title")).toBe(true);

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

  it("组合筛选在扫描预算之前生效，上海日界与同刻跨页都按真实历史时间", async () => {
    const r = await reader(), f = await fixture(r.actor);
    const other = await db.matter.create({ data: { internalCode: `HISTORY-${randomUUID()}`, title: "筛选外事项", primaryClientId: f.client.id, ownerId: f.actor.id } });
    matters.push(other.id);
    const start = new Date("2026-06-30T16:00:00.000Z"), end = new Date("2026-07-01T15:59:59.999Z");
    const targets = Array.from({ length: 23 }, (_, index) => ({ id: newId(), matterId: f.matter.id, authorId: f.actor.id,
      content: `真实筛选命中${index}`, tags: [], attachments: [], occurredAt: index === 0 ? end : start, createdAt: new Date("2026-11-01T00:00:00Z") }));
    await db.note.createMany({ data: [...targets,
      ...Array.from({ length: 205 }, () => ({ id: newId(), matterId: other.id, authorId: f.actor.id, content: "其他事项同日沟通", tags: [], attachments: [], occurredAt: end })),
      ...[new Date(start.getTime() - 1), new Date(end.getTime() + 1)].map(occurredAt => ({ id: newId(), matterId: f.matter.id,
        authorId: f.actor.id, content: "相邻日不应命中", tags: [], attachments: [], occurredAt })),
    ] });
    await db.clientActivity.createMany({ data: Array.from({ length: 205 }, () => ({ clientId: f.client.id, authorId: f.actor.id, channel: "PHONE" as const,
      content: "其他来源同日沟通", occurredAt: end, requestKey: randomUUID(), requestHash: "synthetic" })) });
    const filters = { from: "2026-07-01", to: "2026-07-01", source: "NOTE" as const, matterId: f.matter.id };
    vi.mocked(requireSession).mockResolvedValue({ user: f.actor } as Awaited<ReturnType<typeof requireSession>>);
    const first = await getClientHistoryPage({ clientId: f.client.id, ...filters });
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
    const next = await getClientHistoryPage({ clientId: f.client.id, ...filters, cursor: first.nextCursor! });
    expect(next.items).toHaveLength(3); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map(row => row.id))).toEqual(new Set(targets.map(row => row.id)));
    expect(first.selectedMatter?.id).toBe(f.matter.id);
    const sourceOnly = await collect(cursor => readClientHistory(db, f.actor, { clientId: f.client.id, from: filters.from, to: filters.to, source: "NOTE", cursor }));
    expect(sourceOnly).toHaveLength(228);
    for (const changed of [{ ...filters, from: undefined }, { ...filters, to: undefined }, { ...filters, source: undefined }, { ...filters, matterId: other.id }]) {
      await expect(getClientHistoryPage({ clientId: f.client.id, ...changed, cursor: first.nextCursor! })).rejects.toThrow("分页位置");
    }
    const choices = await getClientHistoryMatterPage({ clientId: f.client.id });
    expect(choices.items.map(row => row.id)).toContain(other.id);
    const toOnly = await readClientHistory(db, f.actor, { clientId: f.client.id, source: "NOTE", matterId: f.matter.id, to: "2026-06-30" });
    expect(toOnly.items.map(row => row.content)).toEqual(["相邻日不应命中"]);
    const fromOnly = await readClientHistory(db, f.actor, { clientId: f.client.id, source: "NOTE", matterId: f.matter.id, from: "2026-07-02" });
    expect(fromOnly.items.map(row => row.content)).toEqual(["相邻日不应命中"]);
  }, 30_000);

  it("仅财务权限仍能筛确认到账及其事项，待确认和撤权不补旧名称", async () => {
    const r = await reader(), f = await fixture(r.actor);
    await db.rolePermission.deleteMany({ where: { roleId: r.role.id, permissionKey: { in: ["matters.read", "schedule.read", "documents.read"] } } });
    await db.rolePermission.create({ data: { roleId: r.role.id, permissionKey: "finance.read", scope: "OWN" } });
    const pending = await db.matter.create({ data: { internalCode: `HISTORY-${randomUUID()}`, title: "只有待确认到账的事项", primaryClientId: f.client.id, ownerId: f.actor.id } });
    matters.push(pending.id);
    // Persisted synthetic entries exercise history reading, not the receipt-confirmation workflow.
    const receipt = await db.feeEntry.create({ data: { matterId: f.matter.id, moneyKind: "LAWYER_FEE", type: "RECEIVED", amount: 100,
      occurredAt: at, recordedById: f.actor.id, confirmState: "CONFIRMED", confirmedAt: at, confirmedById: f.actor.id } });
    await db.feeEntry.create({ data: { matterId: pending.id, moneyKind: "LAWYER_FEE", type: "RECEIVED", amount: 200,
      occurredAt: at, recordedById: f.actor.id, confirmState: "PENDING" } });
    const input = { clientId: f.client.id, source: "FEE" as const, matterId: f.matter.id, from: "2026-05-01", to: "2026-05-01" };
    const page = await readClientHistory(db, f.actor, input);
    expect(page.items.map(row => row.id)).toEqual([receipt.id]); expect(page.selectedMatter?.id).toBe(f.matter.id);
    expect((await readClientHistoryMatters(db, f.actor, { clientId: f.client.id })).items.map(row => row.id)).toEqual([f.matter.id]);
    expect(await readClientHistory(db, f.actor, { ...input, matterId: pending.id })).toMatchObject({ items: [], selectedMatter: null });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: r.role.id, permissionKey: "finance.read" } } });
    expect(await readClientHistory(db, f.actor, input)).toMatchObject({ items: [], selectedMatter: null });
    expect((await readClientHistoryMatters(db, f.actor, { clientId: f.client.id })).items).toEqual([]);
  });

  it("转案仅用真实关联，客户级三源不猜事项；标题可读不证明客户关系", async () => {
    const r = await reader(), f = await fixture(r.actor), other = await fixture(r.actor);
    const intake = await db.intake.create({ data: { title: "合成真实转换收案", clientId: f.client.id, ownerUserId: f.actor.id, createdById: f.actor.id,
      createdAt: at, receivedAt: new Date("2026-11-01T00:00:00Z") } });
    await db.matter.update({ where: { id: other.matter.id }, data: { intakeId: intake.id } });
    const original = await activity(f.client.id, f.actor.id);
    const contact = await db.contact.create({ data: { clientId: f.client.id, name: "合成客户联系人", createdAt: at } });
    const followUp = await db.clientFollowUp.create({ data: { clientId: f.client.id, title: "合成客户跟进", dueAt: new Date("2027-01-01T00:00:00Z"),
      sourceActivityId: original.id, createdAt: at, createdById: f.actor.id, assigneeId: f.actor.id } });
    const day = { from: "2026-05-01", to: "2026-05-01" };
    for (const [source, id] of [["CLIENT_ACTIVITY", original.id], ["CONTACT", contact.id], ["FOLLOW_UP", followUp.id], ["MATTER", f.matter.id]] as const) {
      expect((await readClientHistory(db, f.actor, { clientId: f.client.id, ...day, source })).items.map(row => row.id)).toContain(id);
    }
    for (const source of ["CLIENT_ACTIVITY", "CONTACT", "FOLLOW_UP"] as const) {
      expect((await readClientHistory(db, f.actor, { clientId: f.client.id, ...day, source, matterId: f.matter.id })).items).toEqual([]);
    }
    const intakePage = await readClientHistory(db, f.actor, { clientId: f.client.id, ...day, source: "INTAKE", matterId: other.matter.id });
    expect(intakePage.items.map(row => row.id)).toEqual([intake.id]); expect(intakePage.selectedMatter?.id).toBe(other.matter.id);
    expect((await readClientHistoryMatters(db, f.actor, { clientId: f.client.id })).items.map(row => row.id)).toContain(other.matter.id);
    const unrelated = await fixture(f.actor);
    expect(await readClientHistory(db, f.actor, { clientId: f.client.id, matterId: unrelated.matter.id })).toMatchObject({ items: [], selectedMatter: { id: unrelated.matter.id } });
    expect((await readClientHistoryMatters(db, f.actor, { clientId: f.client.id })).items.map(row => row.id)).not.toContain(unrelated.matter.id);
    const outsider = await user();
    await db.matter.update({ where: { id: other.matter.id }, data: { ownerId: outsider.id } });
    expect((await readClientHistoryMatters(db, f.actor, { clientId: f.client.id })).items.map(row => row.id)).not.toContain(other.matter.id);
    const intakeStillReadable = await readClientHistory(db, f.actor, { clientId: f.client.id, source: "INTAKE", matterId: other.matter.id });
    expect(intakeStillReadable.items.map(row => row.id)).toEqual([intake.id]); expect(intakeStillReadable.selectedMatter).toBeNull();
    await db.matter.update({ where: { id: unrelated.matter.id }, data: { deletedAt: new Date() } });
    expect((await readClientHistory(db, f.actor, { clientId: f.client.id, matterId: unrelated.matter.id })).selectedMatter).toBeNull();
  });

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

  it("历史分页中的指示链接固定原修订，原游标重读保留该页并拒绝跨客户位置", async () => {
    const f = await fixture(), other = await fixture(f.actor);
    const first = await saveMatterContext(db, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), kind: "INSTRUCTION", visibility: "MATTER",
      content: "合成旧版指示", sourceDescription: "合成电话", occurredAt: at.toISOString() });
    const latest = await saveMatterContext(db, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), kind: "INSTRUCTION", visibility: "MATTER",
      content: "合成新版指示", sourceDescription: "合成电话", occurredAt: at.toISOString(), supersedesId: first.id });
    await db.clientActivity.createMany({ data: Array.from({ length: 21 }, () => ({ clientId: f.client.id, authorId: f.actor.id,
      channel: "PHONE" as const, content: "合成较新动态", occurredAt: new Date("2026-10-01T00:00:00Z"), requestKey: randomUUID(), requestHash: "synthetic" })) });
    const head = await readClientHistory(db, f.actor, { clientId: f.client.id });
    expect(head.items.some(row => row.id === first.id)).toBe(false);
    expect(head.nextCursor).toBeTruthy();
    const page = await readClientHistory(db, f.actor, { clientId: f.client.id, cursor: head.nextCursor! });
    const old = page.items.find(row => row.id === first.id)!;
    expect(old.content).toBe("合成旧版指示");
    expect(new URL(old.href, "https://example.test").searchParams.get("contextRecord")).toBe(first.id);
    expect(new URL(page.items.find(row => row.id === latest.id)!.href, "https://example.test").searchParams.get("contextRecord")).toBe(latest.id);
    expect(await readClientHistory(db, f.actor, { clientId: f.client.id, cursor: head.nextCursor! })).toEqual(page);
    await expect(readClientHistory(db, f.actor, { clientId: other.client.id, cursor: head.nextCursor! })).rejects.toThrow();
    const filtered = await readClientHistory(db, f.actor, { clientId: f.client.id, source: "CONTEXT", matterId: f.matter.id, from: "2026-05-01", to: "2026-05-01" });
    expect(new Set(filtered.items.map(row => row.id))).toEqual(new Set([first.id, latest.id]));
    expect(filtered.items.find(row => row.id === first.id)?.content).toBe("合成旧版指示");
  });
});
