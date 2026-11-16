// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shDateFromKey } from "@/lib/ui/sh-time";
import type { TaskCreateInput } from "@/server/tasks/contracts";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("待办集成测试只允许独立 _test 数据库");
  return { url, actor: { id: "", role: "LAWYER", runtimeMode: "SERVER" as const } };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasources: { db: { url: config.url ?? "postgresql://unused:unused@127.0.0.1:1/tasks_test" } } }) };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
import { prisma as db } from "@/lib/prisma";
import { approvalTransaction } from "@/lib/approvals/service";
import { changeWorkTx } from "@/server/reminders/responsibility";
import { getWorkBoard } from "@/server/reminders/work-actions";
import { completeTasksBatch } from "@/server/tasks/actions";
import {
  createTaskTx, updateTaskTx, readMatterTasks, readTask, changeTaskTx, completeTaskTx,
  startTaskWaitTx, changeTaskWaitTx, endTaskWaitTx, addTaskDependencyTx, removeTaskDependencyTx,
} from "@/server/tasks/service";

const users: string[] = [], matters: string[] = [], clients: string[] = [], roles: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成待办律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } }); users.push(user.id);
  const client = await db.client.create({ data: { name: "合成待办客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } }); clients.push(client.id);
  const matter = await db.matter.create({ data: { internalCode: `M3-TASK-${randomUUID()}`, title: "合成无程序事项", ownerId: user.id, primaryClientId: client.id } }); matters.push(matter.id);
  const actor = { id: user.id, role: user.role, runtimeMode: "SERVER" as const };
  return { actor, matter };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function create(f: Fixture, title: string, patch: Partial<TaskCreateInput> = {}) {
  const result = await approvalTransaction(tx => createTaskTx(tx, f.actor, { matterId: f.matter.id, requestKey: randomUUID(), title, ...patch }));
  return readTask(db, f.actor, f.matter.id, result.id);
}
async function change(f: Fixture, id: string, action: "COMPLETE"|"CANCEL"|"REOPEN") {
  const row = await readTask(db, f.actor, f.matter.id, id);
  return approvalTransaction(tx => changeTaskTx(tx, f.actor, f.matter.id, id, { revision: row.revision, action, reason: "合成处理结果" }));
}
async function depend(f: Fixture, taskId: string, prerequisiteTaskId: string) {
  const row = await readTask(db, f.actor, f.matter.id, taskId);
  return approvalTransaction(tx => addTaskDependencyTx(tx, f.actor, { matterId: f.matter.id, taskId, prerequisiteTaskId, expectedRevision: row.revision, reason: "须先取得核对结果" }));
}

describe.skipIf(!config.url)("M3 全案待办、等待与依赖 / PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect();
  });

  it("无程序案件可建待办；重复并发与未知结果重试只保留一条及一份审计", async () => {
    const f = await fixture(), input = { matterId: f.matter.id, requestKey: randomUUID(), title: "无阶段待办" };
    const results = await Promise.allSettled([approvalTransaction(tx => createTaskTx(tx, f.actor, input)), approvalTransaction(tx => createTaskTx(tx, f.actor, input))]);
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    const replay = await approvalTransaction(tx => createTaskTx(tx, f.actor, input));
    expect(replay.replayed).toBe(true);
    expect(await db.task.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.actor.id, action: "TASK_CREATE" } })).toBe(1);
    const view = await readMatterTasks(db, f.actor, f.matter.id);
    expect(view.tasks).toHaveLength(1); expect(view.stages).toEqual([]);
    expect(view.tasks[0]).toMatchObject({ id: replay.id, stageId: null, state: "OPEN", assigneeId: f.actor.id });
    config.actor = f.actor;
    expect((await getWorkBoard({ matterId: f.matter.id }))?.items[0].taskHref).toBe(`/matters/${f.matter.internalCode}?view=work&workPane=tasks&task=${replay.id}`);
    await expect(approvalTransaction(tx => createTaskTx(tx, f.actor, { ...input, title: "改掉已保存内容" }))).rejects.toThrow("不同内容");
  });

  it("越案待办、阶段及非本案责任人都拒绝；同案阶段与修订守卫可用", async () => {
    const f = await fixture(), other = await fixture(), row = await create(f, "受控待办");
    const procedure = await db.matterProcedure.create({ data: { matterId: other.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const stage = await db.matterStage.create({ data: { procedureId: procedure.id, name: "合成阶段", order: 0 } });
    await expect(create(f, "越案阶段", { stageId: stage.id })).rejects.toThrow("阶段不存在");
    await expect(create(f, "外案责任人", { assigneeId: other.actor.id })).rejects.toThrow("本案团队");
    await expect(approvalTransaction(tx => updateTaskTx(tx, other.actor, { matterId: other.matter.id, id: row.id, expectedRevision: row.revision, title: "越案修改", reason: "合成" }))).rejects.toThrow("不属于当前案件");
    await expect(approvalTransaction(tx => updateTaskTx(tx, other.actor, { matterId: f.matter.id, id: row.id, expectedRevision: row.revision, title: "无权修改", reason: "合成" }))).rejects.toThrow("无权处理");
    const local = await create(other, "同案阶段", { stageId: stage.id }); expect(local.stageId).toBe(stage.id);
    await approvalTransaction(tx => updateTaskTx(tx, f.actor, { matterId: f.matter.id, id: row.id, expectedRevision: row.revision, title: "已明确更新", reason: "补充办理范围" }));
    await expect(approvalTransaction(tx => updateTaskTx(tx, f.actor, { matterId: f.matter.id, id: row.id, expectedRevision: row.revision, title: "陈旧覆盖", reason: "合成" }))).rejects.toThrow("已变化");
  });

  it("前置只有 DONE 满足；完成入口共享校验，取消/重开均继续阻塞", async () => {
    const f = await fixture(), first = await create(f, "前置核对"), later = await create(f, "提交结果");
    await depend(f, later.id, first.id);
    const blocked = await readTask(db, f.actor, f.matter.id, later.id);
    await expect(approvalTransaction(tx => changeWorkTx(tx, f.actor.id, { id: blocked.workId, revision: blocked.revision, action: "COMPLETE", reason: "从责任面板直接完成" }))).rejects.toThrow("前置待办尚未完成");
    await expect(approvalTransaction(tx => completeTaskTx(tx, f.actor, later.id, "快捷入口", false))).rejects.toThrow("前置待办尚未完成");
    await change(f, first.id, "CANCEL");
    expect((await db.task.findUniqueOrThrow({ where: { id: first.id } })).completed).toBe(true);
    expect((await readTask(db, f.actor, f.matter.id, later.id)).prerequisites[0]).toMatchObject({ state: "CANCELLED", satisfied: false });
    await expect(change(f, later.id, "COMPLETE")).rejects.toThrow("前置待办尚未完成");
    await change(f, first.id, "REOPEN"); await change(f, first.id, "COMPLETE"); await change(f, later.id, "COMPLETE");
    await change(f, first.id, "REOPEN");
    expect((await readTask(db, f.actor, f.matter.id, later.id)).state).toBe("DONE");
    await change(f, later.id, "REOPEN");
    await expect(change(f, later.id, "COMPLETE")).rejects.toThrow("前置待办尚未完成");
  });

  it("自身、越案与并发互相依赖拒绝，间接循环不能进入实际图", async () => {
    const f = await fixture(), foreign = await fixture();
    const a = await create(f, "甲"), b = await create(f, "乙"), c = await create(f, "丙"), x = await create(foreign, "外案");
    await expect(depend(f, a.id, a.id)).rejects.toThrow("循环依赖");
    await expect(depend(f, a.id, x.id)).rejects.toThrow("不属于当前案件");
    const pair = await Promise.allSettled([depend(f, a.id, b.id), depend(f, b.id, a.id)]);
    expect(pair.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const edges = await db.taskDependency.findMany({ where: { task: { matterId: f.matter.id } } }); expect(edges).toHaveLength(1);
    const edge = edges[0];
    await expect(depend(f, edge.prerequisiteTaskId, edge.taskId)).rejects.toThrow("循环依赖");
    await depend(f, c.id, edge.taskId);
    await expect(depend(f, edge.prerequisiteTaskId, c.id)).rejects.toThrow("循环依赖");
  });

  it("移除依赖需明确原因并同事务留痕，移除后方能独立完成", async () => {
    const f = await fixture(), first = await create(f, "前置取消项"), later = await create(f, "后续项");
    const edge = await depend(f, later.id, first.id); await change(f, first.id, "CANCEL");
    const current = await readTask(db, f.actor, f.matter.id, later.id);
    const input = { matterId: f.matter.id, taskId: later.id, id: edge.id, expectedRevision: current.revision, reason: "改用已确认的其他资料，取消此前置要求" };
    await expect(approvalTransaction(tx => removeTaskDependencyTx(tx, f.actor, { ...input, reason: "" }))).rejects.toThrow("原因");
    await approvalTransaction(tx => removeTaskDependencyTx(tx, f.actor, input));
    expect(await db.auditLog.findFirst({ where: { targetId: later.id, action: "TASK_DEPENDENCY_REMOVE" } })).toMatchObject({ detail: expect.objectContaining({ reason: input.reason, prerequisiteTaskId: first.id }) });
    await change(f, later.id, "COMPLETE");
  });

  it("等待保持内部责任人和实际期限，检查日为上海日；显式结果结束后才可完成", async () => {
    const f = await fixture(), dueAt = shDateFromKey("2026-12-12"), row = await create(f, "等待法院来件", { dueAt });
    const procedure = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const deadline = await db.deadline.create({ data: { procedureId: procedure.id, title: "合成已确认期限", dueAt, confirmStatus: "CONFIRMED" } });
    const input = { matterId: f.matter.id, taskId: row.id, expectedRevision: row.revision, requestKey: randomUUID(), externalParty: "合成法院",
      expectedResult: "取得盖章副本", reason: "已提交申请，等待补发", nextCheckDate: "2026-12-05" };
    const wait = await approvalTransaction(tx => startTaskWaitTx(tx, f.actor, input));
    expect((await approvalTransaction(tx => startTaskWaitTx(tx, f.actor, input))).id).toBe(wait.id);
    expect((await db.taskWait.findUniqueOrThrow({ where: { id: wait.id } })).nextCheckAt.toISOString()).toBe("2026-12-04T16:00:00.000Z");
    await expect(change(f, row.id, "COMPLETE")).rejects.toThrow("先结束等待");
    await expect(change(f, row.id, "CANCEL")).rejects.toThrow("先结束等待");
    await approvalTransaction(tx => changeTaskWaitTx(tx, f.actor, { matterId: f.matter.id, taskId: row.id, id: wait.id, revision: 1, nextCheckDate: "2026-12-06", reason: "对方告知翌日取得" }));
    expect(await db.task.findUnique({ where: { id: row.id } })).toMatchObject({ dueAt, assigneeId: f.actor.id, completed: false });
    expect(await db.deadline.findUnique({ where: { id: deadline.id } })).toMatchObject({ dueAt, confirmStatus: "CONFIRMED" });
    await approvalTransaction(tx => endTaskWaitTx(tx, f.actor, { matterId: f.matter.id, taskId: row.id, id: wait.id, revision: 2, result: "已取得并核对盖章副本" }));
    await expect(db.taskWait.update({ where: { id: wait.id }, data: { result: "覆盖历史" } })).rejects.toThrow();
    const reopened = await readTask(db, f.actor, f.matter.id, row.id);
    expect(reopened.waiting).toBeNull(); expect(reopened.waits[0].result).toBe("已取得并核对盖章副本");
    await change(f, row.id, "COMPLETE");
    expect(await db.auditLog.count({ where: { targetId: row.id, action: { in: ["TASK_WAIT_START", "TASK_WAIT_CHECK_DATE", "TASK_WAIT_END"] } } })).toBe(3);
  });

  it("批量完成逐项返回：依赖阻塞不影响独立待办，取消项不冒充完成", async () => {
    const f = await fixture(), a = await create(f, "前置"), b = await create(f, "有依赖"), independent = await create(f, "独立项"), cancelled = await create(f, "已取消项");
    await depend(f, b.id, a.id); await change(f, cancelled.id, "CANCEL"); config.actor = f.actor;
    const result = await completeTasksBatch({ ids: [b.id, independent.id, cancelled.id], reason: "逐项核对处理结果" });
    expect(result.results.map(row => row.ok)).toEqual([false, true, false]);
    expect((await readTask(db, f.actor, f.matter.id, independent.id)).state).toBe("DONE");
    const other = await fixture(); config.actor = other.actor;
    expect((await completeTasksBatch({ ids: [independent.id], reason: "无权重试已完成项" })).results[0].ok).toBe(false);
  });

  it("边增删与单条、责任面板及批量完成并发时均保持前置检查和状态一致", async () => {
    const f = await fixture(); config.actor = f.actor;
    for (const entry of ["SINGLE", "BOARD", "BATCH"] as const) {
      const first = await create(f, `${entry} 前置`), later = await create(f, `${entry} 后续`);
      const complete = async (revision: number) => {
        if (entry === "BATCH") return (await completeTasksBatch({ ids: [later.id], reason: "并发批量完成核对" })).results[0].ok;
        if (entry === "BOARD") await approvalTransaction(tx => changeWorkTx(tx, f.actor.id, { id: later.workId, revision, action: "COMPLETE", reason: "并发责任面板完成核对" }));
        else await approvalTransaction(tx => completeTaskTx(tx, f.actor, later.id, "并发单条完成核对", false));
        return true;
      };
      // Either completion commits first and rejects the new edge, or the new edge blocks completion.
      const added = await Promise.allSettled([
        approvalTransaction(tx => addTaskDependencyTx(tx, f.actor, { matterId: f.matter.id, taskId: later.id, prerequisiteTaskId: first.id,
          expectedRevision: later.revision, reason: "明确前置后才能完成" })),
        complete(later.revision),
      ]);
      let current = await readTask(db, f.actor, f.matter.id, later.id);
      expect(current.state === "DONE" ? current.prerequisites.length === 0 : current.prerequisites.length === 1).toBe(true);
      if (added[0].status === "fulfilled") expect(current.state).toBe("OPEN");
      if (current.state === "DONE") { await change(f, later.id, "REOPEN"); await depend(f, later.id, first.id); }
      current = await readTask(db, f.actor, f.matter.id, later.id);
      expect(current.prerequisites[0].satisfied).toBe(false);
      const edge = current.prerequisites[0];
      // A blocked COMPLETE may fail first; removing the edge is the only permitted unblock.
      const removed = await Promise.allSettled([
        approvalTransaction(tx => removeTaskDependencyTx(tx, f.actor, { matterId: f.matter.id, taskId: later.id, id: edge.id,
          expectedRevision: current.revision, reason: "经明确核对后解除此前置" })),
        complete(current.revision),
      ]);
      expect(removed[0].status).toBe("fulfilled");
      current = await readTask(db, f.actor, f.matter.id, later.id);
      expect(current.prerequisites).toEqual([]);
      if (current.state !== "DONE") expect(await complete(current.revision)).toBe(true);
      expect((await readTask(db, f.actor, f.matter.id, later.id)).state).toBe("DONE");
      expect(await db.auditLog.count({ where: { targetId: later.id, action: "TASK_DEPENDENCY_REMOVE" } })).toBe(1);
    }
  });

  it("当前自定义岗位撤销 schedule.write 后，重放、依赖、等待及各完成入口均重新拒绝", async () => {
    const f = await fixture(), name = `合成待办岗位-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" },
      { permissionKey: "schedule.read", scope: "OWN" }, { permissionKey: "schedule.write", scope: "OWN" },
    ] } } }); roles.push(role.id);
    await db.user.update({ where: { id: f.actor.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    const actor = { ...f.actor, role: "CUSTOM" as const }, custom = { ...f, actor };
    const input = { matterId: f.matter.id, requestKey: randomUUID(), title: "撤权前待办" };
    const saved = await approvalTransaction(tx => createTaskTx(tx, actor, input));
    const row = await readTask(db, actor, f.matter.id, saved.id), predecessor = await create(custom, "可选前置");
    const waitInput = { matterId: f.matter.id, taskId: row.id, expectedRevision: row.revision, requestKey: randomUUID(), externalParty: "合成单位",
      expectedResult: "合成来件", reason: "待取得来件", nextCheckDate: "2026-12-05" };
    await approvalTransaction(tx => startTaskWaitTx(tx, actor, waitInput));
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionKey: "schedule.write" } });
    const readOnly = await readTask(db, actor, f.matter.id, row.id);
    expect(readOnly.canWrite).toBe(false);
    await expect(approvalTransaction(tx => createTaskTx(tx, actor, input))).rejects.toThrow("岗位");
    await expect(approvalTransaction(tx => startTaskWaitTx(tx, actor, waitInput))).rejects.toThrow("岗位");
    await expect(approvalTransaction(tx => addTaskDependencyTx(tx, actor, { matterId: f.matter.id, taskId: row.id, prerequisiteTaskId: predecessor.id,
      expectedRevision: readOnly.revision, reason: "撤权后不能新增" }))).rejects.toThrow("岗位");
    await expect(approvalTransaction(tx => completeTaskTx(tx, actor, row.id, "撤权后快捷完成", false))).rejects.toThrow("岗位");
    await expect(approvalTransaction(tx => changeWorkTx(tx, actor.id, { id: row.workId, revision: readOnly.revision, action: "COMPLETE", reason: "撤权后责任完成" }))).rejects.toThrow("岗位");
    config.actor = actor;
    expect((await completeTasksBatch({ ids: [row.id], reason: "撤权后批量完成" })).results[0].ok).toBe(false);
    expect((await readTask(db, actor, f.matter.id, row.id)).state).toBe("OPEN");
    expect(await db.task.count({ where: { createRequestKey: input.requestKey } })).toBe(1);
  });

  it("归档后阻断编辑；已授权取消可先结清等待；停用后不能重放创建", async () => {
    const f = await fixture(), input = { matterId: f.matter.id, requestKey: randomUUID(), title: "归档待办" };
    const created = await approvalTransaction(tx => createTaskTx(tx, f.actor, input)), row = await readTask(db, f.actor, f.matter.id, created.id);
    const wait = await approvalTransaction(tx => startTaskWaitTx(tx, f.actor, { matterId: f.matter.id, taskId: row.id, expectedRevision: row.revision, requestKey: randomUUID(), externalParty: "外部单位", expectedResult: "来件", reason: "等待来件", nextCheckDate: "2026-12-05" }));
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(create(f, "归档新增")).rejects.toThrow("已归档");
    await approvalTransaction(tx => endTaskWaitTx(tx, f.actor, { matterId: f.matter.id, taskId: row.id, id: wait.id, revision: 1, result: "归档前已不再需要来件，明确结束等待" }));
    await change(f, row.id, "CANCEL");
    await db.user.update({ where: { id: f.actor.id }, data: { active: false } });
    await expect(approvalTransaction(tx => createTaskTx(tx, f.actor, input))).rejects.toThrow("账号");
    await expect(readMatterTasks(db, f.actor, f.matter.id)).rejects.toThrow("账号");
  });
});
