// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const storageFixture = vi.hoisted(() => ({ directory: "", files: new Set<string>(), beforeRead: undefined as (() => Promise<void>) | undefined }));
// The coordinator supplies a migrated, disposable database explicitly. No deployment env files are read.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("材料集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/storage", async () => {
  const { readFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  return { storage: { readFile: async (relPath: string) => {
    if (!storageFixture.files.has(relPath)) throw new Error("Only this test's synthetic originals may be read");
    const bytes = await readFile(nodePath.join(storageFixture.directory, relPath));
    await storageFixture.beforeRead?.();
    return bytes;
  } } };
});

import { prisma as db } from "@/lib/prisma";
import { completeJob } from "@/server/cron/queue";
import { cancelMaterialProcessing, enqueueMaterialProcessing, processMaterialJob, readMaterialSource } from "@/server/documents/material-processing";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成材料经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成材料事项", internalCode: `MATERIAL-TEST-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  const bytes = Buffer.from("合成材料：合同金额 120000 元，验收异议尚未解决。", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `${randomUUID()}.txt`;
  await writeFile(path.join(storageFixture.directory, file), bytes, { flag: "wx" });
  storageFixture.files.add(file);
  const doc = await db.document.create({ data: { name: "合成材料.txt", matterId: matter.id, uploadedById: user.id,
    path: file, mimeType: "text/plain", sha256, size: bytes.length, tags: [] } });
  documentIds.push(doc.id);
  return { user, matter, doc };
}
async function enqueue(f: Awaited<ReturnType<typeof fixture>>, expectedGeneration = 0) {
  return db.$transaction(tx => enqueueMaterialProcessing(tx, { documentId: f.doc.id, requestedById: f.user.id, expectedGeneration }));
}
async function claim(runId: string) {
  const leaseToken = randomUUID();
  const job = await db.jobQueue.update({ where: { dedupeKey: `document.parse:${runId}` },
    data: { status: "RUNNING", leaseToken, leaseUntil: new Date(Date.now() + 300_000) } });
  return { id: job.id, leaseToken };
}
function pauseRead() {
  let read!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { read = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  storageFixture.beforeRead = async () => { read(); await gate; };
  return { entered, release: () => { storageFixture.beforeRead = undefined; release(); } };
}
async function awaitOriginalRead(gate: ReturnType<typeof pauseRead>, executing: Promise<void>) {
  await Promise.race([gate.entered, executing.then(() => { throw new Error("任务未读取合成原件便已结束"); })]);
}

describe.skipIf(!databaseUrl)("Server 材料：真实 PG 事务、代次与原件读取", () => {
  beforeAll(async () => {
    await db.$connect();
    storageFixture.directory = await mkdtemp(path.join(tmpdir(), "lexorder-material-m2-"));
  });
  afterAll(async () => {
    storageFixture.beforeRead = undefined;
    // Keep protected audit/history rows; retire only the fixtures created by this file.
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date(), textContent: null } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.$disconnect();
    if (storageFixture.directory) await rm(storageFixture.directory, { recursive: true, force: true });
  });

  it("任务意图与代次随事务一起回滚，并发相同重试只创建一份", async () => {
    const f = await fixture();
    let rolledBackRun = "";
    await expect(db.$transaction(async (tx: Prisma.TransactionClient) => {
      rolledBackRun = (await enqueueMaterialProcessing(tx, { documentId: f.doc.id, requestedById: f.user.id, expectedGeneration: 0 })).runId;
      throw new Error("controlled rollback");
    })).rejects.toThrow("controlled rollback");
    expect((await db.document.findUniqueOrThrow({ where: { id: f.doc.id } })).parseGeneration).toBe(0);
    expect(await db.documentParseRun.count({ where: { documentId: f.doc.id } })).toBe(0);
    expect(await db.jobQueue.count({ where: { dedupeKey: `document.parse:${rolledBackRun}` } })).toBe(0);
    const attempts = await Promise.allSettled([enqueue(f), enqueue(f)]);
    expect(attempts.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(await db.documentParseRun.count({ where: { documentId: f.doc.id } })).toBe(1);
    const run = await db.documentParseRun.findFirstOrThrow({ where: { documentId: f.doc.id } });
    expect(await db.jobQueue.count({ where: { dedupeKey: `document.parse:${run.id}` } })).toBe(1);
    const lease = await claim(run.id);
    await processMaterialJob({ runId: run.id }, lease);
    await completeJob(lease);
  });

  it("真实解析发布不可变来源，新代次仍可回查旧 anchor", async () => {
    const f = await fixture();
    const first = await enqueue(f), lease = await claim(first.runId);
    await processMaterialJob({ runId: first.runId }, lease);
    await completeJob(lease);
    const saved = await db.documentParseRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(saved.state).toBe("READY");
    const anchor = (saved.anchors as { anchorId: string }[])[0];
    const second = await enqueue(f, 1);
    const result = await readMaterialSource(f.user.id, { documentId: f.doc.id, runId: first.runId, anchorId: anchor.anchorId });
    expect(result).toMatchObject({ status: "AVAILABLE", run: { id: first.runId, isCurrent: false }, anchor: { text: "合成材料：合同金额 120000 元，验收异议尚未解决。" } });
    await expect(db.documentParseRun.update({ where: { id: first.runId }, data: { anchors: [] } })).rejects.toThrow();
    const nextLease = await claim(second.runId);
    await processMaterialJob({ runId: second.runId }, nextLease);
    await completeJob(nextLease);
  });

  it("原件读取期间撤回，迟到解析不发布正文", async () => {
    const f = await fixture(), run = await enqueue(f), lease = await claim(run.runId), gate = pauseRead();
    const executing = processMaterialJob({ runId: run.runId }, lease);
    try {
      await awaitOriginalRead(gate, executing);
      await db.$transaction(async tx => {
        await tx.document.update({ where: { id: f.doc.id }, data: { deletedAt: new Date() } });
        await cancelMaterialProcessing(tx, { documentId: f.doc.id });
      });
    } finally { gate.release(); }
    await executing;
    expect((await db.documentParseRun.findUniqueOrThrow({ where: { id: run.runId } })).state).toBe("CANCELLED");
    expect((await db.document.findUniqueOrThrow({ where: { id: f.doc.id } })).textContent).toBeNull();
    await completeJob(lease);
  });

  it("领取 token 被替换后旧 worker 不得发布，新领取可继续同代次", async () => {
    const f = await fixture(), run = await enqueue(f), oldLease = await claim(run.runId), gate = pauseRead();
    const executing = processMaterialJob({ runId: run.runId }, oldLease);
    let newLease = oldLease;
    try { await awaitOriginalRead(gate, executing); newLease = await claim(run.runId); }
    finally { gate.release(); }
    await expect(executing).rejects.toThrow("另一执行器");
    expect((await db.documentParseRun.findUniqueOrThrow({ where: { id: run.runId } })).anchors).toBeNull();
    await processMaterialJob({ runId: run.runId }, newLease);
    expect((await db.document.findUniqueOrThrow({ where: { id: f.doc.id } })).textContent).toContain("120000");
    await completeJob(newLease);
  });

  it("处理期间账号停用，结果不能借原请求者资格发布", async () => {
    const f = await fixture(), run = await enqueue(f), lease = await claim(run.runId), gate = pauseRead();
    const executing = processMaterialJob({ runId: run.runId }, lease);
    try { await awaitOriginalRead(gate, executing); await db.user.update({ where: { id: f.user.id }, data: { active: false } }); }
    finally { gate.release(); }
    await executing;
    expect(await db.documentParseRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ state: "CANCELLED", errorCode: "PROCESSING_REVOKED", anchors: null });
    expect((await db.document.findUniqueOrThrow({ where: { id: f.doc.id } })).textContent).toBeNull();
    await completeJob(lease);
  });
});
