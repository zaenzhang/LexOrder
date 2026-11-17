// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, UserRole } from "@prisma/client";

const syntheticStorage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(), write: vi.fn(), read: vi.fn(), remove: vi.fn(),
  afterWrite: undefined as ((key: string) => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
}));
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("摄入集成测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: {
  writeFileAt: syntheticStorage.write, readFile: syntheticStorage.read, deleteFile: syntheticStorage.remove,
} }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { removeProcedureStage } from "@/server/procedures/actions";
import { completeJob } from "@/server/cron/queue";
import { intakeState } from "@/server/intakes/workflow";
import { ingestMaterial, resumeMaterialIngest, withdrawMaterial, UploadRejectedBeforeReservation, type MaterialDocumentInput } from "@/server/documents/material-ingest";
import { uploadDocument } from "@/server/documents/actions";
import { getMaterialUploadReceipt, listPendingMaterialUploads, closeMaterialUpload } from "@/server/documents/ingest-actions";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";

const userIds: string[] = [], matterIds: string[] = [], roleIds: string[] = [], intentIds: string[] = [], templateIds: string[] = [];
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
function signIn(f: Awaited<ReturnType<typeof fixture>>) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: f.user.id, role: f.user.role, runtimeMode: "SERVER" }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
}
function uploadForm(f: Awaited<ReturnType<typeof fixture>>, key: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("matterId", f.matter.id); form.set("requestKey", key); form.set("name", "合成批次原件.txt"); form.set("category", "EVIDENCE");
  form.set("file", new File([new Uint8Array(f.bytes)], "同名原件.txt", { type: "text/plain" }));
  for (const [name, value] of Object.entries(extra)) form.set(name, value);
  return form;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
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
    await db.documentTemplate.updateMany({ where: { id: { in: templateIds } }, data: { enabled: false } });
    await db.document.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), textContent: null } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
    syntheticStorage.objects.clear();
  });

  it("G04 公开上传明确前置拒绝不预留；修正同键后保留逐件程序/环节/未归属和独立文件身份", async () => {
    const f = await fixture(); signIn(f);
    const a = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const b = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "SECOND_INSTANCE", order: 1 } });
    const hidden = await db.matterStage.create({ data: { procedureId: a.id, name: "合成隐藏环节", order: 0, status: "HIDDEN" } });
    const active = await db.matterStage.create({ data: { procedureId: b.id, name: "合成实际环节", order: 0 } });
    const key = request(f).requestKey;
    expect(await uploadDocument(uploadForm(f, key, { name: "" }))).toMatchObject({ ok: false, code: "REJECTED_BEFORE_RESERVATION" });
    expect(await uploadDocument(uploadForm(f, key, { procedureId: a.id, stageId: hidden.id }))).toMatchObject({ ok: false, code: "REJECTED_BEFORE_RESERVATION", message: expect.stringContaining("环节") });
    const missing = `c${randomUUID().replaceAll("-", "")}`;
    expect(await uploadDocument(uploadForm(f, key, { contextInputs: JSON.stringify([{ recordId: missing, expectedCurrentRecordId: missing, expectedConfirmedAt: null }]) })))
      .toMatchObject({ ok: false, code: "REJECTED_BEFORE_RESERVATION" });
    expect(await db.materialIngestIntent.findUnique({ where: { id: key } })).toBeNull();
    expect(await db.jobQueue.findUnique({ where: { dedupeKey: `document.ingest:${key}` } })).toBeNull();
    expect(syntheticStorage.write).not.toHaveBeenCalled();
    const first = await uploadDocument(uploadForm(f, key, { procedureId: a.id }));
    const second = await uploadDocument(uploadForm(f, request(f).requestKey, { procedureId: b.id, stageId: active.id }));
    const third = await uploadDocument(uploadForm(f, request(f).requestKey));
    if (!first.ok || !second.ok || !third.ok) throw new Error("合成成功输入未保存");
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(await db.document.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ procedureId: a.id, stageId: null });
    expect(await db.document.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ procedureId: b.id, stageId: active.id });
    expect(await db.document.findUniqueOrThrow({ where: { id: third.id } })).toMatchObject({ procedureId: null, stageId: null });
    expect(await db.document.count({ where: { matterId: f.matter.id, name: "合成批次原件.txt" } })).toBe(3);
  }, 30_000);

  it("G04 同键真实并发预留冲突及已有请求异载不会误报可纠正，原请求只保存一份", async () => {
    const f = await fixture(); signIn(f); const key = request(f).requestKey;
    const locked = deferred<void>(), unlock = deferred<void>(), finishStorage = deferred<void>();
    const lock = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`; locked.resolve(); await unlock.promise;
    }, { timeout: 20000 });
    await locked.promise;
    syntheticStorage.write.mockImplementationOnce(async (path: string, bytes: Buffer) => {
      syntheticStorage.objects.set(path, Buffer.from(bytes)); await finishStorage.promise;
    });
    const calls = ["竞争甲.txt", "竞争乙.txt"].map(name => uploadDocument(uploadForm(f, key, { name }))
      .then(value => ({ value, error: null }), error => ({ value: null, error })));
    let waiting = 0;
    try {
      for (let i = 0; i < 200 && waiting < 2; i++) {
        const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=72606101`;
        waiting = row.count; if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThanOrEqual(2); // Both real requests observed no intent before their reservation transaction.
    } finally { unlock.resolve(); }
    await lock;
    try {
      const rejected = await Promise.race(calls);
      expect(rejected.value).toBeNull(); expect(rejected.error).toBeInstanceOf(ActionError);
      expect(rejected.error).not.toBeInstanceOf(UploadRejectedBeforeReservation);
      expect(rejected.error.message).toContain("其他内容");
    } finally { finishStorage.resolve(); }
    const outcomes = await Promise.all(calls);
    const saved = outcomes.find(row => row.value?.ok)?.value;
    if (!saved?.ok) throw new Error("并发原请求未保存");
    const doc = await db.document.findUniqueOrThrow({ where: { id: saved.id } });
    expect(await uploadDocument(uploadForm(f, key, { name: doc.name }))).toEqual(saved);
    await expect(uploadDocument(uploadForm(f, key, { name: "另一个输入.txt" }))).rejects.toThrow("其他内容");
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(syntheticStorage.write).toHaveBeenCalledOnce();
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "DOCUMENT_UPLOAD", targetId: saved.id } })).toBe(1);
  }, 30_000);

  it("G04 已预留失败保持原输入；精确回执可核对最新 20 条外的本次上传且不读取存储", async () => {
    const f = await fixture(); signIn(f); const key = request(f).requestKey;
    syntheticStorage.write.mockRejectedValueOnce(new Error("synthetic write failed"));
    await expect(uploadDocument(uploadForm(f, key))).rejects.toThrow("原件");
    const failed = await db.materialIngestIntent.findUniqueOrThrow({ where: { id: key } });
    expect(failed).toMatchObject({ state: "FAILED", errorCode: "STORAGE_WRITE_FAILED", documentId: null });
    const newer = Array.from({ length: 21 }, (_, index) => {
      const id = randomUUID(); intentIds.push(id);
      return { id, requestedById: f.user.id, matterId: f.matter.id, storagePath: `synthetic-pending/${id}`, sourceSha256: failed.sourceSha256,
        size: failed.size, metadata: failed.metadata as Prisma.InputJsonValue, state: "FAILED" as const, errorCode: "STORAGE_WRITE_FAILED", createdAt: new Date(failed.createdAt.getTime() + index + 1) };
    });
    await db.materialIngestIntent.createMany({ data: newer });
    const list = await listPendingMaterialUploads(f.matter.id);
    expect(list.items).toHaveLength(20); expect(list.hasMore).toBe(true); expect(list.items.map(row => row.id)).not.toContain(key);
    const reads = syntheticStorage.read.mock.calls.length;
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).toMatchObject({ status: "INCOMPLETE", waiting: false });
    expect(syntheticStorage.read).toHaveBeenCalledTimes(reads);
    await expect(uploadDocument(uploadForm(f, key))).rejects.toThrow("未找到完整原件");
    expect(syntheticStorage.write).toHaveBeenCalledOnce();
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: randomUUID() })).toEqual({ status: "NOT_RESERVED" });
  }, 30_000);

  it("G04 精确回执限定当前岗位/经办/本人及事项，COMMITTED 无当前原件资格只确认保存", async () => {
    const f = await fixture(), other = await fixture(); signIn(f); const key = request(f).requestKey;
    const saved = await uploadDocument(uploadForm(f, key)); if (!saved.ok) throw new Error("合成上传失败");
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).toEqual({ status: "COMMITTED", document: { id: saved.id, name: "合成批次原件.txt", version: 1 } });
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: other.user.id, role: "ASSISTANT" } });
    signIn(other);
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).toEqual({ status: "NOT_RESERVED" });
    signIn(f); await db.matterMember.create({ data: { matterId: other.matter.id, userId: f.user.id, role: "ASSISTANT" } });
    expect(await getMaterialUploadReceipt({ matterId: other.matter.id, requestKey: key })).toEqual({ status: "NOT_RESERVED" });
    const name = `g04-write-only-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [{ permissionKey: "documents.write", scope: "OWN" }] } } }); roleIds.push(role.id);
    // Keep the simulated session stale: both receipt and original access must resolve current database authority.
    await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).toEqual({ status: "COMMITTED", document: null });
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: false } });
    await expect(getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).rejects.toThrow("无权核对");
    await db.roleDefinition.update({ where: { id: role.id }, data: { active: true } });
    await db.matter.update({ where: { id: f.matter.id }, data: { ownerId: other.user.id } });
    await expect(getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).rejects.toThrow("无权核对");
    expect(syntheticStorage.read).not.toHaveBeenCalled();
  }, 30_000);

  it("G04 真实关闭后迟到 storage 失败不能重开终态或登记材料", async () => {
    const f = await fixture(); signIn(f); const key = request(f).requestKey;
    const entered = deferred<void>(), release = deferred<void>();
    syntheticStorage.write.mockImplementationOnce(async () => { entered.resolve(); await release.promise; throw new Error("synthetic late storage failure"); });
    const attempt = uploadDocument(uploadForm(f, key)).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await entered.promise;
    const intent = await db.materialIngestIntent.findUniqueOrThrow({ where: { id: key } });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Math.max(Date.now(), intent.createdAt.getTime()) + 121_000);
    try { await closeMaterialUpload(key); }
    finally { clock.mockRestore(); release.resolve(); }
    const result = await attempt; expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(ActionError);
    expect(result.error).not.toBeInstanceOf(UploadRejectedBeforeReservation);
    expect(await db.materialIngestIntent.findUniqueOrThrow({ where: { id: key } })).toMatchObject({ state: "FAILED", errorCode: "UPLOAD_ABANDONED", documentId: null });
    expect(await getMaterialUploadReceipt({ matterId: f.matter.id, requestKey: key })).toEqual({ status: "CLOSED" });
    expect(await db.jobQueue.findUniqueOrThrow({ where: { dedupeKey: `document.ingest:${key}` } })).toMatchObject({ status: "DEAD" });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    expect(await db.documentParseRun.count({ where: { requestedById: f.user.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: "DOCUMENT_UPLOAD_ABANDON", targetId: key } })).toBe(1);
    await expect(uploadDocument(uploadForm(f, key))).rejects.toThrow("已关闭");
    expect(syntheticStorage.write).toHaveBeenCalledOnce();
  }, 30_000);

  it("已预留原件的环节被移除时保留环节与上传，新上传不能再绑定隐藏环节", async () => {
    const f = await fixture();
    vi.mocked(requireSession).mockResolvedValue({ user: { id: f.user.id, role: f.user.role, runtimeMode: "SERVER" }, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
    const procedure = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const stage = await db.matterStage.create({ data: { procedureId: procedure.id, name: "合成可移除环节", order: 1 } });
    const input = request(f, { ...f.document, procedureId: procedure.id, stageId: stage.id });
    syntheticStorage.afterWrite = async () => {
      expect(await removeProcedureStage({ id: stage.id })).toMatchObject({ ok: true, hidden: true });
    };
    const uploaded = await ingestMaterial(input);
    expect(await db.document.findUniqueOrThrow({ where: { id: uploaded.id } })).toMatchObject({ procedureId: procedure.id, stageId: stage.id });
    expect(await db.matterStage.findUniqueOrThrow({ where: { id: stage.id } })).toMatchObject({ status: "HIDDEN" });
    syntheticStorage.afterWrite = undefined;
    expect(await ingestMaterial(input)).toEqual(uploaded);
    await expect(ingestMaterial(request(f, { ...f.document, procedureId: procedure.id, stageId: stage.id }))).rejects.toThrow("环节与案件不匹配或已不可用");
  }, 30_000);

  it("新材料绑定环节时必须指定真实所属程序", async () => {
    const f = await fixture();
    const procedure = await db.matterProcedure.create({ data: { matterId: f.matter.id, type: "FIRST_INSTANCE", order: 0 } });
    const stage = await db.matterStage.create({ data: { procedureId: procedure.id, name: "合成环节", order: 1 } });
    await expect(ingestMaterial(request(f, { ...f.document, stageId: stage.id }))).rejects.toThrow("必须指定所属程序");
    expect(syntheticStorage.write).not.toHaveBeenCalled();
  }, 30_000);

  it("上传新版期间原材料移动卷宗，不会用旧归属提交新版", async () => {
    const f = await fixture();
    const saved = await ingestMaterial(request(f));
    const folder = await db.documentFolder.create({ data: { matterId: f.matter.id, name: "合成新卷宗", orderIndex: 1 } });
    const next = request(f, { ...f.document, name: "合成新版.txt" });
    syntheticStorage.afterWrite = async () => { await db.document.update({ where: { id: saved.id }, data: { folderId: folder.id } }); };
    await expect(ingestMaterial({ ...next, priorDocumentId: saved.id })).rejects.toThrow("原材料归属已变化");
    expect(await db.document.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ isLatest: true, folderId: folder.id });
    expect(await db.materialIngestIntent.findUniqueOrThrow({ where: { id: next.requestKey } })).toMatchObject({ state: "STORED", documentId: null });
  }, 30_000);

  it("等待授权锁期间撤销经办关系后不能预留材料上传", async () => {
    const f = await fixture();
    const member = await db.user.create({ data: { name: "合成待撤销成员", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
    userIds.push(member.id);
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: member.id, role: "ASSISTANT" } });
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const removal = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      await tx.matterMember.delete({ where: { matterId_userId: { matterId: f.matter.id, userId: member.id } } });
      ready();
      await proceed;
    }, { timeout: 20000 });
    await locked;
    const input = { ...request(f, { ...f.document, uploadedById: member.id }), userId: member.id };
    const attempted = ingestMaterial(input).then(() => true, () => false);
    let waiting = 0;
    try {
      for (let i = 0; i < 200 && waiting < 1; i++) {
        const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=72606101`;
        waiting = row.count;
        if (waiting < 1) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThanOrEqual(1);
    } finally { release(); }
    await removal;
    expect(await attempted).toBe(false);
    expect(await db.materialIngestIntent.findUnique({ where: { id: input.requestKey } })).toBeNull();
    expect(syntheticStorage.write).not.toHaveBeenCalled();
  }, 30_000);

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

  it("派生文书上传新版本继承固定研究和模板依据，旧批准不继承，来源撤回即阻止后续读取/送审/修订", async () => {
    const f = await fixture();
    const source = await ingestMaterial(request(f, { ...f.document, name: "合成固定研究来源.txt" }));
    const original = await ingestMaterial(request(f, { ...f.document, name: "合成研究初稿.txt" }));
    const research = await db.researchRevision.create({ data: {
      matterId: f.matter.id, seriesId: randomUUID(), version: 1, question: "合成金额规则争点", purpose: "合成审校验收", jurisdiction: "中国大陆",
      researchedAt: new Date(), scope: "仅此合成来源", queryLog: [], rule: "合成规则", exceptions: "合成例外", supportingAnalysis: "合成正向说明",
      opposingAnalysis: "合成反向说明", conclusion: "合成结论", unresolved: "仍待人工核对", nextSteps: "核对原文", authorId: f.user.id,
      requestKey: randomUUID(), requestHash: "a".repeat(64), sources: { create: { documentId: source.id, documentSha256: f.document.sha256,
        relation: "SUPPORTS", location: { kind: "TEXT", start: 0, end: 8 }, locationKey: "TEXT:0:8", lawMetadata: {} } },
    } });
    const blob = await db.document.create({ data: { name: "合成模板原件.docx", path: `ingest-template/${randomUUID()}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", uploadedById: f.user.id, tags: [] } });
    const template = await db.documentTemplate.create({ data: { name: "合成修订模板", category: "LITIGATION", applicableCategories: [], variables: [], docxBlobId: blob.id } });
    templateIds.push(template.id);
    const snapshot = { context: { matter: { title: f.matter.title } }, templateSource: { documentId: blob.id, sha256: null }, reviewedById: f.user.id };
    const approver = await db.user.create({ data: { name: "合成历史审批人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
    userIds.push(approver.id);
    await db.document.update({ where: { id: original.id }, data: { status: "APPROVED", approvedById: approver.id, approvedAt: new Date(),
      reviewedById: approver.id, reviewedAt: new Date(), templateId: template.id, templateContextSnapshot: snapshot } });
    await db.documentResearchSource.create({ data: { documentId: original.id, researchRevisionId: research.id } });
    const revisionBytes = Buffer.from("合成修订稿：按明细更正本金，保留原研究版本。", "utf8");
    const revisionInput = { ...request(f, { ...f.document, name: "合成研究修订稿.txt", size: revisionBytes.length,
      sha256: createHash("sha256").update(revisionBytes).digest("hex") }), bytes: revisionBytes, priorDocumentId: original.id };
    const revision = await ingestMaterial(revisionInput);
    const saved = await db.document.findUniqueOrThrow({ where: { id: revision.id } });
    expect(saved).toMatchObject({ familyId: original.id, version: 2, isLatest: true, status: "DRAFT", approvedById: null, approvedAt: null,
      reviewedById: null, reviewedAt: null, templateId: template.id, templateContextSnapshot: snapshot, generationRequestKey: null });
    expect(await db.documentResearchSource.findMany({ where: { documentId: revision.id }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: research.id }]);
    expect(await db.document.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ status: "APPROVED", approvedById: approver.id, version: 1, isLatest: false });
    await withdrawMaterial(f.user.id, source.id, false);
    expect(await canReadDocument(f.user.id, saved)).toBe(false);
    for (const purpose of ["READ", "EXPORT", "SUBMIT"] as const) {
      await expect(assertDocumentDerivationAccess(f.user.id, saved.id, { purpose })).rejects.toThrow("来源已撤回、变更或无权读取");
    }
    const nextInput = { ...request(f, revisionInput.document), bytes: revisionBytes, priorDocumentId: revision.id };
    await expect(ingestMaterial(nextInput)).rejects.toThrow("来源已撤回、变更或无权读取");
    expect(await db.document.count({ where: { familyId: original.id } })).toBe(2);
    expect(await db.document.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ isLatest: true, version: 2, status: "DRAFT" });
  });

  it("仅为用户明确选择的旧原件建立版本族，不合并其他无族材料", async () => {
    const f = await fixture();
    const original = await db.document.create({ data: { ...f.document, path: `unrelated/${randomUUID()}.txt`, familyId: null } });
    const input = { ...request(f), priorDocumentId: original.id };
    const unrelated = await db.document.create({ data: { ...f.document, path: `other/${randomUUID()}.txt`, familyId: null } });
    const created = await ingestMaterial(input);
    expect(await db.document.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ familyId: original.id, version: 2, isLatest: true });
    expect(await db.document.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ familyId: original.id, version: 1, isLatest: false });
    expect(await db.document.findUniqueOrThrow({ where: { id: unrelated.id } })).toMatchObject({ familyId: null, version: 1, isLatest: true });
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
