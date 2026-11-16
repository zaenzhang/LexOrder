// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { sha256 } from "@/lib/storage/crypto";

// Root alone migrates and starts the dedicated disposable PostgreSQL test database.
// Original bytes below are synthetic in-memory storage, not evidence of a real storage deployment.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("交付集成测试仅允许独立的 _test 数据库");
const bytesByPath = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
vi.mock("@/lib/storage", () => ({ storage: {
  readFile: vi.fn(async (path: string) => { const bytes = bytesByPath.get(path); if (!bytes) throw new Error("missing synthetic original"); return bytes; }),
  writeFileAt: vi.fn(async (path: string, bytes: Buffer) => { if (bytesByPath.has(path)) throw new Error("synthetic original exists"); bytesByPath.set(path, bytes); }),
} }));

import { prisma as db } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import {
  findDeliveryEventByRequestForActor, getDeliveryDetailForActor, listDeliveryRecordsForActor, prepareDeliveryForActor, registerDeliveryEventForActor,
} from "@/server/deliveries/service";
import { exportDeliveryForActor } from "@/server/deliveries/export";
import { createClientBriefForActor } from "@/server/deliveries/brief";

const users: string[] = [], matters: string[] = [], documents: string[] = [], roles: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成交付经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成交付事项", internalCode: `DELIVERY-${randomUUID()}`, ownerId: user.id } });
  matters.push(matter.id);
  return { user, matter };
}
async function document(f: Awaited<ReturnType<typeof fixture>>, options: { name?: string; body?: string; status?: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "FILED"; produced?: boolean; familyId?: string; version?: number; isLatest?: boolean } = {}) {
  const bytes = Buffer.from(options.body ?? "合成原件，不含真实客户资料。", "utf8"), path = `delivery-test/${randomUUID()}.txt`;
  bytesByPath.set(path, bytes);
  const row = await db.document.create({ data: {
    matterId: f.matter.id, uploadedById: f.user.id, path, name: options.name ?? "合成材料.txt", mimeType: "text/plain",
    size: bytes.length, sha256: sha256(bytes), tags: [], status: options.status ?? "DRAFT",
    sourceOrigin: options.produced ? "TEAM_PRODUCED" : "CLIENT_PROVIDED",
    familyId: options.familyId, version: options.version ?? 1, isLatest: options.isLatest ?? true,
  } });
  documents.push(row.id);
  return row;
}
function preparation(f: Awaited<ReturnType<typeof fixture>>, documentIds: string[]) {
  return { matterId: f.matter.id, requestKey: randomUUID(), documentIds, purpose: "合成阶段材料",
    recipientName: "合成客户", recipientContact: "synthetic@example.invalid", disclosureScope: "仅本清单", unresolvedItems: "合成事项仍待确认" };
}
const sentEvent = (deliveryId: string) => ({ deliveryId, requestKey: randomUUID(), kind: "SENT" as const,
  occurredAt: new Date(Date.now() - 60_000).toISOString(), channel: "邮件", note: "合成验收：实际发送事实登记，未进行任何对外发送" });

