// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("G01 队列验证仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: process.env.WORKBENCH_TEST_DATABASE_URL ? createPrismaClient(process.env.WORKBENCH_TEST_DATABASE_URL) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only the unrelated approvals inbox is replaced; the homepage task/follow-up reads use PostgreSQL.
vi.mock("@/server/approval-permissions/inbox", () => ({ listApprovalWorkspace: async () => ({ rows: [], counts: { pending: 0 } }) }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { resolveRoleUser } from "@/lib/roles/service";
import { clientVisibilityFilter } from "@/lib/permissions";
import { getPersonalFollowUp, getPersonalFollowUps, getPersonalFollowUpRescheduleHistory, recordClientActivity, rescheduleClientFollowUp } from "@/server/clients/relationship-actions";
import { personalFollowUpsInTransaction } from "@/server/clients/follow-up-queue";
import { mergeClients } from "@/server/clients/dedup";
import { getDashboardWorkQueue } from "@/server/dashboard/actions";
import * as audit from "@/server/audit";
import { clientFollowUpRescheduleAuditSchema } from "@/lib/clients/follow-ups";

const users: string[] = [], clients: string[] = [], roles: string[] = [];
async function newUser(role: User["role"] = "LAWYER") {
  const user = await db.user.create({ data: { name: "合成 G01 律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role } });
  users.push(user.id); return user;
}
async function newClient(ownerUserId: string) {
  const client = await db.client.create({ data: { name: "合成 G01 客户", type: "INDIVIDUAL", tags: [], ownerUserId } });
  clients.push(client.id); return client;
}
async function fixture(role: User["role"] = "LAWYER") {
  const user = await newUser(role), client = await newClient(user.id);
  await sessionFor(user); return { user, client };
}
async function sessionFor(user: User) {
  const actor = await resolveRoleUser(user.id, user.role, db);
  vi.mocked(requireSession).mockResolvedValue({ user: { ...actor, id: user.id, systemRole: user.systemRole, avatar: user.avatar, runtimeMode: "SERVER" }, expires: "2099-01-01" });
  return actor;
}
async function followUp(clientId: string, creatorId: string, title = "合成 G01 核实材料", dueAt = new Date("2000-01-01T00:00:00Z"), assigneeId = creatorId) {
  const activity = await db.clientActivity.create({ data: { clientId, authorId: creatorId, channel: "PHONE", content: "合成 G01 来源沟通", occurredAt: new Date(), requestKey: randomUUID(), requestHash: randomUUID(),
    nextFollowUp: { create: { clientId, createdById: creatorId, assigneeId, title, dueAt } } }, include: { nextFollowUp: true } });
  return activity.nextFollowUp!;
}
async function customReader(user: User, writable = false) {
  const name = `g01-${randomUUID()}`;
  const definition = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
    { permissionKey: "clients.read", scope: "OWN" }, ...(writable ? [{ permissionKey: "clients.write", scope: "OWN" as const }] : [])
  ] } } });
  roles.push(definition.id);
  const current = await db.user.update({ where: { id: user.id }, data: { role: "CUSTOM", roleDefinitionId: definition.id } });
  await sessionFor(current); return definition;
}
function resultInput(clientId: string, followUpId: string) {
  return { clientId, followUpId, requestKey: randomUUID(), channel: "PHONE" as const, content: "合成 G01 已核实结果", occurredAt: new Date().toISOString(), closeStatus: "COMPLETED" as const };
}
function rescheduleInput(item: Awaited<ReturnType<typeof followUp>>, dueAt = "2027-01-03T02:01:02.003Z") {
  return { clientId: item.clientId, followUpId: item.id, expectedUpdatedAt: item.updatedAt.toISOString(), dueAt, reason: "合成 A2 客户调整约定", requestKey: randomUUID() };
}

