// @vitest-environment node
/**
 * 期限服务端重算（第六轮体检 P2-1）：addDeadline 携带 sourceRuleId + sourceTriggerDate 时，
 * 服务端按规则以上海日历口径重算并与提交 dueAt 比对——一致不干预；不一致不拒绝
 * （表单允许人工调整）但在 basis 追加「重算为 X，请核对」提示，确认律师核对时可见。
 */
import { beforeEach, expect, it, vi } from "vitest";

const { db, session } = vi.hoisted(() => ({
  db: {
    matterProcedure: { findUnique: vi.fn() },
    deadlineRule: { findUnique: vi.fn() },
    deadline: { create: vi.fn() },
    holiday: { findMany: vi.fn() },
    timelineEvent: { create: vi.fn() },
    reminderDelivery: { createMany: vi.fn(), updateMany: vi.fn() },
    notification: { createMany: vi.fn() },
    deadline_: {}
  },
  session: { user: { id: "clawyer0000000000000000001", role: "LAWYER" } }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/lib/roles/service", () => ({
  roleMutation: vi.fn(async (_u: unknown, _p: string, fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  checkRoleMutation: vi.fn()
}));
vi.mock("@/lib/permissions", () => ({ assertCanHandleMatter: vi.fn(), assertCanLeadMatter: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn() }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({
  refreshScheduleReminderAfterSave: vi.fn(),
  retireScheduleReminders: vi.fn()
}));

import { addDeadline } from "@/server/procedures/actions";

const RULE_ID = "crule0000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  db.matterProcedure.findUnique.mockResolvedValue({ matterId: "cmatter00000000000000000001" });
  db.deadlineRule.findUnique.mockResolvedValue({ name: "民事上诉期（不服一审判决）", periodValue: 15, periodUnit: "DAYS" });
  db.deadline.create.mockResolvedValue({ id: "created-deadline" });
  db.holiday.findMany.mockResolvedValue([{ date: new Date("2026-01-01T04:00:00Z"), name: "元旦", kind: "HOLIDAY" }]);
});

// zod 输入侧接受日期字符串/空串，输出侧为 Date——测试按输入侧构造，类型放宽
const input = (overrides: Record<string, unknown> = {}): any => ({
  procedureId: "cproc00000000000000000001",
  title: "上诉期限",
  category: "APPEAL",
  dueAt: "2026-07-16",
  duePrecision: "DATE",
  basis: "《民事诉讼法》第一百七十一条；自判决书送达之日（2026-07-01）起 15 日",
  remindDays: 7,
  sourceRuleId: RULE_ID,
  sourceTriggerDate: "2026-07-01",
  ...overrides
});

it("重算一致：basis 原样落库，confirmStatus PENDING", async () => {
  const result = await addDeadline(input());
  expect(result).toEqual({ ok: true, id: "created-deadline" });
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.basis).not.toContain("重算");
  expect(created.confirmStatus).toBe("PENDING");
  expect(created.duePrecision).toBe("DATE");
  expect(created.sourceRuleId).toBe(RULE_ID);
});

it("重算不一致：不拒绝，basis 追加「重算为 X 请核对」提示", async () => {
  await addDeadline(input({ dueAt: "2026-07-20" })); // 律师人工调整为 20 日届满
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.dueAt).toEqual(new Date("2026-07-20T00:00:00+08:00")); // 提交值保留
  expect(created.basis).toContain("重算为 2026-07-16");
  expect(created.basis).toContain("2026-07-20");
  expect(created.basis).toContain("请核对");
});

it("跨时区安全：起算日以上海日历取日（UTC 深夜时刻不偏一天）", async () => {
  // 2026-07-01T20:00Z = 上海 2026-07-02 04:00 —— sourceTriggerDate 的上海日为 07-02
  await addDeadline(input({ sourceTriggerDate: new Date("2026-07-01T20:00:00Z"), dueAt: "2026-07-17" }));
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.basis).not.toContain("重算"); // 07-02 + 15 = 07-17 一致
});

it("无 sourceTriggerDate（旧客户端/人工）：不触发重算，规则查找不发起", async () => {
  await addDeadline(input({ sourceTriggerDate: "" }));
  expect(db.deadlineRule.findUnique).not.toHaveBeenCalled();
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.basis).not.toContain("重算");
});

it("人工录入（无 sourceRuleId）：confirmStatus CONFIRMED，不做规则重算", async () => {
  await addDeadline(input({ sourceRuleId: "", sourceTriggerDate: "" }));
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.confirmStatus).toBe("CONFIRMED");
  expect(db.deadlineRule.findUnique).not.toHaveBeenCalled();
});

it("日历查询失败时规则核对中止，未创建期限", async () => {
  db.holiday.findMany.mockRejectedValue({ code: "P2021" });
  await expect(addDeadline(input())).rejects.toThrow("放假安排暂时无法读取");
  expect(db.deadline.create).not.toHaveBeenCalled();
});

it("年度未录入时保留人工日期并写明未核对，不能看似已完成顺延", async () => {
  db.holiday.findMany.mockResolvedValue([]);
  await addDeadline(input({ dueAt: "2026-07-20", basis: "依据".repeat(100) }));
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.dueAt).toEqual(new Date("2026-07-20T00:00:00+08:00"));
  expect(created.confirmStatus).toBe("PENDING");
  expect(created.duePrecision).toBe("DATE");
  expect(created.basis).toContain("2026 年放假安排未录入");
  expect(created.basis).toContain("未完成休假日顺延核对");
  expect(created.basis).toContain("保留提交日期 2026-07-20");
  expect(created.basis.length).toBeLessThanOrEqual(300);
});

it("日历故障不阻断已由人工核对的普通期限录入", async () => {
  db.holiday.findMany.mockRejectedValue(new Error("calendar unavailable"));
  await addDeadline(input({ sourceRuleId: "", sourceTriggerDate: "", dueAt: "2026-07-20" }));
  expect(db.holiday.findMany).not.toHaveBeenCalled();
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.dueAt).toEqual(new Date("2026-07-20T00:00:00+08:00"));
  expect(created.confirmStatus).toBe("CONFIRMED");
});

it("放假安排的建议不覆盖律师调整日期", async () => {
  db.holiday.findMany.mockResolvedValue([{ date: new Date("2026-07-16T04:00:00Z"), name: "测试安排", kind: "HOLIDAY" }]);
  await addDeadline(input({ dueAt: "2026-07-20" }));
  const created = db.deadline.create.mock.calls[0][0].data;
  expect(created.dueAt).toEqual(new Date("2026-07-20T00:00:00+08:00"));
  expect(created.basis).toContain("建议按放假安排顺延至 2026-07-17");
  expect(created.confirmStatus).toBe("PENDING");
  expect(created.duePrecision).toBe("DATE");
});
