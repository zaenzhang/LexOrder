// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import type { ContextRecordInput } from "@/lib/matters/context";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("上下文集成测试仅允许独立的 _test 数据库");
  return { url };
});
// All existing authorization helpers use the same explicit isolated database.
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasources: { db: { url: config.url ?? "postgresql://unused:unused@127.0.0.1:1/context_test" } } }) };
});
import { prisma as db } from "@/lib/prisma";
import { saveMatterContext, confirmMatterContext, readMatterContext, readContextHistory, readContextSource } from "@/server/matters/context-service";
import { readMatterBrief } from "@/server/matters/brief";

const userIds: string[] = [], matterIds: string[] = [], clientIds: string[] = [], roleIds: string[] = [], teamIds: string[] = [];
async function makeUser(role: UserRole = "LAWYER", roleDefinitionId?: string) {
  const user = await db.user.create({ data: { name: "合成上下文用户", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role, roleDefinitionId } });
  userIds.push(user.id);
  return { id: user.id, role: user.role, runtimeMode: "SERVER" as const };
}
async function fixture() {
  const user = await makeUser();
  const client = await db.client.create({ data: { name: "合成上下文客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } });
  clientIds.push(client.id);
  const matter = await db.matter.create({ data: { internalCode: `CONTEXT-${randomUUID()}`, title: "合成上下文事项", ownerId: user.id, primaryClientId: client.id, serviceScope: "合成委托范围" } });
  matterIds.push(matter.id);
  return { user, client, matter };
}
async function restrictedMember(matterId: string) {
  const name = `context-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
    { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" },
    { permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "clients.read", scope: "OWN" },
    { permissionKey: "documents.read", scope: "OWN" }, { permissionKey: "documents.download", scope: "OWN" }
  ] } } });
  roleIds.push(role.id);
  const user = await makeUser("CUSTOM", role.id);
  await db.matterMember.create({ data: { matterId, userId: user.id, role: "ASSISTANT" } });
  return { user, role };
}
function input(matterId: string, extra: Partial<ContextRecordInput> = {}): ContextRecordInput {
  return { matterId, requestKey: randomUUID(), kind: "GOAL", visibility: "MATTER", content: "合成目标：核对材料后提出方案",
    sourceDescription: "合成客户电话指示", occurredAt: new Date().toISOString(), ...extra };
}
const confirm = (matterId: string, id: string, expectedVersion: number) => ({ matterId, id, expectedVersion, acknowledged: true as const });

describe.skipIf(!config.url)("W07 上下文：真实 PostgreSQL 历史、并发与授权", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Keep immutable history and audit evidence; retire only this suite's synthetic identities.
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clientIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.team.updateMany({ where: { id: { in: teamIds } }, data: { active: false } });
    await db.$disconnect();
  });

  it("同键并发提交只创建一条记录、审计及事件；同键不同正文拒绝", async () => {
    const f = await fixture(), data = input(f.matter.id);
    const results = await Promise.all([saveMatterContext(db, f.user, data), saveMatterContext(db, f.user, data)]);
    expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
    expect(await db.matterContextRecord.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "MATTER_CONTEXT_CREATE" } })).toBe(1);
    expect(await db.timelineEvent.count({ where: { matterId: f.matter.id } })).toBe(1);
    await expect(saveMatterContext(db, f.user, { ...data, content: "另一项合成目标" })).rejects.toThrow("内容发生变化");
  });

  it("并发更正只有一条新链头成功；旧确认保留，新版不继承，旧版本不能再确认", async () => {
    const f = await fixture();
    const old = await saveMatterContext(db, f.user, input(f.matter.id));
    await confirmMatterContext(db, f.user, confirm(f.matter.id, old.id, 1));
    const changed = await Promise.allSettled(["甲", "乙"].map(content => saveMatterContext(db, f.user, input(f.matter.id, { supersedesId: old.id, content }))));
    expect(changed.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const view = await readMatterContext(db, f.user, f.matter.id);
    expect(view.records).toHaveLength(1);
    expect(view.records[0]).toMatchObject({ version: 2, confirmationStatus: "PENDING", confirmedAt: null });
    const history = await readContextHistory(db, f.user, f.matter.id, old.id);
    expect(history.records.map(row => row.confirmationStatus)).toEqual(["PENDING", "CONFIRMED"]);
    await expect(confirmMatterContext(db, f.user, confirm(f.matter.id, old.id, 1))).rejects.toThrow("已被更新");
  });

  it("财务链不会出现在无财务权限的列表、Brief、历史、来源或时间线中，且不能降级可见性", async () => {
    const f = await fixture(), member = await restrictedMember(f.matter.id);
    const privateRecord = await saveMatterContext(db, f.user, input(f.matter.id, { visibility: "FINANCE", kind: "CONSTRAINT", content: "合成费用预算 9000" }));
    const publicRecord = await saveMatterContext(db, f.user, input(f.matter.id));
    expect((await readMatterContext(db, member.user, f.matter.id)).records.map(row => row.id)).toEqual([publicRecord.id]);
    expect(JSON.stringify(await readMatterBrief(db, member.user, f.matter.id))).not.toContain("9000");
    await expect(readContextHistory(db, member.user, f.matter.id, privateRecord.id)).rejects.toThrow("无权");
    await expect(readContextSource(db, member.user, f.matter.id, privateRecord.id)).rejects.toThrow("无权");
    await expect(saveMatterContext(db, member.user, input(f.matter.id, { visibility: "FINANCE" }))).rejects.toThrow("费用约束");
    await expect(saveMatterContext(db, f.user, input(f.matter.id, { kind: "CONSTRAINT", visibility: "MATTER", supersedesId: privateRecord.id }))).rejects.toThrow("可见范围");
    expect(await db.timelineEvent.count({ where: { refId: privateRecord.id } })).toBe(0);
  });

  it("材料下载撤权后正文及历史同时隐藏，来源不能跨事项挂接", async () => {
    const f = await fixture(), other = await fixture(), member = await restrictedMember(f.matter.id);
    const doc = await db.document.create({ data: { name: "合成来源.txt", path: `synthetic/${randomUUID()}.txt`, tags: [], matterId: f.matter.id, uploadedById: f.user.id } });
    const record = await saveMatterContext(db, f.user, input(f.matter.id, { sourceDocumentId: doc.id, content: "合成来源中的受限内容" }));
    expect((await readMatterContext(db, member.user, f.matter.id)).records[0].content).toContain("受限内容");
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: member.role.id, permissionKey: "documents.download" } } });
    const row = (await readMatterContext(db, member.user, f.matter.id)).records[0];
    expect(row).toMatchObject({ readable: false, content: null, reason: null, sourceDescription: null, source: { id: null, label: null } });
    expect((await readContextHistory(db, member.user, f.matter.id, record.id)).records[0].content).toBeNull();
    await expect(readContextSource(db, member.user, f.matter.id, record.id)).rejects.toThrow("无权读取");
    await expect(saveMatterContext(db, other.user, input(other.matter.id, { sourceDocumentId: doc.id }))).rejects.toThrow("来源不存在");
  });

  it("经办可记录，但非主办协办不能确认；旧账号/撤权/归档不能继续写", async () => {
    const f = await fixture(), member = await restrictedMember(f.matter.id);
    const record = await saveMatterContext(db, member.user, input(f.matter.id));
    await expect(confirmMatterContext(db, member.user, confirm(f.matter.id, record.id, 1))).rejects.toThrow("主办或协办");
    await db.user.update({ where: { id: member.user.id }, data: { active: false } });
    await expect(saveMatterContext(db, member.user, input(f.matter.id))).rejects.toThrow("账号或岗位");
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(saveMatterContext(db, f.user, input(f.matter.id))).rejects.toThrow("已归档");
  });

  it("业务管理读取不扩成写入，团队只读和脱离事项的旧成员不能写", async () => {
    const f = await fixture(), manager = await makeUser();
    await db.user.update({ where: { id: manager.id }, data: { managerAuthorized: true, systemRole: "SUPER_ADMIN" } });
    expect((await readMatterContext(db, manager, f.matter.id)).canWrite).toBe(false);
    await expect(saveMatterContext(db, manager, input(f.matter.id))).rejects.toThrow("无权维护");
    const viewer = await makeUser();
    const team = await db.team.create({ data: { name: `context-team-${randomUUID()}`, leaderId: viewer.id, members: { create: [
      { userId: viewer.id, canViewAllMatters: true }, { userId: f.user.id }
    ] } } });
    teamIds.push(team.id);
    expect((await readMatterContext(db, viewer, f.matter.id)).canWrite).toBe(false);
    await expect(saveMatterContext(db, viewer, input(f.matter.id))).rejects.toThrow("无权维护");
    const member = await restrictedMember(f.matter.id);
    await db.matterMember.delete({ where: { matterId_userId: { matterId: f.matter.id, userId: member.user.id } } });
    await expect(saveMatterContext(db, member.user, input(f.matter.id))).rejects.toThrow("无权读取");
  });

  it("客户沟通保持原身份并能回查；Brief 引用已有任务责任，不从客户活动推定确认", async () => {
    const f = await fixture(), other = await fixture();
    const activity = await db.clientActivity.create({ data: { clientId: f.client.id, authorId: f.user.id, channel: "PHONE", content: "合成成案前沟通",
      occurredAt: new Date(), requestKey: randomUUID(), requestHash: "synthetic" } });
    const record = await saveMatterContext(db, f.user, input(f.matter.id, { sourceClientActivityId: activity.id }));
    await expect(saveMatterContext(db, other.user, input(other.matter.id, { sourceClientActivityId: activity.id }))).rejects.toThrow("来源不存在");
    expect((await readContextSource(db, f.user, f.matter.id, record.id)).content).toBe("合成成案前沟通");
    const assignee = await makeUser();
    await db.user.update({ where: { id: assignee.id }, data: { name: "合成实际责任人" } });
    const task = await db.task.create({ data: { matterId: f.matter.id, title: "合成下一步", assigneeId: f.user.id } });
    await db.workResponsibility.update({ where: { taskId: task.id }, data: { assigneeId: assignee.id, state: "OPEN" } });
    const brief = await readMatterBrief(db, f.user, f.matter.id);
    expect(brief.recentClientActivities[0].id).toBe(activity.id);
    expect(brief.context.records[0].confirmationStatus).toBe("PENDING");
    expect(brief.nextActions.find(row => row.id === task.id)).toMatchObject({ assigneeName: "合成实际责任人", accepted: false });
    expect(brief.serviceScope).toBe("合成委托范围");
    expect(await db.client.count({ where: { id: f.client.id } })).toBe(1);
  });

  it("数据库拒绝覆盖正文与改动已确认记录；重复确认不新增审计", async () => {
    const f = await fixture();
    const record = await saveMatterContext(db, f.user, input(f.matter.id));
    await expect(db.matterContextRecord.update({ where: { id: record.id }, data: { content: "直接覆盖" } })).rejects.toThrow();
    await confirmMatterContext(db, f.user, confirm(f.matter.id, record.id, 1));
    expect((await confirmMatterContext(db, f.user, confirm(f.matter.id, record.id, 1))).replayed).toBe(true);
    await expect(db.matterContextRecord.update({ where: { id: record.id }, data: { confirmedAt: new Date("2026-01-01") } })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { targetId: record.id, action: "MATTER_CONTEXT_CONFIRM" } })).toBe(1);
  });
});