describe.skipIf(!databaseUrl)("固定交付链：真实 PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.document.updateMany({ where: { id: { in: documents } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect();
  });

  it("准备固定旧批准版本和顺序，导出不写发送；普通附件不被一律要求审批", async () => {
    const f = await fixture();
    const first = await document(f, { name: "合成旧批准稿.txt", body: "旧稿", produced: true, status: "APPROVED", isLatest: false });
    await db.document.update({ where: { id: first.id }, data: { familyId: first.id } });
    const next = await document(f, { name: "合成新草稿.txt", body: "新稿", produced: true, familyId: first.id, version: 2 });
    const evidence = await document(f, { name: "合成客户附件.txt" });
    const created = await prepareDeliveryForActor(f.user.id, preparation(f, [evidence.id, first.id]));
    expect(await db.deliveryEvent.count({ where: { deliveryId: created.id } })).toBe(0);
    const readsBefore = vi.mocked(storage.readFile).mock.calls.length;
    const detail = await getDeliveryDetailForActor(f.user.id, created.id);
    expect(detail.items.map(item => item.documentId)).toEqual([evidence.id, first.id]);
    expect(detail.items[1].newerVersionAvailable).toBe(true);
    expect(vi.mocked(storage.readFile).mock.calls.length).toBe(readsBefore);
    const exportKey = randomUUID();
    const archive = await exportDeliveryForActor(f.user.id, created.id, { requestKey: exportKey });
    const zip = new PizZip(archive.buffer);
    expect(zip.file("材料/02_合成旧批准稿.txt")?.asText()).toBe("旧稿");
    expect(Object.keys(zip.files).some(name => name.includes("新草稿"))).toBe(false);
    await exportDeliveryForActor(f.user.id, created.id, { requestKey: exportKey });
    expect(await db.deliveryEvent.count({ where: { deliveryId: created.id, kind: "EXPORTED" } })).toBe(1);
    expect(await db.deliveryEvent.count({ where: { deliveryId: created.id, kind: "SENT" } })).toBe(0);
    await expect(prepareDeliveryForActor(f.user.id, preparation(f, [next.id]))).rejects.toThrow(/审批/);
  });

  it("保存重放只保留一份固定清单，异载荷和原位修改被拒绝", async () => {
    const f = await fixture(), doc = await document(f), input = preparation(f, [doc.id]);
    const attempts = await Promise.allSettled([prepareDeliveryForActor(f.user.id, input), prepareDeliveryForActor(f.user.id, input)]);
    expect(attempts.some(result => result.status === "fulfilled")).toBe(true);
    const saved = await prepareDeliveryForActor(f.user.id, input);
    expect(await prepareDeliveryForActor(f.user.id, input)).toEqual(saved);
    expect(await db.deliveryRecord.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: saved.id, action: "DELIVERY_PREPARE" } })).toBe(1);
    await expect(prepareDeliveryForActor(f.user.id, { ...input, recipientName: "另一人" })).rejects.toThrow(/已保存/);
    await expect(db.deliveryRecord.update({ where: { id: saved.id }, data: { recipientName: "静默覆盖" } })).rejects.toThrow();
    const item = await db.deliveryItem.findFirstOrThrow({ where: { deliveryId: saved.id } });
    await expect(db.deliveryItem.update({ where: { id: item.id }, data: { documentVersion: 8 } })).rejects.toThrow();
  });

  it("发送、收悉、回复和更正追加独立事实，重试不重复且不改变文书批准", async () => {
    const f = await fixture(), doc = await document(f), saved = await prepareDeliveryForActor(f.user.id, preparation(f, [doc.id]));
    await expect(registerDeliveryEventForActor(f.user.id, { ...sentEvent(saved.id), kind: "RECEIVED" })).rejects.toThrow(/先登记实际发送/);
    const input = sentEvent(saved.id), event = await registerDeliveryEventForActor(f.user.id, input);
    expect(await registerDeliveryEventForActor(f.user.id, input)).toEqual(event);
    await expect(registerDeliveryEventForActor(f.user.id, { ...input, requestKey: randomUUID() })).rejects.toThrow(/已登记发送/);
    await registerDeliveryEventForActor(f.user.id, { ...sentEvent(saved.id), kind: "RECEIVED", note: "客户表示已收到，未确认内容" });
    await registerDeliveryEventForActor(f.user.id, { ...sentEvent(saved.id), kind: "REPLIED", note: "客户要求进一步解释，未形成决定" });
    await registerDeliveryEventForActor(f.user.id, { ...sentEvent(saved.id), kind: "SEND_CORRECTION", correctsEventId: event.id, note: "更正记录中的发送时间；原记录保留" });
    const detail = await getDeliveryDetailForActor(f.user.id, saved.id);
    expect(detail.events.map(item => item.kind)).toEqual(["SENT", "RECEIVED", "REPLIED", "SEND_CORRECTION"]);
    expect(detail.events[0].note).toBe(input.note);
    expect(detail.events[0].proofDocumentId).toBeNull();
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("DRAFT");
    await expect(db.deliveryEvent.update({ where: { id: event.id }, data: { note: "静默更正" } })).rejects.toThrow();
  });

  it("撤回、缺失或变更的原件停止整包，保留清单且不记录成功导出", async () => {
    const f = await fixture(), a = await document(f), b = await document(f), saved = await prepareDeliveryForActor(f.user.id, preparation(f, [a.id, b.id]));
    bytesByPath.delete(b.path);
    await expect(exportDeliveryForActor(f.user.id, saved.id, { requestKey: randomUUID() })).rejects.toThrow(/无法读取/);
    bytesByPath.set(b.path, Buffer.from("发生变化的原件"));
    await expect(exportDeliveryForActor(f.user.id, saved.id, { requestKey: randomUUID() })).rejects.toThrow(/不一致/);
    await db.document.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    await expect(getDeliveryDetailForActor(f.user.id, saved.id)).rejects.toThrow(/撤回/);
    const page = await listDeliveryRecordsForActor(f.user.id, f.matter.id);
    expect(page.items[0]).toMatchObject({ state: "UNAVAILABLE", purpose: null, recipientName: null });
    expect(await db.deliveryEvent.count({ where: { deliveryId: saved.id } })).toBe(0);
    expect(await db.deliveryItem.count({ where: { deliveryId: saved.id } })).toBe(2);
    // A corrected new list can reference the prior record without reviving its withdrawn document.
    const corrected = await prepareDeliveryForActor(f.user.id, { ...preparation(f, [a.id]), supersedesId: saved.id });
    expect((await db.deliveryRecord.findUniqueOrThrow({ where: { id: corrected.id } })).supersedesId).toBe(saved.id);
  });

  it("凭据撤回后隐藏依赖正文并拒绝原登记重放，无凭据登记保持独立", async () => {
    const f = await fixture(), doc = await document(f), proof = await document(f, { name: "合成发送凭据.txt" });
    const saved = await prepareDeliveryForActor(f.user.id, preparation(f, [doc.id]));
    const input = { ...sentEvent(saved.id), proofDocumentId: proof.id, note: "仅获准凭据支撑的发送正文" };
    const event = await registerDeliveryEventForActor(f.user.id, input);
    expect((await getDeliveryDetailForActor(f.user.id, saved.id)).events[0].note).toBe(input.note);
    await db.document.update({ where: { id: proof.id }, data: { deletedAt: new Date() } });
    const detail = await getDeliveryDetailForActor(f.user.id, saved.id);
    expect(detail.events[0]).toMatchObject({ id: event.id, proofUnavailable: true, proofDocumentId: null, proofName: null, note: null });
    expect(JSON.stringify(detail)).not.toContain(input.note);
    expect((await db.deliveryEvent.findUniqueOrThrow({ where: { id: event.id } })).note).toBe(input.note);
    await expect(registerDeliveryEventForActor(f.user.id, input)).rejects.toThrow(/撤回/);
    await expect(findDeliveryEventByRequestForActor(f.user.id, input)).rejects.toThrow(/撤回/);
    await registerDeliveryEventForActor(f.user.id, { ...sentEvent(saved.id), kind: "RECEIVED", note: "无凭据的明确收悉事实" });
    expect((await getDeliveryDetailForActor(f.user.id, saved.id)).events[1]).toMatchObject({
      proofUnavailable: false, proofDocumentId: null, proofName: null, note: "无凭据的明确收悉事实",
    });
  });

  it("越案材料、无导出资格及归档写入拒绝，来源读取权不等于交付资格", async () => {
    const f = await fixture(), other = await fixture(), doc = await document(f), foreign = await document(other);
    await expect(prepareDeliveryForActor(f.user.id, preparation(f, [foreign.id]))).rejects.toThrow(/无权/);
    const saved = await prepareDeliveryForActor(f.user.id, preparation(f, [doc.id]));
    const roleName = `合成仅阅读-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName, active: true, permissions: { create: [
      { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "documents.download", scope: "OWN" },
    ] } } }); roles.push(role.id);
    await db.user.update({ where: { id: f.user.id }, data: { role: "CUSTOM", roleDefinitionId: role.id } });
    expect((await getDeliveryDetailForActor(f.user.id, saved.id)).canWrite).toBe(false);
    await expect(exportDeliveryForActor(f.user.id, saved.id, { requestKey: randomUUID() })).rejects.toThrow(/导出权限/);
    await db.user.update({ where: { id: f.user.id }, data: { role: "LAWYER", roleDefinitionId: null } });
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(registerDeliveryEventForActor(f.user.id, sentEvent(saved.id))).rejects.toThrow(/已归档/);
  });

  it("人工简报同请求重试只有一个草稿，新稿不借旧批准", async () => {
    const f = await fixture(), input = { matterId: f.matter.id, requestKey: randomUUID(), title: "合成客户简报", content: "合成进展\n仍待客户决定" };
    const first = await createClientBriefForActor(f.user.id, input); documents.push(first.id);
    expect(await createClientBriefForActor(f.user.id, input)).toEqual(first);
    const original = await db.document.findUniqueOrThrow({ where: { id: first.id } });
    expect(original).toMatchObject({ status: "DRAFT", sourceOrigin: "TEAM_PRODUCED", version: 1 });
    await db.document.update({ where: { id: first.id }, data: { status: "APPROVED", approvedById: f.user.id, approvedAt: new Date() } });
    const next = await createClientBriefForActor(f.user.id, { ...input, requestKey: randomUUID(), priorDocumentId: first.id, content: "合成修订后正文" }); documents.push(next.id);
    expect(await db.document.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({ status: "DRAFT", version: 2, approvedById: null });
    expect((await db.document.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("APPROVED");
  });
});
