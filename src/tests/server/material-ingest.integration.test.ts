// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";

const syntheticStorage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(), write: vi.fn(), read: vi.fn(), remove: vi.fn(),
  afterWrite: undefined as ((key: string) => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
}));
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("摄入集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: {
  writeFileAt: syntheticStorage.write, readFile: syntheticStorage.read, deleteFile: syntheticStorage.remove,
} }));

import { prisma as db } from "@/lib/prisma";
import { completeJob } from "@/server/cron/queue";
import { intakeState } from "@/server/intakes/workflow";
import { ingestMaterial, resumeMaterialIngest, withdrawMaterial, type MaterialDocumentInput } from "@/server/documents/material-ingest";

const userIds: string[] = [], matterIds: string[] = [], roleIds: string[] = [], intentIds: string[] = [];
async function fixture(role: UserRole = "LAWYER") {
  const user = await db.user.create({ data: { name: "合成摄入经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成摄入事项", internalCode: `INGEST-TEST-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  const bytes = Buffer.from("合成原件：交付与验收分别核对，合同金额 120000 元。", "utf8");
  // One original fingerprint per fixture; recovery uses the production contract.
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const document: MaterialDocumentInput = { name: "合成摄入.txt", matterId: matter.id, category: "EVIDENCE",
    mimeType: "text/plain", size: bytes.length, sha256, encrypted: false, uploadedById: user.id, tags: ["合成验收"] };
  return { user, matter, bytes, document };
}
function request(f: Awaited<ReturnType<typeof fixture>>, document = f.document) {
  const requestKey = randomUUID();
  intentIds.push(requestKey);
  return { userId: f.user.id, document, bytes: f.bytes, requestKey };
}
async function claimIntent(intentId: string) {
  const leaseToken = randomUUID();
  const job = await db.jobQueue.update({ where: { dedupeKey: `document.ingest:${intentId}` },
    data: { status: "RUNNING", leaseToken, leaseUntil: new Date(Date.now() + 300_000) } });
  return { id: job.id, leaseToken };
}

beforeEach(() => {
  vi.restoreAllMocks();
  syntheticStorage.afterWrite = undefined; syntheticStorage.beforeRead = undefined;
  syntheticStorage.write.mockReset().mockImplementation(async (key: string, bytes: Buffer) => {
    if (syntheticStorage.objects.has(key)) throw new Error("synthetic object already exists");
    syntheticStorage.objects.set(key, Buffer.from(bytes));
    await syntheticStorage.afterWrite?.(key);
  });
  syntheticStorage.read.mockReset().mockImplementation(async (key: string) => {
    await syntheticStorage.beforeRead?.();
    const bytes = syntheticStorage.objects.get(key);
    if (!bytes) throw new Error("synthetic object missing");
    return Buffer.from(bytes);
  });
  syntheticStorage.remove.mockReset().mockImplementation(async (key: string) => { syntheticStorage.objects.delete(key); });
});

describe.skipIf(!databaseUrl)("Server 原件摄入：真实 PG 恢复与幂等守卫", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    const docs = await db.document.findMany({ where: { uploadedById: { in: userIds } }, select: { id: true } });
    const ids = docs.map(doc => doc.id);
    const runs = await db.documentParseRun.findMany({ where: { documentId: { in: ids } }, select: { id: true } });
    // Disarm this file's jobs without pretending their parsers or cleanup workers ran.
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: [
      ...intentIds.map(id => `document.ingest:${id}`), ...runs.map(run => `document.parse:${run.id}`),
    ] }, status: { not: "SUCCESS" } }, data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "合成摄入场景已结束" } });
    // Retain immutable history/audit fixtures; retire only objects owned by this file.
    await db.document.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), textContent: null } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
    syntheticStorage.objects.clear();
  });

  it("恢复先完成时迟到写回执不能重开 COMMITTED，同键重放返回原材料而异载被拒", async () => {
    const f = await fixture(), input = request(f);
    let recoveredId = "";
    syntheticStorage.afterWrite = async () => {
      // Simulate a slow storage acknowledgement after the object is already readable.
      // Advance only the application's 2-minute pending-age check; PG transactions stay real.
      const intent = await db.materialIngestIntent.findUniqueOrThrow({ where: { id: input.requestKey } });
      const clock = vi.spyOn(Date, "now").mockReturnValue(Math.max(Date.now(), intent.createdAt.getTime()) + 121_000);
      try { recoveredId = (await resumeMaterialIngest(input.requestKey, f.user.id)).id; }
      finally { clock.mockRestore(); }
    };
    const first = await ingestMaterial(input);
    expect(first.id).toBe(recoveredId);
    expect(await ingestMaterial(input)).toEqual(first);
    await expect(ingestMaterial({ ...input, document: { ...input.document, sourceParty: "另一材料来源方" } })).rejects.toThrow("其他内容");
    const intent = await db.materialIngestIntent.findUniqueOrThrow({ where: { id: input.requestKey } });
    expect(intent).toMatchObject({ state: "COMMITTED", documentId: first.id });
    expect(await db.document.count({ where: { path: intent.storagePath } })).toBe(1);
    expect(syntheticStorage.write).toHaveBeenCalledTimes(1);
    await expect(db.materialIngestIntent.update({ where: { id: input.requestKey }, data: { state: "STORED" } })).rejects.toThrow("Committed material upload cannot be reopened");
  });

  it("原件保存后最终审计写入失败，材料/解析任务回滚；恢复只建立一份", async () => {
    const f = await fixture(), input = request(f);
    const constraint = `ingest_test_${randomUUID().replaceAll("-", "")}`;
    // This temporary check targets only this synthetic request. Failure happens after
    // Document + parse intent creation, proving the production transaction rolls back.
    await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "${constraint}" CHECK (
      action <> 'DOCUMENT_UPLOAD' OR (detail->>'intentId') IS DISTINCT FROM '${input.requestKey}'
    ) NOT VALID`);
    try {
      await expect(ingestMaterial(input)).rejects.toThrow();
      const saved = await db.materialIngestIntent.findUniqueOrThrow({ where: { id: input.requestKey } });
      expect(saved).toMatchObject({ state: "STORED", documentId: null });
      expect(syntheticStorage.objects.has(saved.storagePath)).toBe(true);
      expect(await db.document.count({ where: { path: saved.storagePath } })).toBe(0);
      expect(await db.documentParseRun.count({ where: { requestedById: f.user.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "${constraint}"`);
    }
    const recovered = await resumeMaterialIngest(input.requestKey, f.user.id);
    expect(await resumeMaterialIngest(input.requestKey, f.user.id)).toEqual(recovered);
    expect(await db.document.count({ where: { uploadedById: f.user.id } })).toBe(1);
    const run = await db.documentParseRun.findFirstOrThrow({ where: { documentId: recovered.id } });
    expect(await db.jobQueue.count({ where: { dedupeKey: `document.parse:${run.id}` } })).toBe(1);
    expect(syntheticStorage.write).toHaveBeenCalledTimes(1);
  });

  it("恢复读取期间更换领取 token，旧恢复不能覆盖新状态，新领取可以提交", async () => {
    const f = await fixture(), input = request(f);
    syntheticStorage.afterWrite = async () => { throw new Error("controlled lost storage acknowledgement"); };
    await expect(ingestMaterial(input)).rejects.toThrow("原件保存未完成");
    syntheticStorage.afterWrite = undefined;
    const oldLease = await claimIntent(input.requestKey);
    let entered!: () => void, release!: () => void;
    const readStarted = new Promise<void>(resolve => { entered = resolve; });
    const readGate = new Promise<void>(resolve => { release = resolve; });
    syntheticStorage.beforeRead = async () => { entered(); await readGate; };
    const executing = resumeMaterialIngest(input.requestKey, f.user.id, oldLease);
    let currentLease = oldLease;
    try {
      await Promise.race([readStarted, executing.then(() => { throw new Error("恢复未读取原件便已结束"); })]);
      currentLease = await claimIntent(input.requestKey);
      await db.materialIngestIntent.update({ where: { id: input.requestKey }, data: { state: "FAILED", errorCode: "NEW_ATTEMPT_OBSERVATION" } });
    } finally { syntheticStorage.beforeRead = undefined; release(); }
    await expect(executing).rejects.toThrow("另一执行器");
    expect(await db.materialIngestIntent.findUniqueOrThrow({ where: { id: input.requestKey } })).toMatchObject({ state: "FAILED", errorCode: "NEW_ATTEMPT_OBSERVATION", documentId: null });
    const recovered = await resumeMaterialIngest(input.requestKey, f.user.id, currentLease);
    expect(await db.document.count({ where: { id: recovered.id } })).toBe(1);
    expect(await completeJob(currentLease)).toBe(true);
  });

  it("获准的归档补充初传可建解析任务，普通卷宗上传仍被阻断", async () => {
    const f = await fixture();
    const name = `ingest-archive-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "documents.write", scope: "OWN" }, { permissionKey: "archive.supplement", scope: "OWN" },
    ] } } });
    roleIds.push(role.id);
    await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    const folder = await db.documentFolder.create({ data: { matterId: f.matter.id, name: "归档" } });
    const saved = await ingestMaterial(request(f, { ...f.document, folderId: folder.id }));
    expect(await db.documentParseRun.count({ where: { documentId: saved.id, generation: 1, state: "PENDING" } })).toBe(1);
    await expect(ingestMaterial(request(f))).rejects.toThrow("归档案件仅允许");
    expect(syntheticStorage.write).toHaveBeenCalledTimes(1);
  });

  it("收案快照材料转入案件后仍禁止撤回或清理，原件与历史保留", async () => {
    const f = await fixture("PRINCIPAL_LAWYER");
    const intake = await db.intake.create({ data: { title: "合成已成案收案", createdById: f.user.id, ownerUserId: f.user.id } });
    const saved = await ingestMaterial(request(f, { ...f.document, matterId: null, intakeId: intake.id }));
    const state = await intakeState(db, intake.id);
    const check = await db.conflictCheck.create({ data: { intakeId: intake.id, queryPayload: state.queries,
      subjectFingerprint: state.subjectFingerprint, conclusion: "DIFFERENT", decidedById: f.user.id, decidedAt: new Date(), note: "合成历史夹具" } });
    await db.intakeRevision.create({ data: { intakeId: intake.id, round: 1, snapshot: state.snapshot,
      fingerprint: state.fingerprint, checkId: check.id, submittedById: f.user.id } });
    await db.$transaction(async tx => {
      await tx.intake.update({ where: { id: intake.id }, data: { status: "CONVERTED" } });
      await tx.matter.update({ where: { id: f.matter.id }, data: { intakeId: intake.id } });
      await tx.document.update({ where: { id: saved.id }, data: { matterId: f.matter.id } });
    });
    await expect(withdrawMaterial(f.user.id, saved.id, false)).rejects.toThrow("收案送审历史");
    await expect(withdrawMaterial(f.user.id, saved.id, true)).rejects.toThrow("收案送审历史");
    const original = await db.document.findUniqueOrThrow({ where: { id: saved.id } });
    expect(original.deletedAt).toBeNull();
    expect(await db.intakeRevision.count({ where: { intakeId: intake.id } })).toBe(1);
    expect(await db.jobQueue.count({ where: { dedupeKey: `document.purge:${saved.id}` } })).toBe(0);
    expect(syntheticStorage.objects.has(original.path)).toBe(true);
    expect(syntheticStorage.remove).not.toHaveBeenCalled();
  });
});
