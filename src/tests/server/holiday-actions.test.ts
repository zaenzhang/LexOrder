// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, session } = vi.hoisted(() => ({
  db: { holiday: { findMany: vi.fn(), upsert: vi.fn() }, $transaction: vi.fn() },
  session: { user: { id: "admin" } }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session), requireWorkspaceConfiguration: vi.fn() }));
vi.mock("@/lib/auth/system-role", () => ({ isSystemAdmin: vi.fn(() => true) }));
vi.mock("@/lib/runtime/mode", () => ({ isPersonalMode: vi.fn(() => false) }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));

import { listHolidays, saveHolidayBatch } from "@/server/calendar/holiday-actions";

const entry = { date: "2026-07-01", name: "测试安排", kind: "HOLIDAY" as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async fn => fn(db));
  db.holiday.findMany.mockResolvedValue([]);
});

describe("放假安排存取日期", () => {
  it("新安排固定存为上海正午，不跟随服务器时区", async () => {
    await saveHolidayBatch({ entries: [entry] });
    expect(db.holiday.upsert).toHaveBeenCalledWith({
      where: { date: new Date("2026-07-01T04:00:00Z") },
      create: { date: new Date("2026-07-01T04:00:00Z"), name: "测试安排", kind: "HOLIDAY" },
      update: { name: "测试安排", kind: "HOLIDAY" }
    });
  });

  it("已有上海日记录保留实际时间戳，只更新安排，不自动迁移或制造重复", async () => {
    const existingDate = new Date("2026-07-01T12:00:00Z");
    db.holiday.findMany.mockResolvedValue([{ date: existingDate }]);
    await saveHolidayBatch({ entries: [entry] });
    const args = db.holiday.upsert.mock.calls[0][0];
    expect(args.where.date).toEqual(existingDate);
    expect(args.update).toEqual({ name: "测试安排", kind: "HOLIDAY" });
  });

  it("按年读取覆盖上海元旦零点至年末，不漏掉不同正午写入的记录", async () => {
    await listHolidays(2026);
    expect(db.holiday.findMany.mock.calls[0][0].where.date).toEqual({
      gte: new Date("2025-12-31T16:00:00.000Z"),
      lte: new Date("2026-12-31T15:59:59.999Z")
    });
  });

  it("2 月 30 日不能自动滚入 3 月后落库", async () => {
    await expect(saveHolidayBatch({ entries: [{ ...entry, date: "2026-02-30" }] })).rejects.toThrow("日期无效");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.holiday.upsert).not.toHaveBeenCalled();
  });

  it("同一上海日已有重复安排时不猜测应覆盖哪一条", async () => {
    db.holiday.findMany.mockResolvedValue([
      { date: new Date("2026-07-01T04:00:00Z") },
      { date: new Date("2026-07-01T12:00:00Z") }
    ]);
    await expect(saveHolidayBatch({ entries: [entry] })).rejects.toThrow("有重复的放假安排");
    expect(db.holiday.upsert).not.toHaveBeenCalled();
  });
});
