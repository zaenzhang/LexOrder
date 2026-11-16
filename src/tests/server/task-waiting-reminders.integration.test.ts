// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ send: vi.fn(), claim: vi.fn(), complete: vi.fn(), renew: vi.fn(), fail: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ isEmailConfigured: () => true, sendReminderEmail: mail.send }));
vi.mock("@/server/settings/email-last-result", () => ({ saveEmailLastResult: vi.fn() }));
vi.mock("@/server/cron/queue", () => ({ claimDueJobs: mail.claim, completeJob: mail.complete, renewJobLease: mail.renew, failJob: mail.fail }));

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("等待提醒仅允许独立 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: process.env.WORKBENCH_TEST_DATABASE_URL ? createPrismaClient(process.env.WORKBENCH_TEST_DATABASE_URL) : undefined };
});
import { prisma as db } from "@/lib/prisma";
import { scanTaskWaitingReminders } from "@/server/reminders/task-waiting";
import { processDueJobs } from "@/server/cron/worker";
import { startTaskWaitingTx, finishTaskWaitingTx, rescheduleTaskWaitingTx } from "@/server/tasks/workflow-service";

const users: string[] = [], matters: string[] = [], roles: string[] = [];
const now = new Date("2026-11-20T02:00:00.000Z"), due = new Date("2026-11-20T01:00:00.000Z");
async function fixture(custom = false) {
  const role = custom ? await db.roleDefinition.create({ data: { name: `waiting-${randomUUID()}`, normalizedName: `waiting-${randomUUID()}`,
    permissions: { create: ["matters.read", "matters.write", "schedule.read", "schedule.write"].map(permissionKey => ({ permissionKey, scope: "OWN" as const })) } } }) : null;
  if (role) roles.push(role.id);
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: "合成等待检查负责人", passwordHash: "disabled-test-only",
    role: role ? "CUSTOM" : "LAWYER", roleDefinitionId: role?.id } });
  users.push(user.id);
  const matter = await db.matter.create({ data: { internalCode: `WAIT-${randomUUID()}`, title: "合成等待检查事项", ownerId: user.id } });
  matters.push(matter.id);
  const task = await db.task.create({ data: { matterId: matter.id, title: "合成收取原件", assigneeId: user.id, dueAt: new Date("2026-12-01T01:00:00.000Z") }, include: { responsibility: true } });
  const waitingId = randomUUID();
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await startTaskWaitingTx(tx, user.id, { taskId: task.id, revision: task.responsibility!.revision, waitingId,
      waitingFor: "合成客户", expectedResult: "合成签章原件", nextCheckAt: due });
  });
  return { user, matter, task, waitingId, role };
}
async function revision(taskId: string) { return (await db.workResponsibility.findUniqueOrThrow({ where: { taskId } })).revision; }
async function notices(waitingId: string) { return db.notification.findMany({ where: { refType: "TaskWaiting", refId: waitingId } }); }

