// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/storage/crypto";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("归档专业历史仅允许独立的 _test 数据库");
  return { url };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/archive_test") };
});

import { prisma as db } from "@/lib/prisma";
import { buildArchiveProfessionalHistory, assertArchiveProfessionalHistoryAccess, type ArchiveProfessionalHistory } from "@/server/archive/professional-history";
import { saveMatterContext } from "@/server/matters/context-service";

const users: string[] = [], matters: string[] = [], documents: string[] = [];
const stamp = new Date("2026-07-02T03:04:05.000Z");
const fingerprint = "a".repeat(64);

// The metadata fixtures contain no stored bytes and do not claim an actual archive approval or export.
async function fixture() {
  const user = await db.user.create({ data: { name: "合成归档经办人", email: `${randomUUID()}@example.invalid`,
    passwordHash: "disabled-synthetic-only", role: "LAWYER" } }); users.push(user.id);
  const matter = await db.matter.create({ data: { ownerId: user.id, internalCode: `ARCHIVE-M3-${randomUUID()}`, title: "合成专业历史事项" } }); matters.push(matter.id);
  async function document(name: string, produced = false) {
    const row = await db.document.create({ data: { name, matterId: matter.id, uploadedById: user.id,
      path: `synthetic/${randomUUID()}.txt`, tags: [], sha256: sha256(Buffer.from(name)),
      sourceOrigin: produced ? "TEAM_PRODUCED" : "CLIENT_PROVIDED", status: produced ? "APPROVED" : "DRAFT" } });
    documents.push(row.id); return row;
  }
  const output = await document("合成已选旧稿.txt", true), source = await document("合成法源.txt"), issueSource = await document("合成争点来源.txt");
  const basis = await document("合成复核依据.txt"), revision = await document("合成后续修订稿.txt", true), proof = await document("合成发送凭据.txt");
  const unselected = await document("合成未选材料.txt", true);
  await db.document.update({ where: { id: output.id }, data: { familyId: output.id, isLatest: false } });
  await db.document.update({ where: { id: revision.id }, data: { familyId: output.id, version: 2, status: "DRAFT" } });
  const issue = await db.evidenceItem.create({ data: { matterId: matter.id, title: "合成待核争点", content: "合成争点正文", kind: "ISSUE", createdById: user.id } });
  const issueRevision = await db.evidenceItemRevision.create({ data: { evidenceItemId: issue.id, revision: 1, title: issue.title,
    content: issue.content, kind: "ISSUE", editedById: user.id, sourceSnapshot: [{ id: `source:${issueSource.id}`,
      documentId: issueSource.id, documentSha256: issueSource.sha256, relation: "SUPPORTS", location: { kind: "UNLOCATED", reason: "NO_MAPPING" },
      parseRunId: null, anchorId: null, legacy: false }] } });
  const research = await db.researchRevision.create({ data: { matterId: matter.id, seriesId: randomUUID(), version: 1,
    issueId: issue.id, issueRevisionId: issueRevision.id, question: "合成研究问题", purpose: "合成验收", jurisdiction: "合成法域",
    issueSnapshot: { evidenceItemId: issue.id, matterId: matter.id, revision: 1, revisionId: issueRevision.id,
      title: issueRevision.title, content: issueRevision.content, kind: "ISSUE", eventDate: { precision: "UNKNOWN", start: null, end: null, text: null },
      sourceSnapshot: issueRevision.sourceSnapshot, confirmedById: null, confirmedAt: null, capturedAt: new Date().toISOString(), capturedById: user.id },
    relevantDate: "2025-01-01", researchedAt: stamp, scope: "合成有限范围", queryLog: [{ query: "合成查询", result: "已读选定原文" }],
    rule: "合成规则", exceptions: "合成例外", supportingAnalysis: "合成支持", opposingAnalysis: "合成反向依据",
    conclusion: "合成有条件结论", unresolved: "仍待核对", nextSteps: "人工续查", authorId: user.id,
    requestKey: randomUUID(), requestHash: fingerprint, sources: { create: { documentId: source.id, documentSha256: source.sha256!,
      relation: "SUPPORTS", location: { kind: "UNLOCATED", reason: "NO_MAPPING" }, locationKey: "UNLOCATED", lawMetadata: { version: "合成旧版" } } } } });
  await db.documentResearchSource.createMany({ data: [{ documentId: output.id, researchRevisionId: research.id }, { documentId: unselected.id, researchRevisionId: research.id }] });
  const review = await db.documentReviewIssue.create({ data: { documentId: output.id, title: "合成引用需补核", basis: "合成复核意见",
    basisDocumentId: basis.id, createdById: user.id, requestId: randomUUID(), requestHash: fingerprint, version: 2, state: "WAITING_CHECK",
    events: { create: { kind: "RESPONSE", disposition: "PARTIAL", note: "部分接受，保留未决", revisionDocumentId: revision.id,
      revisionLocation: "第二段", actorId: user.id, version: 2, requestId: randomUUID(), requestHash: fingerprint } } } });
  await db.documentReviewIssue.create({ data: { documentId: unselected.id, title: "未选材料的意见", basis: "不应进入此包",
    createdById: user.id, requestId: randomUUID(), requestHash: fingerprint } });
  async function delivery(ids: typeof output[], purpose: string) {
    return db.deliveryRecord.create({ data: { matterId: matter.id, requestKey: randomUUID(), requestFingerprint: fingerprint,
      purpose, recipientName: "合成接收人", recipientContact: "synthetic@example.invalid", disclosureScope: "本清单", unresolvedItems: "仍待答复",
      createdById: user.id, items: { create: ids.map((document, index) => ({ documentId: document.id, position: index + 1,
        documentName: document.name, documentVersion: document.version, documentSha256: document.sha256! })) } } });
  }
  const selectedDelivery = await delivery([output], "合成完整选入的交付");
  const partialDelivery = await delivery([output, unselected], "合成未完整选入的交付");
  await db.deliveryEvent.createMany({ data: ["EXPORTED", "SENT", "REPLIED"].map(kind => ({ deliveryId: selectedDelivery.id,
    kind: kind as "EXPORTED" | "SENT" | "REPLIED", actorId: user.id, occurredAt: stamp, requestKey: randomUUID(), requestFingerprint: fingerprint,
    channel: kind === "SENT" ? "合成邮件" : null, note: kind === "REPLIED" ? "客户尚未决定" : null,
    proofDocumentId: kind === "SENT" ? proof.id : null })) });
  return { user, matter, output, source, issueSource, basis, revision, proof, unselected, research, review, selectedDelivery, partialDelivery };
}

