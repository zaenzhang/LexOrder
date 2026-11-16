// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The coordinator alone provisions and migrates this disposable PostgreSQL database.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("W11 集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { approvalTransaction } from "@/lib/approvals/service";
import { createTask } from "@/server/tasks/actions";
import {
  finishTaskWaiting, getTaskWorkflow, getTaskWorkspace, rescheduleTaskWaiting,
  saveTaskDependencies, startTaskWaiting
} from "@/server/tasks/workflow-actions";
import { changeWorkTx } from "@/server/reminders/responsibility";

const userIds: string[] = [], matterIds: string[] = [], roleIds: string[] = [];
const taskDate = new Date("2026-12-15T04:00:00.000Z");
const firstCheck = new Date("2026-12-02T04:00:00.000Z");
const secondCheck = new Date("2026-12-04T04:00:00.000Z");

function sessionFor(user: Pick<User, "id" | "role">) {
  // This request identity deliberately stays unchanged when live permissions are revoked.
  vi.mocked(requireSession).mockResolvedValue({ user: { id: user.id, role: user.role, runtimeMode: "SERVER" }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}

async function fixture(custom = false) {
  let roleDefinitionId: string | undefined;
  if (custom) {
    const name = `task-workflow-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" },
      { permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "schedule.write", scope: "OWN" }
    ] } } });
    roleIds.push(role.id);
    roleDefinitionId = role.id;
  }
  const user = await db.user.create({ data: { name: "合成 W11 经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only",
    role: custom ? "CUSTOM" : "LAWYER", roleDefinitionId } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成 W11 事项", internalCode: `TASK-WORKFLOW-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  sessionFor(user);
  return { user, matter, roleDefinitionId };
}

async function task(f: Awaited<ReturnType<typeof fixture>>, title = "合成待办") {
  const result = await createTask({ matterId: f.matter.id, title, assigneeId: f.user.id, dueAt: taskDate, priority: 0 });
  const row = await db.task.findUniqueOrThrow({ where: { id: result.id }, include: { responsibility: true } });
  expect(row.responsibility).not.toBeNull(); // Exercise the real responsibility creation trigger.
  return row;
}

async function responsibility(taskId: string) {
  return db.workResponsibility.findUniqueOrThrow({ where: { taskId } });
}

async function workChange(userId: string, taskId: string, action: "COMPLETE" | "CANCEL" | "REOPEN", reason = "合成处理原因") {
  const current = await responsibility(taskId);
  return approvalTransaction(tx => changeWorkTx(tx, userId, { id: current.id, revision: current.revision, action, reason }));
}

async function waitingInput(taskId: string) {
  return { taskId, revision: (await responsibility(taskId)).revision, waitingId: randomUUID(),
    waitingFor: "合成客户项目组", expectedResult: "已核实的合同及附件", nextCheckAt: firstCheck };
}

async function audits(taskId: string, action: string) {
  return db.auditLog.count({ where: { targetType: "Task", targetId: taskId, action } });
}

describe.skipIf(!databaseUrl)("W11 任务推进：真实 PostgreSQL 事务、授权和日期边界", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    // Keep task, wait and audit history intact; retire only these synthetic matters and actors.
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("只能添加同事项前置，拒绝自身和真实递归图中的环，失败不留关系或审计", async () => {
    const f = await fixture();
    const a = await task(f, "准备意见"), b = await task(f, "核对意见"), c = await task(f, "确认意见");
    const otherMatter = await db.matter.create({ data: { title: "合成其他事项", internalCode: `TASK-OTHER-${randomUUID()}`, ownerId: f.user.id } });
    matterIds.push(otherMatter.id);
    const other = await task({ ...f, matter: otherMatter }, "其他事项的任务");
    const input = { taskId: a.id, revision: a.responsibility!.revision, reason: "先核对前置材料" };
    await expect(saveTaskDependencies({ ...input, prerequisiteIds: [other.id] })).rejects.toThrow("不属于同一事项");
    await expect(saveTaskDependencies({ ...input, prerequisiteIds: [a.id] })).rejects.toThrow("自身");
    await saveTaskDependencies({ taskId: b.id, revision: b.responsibility!.revision, prerequisiteIds: [a.id], reason: "先准备再核对" });
    await saveTaskDependencies({ taskId: c.id, revision: c.responsibility!.revision, prerequisiteIds: [b.id], reason: "核对后确认" });
    await expect(saveTaskDependencies({ ...input, prerequisiteIds: [c.id] })).rejects.toThrow("循环");
    expect(await db.taskDependency.count({ where: { taskId: a.id } })).toBe(0);
    expect((await responsibility(a.id)).revision).toBe(input.revision);
    expect(await audits(a.id, "TASK_DEPENDENCIES_CHANGE")).toBe(0);
    expect(await db.taskDependency.count({ where: { taskId: { in: [b.id, c.id] } } })).toBe(2);
  }, 30_000);

  it("前置只有 DONE 满足，CANCELLED 的 completed=true 不能放行；重开后重新检查", async () => {
    const f = await fixture(), prior = await task(f, "核对材料"), next = await task(f, "提交意见");
    await saveTaskDependencies({ taskId: next.id, revision: next.responsibility!.revision, prerequisiteIds: [prior.id], reason: "材料核对后提交" });
    await expect(workChange(f.user.id, next.id, "COMPLETE")).rejects.toThrow("前置任务尚未办结");
    await workChange(f.user.id, prior.id, "CANCEL");
    expect(await db.task.findUniqueOrThrow({ where: { id: prior.id } })).toMatchObject({ completed: true });
    expect((await responsibility(prior.id)).state).toBe("CANCELLED");
    await expect(workChange(f.user.id, next.id, "COMPLETE")).rejects.toThrow("前置任务尚未办结");
    await workChange(f.user.id, prior.id, "REOPEN");
    await workChange(f.user.id, prior.id, "COMPLETE");
    await workChange(f.user.id, next.id, "COMPLETE");
    expect((await responsibility(next.id)).state).toBe("DONE");
    await workChange(f.user.id, prior.id, "REOPEN");
    expect((await responsibility(next.id)).state).toBe("DONE"); // No automatic rewrite of a completed task.
    await workChange(f.user.id, next.id, "REOPEN");
    await expect(workChange(f.user.id, next.id, "COMPLETE")).rejects.toThrow("前置任务尚未办结");
    expect((await responsibility(next.id)).state).toBe("OPEN");
  }, 30_000);

  it("撤销实际岗位权限后，旧会话与已成功登记的稳定标识重试均不能绕过鉴权", async () => {
    const f = await fixture(true), t = await task(f), input = await waitingInput(t.id);
    await startTaskWaiting(input);
    const before = await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } });
    const revision = (await responsibility(t.id)).revision;
    await approvalTransaction(tx => tx.rolePermission.deleteMany({ where: { roleId: f.roleDefinitionId!, permissionKey: "schedule.write" } }));
    // requireSession still returns the original identity; the real transaction must read current grants.
    await expect(startTaskWaiting(input)).rejects.toThrow("当前岗位无权处理任务");
    await expect(startTaskWaiting({ ...input, waitingId: randomUUID(), revision })).rejects.toThrow("当前岗位无权处理任务");
    expect(await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } })).toEqual(before);
    expect((await responsibility(t.id)).revision).toBe(revision);
    expect(await audits(t.id, "TASK_WAITING_START")).toBe(1);
  }, 30_000);

  it("两个并发登记经过真实 Serializable 事务后，只有一条有效等待和一条登记审计", async () => {
    const f = await fixture(), t = await task(f), input = await waitingInput(t.id);
    const outcomes = await Promise.allSettled([
      startTaskWaiting(input),
      startTaskWaiting({ ...input, waitingId: randomUUID(), expectedResult: "另一份合成外部成果" })
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.taskWaiting.count({ where: { taskId: t.id } })).toBe(1);
    expect(await db.taskWaiting.count({ where: { taskId: t.id, endedAt: null } })).toBe(1);
    expect((await responsibility(t.id)).revision).toBe(input.revision + 1);
    expect(await audits(t.id, "TASK_WAITING_START")).toBe(1);
  }, 30_000);

  it("丢响应重试在改期、结束和任务完成后保留初始检查日、当前检查日与结束结果", async () => {
    const f = await fixture(), t = await task(f), input = await waitingInput(t.id);
    await startTaskWaiting(input);
    await rescheduleTaskWaiting({ taskId: t.id, waitingId: input.waitingId, revision: (await responsibility(t.id)).revision,
      nextCheckAt: secondCheck, reason: "约定后天再检查" });
    const rescheduled = await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } });
    const revision = (await responsibility(t.id)).revision;
    await startTaskWaiting(input);
    expect(await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } })).toEqual(rescheduled);
    expect(rescheduled.initialCheckAt).toEqual(firstCheck);
    expect(rescheduled.nextCheckAt).toEqual(secondCheck);
    expect((await responsibility(t.id)).revision).toBe(revision);
    await expect(startTaskWaiting({ ...input, nextCheckAt: secondCheck })).rejects.toThrow("已用于不同内容");
    await finishTaskWaiting({ taskId: t.id, waitingId: input.waitingId, revision, result: "已收到并核对约定附件" });
    const closed = await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } });
    await startTaskWaiting(input);
    await workChange(f.user.id, t.id, "COMPLETE");
    await startTaskWaiting(input);
    expect(await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } })).toEqual(closed);
    expect(closed).toMatchObject({ initialCheckAt: firstCheck, nextCheckAt: secondCheck, result: "已收到并核对约定附件", endedById: f.user.id });
    expect(closed.endedAt).toBeInstanceOf(Date);
    expect((await responsibility(t.id)).state).toBe("DONE");
    expect(await db.taskWaiting.count({ where: { taskId: t.id } })).toBe(1);
    expect(await audits(t.id, "TASK_WAITING_START")).toBe(1);
    expect(await audits(t.id, "TASK_WAITING_FINISH")).toBe(1);
  }, 30_000);

  it("取消任务与结束等待同事务提交；事务失败时任务、等待及审计一起回滚", async () => {
    const f = await fixture(), t = await task(f), input = await waitingInput(t.id);
    await startTaskWaiting(input);
    const current = await responsibility(t.id);
    const change = { id: current.id, revision: current.revision, action: "CANCEL" as const, reason: "客户撤回本次资料要求" };
    await expect(approvalTransaction(async tx => {
      await changeWorkTx(tx, f.user.id, change);
      throw new Error("synthetic transaction rollback");
    })).rejects.toThrow("synthetic transaction rollback");
    expect(await responsibility(t.id)).toEqual(current);
    expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ completed: false });
    expect(await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } })).toMatchObject({ endedAt: null, result: null });
    expect(await audits(t.id, "TASK_WAITING_CANCEL")).toBe(0);
    expect(await audits(t.id, "WORK_ITEM_CANCEL")).toBe(0);
    await approvalTransaction(tx => changeWorkTx(tx, f.user.id, change));
    expect((await responsibility(t.id)).state).toBe("CANCELLED");
    expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ completed: true });
    expect(await db.taskWaiting.findUniqueOrThrow({ where: { id: input.waitingId } })).toMatchObject({
      endedAt: expect.any(Date), endedById: f.user.id, result: `任务取消：${change.reason}`
    });
    expect(await audits(t.id, "TASK_WAITING_CANCEL")).toBe(1);
    expect(await audits(t.id, "WORK_ITEM_CANCEL")).toBe(1);
  }, 30_000);

  it("检查日改期只改等待，不改内部责任、Task 安排日期或已人工调整的 Deadline", async () => {
    const f = await fixture(), t = await task(f), input = await waitingInput(t.id);
    const procedure = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const deadline = await db.deadline.create({ data: { procedureId: procedure.id, title: "合成人工调整期限", dueAt: taskDate,
      confirmStatus: "ADJUSTED", adjustedById: f.user.id, adjustedAt: new Date("2026-11-16T04:00:00Z") } });
    await startTaskWaiting(input);
    await expect(workChange(f.user.id, t.id, "COMPLETE")).rejects.toThrow("仍在等待外部成果");
    await rescheduleTaskWaiting({ taskId: t.id, waitingId: input.waitingId, revision: (await responsibility(t.id)).revision,
      nextCheckAt: secondCheck, reason: "合成检查日改期" });
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ dueAt: t.dueAt, updatedAt: t.updatedAt, assigneeId: t.assigneeId, completed: false });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: deadline.id } })).toEqual(deadline);
    expect(await responsibility(t.id)).toMatchObject({ assigneeId: f.user.id, state: "OPEN" });
    const detail = await getTaskWorkflow(t.id);
    expect(detail.task).toMatchObject({ dueAt: taskDate, activeWaiting: { nextCheckAt: secondCheck } });
    const workspace = await getTaskWorkspace({ matterId: f.matter.id });
    expect(workspace.tasks.map(item => item.id)).toEqual([t.id]);
  }, 30_000);
});
