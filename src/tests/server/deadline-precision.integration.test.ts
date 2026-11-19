// @vitest-environment node
// Actual business actions and PostgreSQL triggers; no HTTP server/browser or external delivery.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("Deadline precision requires isolated _test database");
  return { url, actor: null as WorkspaceActor | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/precision_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })), getSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/reminders/schedule", async () => ({ ...await vi.importActual<typeof import("@/server/reminders/schedule")>("@/server/reminders/schedule"), refreshScheduleReminderAfterSave: vi.fn() }));
vi.mock("@/server/reminders/urgent", async () => ({ ...await vi.importActual<typeof import("@/server/reminders/urgent")>("@/server/reminders/urgent"), scanAdditionalWorkReminders: vi.fn() }));
vi.mock("@/server/timeline/record", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/timeline/record")>();
  return { ...actual, recordTimelineEvent: vi.fn(actual.recordTimelineEvent) };
});
import { recordTimelineEvent } from "@/server/timeline/record";
import { revalidatePath } from "next/cache";
import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { approvalTransaction } from "@/lib/approvals/service";
import { addDeadline } from "@/server/procedures/actions";
import { confirmDeadline, adjustDeadline } from "@/server/deadlines/confirm";
import { changeWork } from "@/server/reminders/work-actions";
import { readWorkRows } from "@/server/reminders/responsibility";
import { handoverSnapshot, requestHandoverTx } from "@/server/matters/handover";
import { generateDeadlineFromSms } from "@/server/sms/actions";
import { queryScheduleItems } from "@/server/schedule/query";
import { registerReminderDelivery } from "@/server/reminders/ledger";

