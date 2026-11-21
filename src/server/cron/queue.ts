/**
 * 持久任务队列（P1-1，报告 6.5 / 10.1 的地基）。
 *
 * 数据库实现（无新依赖）：FOR UPDATE SKIP LOCKED 抢占防多实例重复；
 * 租约（leaseUntil）过期即视为宕机遗留，恢复为待执行；失败按指数退避
 * 重试；超过 maxAttempts 进 DEAD（可见可查，绝不静默丢弃）；dedupeKey
 * 唯一兜底，重复投递直接覆盖未执行任务（= 改期取消旧内容）。
 */
import { prisma } from "@/lib/prisma";
import { Prisma, type JobQueue } from "@prisma/client";
import { randomUUID } from "node:crypto";

const personalMaterialJobTypes = ["document.parse", "document.ingest-reconcile"];
export type JobScope = "all" | "personal-materials" | "personal-ai";
function scopedJobTypes(scope: JobScope) {
  if (scope === "personal-materials") return personalMaterialJobTypes;
  if (scope === "personal-ai") return ["skill.signoff", "evidence.observations", "evidence.case-grouping"];
  return null;
}

export interface JobLease { id: string; leaseToken: string }
export class JobLeaseLost extends Error {
  constructor() { super("任务已由另一执行器接手"); this.name = "JobLeaseLost"; }
}

export type QueueJob = Pick<
  JobQueue,
  "id" | "type" | "payload" | "dedupeKey" | "status" | "runAt" | "attempts" | "maxAttempts" | "lastError" | "deliveredAt"
> & { leaseToken: string };

/** 指数退避 + 抖动（纯函数，单测覆盖）：25s · 50s · 100s · … 上限 15 分钟 */
export function backoffMs(attempts: number): number {
  const base = 25_000 * 2 ** Math.max(0, attempts - 1);
  const jitter = Math.floor(Math.random() * 5_000);
  return Math.min(base, 15 * 60_000) + jitter;
}

/**
 * 入队 / 改期。dedupeKey 命中未终结（非 SUCCESS/DEAD）任务时覆盖
 * payload 与 runAt——即"改期取消旧提醒、以新内容生效"；已终结则不再
 * 复活（同键当日已成功投递不重发），死信例外：6 小时后允许新一轮尝试。
 */
export async function enqueueJob(input: {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}): Promise<void> {
  if (!input.dedupeKey) {
    await prisma.jobQueue.create({
      data: {
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5
      }
    });
    return;
  }
  const existing = await prisma.jobQueue.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true, status: true, updatedAt: true }
  });
  // 终结任务不复活：同键再次入队视为重复投递，忽略。
  // 死信例外：6 小时后重置尝试再入队——当日扫描可自愈死信，
  // 毒任务最坏每 6 小时重试一轮（attempts 归零），不会无限循环。
  if (existing?.status === "SUCCESS") return;
  if (existing?.status === "DEAD") {
    if (Date.now() - existing.updatedAt.getTime() < 6 * 60 * 60_000) return;
    await prisma.jobQueue.updateMany({
      where: { id: existing.id, status: "DEAD", updatedAt: existing.updatedAt },
      data: {
        payload: input.payload as Prisma.InputJsonValue,
        runAt: input.runAt ?? new Date(),
        status: "PENDING",
        attempts: 0,
        leaseUntil: null,
        leaseToken: null,
        lastError: null
      }
    });
    return;
  }
  if (existing) {
    await overwritePending(existing.id, existing.status, input);
    return;
  }
  try {
    await prisma.jobQueue.create({
      data: {
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5
      }
    });
  } catch (error) {
    // 并发同键入队撞唯一键（find-then-create 竞态）：按已存在处理，不得炸给扫描调用方
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.jobQueue.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true, status: true }
      });
      if (raced && raced.status !== "SUCCESS" && raced.status !== "DEAD") {
        await overwritePending(raced.id, raced.status, input);
      }
      return;
    }
    throw error;
  }
}

async function overwritePending(id: string, status: string, input: {
  payload: Record<string, unknown>;
  runAt?: Date;
}): Promise<void> {
  // 未终结 → 覆盖内容与执行时间（= 改期取消旧内容、以新内容生效）。
  // RUNNING 例外：旧内容可能正在投递，直接改 payload 后旧执行完成会把任务落成 SUCCESS，
  // 新内容永不投递；因此 RUNNING 时改写为 FAILED（可被重新领取），完成判定也只认 RUNNING。
  // The status read above may already be stale. This conditional update also
  // revokes any intervening claim before replacing its payload.
  await prisma.jobQueue.updateMany({
    where: { id, status: { in: ["PENDING", "FAILED", "RUNNING"] } },
    data: {
      payload: input.payload as Prisma.InputJsonValue,
      runAt: input.runAt ?? new Date(), status: "PENDING", leaseUntil: null,
      leaseToken: null, lastError: status === "RUNNING" ? "内容已更新，等待重跑" : null
    }
  });
}

