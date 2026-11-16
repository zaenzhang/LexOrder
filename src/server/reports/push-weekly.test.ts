import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([{ id: "user-1", name: "测试用户" }]),
  findFirst: vi.fn().mockResolvedValue({ id: "existing-notification" }),
  createMany: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined),
  weekPeriod: vi.fn(() => ({ label: "2026-07-27 ~ 2026-08-02", start: new Date(), end: new Date() })),
  getLawyerWeeklyDigest: vi.fn(),
  formatWeeklyDigestContent: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: mocks.findMany }, notification: { findFirst: mocks.findFirst, createMany: mocks.createMany } }
}));
vi.mock("@/server/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("./weekly", () => ({
  weekPeriod: mocks.weekPeriod,
  getLawyerWeeklyDigest: mocks.getLawyerWeeklyDigest,
  formatWeeklyDigestContent: mocks.formatWeeklyDigestContent
}));

import { runWeeklyReportPush } from "./weekly-push-core";

describe("weekly report push idempotency", () => {
  beforeEach(() => {
    mocks.findMany.mockClear();
    mocks.findFirst.mockReset();
    mocks.createMany.mockReset();
    mocks.getLawyerWeeklyDigest.mockReset();
    mocks.formatWeeklyDigestContent.mockReset();
    mocks.audit.mockClear();
  });

  it("does not create a second notification for the same user and week", async () => {
    mocks.findFirst.mockResolvedValue({ id: "existing-notification" });
    const result = await runWeeklyReportPush(null);

    expect(result).toMatchObject({ succeeded: 1, failed: [], weekLabel: "2026-07-27 ~ 2026-08-02" });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.getLawyerWeeklyDigest).not.toHaveBeenCalled();
  });

  it("concurrent manual and scheduled sends use the same database unique key", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.getLawyerWeeklyDigest.mockResolvedValue({});
    mocks.formatWeeklyDigestContent.mockReturnValue("摘要");
    await Promise.all([runWeeklyReportPush("manual-user"), runWeeklyReportPush(null)]);
    expect(mocks.createMany).toHaveBeenCalledTimes(2);
    const calls = mocks.createMany.mock.calls;
    expect(calls[0][0].data[0].id).toBe(calls[1][0].data[0].id);
    expect(calls.every(call => call[0].skipDuplicates)).toBe(true);
  });

  it("creates a notification when the weekly marker is absent", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.getLawyerWeeklyDigest.mockResolvedValue({
      userId: "user-1",
      userName: "测试用户",
      period: mocks.weekPeriod(),
      newIntake: 1,
      closed: 2,
      archived: 3,
      receivedAmount: 4
    });
    mocks.formatWeeklyDigestContent.mockReturnValue("摘要");
    mocks.createMany.mockResolvedValue({ count: 1 });

    const result = await runWeeklyReportPush(null);

    expect(result).toMatchObject({ succeeded: 1, failed: [] });
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [expect.objectContaining({
          id: expect.stringMatching(/^weekly_[a-f0-9]{64}$/),
          userId: "user-1", refType: "WeeklyReport", refId: "2026-07-27 ~ 2026-08-02"
        })]
      })
    );
  });
});
