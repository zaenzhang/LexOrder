// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("G02 仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: process.env.WORKBENCH_TEST_DATABASE_URL ? createPrismaClient(process.env.WORKBENCH_TEST_DATABASE_URL) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Approval qualification has its own existing tests; this batch exercises the real task reads and database.
vi.mock("@/server/approval-permissions/inbox", () => ({ listApprovalWorkspace: async () => ({ rows: [{ id: "synthetic-approval", action: "INTAKE_APPROVE", title: "合成独立审批", requester: "合成申请人", matter: null, task: "approve", submittedAt: null }], counts: { pending: 1 } }) }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { resolveRoleUser } from "@/lib/roles/service";
import { matterReadVisibilityFilter } from "@/lib/permissions";
import { approvalTransaction } from "@/lib/approvals/service";
import { createTask } from "@/server/tasks/actions";
import { finishTaskWaiting, getTaskWorkflow, getTaskWorkspace, saveTaskDependencies, startTaskWaiting } from "@/server/tasks/workflow-actions";
import { changeWorkTx } from "@/server/reminders/responsibility";
import { getWorkBoard } from "@/server/reminders/work-actions";
import { getDashboardWorkQueue } from "@/server/dashboard/actions";
import { matchesTaskProgressFilter } from "@/lib/tasks/workflow";

const users: string[] = [], matters: string[] = [], roles: string[] = [], teams: string[] = [];
async function sessionFor(user: Pick<User, "id" | "role" | "systemRole" | "avatar">) {
  const actor = await resolveRoleUser(user.id, user.role, db);
  vi.mocked(requireSession).mockResolvedValue({ user: { ...actor, id: user.id, systemRole: user.systemRole, avatar: user.avatar, runtimeMode: "SERVER" }, expires: "2099-01-01" });
  return actor;
}
async function newUser(role: User["role"] = "LAWYER", roleDefinitionId?: string) {
  const user = await db.user.create({ data: { role, roleDefinitionId, name: "合成 G02 经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only" } });
  users.push(user.id);
  return user;
}
async function fixture(custom = false) {
  const role = custom ? await db.roleDefinition.create({ data: { name: `G02-${randomUUID()}`, normalizedName: `g02-${randomUUID()}`, permissions: { create: [
    { permissionKey: "matters.read", scope: "TEAM" }, { permissionKey: "matters.write", scope: "OWN" },
    { permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "schedule.write", scope: "OWN" }
  ] } } }) : null;
  if (role) roles.push(role.id);
  const user = await newUser(custom ? "CUSTOM" : "LAWYER", role?.id);
  const matter = await db.matter.create({ data: { internalCode: `G02-${randomUUID()}`, title: "合成 G02 事项", ownerId: user.id } });
  matters.push(matter.id);
  await sessionFor(user);
  return { user, matter, role };
}
async function task(f: Awaited<ReturnType<typeof fixture>>, title: string, dueAt?: Date) {
  await sessionFor(f.user);
  const created = await createTask({ matterId: f.matter.id, title, priority: 0, assigneeId: f.user.id, ...(dueAt ? { dueAt } : {}) });
  const row = await db.task.findUniqueOrThrow({ where: { id: created.id }, include: { responsibility: true } });
  expect(row.responsibility).not.toBeNull(); // Real responsibility-creation trigger remains enabled.
  return row;
}
async function work(taskId: string) { return db.workResponsibility.findUniqueOrThrow({ where: { taskId } }); }
async function waiting(f: Awaited<ReturnType<typeof fixture>>, taskId: string) {
  await sessionFor(f.user);
  const id = randomUUID();
  await startTaskWaiting({ taskId, revision: (await work(taskId)).revision, waitingId: id, waitingFor: "合成客户财务", expectedResult: "合成银行原始回单", nextCheckAt: new Date("2000-01-01T01:00:00Z") });
  return id;
}
async function change(userId: string, taskId: string, action: "CANCEL" | "REOPEN" | "COMPLETE" | "PROPOSE" | "ACCEPT", assigneeId?: string) {
  const current = await work(taskId);
  return approvalTransaction(tx => changeWorkTx(tx, userId, { id: current.id, revision: current.revision, action, reason: "合成实际处置", assigneeId }));
}

describe.skipIf(!databaseUrl)("G02 全局任务摘要 / 真实 PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    // Preserve synthetic history; retire only records owned by this test file.
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.team.updateMany({ where: { id: { in: teams } }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("首页五条与完整板独立：窗外及无截止等待仍可筛，读取不写历史，结束等待仍保留前置阻塞", async () => {
    const f = await fixture();
    for (let index = 1; index <= 6; index++) await task(f, `合成较早任务 ${index}`, new Date(`2026-01-0${index}T01:00:00Z`));
    const target = await task(f, "合成窗口外等待任务", new Date("2099-12-01T01:00:00Z"));
    const undated = await task(f, "合成无截止等待任务");
    const prior = await task(f, "合成已取消前置");
    await saveTaskDependencies({ taskId: target.id, revision: (await work(target.id)).revision, prerequisiteIds: [prior.id], reason: "实际前置成果" });
    await change(f.user.id, prior.id, "CANCEL");
    const waitingId = await waiting(f, target.id);
    await waiting(f, undated.id);
    const procedure = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const deadline = await db.deadline.create({ data: { procedureId: procedure.id, title: "合成日期型期限", dueAt: new Date("2030-01-01T16:00:00Z"), duePrecision: "DATE" } });
    const snapshot = async () => Promise.all([
      db.task.findMany({ where: { matterId: f.matter.id }, orderBy: { id: "asc" } }),
      db.taskWaiting.findMany({ where: { task: { matterId: f.matter.id } }, orderBy: { id: "asc" } }),
      db.workResponsibility.findMany({ where: { task: { matterId: f.matter.id } }, orderBy: { id: "asc" } }),
      db.taskDependency.findMany({ where: { task: { matterId: f.matter.id } }, orderBy: { taskId: "asc" } }),
      db.deadline.findUniqueOrThrow({ where: { id: deadline.id } }),
      db.auditLog.count({ where: { targetId: { in: [target.id, undated.id, prior.id] } } })
    ]);
    const before = await snapshot();
    const queue = await getDashboardWorkQueue();
    expect(queue.tasksAvailable).toBe(true);
    expect(queue.taskTotal).toBe(8);
    expect(queue.tasks).toHaveLength(5);
    expect(queue.tasks.some(item => item.id === target.id || item.id === undated.id)).toBe(false);
    const board = (await getWorkBoard())!;
    const due = board.items.filter(item => item.kind === "Task" && item.state === "OPEN" && matchesTaskProgressFilter(item.taskProgress, "CHECK_DUE"));
    expect(new Set(due.map(item => item.targetId))).toEqual(new Set([target.id, undated.id]));
    expect(due.find(item => item.targetId === target.id)?.taskProgress).toMatchObject({ availability: "AVAILABLE", waiting: { expectedResult: "合成银行原始回单" }, blockingPrerequisiteCount: 1, cancelledPrerequisiteCount: 1 });
    expect(await snapshot()).toEqual(before);
    await finishTaskWaiting({ taskId: target.id, waitingId, revision: (await work(target.id)).revision, result: "合成原件收到，仍待前置" });
    const afterWaiting = (await getWorkBoard())!.items.find(item => item.targetId === target.id)!;
    expect(afterWaiting).toMatchObject({ state: "OPEN", dueAt: target.dueAt, taskProgress: { availability: "AVAILABLE", waiting: null, blockingPrerequisiteCount: 1, checkDue: false } });
    await expect(change(f.user.id, target.id, "COMPLETE")).rejects.toThrow("前置任务尚未办结");
    await change(f.user.id, prior.id, "REOPEN");
    await change(f.user.id, prior.id, "COMPLETE");
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)).toMatchObject({ state: "OPEN", taskProgress: { availability: "AVAILABLE", blockingPrerequisiteCount: 0 } });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: deadline.id } })).toEqual(deadline);
  }, 30_000);

  it("拟接收不变成本人当前任务；当前责任优先于旧Task镜像且读取不修补镜像", async () => {
    const f = await fixture(), target = await task(f, "合成待交接任务");
    const recipient = await newUser();
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: recipient.id, role: "ASSISTANT" } });
    await change(f.user.id, target.id, "PROPOSE", recipient.id);
    await sessionFor(recipient);
    expect((await getDashboardWorkQueue()).taskTotal).toBe(0);
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)).toMatchObject({ assigneeId: f.user.id, proposedAssigneeId: recipient.id, taskProgress: { availability: "AVAILABLE" } });
    await change(recipient.id, target.id, "ACCEPT");
    expect((await getDashboardWorkQueue()).tasks.map(item => item.id)).toEqual([target.id]);
    // A synthetic legacy mirror mismatch, without disabling any trigger or changing task history on read.
    await db.workResponsibility.update({ where: { taskId: target.id }, data: { assigneeId: f.user.id } });
    const originalTask = await db.task.findUniqueOrThrow({ where: { id: target.id } });
    expect(originalTask.assigneeId).toBe(recipient.id);
    expect((await getDashboardWorkQueue()).taskTotal).toBe(0);
    await sessionFor(f.user);
    expect((await getDashboardWorkQueue()).tasks.map(item => item.id)).toEqual([target.id]);
    expect(await db.task.findUniqueOrThrow({ where: { id: target.id } })).toEqual(originalTask);
  });

  it("CUSTOM团队概况、本人或拟接收基础行不授予正文；实际撤权或停用即时遮蔽摘要", async () => {
    const f = await fixture(true), own = await task(f, "合成有权任务");
    await waiting(f, own.id);
    const other = await fixture();
    const outside = await db.task.create({ data: { matterId: other.matter.id, title: "合成仅责任行可见", assigneeId: f.user.id } });
    await waiting(other, outside.id);
    const team = await db.team.create({ data: { name: `G02-${randomUUID()}`, leaderId: f.user.id, members: { create: [{ userId: f.user.id, canViewAllMatters: true }, { userId: other.user.id }] } } });
    teams.push(team.id);
    const actor = await sessionFor(f.user);
    expect(await db.matter.count({ where: { id: other.matter.id, ...matterReadVisibilityFilter(f.user.id, actor.role, actor.rolePermissions) } })).toBe(1);
    expect((await getDashboardWorkQueue()).tasks.map(item => item.id)).toEqual([own.id]);
    expect((await getWorkBoard())!.items.find(item => item.targetId === outside.id)?.taskProgress).toEqual({ availability: "UNAVAILABLE" });
    await expect(getTaskWorkflow(outside.id)).rejects.toThrow("无权处理");
    // Keep the original session grants: newly returned summaries must use current database grants.
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: f.role!.id, permissionKey: "schedule.read" } } });
    expect(await getDashboardWorkQueue()).toMatchObject({ tasksAvailable: false, tasks: [], approvalTotal: 1 });
    expect((await getWorkBoard())!.items.find(item => item.targetId === own.id)?.taskProgress).toEqual({ availability: "UNAVAILABLE" });
    await db.rolePermission.create({ data: { roleId: f.role!.id, permissionKey: "schedule.read", scope: "OWN" } });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: f.role!.id, permissionKey: "matters.read" } } });
    expect((await getDashboardWorkQueue()).tasksAvailable).toBe(false);
    await db.rolePermission.create({ data: { roleId: f.role!.id, permissionKey: "matters.read", scope: "TEAM" } });
    await db.roleDefinition.update({ where: { id: f.role!.id }, data: { active: false } });
    expect((await getDashboardWorkQueue()).tasksAvailable).toBe(false);
    await db.roleDefinition.update({ where: { id: f.role!.id }, data: { active: true } });
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    expect((await getDashboardWorkQueue()).tasksAvailable).toBe(false);
  });

  it("FINANCE和应急交接资格都不扩正文；实际加入及移出经办关系按当前状态读取", async () => {
    const f = await fixture();
    const finance = await newUser("FINANCE");
    const target = await db.task.create({ data: { matterId: f.matter.id, title: "合成财务经办任务", assigneeId: finance.id } });
    await waiting(f, target.id);
    await sessionFor(finance);
    expect((await getDashboardWorkQueue()).taskTotal).toBe(0);
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)?.taskProgress).toEqual({ availability: "UNAVAILABLE" });
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: finance.id, role: "ASSISTANT" } });
    expect((await getDashboardWorkQueue()).tasks.map(item => item.id)).toEqual([target.id]);
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)?.taskProgress).toMatchObject({ availability: "AVAILABLE", waiting: { expectedResult: "合成银行原始回单" } });
    await db.matterMember.delete({ where: { matterId_userId: { matterId: f.matter.id, userId: finance.id } } });
    expect((await getDashboardWorkQueue()).taskTotal).toBe(0);
    const emergency = await fixture(true);
    await db.rolePermission.deleteMany({ where: { roleId: emergency.role!.id, permissionKey: { in: ["matters.read", "schedule.read"] } } });
    await db.rolePermission.create({ data: { roleId: emergency.role!.id, permissionKey: "matters.transfer", scope: "ALL" } });
    await db.user.update({ where: { id: finance.id }, data: { active: false } });
    await sessionFor(emergency.user);
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)?.taskProgress).toEqual({ availability: "UNAVAILABLE" });
  });

  it("跨案前置和旧缺责任只返回匿名待核对，读取不制造责任或历史", async () => {
    const f = await fixture(), target = await task(f, "合成异常前置任务"), legacy = await task(f, "合成旧无责任任务");
    const other = await fixture(), outside = await task(other, "合成不可读前置标题");
    // Synthetic historical shapes are inserted directly, retaining every actual database guard.
    await db.taskDependency.create({ data: { taskId: target.id, prerequisiteId: outside.id, createdById: f.user.id } });
    await db.workResponsibility.delete({ where: { taskId: legacy.id } });
    await sessionFor(f.user);
    const before = await db.task.findUniqueOrThrow({ where: { id: legacy.id } });
    const queue = await getDashboardWorkQueue();
    expect(queue.tasks.find(item => item.id === target.id)?.progress).toEqual({ availability: "REVIEW" });
    expect(queue.tasks.find(item => item.id === legacy.id)).toMatchObject({ hasResponsibility: false, progress: { availability: "REVIEW" } });
    expect(JSON.stringify(queue)).not.toContain(outside.title);
    expect(JSON.stringify(queue)).not.toContain(outside.id);
    expect((await getWorkBoard())!.items.find(item => item.targetId === target.id)?.taskProgress).toEqual({ availability: "REVIEW" });
    // The existing matter workspace rejects the malformed relation; no global read repairs it.
    await expect(getTaskWorkspace({ matterId: f.matter.id })).rejects.toThrow("前置关系异常");
    expect(await db.workResponsibility.findUnique({ where: { taskId: legacy.id } })).toBeNull();
    expect(await db.task.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(before);
  });
});
