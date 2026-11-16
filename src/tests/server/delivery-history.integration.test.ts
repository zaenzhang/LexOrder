// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClientHistoryActor } from "@/server/clients/history-service";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("交付历史仅允许独立的 _test 数据库");
  return { url };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/history_test") };
});

import { prisma as db } from "@/lib/prisma";
import { readClientHistory } from "@/server/clients/history-service";
import { prepareDeliveryForActor, registerDeliveryEventForActor } from "@/server/deliveries/service";

const users: string[] = [], clients: string[] = [], matters: string[] = [], documents: string[] = [], roles: string[] = [];
const at = new Date("2026-07-02T03:04:05.000Z");
const fingerprint = "a".repeat(64);
async function fixture(role: UserRole = "LAWYER", roleDefinitionId?: string) {
  const user = await db.user.create({ data: { role, roleDefinitionId, name: "合成交付历史经办人",
    email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-synthetic-only" } });
  users.push(user.id);
  const actor: ClientHistoryActor = { id: user.id, role, runtimeMode: "SERVER" };
  const client = await db.client.create({ data: { name: "实际接收客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } });
  const related = await db.client.create({ data: { name: "同案其他客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } });
  clients.push(client.id, related.id);
  const matter = await db.matter.create({ data: { internalCode: `DELIVERY-HISTORY-${randomUUID()}`, title: "合成交付历史事项",
    primaryClientId: client.id, ownerId: user.id, createdAt: new Date("2026-01-01T00:00:00Z"),
    clientLinks: { create: { clientId: related.id } } } });
  matters.push(matter.id);
  const document = await db.document.create({ data: { name: "合成固定交付稿.txt", path: `synthetic/${randomUUID()}.txt`,
    matterId: matter.id, uploadedById: user.id, sha256: fingerprint, sourceOrigin: "TEAM_PRODUCED", status: "APPROVED", tags: [] } });
  documents.push(document.id);
  return { actor, client, related, matter, document };
}
async function delivery(f: Awaited<ReturnType<typeof fixture>>, recipientClientId: string | null = f.client.id) {
  const saved = await prepareDeliveryForActor(f.actor.id, { matterId: f.matter.id, requestKey: randomUUID(), documentIds: [f.document.id],
    recipientClientId, recipientName: "实际接收人", recipientContact: "synthetic@example.invalid", purpose: "合成固定交付目的",
    disclosureScope: "仅固定清单", unresolvedItems: "" });
  const sent = await registerDeliveryEventForActor(f.actor.id, { deliveryId: saved.id, requestKey: randomUUID(), kind: "SENT",
    occurredAt: at.toISOString(), channel: "合成邮件", note: "合成发送登记；没有实际外发" });
  return { ...saved, sent };
}

describe.skipIf(!config.url)("M3 交付进入客户历史：真实 PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("NEXTAUTH_SECRET", "synthetic-delivery-history-test-only"); await db.$connect(); });
  afterAll(async () => {
    await db.document.updateMany({ where: { id: { in: documents } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("只进入实际接收客户，导出与回复分别链接原清单和事件，不复制沟通", async () => {
    const f = await fixture(), saved = await delivery(f);
    const reply = await registerDeliveryEventForActor(f.actor.id, { deliveryId: saved.id, requestKey: randomUUID(), kind: "REPLIED",
      occurredAt: at.toISOString(), note: "客户仅要求解释，没有作出新的决定" });
    // A persisted export fixture tests its history label; this is not evidence of filesystem export.
    const exported = await db.deliveryEvent.create({ data: { deliveryId: saved.id, actorId: f.actor.id, requestKey: randomUUID(),
      requestFingerprint: fingerprint, kind: "EXPORTED", occurredAt: at } });
    await delivery(f, null);
    const page = await readClientHistory(db, f.actor, { clientId: f.client.id });
    const rows = page.items.filter(row => row.source === "DELIVERY");
    expect(rows).toHaveLength(3);
    const item = rows.find(row => row.id === reply.id)!;
    expect(item.content).toBe("客户仅要求解释，没有作出新的决定");
    expect(item.href).toBe(`/matters/${f.matter.internalCode}?view=work&workPane=records&delivery=${saved.id}&deliveryEvent=${reply.id}`);
    expect(item.meta).toContain("仅人工登记，未附凭据");
    expect(rows.find(row => row.id === exported.id)?.title).toBe("已导出：合成固定交付目的");
    expect(rows.find(row => row.id === saved.sent.id)?.title).toBe("已登记发送：合成固定交付目的");
    const other = await readClientHistory(db, f.actor, { clientId: f.related.id });
    expect(other.items.some(row => row.source === "DELIVERY")).toBe(false);
    expect(await db.clientActivity.count({ where: { clientId: f.client.id } })).toBe(0);
  });

  it("撤回直接研究来源隐藏交付正文，长段隐藏事件仍以加密位置前进", async () => {
    const f = await fixture();
    const source = await db.document.create({ data: { name: "合成研究原文.txt", path: `synthetic/${randomUUID()}.txt`,
      matterId: f.matter.id, uploadedById: f.actor.id, sha256: fingerprint, tags: [] } });
    documents.push(source.id);
    const research = await db.researchRevision.create({ data: { seriesId: randomUUID(), version: 1, matterId: f.matter.id,
      question: "合成研究", purpose: "合成验收", jurisdiction: "合成法域", researchedAt: at, scope: "合成范围", queryLog: [],
      rule: "", exceptions: "", supportingAnalysis: "", opposingAnalysis: "", conclusion: "", unresolved: "", nextSteps: "",
      authorId: f.actor.id, requestKey: randomUUID(), requestHash: fingerprint,
      sources: { create: { documentId: source.id, documentSha256: fingerprint, relation: "SUPPORTS", location: {}, locationKey: "whole", lawMetadata: {} } } } });
    await db.documentResearchSource.create({ data: { documentId: f.document.id, researchRevisionId: research.id } });
    const saved = await delivery(f);
    await db.deliveryEvent.createMany({ data: Array.from({ length: 220 }, () => ({ deliveryId: saved.id, actorId: f.actor.id,
      requestKey: randomUUID(), requestFingerprint: fingerprint, kind: "REPLIED" as const, occurredAt: at, note: "不可泄露的交付回复" })) });
    const older = await db.clientActivity.create({ data: { clientId: f.client.id, authorId: f.actor.id, channel: "PHONE",
      content: "更早的授权沟通", occurredAt: new Date("2026-05-01T00:00:00Z"), requestKey: randomUUID(), requestHash: fingerprint } });
    await db.document.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
    const first = await readClientHistory(db, f.actor, { clientId: f.client.id });
    expect(first.items).toEqual([]); expect(first.nextCursor).toBeTruthy();
    const bytes = Buffer.from(first.nextCursor!, "base64url").toString("utf8");
    expect(bytes).not.toContain(at.toISOString()); expect(bytes).not.toContain(saved.sent.id);
    const next = await readClientHistory(db, f.actor, { clientId: f.client.id, cursor: first.nextCursor! });
    expect(next.items.some(row => row.id === older.id)).toBe(true); expect(next.nextCursor).toBeNull();
    expect(JSON.stringify(next)).not.toContain("不可泄露的交付回复");
    expect(next.items.some(row => row.source === "DELIVERY")).toBe(false);
  });

  it("已发出的历史游标不保留撤销后的下载资格", async () => {
    const name = `delivery-history-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "clients.read", scope: "OWN" }, { permissionKey: "matters.read", scope: "OWN" },
      { permissionKey: "matters.write", scope: "OWN" }, { permissionKey: "matters.export", scope: "OWN" },
      { permissionKey: "documents.read", scope: "OWN" }, { permissionKey: "documents.download", scope: "OWN" },
    ] } } }); roles.push(role.id);
    const f = await fixture("CUSTOM", role.id), saved = await delivery(f);
    await db.deliveryEvent.createMany({ data: Array.from({ length: 24 }, () => ({ deliveryId: saved.id, actorId: f.actor.id,
      requestKey: randomUUID(), requestFingerprint: fingerprint, kind: "REPLIED" as const, occurredAt: at, note: "撤权后不再读取的回复" })) });
    const first = await readClientHistory(db, f.actor, { clientId: f.client.id });
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
    await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: "documents.download" } } });
    const next = await readClientHistory(db, f.actor, { clientId: f.client.id, cursor: first.nextCursor! });
    expect(next.items.some(row => row.source === "DELIVERY")).toBe(false);
    expect(JSON.stringify(next)).not.toContain("撤权后不再读取的回复");
  });

  it("回复凭据撤回后客户历史不下发该事件正文，原无凭据发送事实仍可查", async () => {
    const f = await fixture(), saved = await delivery(f);
    const proof = await db.document.create({ data: { name: "合成回复凭据.txt", path: `synthetic/${randomUUID()}.txt`,
      matterId: f.matter.id, uploadedById: f.actor.id, sha256: fingerprint, tags: [] } }); documents.push(proof.id);
    const reply = await registerDeliveryEventForActor(f.actor.id, { deliveryId: saved.id, requestKey: randomUUID(), kind: "REPLIED",
      occurredAt: at.toISOString(), proofDocumentId: proof.id, note: "依赖被撤回凭据的客户原意" });
    expect((await readClientHistory(db, f.actor, { clientId: f.client.id })).items.some(row => row.id === reply.id)).toBe(true);
    await db.document.update({ where: { id: proof.id }, data: { deletedAt: new Date() } });
    const page = await readClientHistory(db, f.actor, { clientId: f.client.id });
    expect(page.items.some(row => row.id === reply.id)).toBe(false);
    expect(page.items.some(row => row.id === saved.sent.id)).toBe(true);
    expect(JSON.stringify(page)).not.toContain("依赖被撤回凭据的客户原意");
  });
});