/** 崩溃恢复：租约过期的 RUNNING 任务重新入队（attempts 不变——它没被执行完） */
export async function recoverStaleLeases(scope: JobScope = "all"): Promise<number> {
  const types = scopedJobTypes(scope);
  const res = await prisma.jobQueue.updateMany({
    where: { status: "RUNNING", ...(types ? { type: { in: types } } : {}),
      OR: [{ leaseUntil: { lt: new Date() } }, { leaseUntil: null }, { leaseToken: null }] },
    data: { status: "PENDING", leaseUntil: null, leaseToken: null }
  });
  return res.count;
}

/** 抢占一批到期任务（FOR UPDATE SKIP LOCKED，多实例安全；每批 ≤ limit 条）。
 *  attempts 不在抢占时递增：执行前反复崩溃不应烧尽重试次数（未执行过一次即
 *  DEAD 是误杀），失败计数统一由 failJob 在真实失败时原子递增。 */
// Prisma DateTime columns are timestamp without time zone and contain UTC.
// Keep raw queue timestamps in UTC even when the PostgreSQL session is not UTC.
export async function claimDueJobs(limit = 10, scope: JobScope = "all"): Promise<QueueJob[]> {
  const take = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 10));
  const token = randomUUID();
  const types = scopedJobTypes(scope);
  const rows = await prisma.$queryRaw<QueueJob[]>(Prisma.sql`
    UPDATE "JobQueue" SET
      "status" = 'RUNNING',
      "leaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '5 minutes',
      "leaseToken" = ${token},
      "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "JobQueue"
      WHERE "status" IN ('PENDING', 'FAILED') AND "runAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ${types ? Prisma.sql`AND "type" IN (${Prisma.join(types)})` : Prisma.empty}
      ORDER BY "runAt" ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `);
  return rows;
}

export async function assertCurrentJobLease(tx: Prisma.TransactionClient, lease: JobLease): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "JobQueue" WHERE "id" = ${lease.id}
      AND "status" = 'RUNNING' AND "leaseToken" = ${lease.leaseToken}
      AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE`);
  if (rows.length !== 1) throw new JobLeaseLost();
}

export async function renewJobLease(lease: JobLease): Promise<boolean> {
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "JobQueue" SET "leaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '5 minutes', "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE "id" = ${lease.id} AND "status" = 'RUNNING'
      AND "leaseToken" = ${lease.leaseToken} AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`);
  return count === 1;
}

export async function completeJob(lease: JobLease): Promise<boolean> {
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "JobQueue" SET "status" = 'SUCCESS', "deliveredAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "leaseUntil" = NULL, "leaseToken" = NULL, "lastError" = NULL, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE "id" = ${lease.id} AND "status" = 'RUNNING'
      AND "leaseToken" = ${lease.leaseToken} AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`);
  return count === 1;
}

/** 失败处理：仅当仍处 RUNNING 才计数并转移（迟到的旧执行器不得误标已被
 *  覆盖重排的新内容）；真实失败时原子递增 attempts——未超上限 → FAILED +
 *  退避 runAt；超上限 → DEAD（终态，留 lastError）。 */
export async function failJob(lease: JobLease, _maxAttempts: number, error: string): Promise<"RETRY" | "DEAD" | "LEASE_LOST"> {
  const message = error.slice(0, 300);
  // Increment and state transition are a single CAS; a late failing worker
  // cannot overwrite a newly claimed attempt between two UPDATE statements.
  const rows = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`
    UPDATE "JobQueue" SET "attempts" = "attempts" + 1, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "status" = CASE WHEN "attempts" + 1 >= "maxAttempts" THEN 'DEAD'::"JobStatus" ELSE 'FAILED'::"JobStatus" END,
      "runAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + (LEAST(25000 * power(2, LEAST("attempts", 16)), 900000) + floor(random() * 5000)) * INTERVAL '1 millisecond',
      "leaseUntil" = NULL, "leaseToken" = NULL, "lastError" = ${message}
    WHERE "id" = ${lease.id} AND "status" = 'RUNNING'
      AND "leaseToken" = ${lease.leaseToken} AND "leaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    RETURNING "status"`);
  if (!rows.length) return "LEASE_LOST";
  return rows[0].status === "DEAD" ? "DEAD" : "RETRY";
}

/** 死信可见（管理端展示；不自动清理，人工处置后可删除或重跑） */
export async function listDeadJobs(take = 10) {
  return prisma.jobQueue.findMany({
    where: { status: "DEAD" },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, type: true, dedupeKey: true, attempts: true, lastError: true, updatedAt: true }
  });
}