const users: string[] = [], matters: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成期限经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } }); users.push(user.id);
  config.actor = { ...user, ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
  const matter = await db.matter.create({ data: { title: "合成精度事项", internalCode: `PREC-${randomUUID()}`, ownerId: user.id, status: "IN_PROGRESS" } }); matters.push(matter.id);
  const procedure = await db.matterProcedure.create({ data: { matterId: matter.id, type: "FIRST_INSTANCE", engagement: "ENGAGED", order: 1 } });
  return { user, matter, procedure };
}
async function create(f: Awaited<ReturnType<typeof fixture>>, precision: "DATE" | "DATETIME", date = new Date("2027-02-03T00:00:00+08:00")) {
  const result = await addDeadline({ procedureId: f.procedure.id, title: `合成${precision}期限`, category: "CUSTOM", dueAt: date, duePrecision: precision, remindDays: 3 });
  return db.deadline.findUniqueOrThrow({ where: { id: result.id } });
}
describe.skipIf(!config.url)("F01 期限真实精度与责任：PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });
  it("桌面期限在事务失败后完整回滚，回执丢失和并发重试只保留一次登记", async () => {
    const f = await fixture();
    config.actor = { ...config.actor!, runtimeMode: "PERSONAL" };
    const request = { procedureId: f.procedure.id, requestKey: randomUUID(), title: "合成回执重试期限",
      duePrecision: "DATE" as const, dueAt: new Date("2027-02-03T00:00:00+08:00"), remindDays: 3, category: "CUSTOM" as const };
    vi.mocked(recordTimelineEvent).mockRejectedValueOnce(new Error("合成时间线失败"));
    await expect(addDeadline(request)).rejects.toThrow("合成时间线失败");
    expect(await db.deadline.count({ where: { procedureId: f.procedure.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "DEADLINE_CREATE" } })).toBe(0);

    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error("合成提交后回执中断"); });
    await expect(addDeadline(request)).rejects.toThrow("合成提交后回执中断");
    const [first, second] = await Promise.all([addDeadline(request), addDeadline(request)]);
    expect(first.id).toBe(second.id);
    await expect(addDeadline({ ...request, title: "已修改期限" })).rejects.toThrow("不同的期限内容");
    expect(await db.deadline.count({ where: { procedureId: f.procedure.id } })).toBe(1);
    expect(await db.workResponsibility.count({ where: { deadlineId: first.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: first.id, action: "DEADLINE_CREATE" } })).toBe(1);
    expect(await db.timelineEvent.count({ where: { refId: first.id, eventType: "DEADLINE_ADDED" } })).toBe(1);

    const other = { ...request, requestKey: randomUUID(), title: "另一次期限登记" };
    const racing = await Promise.all([addDeadline(other), addDeadline(other)]);
    expect(racing[0].id).toBe(racing[1].id);
    expect(racing[0].id).not.toBe(first.id);
    expect(await db.deadline.count({ where: { procedureId: f.procedure.id } })).toBe(2);
  });
  it("公开新增入口保存日期/准确午夜/17点，数据库拒绝不合法DATE载体", async () => {
    const f = await fixture(), date = await create(f, "DATE"), midnight = await create(f, "DATETIME"), timed = await create(f, "DATETIME", new Date("2027-02-03T17:00:03.456+08:00"));
    expect(date.dueAt.toISOString()).toBe("2027-02-02T16:00:00.000Z");
    expect(midnight).toMatchObject({ dueAt: date.dueAt, duePrecision: "DATETIME" });
    expect(timed.dueAt.toISOString()).toBe("2027-02-03T09:00:03.456Z");
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: date.id, action: "DEADLINE_CREATE" } })).detail).toMatchObject({ duePrecision: "DATE", dueAt: date.dueAt.toISOString() });
    await expect(db.deadline.create({ data: { procedureId: f.procedure.id, title: "无效DATE", duePrecision: "DATE", dueAt: new Date("2027-02-03T00:00:00Z") } })).rejects.toThrow();
    const items = await queryScheduleItems(f.user.id, f.user.role, { from: new Date("2027-02-03T00:00:00+08:00"), to: new Date("2027-02-04T00:00:00+08:00") });
    expect(items.find(item => item.deadlineId === date.id)).toMatchObject({ duePrecision: "DATE", occurredAt: date.dueAt });
    expect(items.find(item => item.deadlineId === midnight.id)).toMatchObject({ duePrecision: "DATETIME" });
  });
  it("历史未知确认不补精度或改秒毫秒，明确调整记录真实前后值", async () => {
    const f = await fixture(), original = new Date("2027-02-03T00:00:23.789Z");
    const legacy = await db.deadline.create({ data: { procedureId: f.procedure.id, title: "合成历史未知", dueAt: original, confirmStatus: "PENDING" } });
    await confirmDeadline({ id: legacy.id, expectedUpdatedAt: legacy.updatedAt });
    const confirmed = await db.deadline.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(confirmed).toMatchObject({ dueAt: original, duePrecision: null, confirmStatus: "CONFIRMED" });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: legacy.id, action: "DEADLINE_CONFIRM" } })).detail).toMatchObject({ dueAt: original.toISOString(), duePrecision: null });
    await adjustDeadline({ id: legacy.id, expectedUpdatedAt: confirmed.updatedAt, dueAt: original, duePrecision: "DATETIME", reason: "明确核实原时点" });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ dueAt: original, duePrecision: "DATETIME" });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: legacy.id, action: "DEADLINE_ADJUST" } })).detail).toMatchObject({ previousDuePrecision: null, newDuePrecision: "DATETIME", previousDueAt: original.toISOString(), newDueAt: original.toISOString() });
  });
  it("同一瞬间只改精度触发责任/提醒/审计，新交接清单有精度而旧冻结不改", async () => {
    const f = await fixture(), date = await create(f, "DATE");
    let work = await db.workResponsibility.findUniqueOrThrow({ where: { deadlineId: date.id } });
    await changeWork({ id: work.id, revision: work.revision, action: "ACCEPT" });
    work = await db.workResponsibility.findUniqueOrThrow({ where: { deadlineId: date.id } }); expect(work.acceptedAt).not.toBeNull();
    const receiver = await db.user.create({ data: { name: "合成交接接收", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled", role: "LAWYER" } }); users.push(receiver.id);
    const handover = await approvalTransaction(tx => requestHandoverTx(tx, f.user.id, { matterId: f.matter.id, toUserId: receiver.id, reason: "合成期限交接" }));
    const frozen = await db.matterHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(frozen.snapshot).toMatchObject({ work: [expect.objectContaining({ duePrecision: "DATE" })] });
    const key = { objectType: "DEADLINE" as const, objectId: date.id, kind: "OFFSET" as const, offset: 0, channel: "IN_APP" as const, dayKey: "2027-02-03", userId: f.user.id };
    await db.reminderDelivery.create({ data: { ...key, status: "SENT", registeredAt: new Date(), sentAt: new Date() } });
    const pending = await db.reminderDelivery.create({ data: { ...key, offset: -3, status: "PENDING", registeredAt: new Date() } });
    const observed = await db.deadline.findUniqueOrThrow({ where: { id: date.id } }); // ACCEPT 已按原业务更新对象版本。
    await adjustDeadline({ id: date.id, expectedUpdatedAt: observed.updatedAt, dueAt: date.dueAt, duePrecision: "DATETIME", reason: "核实为准确午夜" });
    const next = await db.workResponsibility.findUniqueOrThrow({ where: { id: work.id } });
    expect(next).toMatchObject({ acceptedAt: null, revision: work.revision + 1 });
    expect((await db.reminderDelivery.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("SUPERSEDED");
    expect(await registerReminderDelivery(key)).toBe("ALREADY");
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: date.id, action: "WORK_ITEM_DATE_CHANGED" } })).detail).toMatchObject({ previousDuePrecision: "DATE", newDuePrecision: "DATETIME" });
    expect(await db.matterHandover.findUniqueOrThrow({ where: { id: handover.id } })).toEqual(frozen);
    expect((await handoverSnapshot(db, f.matter.id)).fingerprint).not.toBe(frozen.fingerprint);
    await expect(changeWork({ id: work.id, revision: work.revision, action: "RESCHEDULE", dueAt: date.dueAt, duePrecision: "DATE", reason: "旧页面" })).rejects.toThrow("事项已变化");
  });
  it("公开责任改期只对真实Deadline要求精度，Task/Hearing触发器仍可运行", async () => {
    const f = await fixture(), date = await create(f, "DATE"), work = await db.workResponsibility.findUniqueOrThrow({ where: { deadlineId: date.id } });
    await expect(changeWork({ id: work.id, revision: work.revision, action: "RESCHEDULE", dueAt: date.dueAt, reason: "缺少精度" })).rejects.toThrow();
    expect((await db.workResponsibility.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(work.revision);
    const dueAt = new Date("2027-02-03T09:00:23.789Z");
    await changeWork({ id: work.id, revision: work.revision, action: "RESCHEDULE", dueAt, duePrecision: "DATETIME", reason: "核实17点截止" });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: date.id } })).toMatchObject({ dueAt, duePrecision: "DATETIME", confirmStatus: "ADJUSTED" });
    const task = await db.task.create({ data: { matterId: f.matter.id, title: "合成普通任务", dueAt: date.dueAt, assigneeId: f.user.id } });
    const hearing = await db.hearing.create({ data: { procedureId: f.procedure.id, title: "合成庭期", startsAt: date.dueAt } });
    for (const target of [{ taskId: task.id }, { hearingId: hearing.id }]) {
      const item = await db.workResponsibility.findFirstOrThrow({ where: target });
      await changeWork({ id: item.id, revision: item.revision, action: "RESCHEDULE", dueAt, reason: "原业务改期" });
      expect((await db.workResponsibility.findUniqueOrThrow({ where: { id: item.id } })).revision).toBeGreaterThan(item.revision);
    }
    const rows = (await readWorkRows(db)).filter(row => row.matterId === f.matter.id);
    expect(rows.find(row => row.targetId === date.id)).toMatchObject({ duePrecision: "DATETIME", dueAt });
    expect(rows.find(row => row.targetId === task.id)).toMatchObject({ duePrecision: null });
    const current = await db.workResponsibility.findUniqueOrThrow({ where: { deadlineId: date.id } });
    await changeWork({ id: current.id, revision: current.revision, action: "COMPLETE", reason: "合成已处理" });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: date.id } })).toMatchObject({ dueAt, duePrecision: "DATETIME", completed: true });
  });
  it("旧短信生成实际入口显式保存日期或准确时刻，不从原文猜精度", async () => {
    const f = await fixture();
    for (const duePrecision of ["DATE", "DATETIME"] as const) {
      const sms = await db.smsMessage.create({ data: { rawText: "合成通知写17点，仅以本次明确输入为准", parsedJson: {}, receivedById: f.user.id, matchedMatterId: f.matter.id } });
      const result = await generateDeadlineFromSms({ smsId: sms.id, procedureId: f.procedure.id, title: "合成短信期限", category: "CUSTOM", duePrecision,
        dueAt: new Date(duePrecision === "DATE" ? "2027-02-03T00:00:00+08:00" : "2027-02-03T17:00:00+08:00"), remindDays: 3 });
      expect(await db.deadline.findUniqueOrThrow({ where: { id: result.deadlineId } })).toMatchObject({ duePrecision });
      expect((await db.auditLog.findFirstOrThrow({ where: { targetId: result.deadlineId, action: "SMS_GENERATE_DEADLINE" } })).detail).toMatchObject({ duePrecision });
    }
  });
});
