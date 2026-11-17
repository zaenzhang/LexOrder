// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/notifications/approval", () => ({ notifyRoleApprovers: vi.fn() }));
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
import { getSession, requireSession } from "@/lib/auth/session";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { approvalTransaction } from "@/lib/approvals/service";
import { submitDocumentForReview } from "@/server/documents/actions";
import { GET as preview } from "@/app/api/documents/[id]/preview/route";
import { completeJob } from "@/server/cron/queue";
import { cancelMaterialProcessing, enqueueMaterialProcessing, processMaterialJob, readMaterialSource } from "@/server/documents/material-processing";

const userIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], roleIds: string[] = [], groupIds: string[] = [];
async function fixture(original?: { bytes: Buffer; name: string; mimeType: string }) {
  const user = await db.user.create({ data: { name: "合成材料经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成材料事项", internalCode: `MATERIAL-TEST-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  const bytes = original?.bytes ?? Buffer.from("合成材料：合同金额 120000 元，验收异议尚未解决。", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `${randomUUID()}${original ? ".xlsx" : ".txt"}`;
  await writeFile(path.join(storageFixture.directory, file), bytes, { flag: "wx" });
  storageFixture.files.add(file);
  const doc = await db.document.create({ data: { name: original?.name ?? "合成材料.txt", matterId: matter.id, uploadedById: user.id,
    path: file, mimeType: original?.mimeType ?? "text/plain", sha256, size: bytes.length, tags: [] } });
  documentIds.push(doc.id);
  return { user, matter, doc };
}

async function publishedSheet() {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("合成明细");
  const marker = ` 合成固定单格\n${randomUUID()} `;
  sheet.getCell("C8").value = marker; sheet.getCell("F10").value = { formula: "1+1" };
  const f = await fixture({ bytes: Buffer.from(await workbook.xlsx.writeBuffer()), name: "合成固定表.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const first = await enqueue(f), lease = await claim(first.runId);
  await processMaterialJob({ runId: first.runId }, lease); await completeJob(lease);
  const saved = await db.documentParseRun.findUniqueOrThrow({ where: { id: first.runId } });
  expect(saved.state).toBe("PARTIAL");
  const anchor = (saved.anchors as { anchorId: string; text: string }[])[0];
  expect(anchor.text).toBe(marker);
  return { ...f, marker, input: { documentId: f.doc.id, runId: first.runId, anchorId: anchor.anchorId } };
}
async function actorFor(user: Awaited<ReturnType<typeof fixture>>["user"]) {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" as const };
}
function runPreview(input: { documentId: string; runId: string; anchorId: string }) {
  const url = `http://localhost/api/documents/${input.documentId}/preview?runId=${encodeURIComponent(input.runId)}&anchorId=${encodeURIComponent(input.anchorId)}`;
  return preview(new Request(url), { params: Promise.resolve({ id: input.documentId }) });
}
async function approvalReader(f: Awaited<ReturnType<typeof publishedSheet>>) {
  const roleName = `material-table-reader-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName } }); roleIds.push(role.id);
  const reviewer = await db.user.create({ data: { name: "合成单格审批人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only",
    role: "CUSTOM", roleDefinitionId: role.id } }); userIds.push(reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成单格审批-${randomUUID()}`, members: { create: { userId: reviewer.id } },
    rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groupIds.push(group.id);
  vi.mocked(requireSession).mockResolvedValue({ user: await actorFor(f.user) });
  await submitDocumentForReview(f.doc.id);
  expect((await db.document.findUniqueOrThrow({ where: { id: f.doc.id } })).status).toBe("PENDING_REVIEW");
  const actor = await actorFor(reviewer);
  expect(hasCustomPermission(actor, "documents.read")).toBe(false);
  expect(hasCustomPermission(actor, "documents.download")).toBe(false);
  expect(hasCustomPermission(actor, "matters.read")).toBe(false);
  // The request boundary is explicitly synthetic; current grants and final release are real PG reads.
  vi.mocked(getSession).mockResolvedValue({ user: actor });
  return { reviewer, group };
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
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groupIds } }, data: { active: false } });
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

  it("真实XLSX发布后新代次不改旧单格URL，GET handler使用旧run成功且只审计成功读取", async () => {
    const f = await publishedSheet();
    const next = await enqueue(f, 1), lease = await claim(next.runId);
    await processMaterialJob({ runId: next.runId }, lease); await completeJob(lease);
    const source = await readMaterialSource(f.user.id, f.input);
    expect(source).toMatchObject({ status: "AVAILABLE", run: { id: f.input.runId, isCurrent: false }, previewKind: "TABLE",
      previewUrl: `/api/documents/${f.doc.id}/preview?runId=${f.input.runId}&anchorId=${f.input.anchorId}#material-source`,
      downloadUrl: `/api/documents/${f.doc.id}/download`, anchor: { text: f.marker, location: { kind: "TABLE", sheet: "合成明细", rowStart: 8, rowEnd: 8, columnStart: 3, columnEnd: 3 } } });
    vi.mocked(getSession).mockResolvedValue({ user: await actorFor(f.user) });
    const response = await runPreview(f.input);
    expect(response.status).toBe(200); expect(await response.text()).toContain(`<td id="material-source">${f.marker}</td>`);
    expect((await runPreview({ ...f.input, runId: "wrong-run" })).status).toBe(404);
    expect((await runPreview({ ...f.input, anchorId: "wrong-anchor" })).status).toBe(404);
    expect(await db.auditLog.count({ where: { targetId: f.doc.id, action: "DOCUMENT_PREVIEW", userId: f.user.id } })).toBe(1);
  });

  it("只有具体审批附件资格的零业务权限用户可看目标TABLE，不可借此看无关材料", async () => {
    const f = await publishedSheet(), { reviewer } = await approvalReader(f);
    const unrelated = await db.document.create({ data: { name: "合成未送审表.xlsx", matterId: f.matter.id, uploadedById: f.user.id,
      path: f.doc.path, mimeType: f.doc.mimeType, sha256: f.doc.sha256, size: f.doc.size, tags: [] } }); documentIds.push(unrelated.id);
    expect(await readMaterialSource(reviewer.id, f.input)).toMatchObject({ status: "AVAILABLE", previewKind: "TABLE" });
    const response = await runPreview(f.input);
    expect(response.status).toBe(200); expect(await response.text()).toContain(`<td id="material-source">${f.marker}</td>`);
    expect((await runPreview({ ...f.input, documentId: unrelated.id })).status).toBe(403);
    expect(await readMaterialSource(reviewer.id, { ...f.input, documentId: unrelated.id })).toEqual({ status: "UNAVAILABLE" });
    expect(await db.auditLog.count({ where: { targetId: f.doc.id, action: "DOCUMENT_PREVIEW", userId: reviewer.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: unrelated.id, action: "DOCUMENT_PREVIEW", userId: reviewer.id } })).toBe(0);
  });

  it("真实文件读入后撤销未处理审批资格，固定TABLE不释放正文也不记成功审计", async () => {
    const f = await publishedSheet(), { reviewer, group } = await approvalReader(f), gate = pauseRead();
    const executing = runPreview(f.input);
    try {
      await Promise.race([gate.entered, executing.then(() => { throw new Error("预览未到达真实文件读取屏障"); })]);
      // Same authorization transaction as mutations; this fixture reviewer has never handled the approval.
      await approvalTransaction(tx => tx.approvalPermissionGroup.update({ where: { id: group.id }, data: { active: false } }));
    } finally { gate.release(); await executing.catch(() => undefined); }
    const response = await executing;
    expect(response.status).toBe(403); expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.text()).not.toContain(f.marker);
    expect(await readMaterialSource(reviewer.id, f.input)).toEqual({ status: "UNAVAILABLE" });
    expect(await db.auditLog.count({ where: { targetId: f.doc.id, action: "DOCUMENT_PREVIEW", userId: reviewer.id } })).toBe(0);
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
