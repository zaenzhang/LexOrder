// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const { db, writable, refresh, retire, auditTx } = vi.hoisted(() => ({
  db: { deadline: { findUnique: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() },
  writable: vi.fn(), refresh: vi.fn(), retire: vi.fn(), auditTx: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "user", role: "LAWYER" } })) }));
vi.mock("@/server/matters/write-access", () => ({ lockWritableMatters: writable }));
vi.mock("@/server/audit", () => ({ auditTx }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ refreshScheduleReminderAfterSave: refresh, retireScheduleReminders: retire }));
import { adjustDeadline, confirmDeadline } from "@/server/deadlines/confirm";
const id = "cidl000000000000000000001";
const updatedAt = new Date("2026-09-19T00:00:00Z");
const input = { id, expectedUpdatedAt: updatedAt };
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async fn => fn(db));
  db.deadline.findUnique.mockResolvedValue({ id, procedure: { matterId: "m1" }, confirmStatus: "PENDING", dueAt: updatedAt, duePrecision: null, updatedAt, sourceRuleId: "rule" });
  db.deadline.updateMany.mockResolvedValue({ count: 1 });
});
it.each(["confirm", "adjust"])("%s 在事务内复核当前经办与归档，拒绝后不改变期限或提醒", async kind => {
  writable.mockRejectedValue(new Error("案件已归档或无权处理"));
  const call = kind === "confirm" ? confirmDeadline(input) : adjustDeadline({ duePrecision: "DATETIME", ...input, dueAt: updatedAt, reason: "送达日期核实" });
  await expect(call).rejects.toThrow("案件已归档或无权处理");
  expect(writable).toHaveBeenCalledWith(db, { id: "user", role: "LAWYER" }, "schedule.write", ["m1"]);
  expect(db.deadline.updateMany).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it.each(["confirm", "adjust"])("%s 拒绝页面所见旧版本，不把请求到达时的新版本当作用户基线", async kind => {
  const call = kind === "confirm" ? confirmDeadline({ ...input, expectedUpdatedAt: new Date(0) }) : adjustDeadline({ duePrecision: "DATETIME", ...input, expectedUpdatedAt: new Date(0), dueAt: updatedAt, reason: "人工核对" });
  await expect(call).rejects.toThrow("期限已被修改");
  expect(db.deadline.updateMany).not.toHaveBeenCalled();
  expect(auditTx).not.toHaveBeenCalled();
});
it("确认竞争失败时不产生审计结果或新提醒", async () => {
  db.deadline.updateMany.mockResolvedValue({ count: 0 });
  await expect(confirmDeadline(input)).rejects.toThrow("其他人处理");
  expect(auditTx).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("改期受所见版本保护，审计使用锁后读出的真实原日期", async () => {
  const dueAt = new Date("2026-09-20T00:00:00+08:00");
  db.deadline.findUnique.mockResolvedValueOnce({ procedure: { matterId: "m1" } });
  await adjustDeadline({ duePrecision: "DATETIME", ...input, dueAt, reason: "送达日期核实" });
  expect(db.deadline.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id, updatedAt }, data: expect.objectContaining({ dueAt, confirmStatus: "ADJUSTED" }) }));
  expect(retire).toHaveBeenCalledWith(db, "Deadline", id);
  expect(auditTx).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DEADLINE_ADJUST", detail: expect.objectContaining({ previousDueAt: updatedAt.toISOString(), newDueAt: dueAt.toISOString(), sourceRuleId: "rule", previousDuePrecision: null, newDuePrecision: "DATETIME" }) }));
  expect(refresh).toHaveBeenCalledWith("Deadline", id);
});
it("期限归属变化不得拿旧案件授权修改当前对象", async () => {
  db.deadline.findUnique.mockResolvedValueOnce({ procedure: { matterId: "old" } });
  await expect(confirmDeadline(input)).rejects.toThrow("归属已变化");
  expect(db.deadline.updateMany).not.toHaveBeenCalled();
});
