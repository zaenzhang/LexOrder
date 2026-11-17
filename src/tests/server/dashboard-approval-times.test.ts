// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ approvals: vi.fn(), readTasks: vi.fn(), tx: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (db: object) => Promise<unknown>) => fn(mock.tx) } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: { id: "reviewer", role: "LAWYER" } }) }));
vi.mock("@/lib/permissions", () => ({ matterReadVisibilityFilter: () => ({ ownerId: "reviewer" }), customMatterFilter: vi.fn(), matterFinanceVisibilityFilter: vi.fn(), intakeReadVisibilityFilter: vi.fn() }));
vi.mock("@/server/approval-permissions/inbox", () => ({ listApprovalWorkspace: mock.approvals }));
vi.mock("@/server/clients/follow-up-queue", () => ({ personalFollowUpsInTransaction: async () => ({ available: true, items: [], total: 0, page: 1, pageSize: 5, filter: "all" as const, observedAt: "2026-11-17T10:00:00.000Z" }) }));
vi.mock("@/server/tasks/workflow-service", () => ({ readPersonalTaskProgressTx: mock.readTasks }));
vi.mock("@/server/reminders/responsibility", () => ({ closedHearingIds: vi.fn() }));
vi.mock("@/server/finance/facts", () => ({ getFinanceFacts: vi.fn(), periodReceipts: vi.fn(), sumAmounts: vi.fn(), shMonthStart: vi.fn(), financeTrend: vi.fn() }));

import { getDashboardWorkQueue } from "@/server/dashboard/actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
  mock.readTasks.mockResolvedValue({ available: true, tasks: [], total: 0 });
});
afterEach(() => { vi.useRealTimers(); });

describe("工作台审批等待摘要", () => {
  it("沿用审批工作台的真实提交时间，未知时间保留null而不是今日或从1970年等待", async () => {
    const row = { action: "INTAKE_APPROVE", title: "合成申请", requester: "合成申请人", matter: "合成案件", task: "approve" };
    mock.approvals.mockResolvedValue({ rows: [
      { ...row, id: "old", submittedAt: new Date("2026-11-15T10:00:00Z") },
      { ...row, id: "today", submittedAt: new Date("2026-11-17T09:00:00Z") },
      { ...row, id: "unknown", submittedAt: null },
    ], counts: { pending: 3 } });
    const queue = await getDashboardWorkQueue();
    expect(queue.approvals.map(({ id, waitDays }) => ({ id, waitDays }))).toEqual([
      { id: "old", waitDays: 2 }, { id: "today", waitDays: 0 }, { id: "unknown", waitDays: null },
    ]);
    expect(queue.approvalTotal).toBe(3);
    expect(mock.approvals).toHaveBeenCalledWith({ tab: "pending" });
    expect(mock.readTasks).toHaveBeenCalledWith(mock.tx, "reviewer", new Date("2026-11-17T10:00:00Z"));
    expect(queue.tasksAvailable).toBe(true);
  });

  it("G02 当前任务资格不可用时独立审批仍保留，不把未知任务数当空待办", async () => {
    mock.readTasks.mockResolvedValue({ available: false, tasks: [], total: 0 });
    mock.approvals.mockResolvedValue({ rows: [{ id: "approval", action: "INTAKE_APPROVE", title: "独立审批", requester: "申请人", matter: null, task: "approve", submittedAt: null }], counts: { pending: 1 } });
    const queue = await getDashboardWorkQueue();
    expect(queue).toMatchObject({ tasksAvailable: false, tasks: [], approvalTotal: 1, approvals: [{ id: "approval", waitDays: null }] });
  });
});