describe.skipIf(!config.url)("M3 归档专业历史：真实 PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.document.updateMany({ where: { id: { in: documents } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });

  it("只冻结所选文书的真实采用输入和来源版本；之后hash变化或撤回不改原快照而拒绝整包", async () => {
    const f = await fixture();
    const contextSource = await db.document.create({ data: { name: "合成指示唯一来源.txt", matterId: f.matter.id, uploadedById: f.user.id,
      path: `synthetic/${randomUUID()}.txt`, tags: [], sha256: "d".repeat(64) } }); documents.push(contextSource.id);
    const input = { matterId: f.matter.id, requestKey: randomUUID(), kind: "INSTRUCTION" as const, visibility: "MATTER" as const,
      content: "合成已选固定指示", sourceDescription: "合成来源原件", sourceDocumentId: contextSource.id, occurredAt: new Date().toISOString() };
    const chosen = await saveMatterContext(db, f.user, input);
    const excluded = await saveMatterContext(db, f.user, { ...input, requestKey: randomUUID(), content: "未选文书的指示不进入快照" });
    // Synthetic metadata fixture only; creation of actual output/relations is covered by the generation/ingest suites.
    await db.documentContextInput.createMany({ data: [
      { documentId: f.output.id, contextRecordId: chosen.id, currentRecordIdAtAdoption: chosen.id },
      { documentId: f.unselected.id, contextRecordId: excluded.id, currentRecordIdAtAdoption: excluded.id },
    ] });
    const frozen = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id]);
    expect(frozen.documentContextInputs).toHaveLength(1);
    expect(frozen.documentContextInputs[0]).toMatchObject({ documentId: f.output.id, contextRecordId: chosen.id,
      currentRecordIdAtAdoption: chosen.id, adoptedConfirmedAt: null, adoptedAt: f.output.createdAt.toISOString(), adoptedBy: { id: f.user.id }, record: { content: input.content } });
    expect(frozen.documentReferences.find(row => row.documentId === contextSource.id)).toMatchObject({ documentVersion: contextSource.version, documentSha256: contextSource.sha256, roles: ["CONTEXT_SOURCE"] });
    const unchanged = JSON.stringify(frozen);
    expect(unchanged).not.toContain("未选文书的指示不进入快照");
    await assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen);
    await db.document.update({ where: { id: contextSource.id }, data: { sha256: "e".repeat(64) } });
    await expect(assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen)).rejects.toThrow("版本已变化");
    await db.document.update({ where: { id: contextSource.id }, data: { deletedAt: new Date() } });
    await expect(assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen)).rejects.toThrow();
    expect(JSON.stringify(frozen)).toBe(unchanged);
  });

  it("只固定选中具体稿件的三条链，来源和修订凭据仅形成引用", async () => {
    const f = await fixture(), frozen = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id]);
    expect(frozen.selectedDocumentIds).toEqual([f.output.id]);
    expect(frozen.research).toHaveLength(1);
    expect(frozen.research[0].outputDocuments.map(row => row.documentId)).toEqual([f.output.id]);
    expect(frozen.research[0]).toMatchObject({ checkedAt: null, opposingAnalysis: "合成反向依据", unresolved: "仍待核对" });
    expect(frozen.reviews.map(row => row.id)).toEqual([f.review.id]);
    expect(frozen.reviews[0]).toMatchObject({ state: "WAITING_CHECK", events: [{ disposition: "PARTIAL", revisionDocumentId: f.revision.id }] });
    expect(frozen.deliveries.map(row => row.id)).toEqual([f.selectedDelivery.id]);
    expect(frozen.deliveries[0].events.map(row => row.kind).sort()).toEqual(["EXPORTED", "REPLIED", "SENT"]);
    expect(new Set(frozen.documentReferences.map(row => row.documentId))).toEqual(new Set([f.output.id, f.source.id, f.issueSource.id, f.basis.id, f.revision.id, f.proof.id]));
    expect(frozen.documentReferences.find(row => row.documentId === f.revision.id)?.documentVersion).toBe(2);
    expect(JSON.stringify(frozen)).not.toContain("synthetic/");
    expect(JSON.stringify(frozen)).not.toContain("requestHash");
    await assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen);
  });

  it("已有 frozenManifest 不用后来回复、复核状态或同族新稿补写", async () => {
    const f = await fixture(), frozen = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id]);
    const archive = await db.archiveRecord.create({ data: { matterId: f.matter.id, archiveNo: `SYNTHETIC-M3-${randomUUID()}`,
      summary: "合成冻结测试", checklistJson: {}, missingItems: [], archivedBy: f.user.name, archivedById: f.user.id,
      status: "APPROVED", frozenManifest: { professionalHistory: frozen } as Prisma.InputJsonValue } });
    await db.documentReviewEvent.create({ data: { issueId: f.review.id, kind: "CHECK", resolved: true, note: "后来完成复核",
      actorId: f.user.id, version: 3, requestId: randomUUID(), requestHash: fingerprint } });
    await db.documentReviewIssue.update({ where: { id: f.review.id }, data: { state: "RESOLVED", version: 3 } });
    await db.deliveryEvent.create({ data: { deliveryId: f.selectedDelivery.id, kind: "CONTENT_CONFIRMED", actorId: f.user.id,
      occurredAt: stamp, note: "后来收到内容确认", requestKey: randomUUID(), requestFingerprint: fingerprint } });
    const current = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id, f.revision.id]);
    expect(current.reviews[0].state).toBe("RESOLVED");
    expect(current.deliveries[0].events).toHaveLength(4);
    const stored = await db.archiveRecord.findUniqueOrThrow({ where: { id: archive.id }, select: { frozenManifest: true } });
    const original = (stored.frozenManifest as unknown as { professionalHistory: ArchiveProfessionalHistory }).professionalHistory;
    await assertArchiveProfessionalHistoryAccess(db, f.user.id, original);
    expect(original).toEqual(frozen);
    expect(original.reviews[0].state).toBe("WAITING_CHECK");
    expect(original.deliveries[0].events).toHaveLength(3);
    expect(original.selectedDocumentIds).toEqual([f.output.id]);
  });

  it("冻结引用被撤回时整包资格拒绝，不改取同族当前稿", async () => {
    const f = await fixture(), frozen = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id]);
    await db.document.update({ where: { id: f.source.id }, data: { deletedAt: new Date() } });
    await expect(assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen)).rejects.toThrow(/撤回/);
    expect(frozen.deliveries[0].items[0].documentId).toBe(f.output.id);
    expect(frozen.selectedDocumentIds).not.toContain(f.revision.id);
    await expect(buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id])).rejects.toThrow(/撤回/);
  });

  it("额外复核依据的登记 hash 变化或当前账号停用拒绝冻结正文", async () => {
    const f = await fixture(), frozen = await buildArchiveProfessionalHistory(db, f.matter.id, [f.output.id]);
    await db.document.update({ where: { id: f.basis.id }, data: { sha256: "b".repeat(64) } });
    await expect(assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen)).rejects.toThrow(/版本已变化/);
    await db.document.update({ where: { id: f.basis.id }, data: { sha256: f.basis.sha256 } });
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(assertArchiveProfessionalHistoryAccess(db, f.user.id, frozen)).rejects.toThrow(/无权/);
  });
});
