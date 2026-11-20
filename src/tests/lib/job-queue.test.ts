// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { assertCurrentJobLease, backoffMs, claimDueJobs, completeJob, failJob, renewJobLease } from "@/server/cron/queue";

describe("任务队列退避计算（P1-1）", () => {
  it("指数递增且带上限：第 1 次约 25s，第 5 次封顶 15 分钟", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(25_000);
    expect(backoffMs(1)).toBeLessThan(25_000 + 5_000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(100_000);
    expect(backoffMs(10)).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });
});

/* enqueue 语义（终结任务不复活 / 未终结覆盖 / 新建） */
const { db } = vi.hoisted(() => {
  const mk = () => ({ findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { db: { jobQueue: mk(), $queryRaw: vi.fn(), $executeRaw: vi.fn() } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { enqueueJob } from "@/server/cron/queue";

beforeEach(() => {
  vi.resetAllMocks();
  db.jobQueue.updateMany.mockResolvedValue({ count: 1 });
});

describe("enqueueJob 幂等语义", () => {
  it("同键 SUCCESS 任务：忽略（不复活）", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j1", status: "SUCCESS" });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.updateMany).not.toHaveBeenCalled();
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键 DEAD 任务 6 小时内：忽略", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j9", status: "DEAD", updatedAt: new Date(Date.now() - 60 * 60_000) });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.updateMany).not.toHaveBeenCalled();
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键 DEAD 任务超过 6 小时：重置尝试再入队（死信自愈）", async () => {
    const updatedAt = new Date(Date.now() - 7 * 60 * 60_000);
    db.jobQueue.findUnique.mockResolvedValue({ id: "j10", status: "DEAD", updatedAt });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.updateMany).toHaveBeenCalledWith({
      where: { id: "j10", status: "DEAD", updatedAt },
      data: expect.objectContaining({ status: "PENDING", attempts: 0, leaseToken: null, leaseUntil: null })
    });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键未终结任务：覆盖 payload 与 runAt（= 改期取消旧内容）", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j2", status: "PENDING" });
    const runAt = new Date("2026-09-14T09:00:00+08:00");
    await enqueueJob({ type: "t", payload: { b: 2 }, dedupeKey: "k", runAt });
    expect(db.jobQueue.updateMany).toHaveBeenCalledWith({
      where: { id: "j2", status: { in: ["PENDING", "FAILED", "RUNNING"] } },
      data: expect.objectContaining({ runAt, payload: { b: 2 }, status: "PENDING", leaseToken: null, leaseUntil: null })
    });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("无同键任务：新建", async () => {
    db.jobQueue.findUnique.mockResolvedValue(null);
    await enqueueJob({ type: "t", payload: {}, dedupeKey: "k2" });
    expect(db.jobQueue.create).toHaveBeenCalled();
  });

  it("覆盖前已完成的任务不会被陈旧状态读取复活", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j-race", status: "RUNNING" });
    // PostgreSQL reports no match after the competing completion commits.
    db.jobQueue.updateMany.mockResolvedValue({ count: 0 });
    await enqueueJob({ type: "t", payload: { changed: true }, dedupeKey: "k" });
    const write = db.jobQueue.updateMany.mock.calls[0][0];
    expect(write.where.status.in).toEqual(["PENDING", "FAILED", "RUNNING"]);
    expect(write.where.status.in).not.toContain("SUCCESS");
    expect(write.data).toMatchObject({ leaseToken: null, leaseUntil: null });
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("并发撞唯一键后读到 SUCCESS，忽略而不覆盖成功记录", async () => {
    db.jobQueue.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "j-race", status: "SUCCESS" });
    db.jobQueue.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic duplicate", { code: "P2002", clientVersion: "test" }));
    await expect(enqueueJob({ type: "t", payload: {}, dedupeKey: "k-race" })).resolves.toBeUndefined();
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.updateMany).not.toHaveBeenCalled();
  });
});

describe("队列租约围栏", () => {
  const lease = { id: "j-lease", leaseToken: "attempt-one" };
  function expectCurrentLease(query: Prisma.Sql) {
    expect(query.values).toEqual(expect.arrayContaining([lease.id, lease.leaseToken]));
    expect(query.text).toMatch(/WHERE "id" = \$\d+/);
    expect(query.text).toContain('"status" = \'RUNNING\'');
    expect(query.text).toMatch(/"leaseToken" = \$\d+/);
    expect(query.text).toContain('"leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
  }

  it("领取使用数据库 UTC 时钟，并产生此次领取令牌", async () => {
    db.$queryRaw.mockResolvedValue([]);
    await claimDueJobs(1000);
    const query = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).toContain('"runAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
    expect(query.text).toContain('"leaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
    expect(query.text).toMatch(/"leaseToken" = \$\d+/);
    expect(query.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.values).toEqual([expect.stringMatching(/^[a-f0-9-]{36}$/), 50]);
  });

  it("个人材料领取只选本地解析与入卷对账", async () => {
    db.$queryRaw.mockResolvedValue([]);
    await claimDueJobs(1, "personal-materials");
    const query = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).toMatch(/AND "type" IN/);
    expect(query.values.slice(1)).toEqual(["document.parse", "document.ingest-reconcile", 1]);
  });

  it("续租、完成、失败及发布守卫都必须匹配 token 与尚未到期的时间", async () => {
    db.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await renewJobLease(lease)).toBe(true);
    expect(await completeJob(lease)).toBe(false);
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await failJob(lease, 3, "synthetic late failure")).toBe("LEASE_LOST");
    await expect(assertCurrentJobLease(db as unknown as Prisma.TransactionClient, lease)).rejects.toThrow("另一执行器");
    for (const [query] of [...db.$executeRaw.mock.calls, ...db.$queryRaw.mock.calls]) expectCurrentLease(query);
    expect(db.jobQueue.update).not.toHaveBeenCalled();
  });
});