describe.skipIf(!databaseUrl)("等待检查提醒：当前权限、日期与并发 / PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("同日并发扫描只提醒一次，检查日前不发送；通知直达原任务且不改任务日期", async () => {
    const f = await fixture();
    await scanTaskWaitingReminders(db, new Date(due.getTime() - 1));
    expect(await notices(f.waitingId)).toHaveLength(0);
    await Promise.all([scanTaskWaitingReminders(db, now), scanTaskWaitingReminders(db, now)]);
    const records = await notices(f.waitingId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ userId: f.user.id, type: "SYSTEM", title: "外部等待待检查" });
    expect(records[0].href).toBe(`/matters/${encodeURIComponent(f.matter.internalCode)}?view=work&workPane=tasks&task=${f.task.id}`);
    expect((await db.task.findUniqueOrThrow({ where: { id: f.task.id } })).dueAt).toEqual(f.task.dueAt);
    expect((await db.workResponsibility.findUniqueOrThrow({ where: { taskId: f.task.id } })).state).toBe("OPEN");
  });

  it("改检查日和结束等待均停止旧检查提醒，结束等待不把任务办结", async () => {
    const f = await fixture();
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await rescheduleTaskWaitingTx(tx, f.user.id, { taskId: f.task.id, revision: await revision(f.task.id), waitingId: f.waitingId,
        nextCheckAt: new Date("2026-11-22T01:00:00.000Z"), reason: "合成客户另约交件日" });
    });
    await scanTaskWaitingReminders(db, now);
    expect(await notices(f.waitingId)).toHaveLength(0);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await finishTaskWaitingTx(tx, f.user.id, { taskId: f.task.id, revision: await revision(f.task.id), waitingId: f.waitingId, result: "合成原件收到，继续核对" });
    });
    await scanTaskWaitingReminders(db, new Date("2026-11-23T02:00:00.000Z"));
    expect(await notices(f.waitingId)).toHaveLength(0);
    expect((await db.workResponsibility.findUniqueOrThrow({ where: { taskId: f.task.id } })).state).toBe("OPEN");
  });

  it("停用账号、撤销日程读取或移出本案后不继续下发等待正文", async () => {
    const inactive = await fixture(), revoked = await fixture(true), detached = await fixture();
    await db.user.update({ where: { id: inactive.user.id }, data: { active: false } });
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: revoked.role!.id, permissionKey: "schedule.read" } } });
    await db.matter.update({ where: { id: detached.matter.id }, data: { ownerId: inactive.user.id } });
    await scanTaskWaitingReminders(db, now);
    for (const f of [inactive, revoked, detached]) expect(await notices(f.waitingId)).toHaveLength(0);
  });

  it("自定义岗位按现有任务权限接收提醒，不额外要求案件维护权限", async () => {
    const f = await fixture(true);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: f.role!.id, permissionKey: "matters.write" } } });
    await scanTaskWaitingReminders(db, now);
    expect(await notices(f.waitingId)).toHaveLength(1);
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: f.role!.id, permissionKey: "schedule.write" } } });
    await scanTaskWaitingReminders(db, new Date(now.getTime() + 86400000));
    expect(await notices(f.waitingId)).toHaveLength(1);
  });

  it("等待通知只留站内：真实摘要查询排除等待，同用户普通通知仍可进入模拟邮件", async () => {
    const f = await fixture();
    await scanTaskWaitingReminders(db, now);
    expect(await notices(f.waitingId)).toHaveLength(1);
    await db.notification.create({ data: { userId: f.user.id, type: "SYSTEM", title: "合成普通通知", content: "保留现有摘要", refType: null } });
    mail.send.mockResolvedValue(undefined);
    mail.renew.mockResolvedValue(true);
    mail.complete.mockResolvedValue(true);
    mail.claim.mockResolvedValue([{ id: randomUUID(), type: "email-digest", payload: {}, maxAttempts: 3, leaseToken: randomUUID() }]);
    const result = await processDueJobs(1);
    expect(result).toMatchObject({ succeeded: 1, failed: 0 });
    const received = mail.send.mock.calls.filter(([input]) => input.to === f.user.email);
    expect(received).toHaveLength(1);
    expect(received[0][0].lines).toContain("合成普通通知：保留现有摘要");
    expect(received[0][0].lines.some((line: string) => line.startsWith("外部等待待检查"))).toBe(false);
    expect(await notices(f.waitingId)).toHaveLength(1);
  });

  it("等待授权锁时发生改期，扫描取得锁后按新日期判断，不发布旧提醒", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const change = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await rescheduleTaskWaitingTx(tx, f.user.id, { taskId: f.task.id, revision: await revision(f.task.id), waitingId: f.waitingId,
        nextCheckAt: new Date("2026-11-22T01:00:00.000Z"), reason: "合成并发改期" });
      locked(); await gate;
    }, { timeout: 20000 });
    await ready;
    const scan = scanTaskWaitingReminders(db, now);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting === 0; attempt++) {
        const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=72606101`;
        waiting = row.count;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally { release(); }
    await change; await scan;
    expect(await notices(f.waitingId)).toHaveLength(0);
  }, 30000);
});