describe.skipIf(!databaseUrl)("G01 本人跟进队列 / 真实 PostgreSQL 与服务动作", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    // Retire only this file's synthetic fixtures. Preserve activities, follow-ups and protected audit history.
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("当前授权先于完整计数与分页；同刻 ID 排序、超末页夹取、首页前五和页外精确定位一致", async () => {
    const f = await fixture(), secondClient = await newClient(f.user.id), other = await newUser(), hidden = await newClient(other.id), deleted = await newClient(f.user.id);
    const allowed = [];
    for (let index = 0; index < 22; index++) allowed.push(await followUp(index % 2 ? secondClient.id : f.client.id, f.user.id, `合成允许跟进 ${index}`));
    await followUp(hidden.id, other.id, "合成无权客户正文", undefined, f.user.id);
    await followUp(f.client.id, f.user.id, "合成他人负责", undefined, other.id);
    await followUp(deleted.id, f.user.id, "合成已删客户");
    await db.client.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const beforeAudit = await db.auditLog.count({ where: { userId: f.user.id } });
    const first = await getPersonalFollowUps({}), second = await getPersonalFollowUps({ page: 2 }), clamped = await getPersonalFollowUps({ page: 999 });
    const expected = allowed.map(row => row.id).sort();
    expect(first.total).toBe(22); expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(2); expect(second.total).toBe(22);
    expect([...first.items, ...second.items].map(row => row.id)).toEqual(expected);
    expect(new Set([...first.items, ...second.items].map(row => row.client.id))).toEqual(new Set([f.client.id, secondClient.id]));
    expect(clamped.page).toBe(2); expect(clamped.items.map(row => row.id)).toEqual(expected.slice(20));
    const home = await getDashboardWorkQueue();
    expect(home.followUps.total).toBe(22); expect(home.followUps.items.map(row => row.id)).toEqual(expected.slice(0, 5));
    expect(home.followUps.items.every(row => row.canClose)).toBe(true);
    const last = second.items[1];
    expect(await getPersonalFollowUp({ followUpId: last.id, clientId: last.client.id })).toMatchObject({ id: last.id, status: "OPEN", canClose: true });
    expect(await db.auditLog.count({ where: { userId: f.user.id } })).toBe(beforeAudit);
  });

  it("上海今日含日界，逾期严格早于同一 observedAt；两筛选可重叠", async () => {
    const f = await fixture(), observedAt = new Date("2026-11-17T04:00:00.000Z");
    const instants = ["2026-11-16T15:59:59.999Z", "2026-11-16T16:00:00.000Z", "2026-11-17T03:59:59.999Z", "2026-11-17T04:00:00.000Z", "2026-11-17T04:00:00.001Z", "2026-11-17T15:59:59.999Z", "2026-11-17T16:00:00.000Z"];
    const rows: Awaited<ReturnType<typeof followUp>>[] = [];
    for (const instant of instants) rows.push(await followUp(f.client.id, f.user.id, `合成日期 ${instant}`, new Date(instant)));
    const [all, today, overdue] = await db.$transaction(async tx => {
      const all = await personalFollowUpsInTransaction(tx, f.user.id, { filter: "all" }, 20, observedAt);
      const today = await personalFollowUpsInTransaction(tx, f.user.id, { filter: "today" }, 20, observedAt);
      const overdue = await personalFollowUpsInTransaction(tx, f.user.id, { filter: "overdue" }, 20, observedAt);
      return [all, today, overdue];
    }, { isolationLevel: "RepeatableRead" });
    expect(today.items.map(row => row.id)).toEqual(rows.slice(1, 6).map(row => row.id));
    expect(overdue.items.map(row => row.id)).toEqual(rows.slice(0, 3).map(row => row.id));
    expect(all.items.find(row => row.id === rows[3].id)?.overdue).toBe(false);
    expect(all.items.find(row => row.id === rows[2].id)?.overdue).toBe(true);
    expect([all, today, overdue].map(row => row.observedAt)).toEqual(Array(3).fill(observedAt.toISOString()));
  });

  it("只读角色仍看本人可读队列，当前写权撤销不沿用旧页面办理资格", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id);
    const role = await customReader(f.user, true);
    expect((await getPersonalFollowUps({})).items[0].canClose).toBe(true);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "clients.write" } } });
    const queue = await getPersonalFollowUps({}), exact = await getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id });
    expect(queue).toMatchObject({ available: true, total: 1 });
    expect(queue.items[0].canClose).toBe(false); expect(exact.canClose).toBe(false);
    await expect(recordClientActivity(resultInput(f.client.id, item.id))).rejects.toThrow("授权范围已变化");
    expect((await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("OPEN");
  });

  it("旧会话不能保留已撤客户读取权限、停用岗位或停用账号的队列", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id), role = await customReader(f.user);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "clients.read" } } });
    expect(await getPersonalFollowUps({ page: 4 })).toMatchObject({ available: false, items: [], total: 0, page: 1 });
    await expect(getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id })).rejects.toThrow("当前资格");
    await db.rolePermission.create({ data: { roleId: role.id, permissionKey: "clients.read", scope: "OWN" } });
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: false } });
    expect((await getPersonalFollowUps({})).available).toBe(false);
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: true } });
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    expect((await getPersonalFollowUps({})).available).toBe(false);
  });

  it("财务主档全所读取不外溢到其他客户跟进正文或精确目标", async () => {
    const owner = await fixture(), finance = await newUser("FINANCE"), own = await newClient(finance.id);
    const hidden = await followUp(owner.client.id, owner.user.id, "合成财务不可读正文", undefined, finance.id);
    const visible = await followUp(own.id, finance.id, "合成财务本人客户");
    await sessionFor(finance);
    expect(await db.client.count({ where: { id: owner.client.id, AND: [clientVisibilityFilter(finance.id, "FINANCE")] } })).toBe(1);
    const queue = await getPersonalFollowUps({});
    expect(queue.total).toBe(1); expect(queue.items.map(row => row.id)).toEqual([visible.id]);
    await expect(getPersonalFollowUp({ clientId: owner.client.id, followUpId: hidden.id })).rejects.toThrow("无权读取");
  });

  it("精确读取复核实际客户范围、本人负责及所见客户，非法查询与会话拒绝不降级为空列表", async () => {
    const f = await fixture(), other = await newUser(), second = await newClient(f.user.id);
    const item = await followUp(f.client.id, f.user.id), assignedOther = await followUp(f.client.id, f.user.id, "合成他人跟进", undefined, other.id);
    await expect(getPersonalFollowUp({ clientId: second.id, followUpId: item.id })).rejects.toThrow("所属客户已变化");
    await expect(getPersonalFollowUp({ clientId: f.client.id, followUpId: assignedOther.id })).rejects.toThrow("无权读取");
    await expect(getPersonalFollowUps({ page: 0 })).rejects.toThrow();
    await expect(getPersonalFollowUps({ filter: "all", page: 1, assigneeId: other.id } as Parameters<typeof getPersonalFollowUps>[0])).rejects.toThrow();
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("合成会话拒绝"));
    await expect(getPersonalFollowUps({})).rejects.toThrow("合成会话拒绝");
    await db.client.update({ where: { id: f.client.id }, data: { deletedAt: new Date() } });
    expect(await getPersonalFollowUps({ page: 3 })).toMatchObject({ available: true, items: [], total: 0, page: 1 });
    await expect(getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id })).rejects.toThrow("无权读取");
  });

  it("原保存动作完成和取消原项，重试不重复下一项，首页与队列读取终态并刷新所有消费者", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id);
    const input = { ...resultInput(f.client.id, item.id), nextFollowUp: { title: "合成下次回访", dueAt: new Date(Date.now() + 86_400_000).toISOString() } };
    vi.mocked(revalidatePath).mockClear();
    await recordClientActivity(input);
    expect((await recordClientActivity(input)).replayed).toBe(true);
    const original = await getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id });
    expect(original).toMatchObject({ status: "COMPLETED", canClose: false });
    const queue = await getPersonalFollowUps({});
    expect(queue.total).toBe(1); expect(queue.items[0].title).toBe(input.nextFollowUp.title);
    expect((await getDashboardWorkQueue()).followUps.items.map(row => row.id)).toEqual([queue.items[0].id]);
    const next = queue.items[0];
    await recordClientActivity({ ...resultInput(f.client.id, next.id), closeStatus: "CANCELLED", content: "合成取消原因：客户调整计划" });
    expect(await getPersonalFollowUp({ clientId: f.client.id, followUpId: next.id })).toMatchObject({ status: "CANCELLED", canClose: false });
    expect((await getPersonalFollowUps({})).total).toBe(0);
    expect(await db.clientFollowUp.count({ where: { clientId: f.client.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "CLIENT_FOLLOWUP_COMPLETE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "CLIENT_FOLLOWUP_CANCEL" } })).toBe(1);
    for (const path of ["/", "/clients", "/clients/follow-ups", `/clients/${f.client.id}`]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it("真实客户合并保留同一跟进 ID，旧所见客户拒绝办理，新定位可读且全部入口刷新", async () => {
    const f = await fixture("PRINCIPAL_LAWYER"), keep = await newClient(f.user.id), item = await followUp(f.client.id, f.user.id);
    const moved = rescheduleInput(item); await rescheduleClientFollowUp(moved);
    const beforeMergeHistory = await getPersonalFollowUpRescheduleHistory({ clientId: f.client.id, followUpId: item.id });
    expect(beforeMergeHistory.items).toHaveLength(1);
    const draft = resultInput(f.client.id, item.id);
    vi.mocked(revalidatePath).mockClear();
    await mergeClients({ keepId: keep.id, mergeId: f.client.id, basis: "合成 G01 同一主体合并" });
    expect((await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } })).clientId).toBe(keep.id);
    await expect(getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id })).rejects.toThrow("所属客户已变化");
    await expect(recordClientActivity(draft)).rejects.toThrow("客户不存在");
    await expect(rescheduleClientFollowUp(moved)).rejects.toThrow("客户不存在");
    await expect(getPersonalFollowUpRescheduleHistory({ clientId: f.client.id, followUpId: item.id })).rejects.toThrow("客户不存在");
    expect(await getPersonalFollowUpRescheduleHistory({ clientId: keep.id, followUpId: item.id })).toEqual(beforeMergeHistory);
    const receipt = await db.auditLog.findFirstOrThrow({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } });
    expect(clientFollowUpRescheduleAuditSchema.parse(receipt.detail).clientId).toBe(f.client.id);
    expect(await getPersonalFollowUp({ clientId: keep.id, followUpId: item.id })).toMatchObject({ id: item.id, client: { id: keep.id }, status: "OPEN", canClose: true });
    expect((await getPersonalFollowUps({})).items[0].client.id).toBe(keep.id);
    expect((await getDashboardWorkQueue()).followUps.items[0].client.id).toBe(keep.id);
    for (const path of ["/", "/clients", "/clients/follow-ups", `/clients/${f.client.id}`, `/clients/${keep.id}`]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it("A2 原项改期仅变时间与版本，同事务一条审计；规范化精确重放不重复保存", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id, "合成精确原项", new Date("2027-01-02T02:00:47.123Z"));
    const input = rescheduleInput(item), activities = await db.clientActivity.count({ where: { clientId: f.client.id } });
    vi.mocked(revalidatePath).mockClear();
    const first = await rescheduleClientFollowUp({ ...input, reason: `  ${input.reason}  ` });
    expect(first.replayed).toBe(false);
    const after = await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } });
    expect({ ...after, dueAt: item.dueAt, updatedAt: item.updatedAt }).toEqual(item);
    expect(after.dueAt.toISOString()).toBe(input.dueAt); expect(after.updatedAt.getTime()).toBeGreaterThan(item.updatedAt.getTime());
    expect(await getPersonalFollowUp({ clientId: f.client.id, followUpId: item.id })).toMatchObject({ id: item.id, updatedAt: after.updatedAt.toISOString() });
    expect((await getPersonalFollowUps({})).items[0].updatedAt).toBe(after.updatedAt.toISOString());
    expect(await rescheduleClientFollowUp({ ...input, dueAt: "2027-01-03T10:01:02.003+08:00" })).toEqual({ ...first, replayed: true });
    expect(await db.clientFollowUp.count({ where: { clientId: f.client.id } })).toBe(1);
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(activities);
    const receipts = await db.auditLog.findMany({ where: { userId: f.user.id, action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: item.id } });
    expect(receipts).toHaveLength(1);
    expect(clientFollowUpRescheduleAuditSchema.parse(receipts[0].detail)).toEqual({ ...input, beforeDueAt: item.dueAt.toISOString(), afterDueAt: input.dueAt, beforeUpdatedAt: input.expectedUpdatedAt, afterUpdatedAt: first.updatedAt });
    expect(requireSession).toHaveBeenCalledWith("clients.write");
    for (const path of ["/", "/clients", "/clients/follow-ups", `/clients/${f.client.id}`]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it("A2 同版本并发仅一项成功，时钟未前进时版本也至少增加一毫秒", async () => {
    const f = await fixture(), created = await followUp(f.client.id, f.user.id);
    const item = await db.clientFollowUp.update({ where: { id: created.id }, data: { updatedAt: new Date("2099-01-01T00:00:00.999Z") } });
    const first = rescheduleInput(item), second = { ...rescheduleInput(item), dueAt: "2027-01-04T02:00:00.000Z" };
    const outcomes = await Promise.allSettled([rescheduleClientFollowUp(first), rescheduleClientFollowUp(second)]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter(row => row.status === "rejected")).toHaveLength(1);
    const after = await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.updatedAt.getTime()).toBe(item.updatedAt.getTime() + 1);
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } })).toBe(1);
    await expect(rescheduleClientFollowUp({ ...rescheduleInput(after), expectedUpdatedAt: item.updatedAt.toISOString() })).rejects.toThrow("已变化");
  });

  it("A2 同键并发只一条审计；同键异内容、随后改期及结束后的历史重放明确拒绝", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id), input = rescheduleInput(item);
    const responses = await Promise.all([rescheduleClientFollowUp(input), rescheduleClientFollowUp(input)]);
    expect(responses.map(row => row.replayed).sort()).toEqual([false, true]);
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } })).toBe(1);
    await expect(rescheduleClientFollowUp({ ...input, reason: "合成不同原因" })).rejects.toThrow("内容不同");
    const current = await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } });
    const next = rescheduleInput(current, "2027-01-04T02:00:00.000Z"); await rescheduleClientFollowUp(next);
    await expect(rescheduleClientFollowUp(input)).rejects.toThrow("随后已变化或结束");
    await recordClientActivity(resultInput(f.client.id, item.id));
    await expect(rescheduleClientFollowUp(next)).rejects.toThrow("随后已变化或结束");
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } })).toBe(2);
  });

  it("A2 非负责人包括管理岗不能改期；错客户、终态与额外写入字段拒绝", async () => {
    const f = await fixture(), other = await newUser(), item = await followUp(f.client.id, f.user.id, "合成他人负责", undefined, other.id);
    await expect(rescheduleClientFollowUp(rescheduleInput(item))).rejects.toThrow("不是本人负责");
    await expect(getPersonalFollowUpRescheduleHistory({ clientId: f.client.id, followUpId: item.id })).rejects.toThrow("无权读取");
    const principal = await newUser("PRINCIPAL_LAWYER"); await sessionFor(principal);
    await expect(rescheduleClientFollowUp(rescheduleInput(item))).rejects.toThrow("不是本人负责");
    await sessionFor(f.user);
    const own = await followUp(f.client.id, f.user.id), secondClient = await newClient(f.user.id);
    await expect(rescheduleClientFollowUp({ ...rescheduleInput(own), clientId: secondClient.id })).rejects.toThrow("所属客户已变化");
    await expect(rescheduleClientFollowUp({ ...rescheduleInput(own), assigneeId: other.id } as Parameters<typeof rescheduleClientFollowUp>[0])).rejects.toThrow();
    await expect(rescheduleClientFollowUp({ ...rescheduleInput(own), dueAt: own.dueAt.toISOString() })).rejects.toThrow("没有变化");
    await recordClientActivity({ ...resultInput(f.client.id, own.id), closeStatus: "CANCELLED" });
    await expect(rescheduleClientFollowUp(rescheduleInput(own))).rejects.toThrow("已结束");
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: { in: [item.id, own.id] } } })).toBe(0);
  });

  it("A2 等待真实授权锁后使用已撤销的当前写权，旧会话不能保存", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id), role = await customReader(f.user, true);
    let signalLocked!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      signalLocked(); await released;
      await tx.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "clients.write" } } });
    }, { timeout: 10_000 });
    await locked;
    const attempted = rescheduleClientFollowUp(rescheduleInput(item)).then(value => ({ value, error: null }), (error: Error) => ({ value: null, error }));
    try {
      await vi.waitFor(async () => {
        const rows = await db.$queryRaw<{ waiting: bigint }[]>`SELECT count(*)::bigint AS waiting FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = 72606101 AND NOT granted`;
        expect(Number(rows[0].waiting)).toBeGreaterThan(0);
      }, { timeout: 3_000, interval: 25 });
    } finally { release(); await blocker; }
    const outcome = await attempted;
    expect(outcome.value).toBeNull(); expect(outcome.error?.message).toContain("授权范围已变化");
    expect(await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } })).toBe(0);
  }, 15_000);

  it("A2 同事务审计失败使时间与版本回滚", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id);
    const failAudit = vi.spyOn(audit, "auditTx").mockRejectedValueOnce(new Error("合成 A2 审计失败"));
    try { await expect(rescheduleClientFollowUp(rescheduleInput(item))).rejects.toThrow("合成 A2 审计失败"); }
    finally { failAudit.mockRestore(); }
    expect(await db.clientFollowUp.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetId: item.id } })).toBe(0);
  });

  it("A2 历史 21 条同刻按 ID 稳定翻页、严格核对游标，仅返回只读投影且终态仍可读", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id), input = rescheduleInput(item);
    const ids = Array.from({ length: 21 }, () => `c${randomUUID().replaceAll("-", "")}`), at = new Date("2026-11-18T01:00:00Z");
    const detail = { ...input, beforeDueAt: item.dueAt.toISOString(), afterDueAt: input.dueAt, beforeUpdatedAt: input.expectedUpdatedAt, afterUpdatedAt: new Date(item.updatedAt.getTime() + 1).toISOString() };
    await db.auditLog.createMany({ data: ids.map((id, index) => ({ id, userId: f.user.id, action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: item.id, createdAt: at,
      detail: { ...detail, requestKey: randomUUID(), reason: `合成历史 ${index}` }, ip: "192.0.2.1", userAgent: "synthetic-only" })) });
    const query = { clientId: f.client.id, followUpId: item.id };
    const auditCount = await db.auditLog.count({ where: { targetId: item.id } });
    const first = await getPersonalFollowUpRescheduleHistory(query), second = await getPersonalFollowUpRescheduleHistory({ ...query, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBe(first.items.at(-1)!.id); expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(row => row.id)).toEqual(ids.sort().reverse());
    for (const row of first.items) expect(Object.keys(row).sort()).toEqual(["actorName", "afterDueAt", "at", "beforeDueAt", "id", "reason"]);
    expect(JSON.stringify(first)).not.toMatch(/requestKey|expectedUpdatedAt|userAgent|192\.0\.2\.1/);
    for (const mismatch of [{ action: "CLIENT_FOLLOWUP_CREATE", targetType: "ClientFollowUp", targetId: item.id }, { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "Client", targetId: item.id }, { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: f.client.id }]) {
      const wrong = await db.auditLog.create({ data: { ...mismatch, userId: f.user.id, detail } });
      await expect(getPersonalFollowUpRescheduleHistory({ ...query, cursor: wrong.id })).rejects.toThrow("位置无效");
    }
    await recordClientActivity(resultInput(f.client.id, item.id));
    expect((await getPersonalFollowUpRescheduleHistory(query)).items).toEqual(first.items);
    expect(await db.auditLog.count({ where: { action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: item.id } })).toBe(auditCount);
    expect(requireSession).toHaveBeenCalledWith("clients.read");
  });

  it("A2 历史每页重新核对当前读取授权；畸形 JSON 明确报错且不能作空记录", async () => {
    const f = await fixture(), item = await followUp(f.client.id, f.user.id); await rescheduleClientFollowUp(rescheduleInput(item));
    const query = { clientId: f.client.id, followUpId: item.id }, before = await getPersonalFollowUpRescheduleHistory(query), role = await customReader(f.user, true);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "clients.read" } } });
    await expect(getPersonalFollowUpRescheduleHistory({ ...query, cursor: before.items[0].id })).rejects.toThrow("无权读取");
    await db.rolePermission.create({ data: { roleId: role.id, permissionKey: "clients.read", scope: "OWN" } });
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: false } });
    await expect(getPersonalFollowUpRescheduleHistory(query)).rejects.toThrow("无权读取");
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: true } });
    await db.auditLog.create({ data: { userId: f.user.id, action: "CLIENT_FOLLOWUP_RESCHEDULE", targetType: "ClientFollowUp", targetId: item.id, detail: { reason: "合成缺失完整时间" } } });
    await expect(getPersonalFollowUpRescheduleHistory(query)).rejects.toThrow("内容无法核对");
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(getPersonalFollowUpRescheduleHistory(query)).rejects.toThrow("账号已停用");
  });
});
