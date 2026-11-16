// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import PizZip from "pizzip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { sha256 } from "@/lib/storage/crypto";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("归档审批及 ZIP 测试仅允许独立的 _test 数据库");
  return { url, actor: null as WorkspaceActor | null, files: new Map<string, Buffer>(),
    onRead: null as ((path: string) => Promise<void>) | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/archive_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only the session boundary, Next cache and blob adapter are replaced. Approval, closure,
// authorization, transactions and ZIP generation are real. No real filesystem stores bytes.
vi.mock("@/lib/storage", () => ({ storage: {
  readFile: vi.fn(async (path: string) => {
    const bytes = config.files.get(path);
    if (!bytes) throw new Error("合成归档原件不存在");
    await config.onRead?.(path);
    return Buffer.from(bytes);
  }),
} }));

import { prisma as db } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { requireSession } from "@/lib/auth/session";
import { resolveRoleUser } from "@/lib/roles/service";
import { approvalTransaction, assertApprovalItem } from "@/lib/approvals/service";
import { ARCHIVE_MANUAL_CHECKS, ARCHIVE_SNAPSHOT_VERSION, requiredArchiveVerificationIds, type ArchiveReviewSnapshot } from "@/lib/archive/snapshot";
import { approveArchiveRecord } from "@/server/archive/actions";
import { assertClosureReady, saveClosureTx } from "@/server/archive/closure";
import { buildArchiveZip, type buildArchiveManifest } from "@/server/archive/export";
import { createArchiveDocumentSnapshots } from "@/server/archive/verification";

const users: string[] = [], matters: string[] = [], documents: string[] = [], roles: string[] = [], groups: string[] = [], policies: string[] = [];
const stamp = new Date("2026-07-02T03:04:05.000Z"), requestHash = "a".repeat(64);
const packagePermissions = ["matters.export", "matters.read", "documents.download", "finance.read", "archive.read"] as const;
type Manifest = Awaited<ReturnType<typeof buildArchiveManifest>>;

async function actorFor(user: { id: string; name: string; email: string; role: string; systemRole: string; avatar: string | null }): Promise<WorkspaceActor> {
  return { id: user.id, name: user.name, email: user.email, systemRole: user.systemRole, avatar: user.avatar,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}

async function fixture() {
  const roleName = `archive-m3-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName,
    permissions: { create: [...packagePermissions, "archive.submit", "documents.read"].map(permissionKey => ({ permissionKey, scope: "OWN" })) } } });
  roles.push(role.id);
  const user = await db.user.create({ data: { name: "合成归档经办人", email: `${randomUUID()}@example.invalid`,
    passwordHash: "disabled-synthetic-only", role: "CUSTOM", roleDefinitionId: role.id } }); users.push(user.id);
  const reviewer = await db.user.create({ data: { name: "合成独立归档审批人", email: `${randomUUID()}@example.invalid`,
    passwordHash: "disabled-synthetic-only", role: "LAWYER" } }); users.push(reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成归档授权-${randomUUID()}`,
    members: { create: { userId: reviewer.id } },
    rules: { create: { action: "ARCHIVE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
  const matter = await db.matter.create({ data: { ownerId: user.id, internalCode: `ARCHIVE-M3-${randomUUID()}`, title: "合成归档审批时事项名称" } }); matters.push(matter.id);
  async function document(name: string, produced = false) {
    const bytes = Buffer.from(`合成原件：${name}。无真实客户资料。`, "utf8"), path = `archive-m3-test/${randomUUID()}.txt`;
    config.files.set(path, bytes);
    const row = await db.document.create({ data: { name, matterId: matter.id, uploadedById: user.id, path, tags: [],
      mimeType: "text/plain", size: bytes.length, sha256: sha256(bytes),
      sourceOrigin: produced ? "TEAM_PRODUCED" : "CLIENT_PROVIDED", status: produced ? "APPROVED" : "DRAFT" } });
    documents.push(row.id); return row;
  }
  const output = await document("合成选定旧分析稿.txt", true), source = await document("合成研究原文.txt"), issueSource = await document("合成争点来源.txt");
  const basis = await document("合成复核依据.txt"), revision = await document("合成后续修订稿.txt", true), proof = await document("合成发送凭据.txt");
  const unselected = await document("合成未选材料.txt", true);
  await db.document.update({ where: { id: output.id }, data: { familyId: output.id, isLatest: false } });
  await db.document.update({ where: { id: revision.id }, data: { familyId: output.id, version: 2, status: "DRAFT" } });
  const issue = await db.evidenceItem.create({ data: { matterId: matter.id, title: "合成待核争点", content: "合成原始争点正文", kind: "ISSUE", createdById: user.id } });
  const issueRevision = await db.evidenceItemRevision.create({ data: { evidenceItemId: issue.id, revision: 1, title: issue.title,
    content: issue.content, kind: "ISSUE", editedById: user.id, sourceSnapshot: [{ id: `source:${issueSource.id}`,
      documentId: issueSource.id, documentSha256: issueSource.sha256, relation: "SUPPORTS", location: { kind: "UNLOCATED", reason: "NO_MAPPING" },
      parseRunId: null, anchorId: null, legacy: false }] } });
  const research = await db.researchRevision.create({ data: { matterId: matter.id, seriesId: randomUUID(), version: 1,
    issueId: issue.id, issueRevisionId: issueRevision.id, question: "合成研究问题", purpose: "合成归档验收", jurisdiction: "合成法域",
    issueSnapshot: { evidenceItemId: issue.id, matterId: matter.id, revision: 1, revisionId: issueRevision.id,
      title: issueRevision.title, content: issueRevision.content, kind: "ISSUE", eventDate: { precision: "UNKNOWN", start: null, end: null, text: null },
      sourceSnapshot: issueRevision.sourceSnapshot, confirmedById: null, confirmedAt: null, capturedAt: new Date().toISOString(), capturedById: user.id },
    relevantDate: "2025-01-01", researchedAt: stamp, scope: "合成有限范围", queryLog: [{ query: "合成查询", result: "已读选定原文" }],
    rule: "合成规则", exceptions: "合成例外", supportingAnalysis: "合成支持分析", opposingAnalysis: "合成反向依据",
    conclusion: "合成有条件结论", unresolved: "原文适用性仍待核对", nextSteps: "人工续查", authorId: user.id,
    requestKey: randomUUID(), requestHash, sources: { create: { documentId: source.id, documentSha256: source.sha256!,
      relation: "SUPPORTS", location: { kind: "UNLOCATED", reason: "NO_MAPPING" }, locationKey: "UNLOCATED",
      lawMetadata: { version: "合成旧版", effectiveAt: "2025-01-01" } } } } });
  await db.documentResearchSource.createMany({ data: [{ documentId: output.id, researchRevisionId: research.id }, { documentId: unselected.id, researchRevisionId: research.id }] });
  const review = await db.documentReviewIssue.create({ data: { documentId: output.id, title: "合成引用需补核", basis: "合成复核意见",
    basisDocumentId: basis.id, createdById: user.id, requestId: randomUUID(), requestHash, version: 2, state: "WAITING_CHECK",
    events: { create: { kind: "RESPONSE", disposition: "PARTIAL", note: "部分接受，保留未决", revisionDocumentId: revision.id,
      revisionLocation: "第二段", actorId: user.id, version: 2, requestId: randomUUID(), requestHash } } } });
  await db.documentReviewIssue.create({ data: { documentId: unselected.id, title: "未选材料意见", basis: "不进入此包",
    createdById: user.id, requestId: randomUUID(), requestHash } });
  async function delivery(selected: typeof output[], purpose: string) {
    return db.deliveryRecord.create({ data: { matterId: matter.id, requestKey: randomUUID(), requestFingerprint: requestHash,
      purpose, recipientName: "合成接收人", recipientContact: "synthetic@example.invalid", disclosureScope: "仅本清单", unresolvedItems: "仍待客户决定",
      createdById: user.id, items: { create: selected.map((doc, index) => ({ documentId: doc.id, position: index + 1,
        documentName: doc.name, documentVersion: doc.version, documentSha256: doc.sha256!, size: doc.size })) } } });
  }
  const selectedDelivery = await delivery([output], "合成完整选入交付"), partialDelivery = await delivery([output, unselected], "合成未完整选入交付");
  await db.deliveryEvent.createMany({ data: (["EXPORTED", "SENT", "REPLIED"] as const).map(kind => ({ deliveryId: selectedDelivery.id,
    kind, actorId: user.id, occurredAt: stamp, requestKey: randomUUID(), requestFingerprint: requestHash,
    channel: kind === "SENT" ? "合成邮件" : null, note: kind === "REPLIED" ? "尚未决定" : null, proofDocumentId: kind === "SENT" ? proof.id : null })) });

  const policyBytes = Buffer.from("合成归档制度原文，仅用于测试。", "utf8"), policyPath = `archive-m3-test/${randomUUID()}-policy.txt`;
  config.files.set(policyPath, policyBytes);
  const policy = await db.firmFile.create({ data: { name: "合成归档制度.txt", category: "POLICY", tags: [], path: policyPath,
    mimeType: "text/plain", size: policyBytes.length, sha256: sha256(policyBytes), uploadedById: user.id } }); policies.push(policy.id);
  const snapshots = await createArchiveDocumentSnapshots({ matterId: matter.id, orderedDocumentIds: [output.id], itemIdsByDocumentId: new Map([[output.id, ["analysis"]]]) });
  const snapshot: ArchiveReviewSnapshot = {
    schemaVersion: ARCHIVE_SNAPSHOT_VERSION,
    policy: { configured: true, name: "合成归档制度", version: "synthetic-v1", effectiveAt: "2025-01-01", sourceFileId: policy.id,
      sourceFileName: policy.name, sourceFileSha256: policy.sha256! },
    checklist: { kind: "SYNTHETIC", title: "合成最小归档清单", items: [{ id: "analysis", label: "分析稿", required: true,
      autoGenerated: false, status: "ATTACHED", note: "合成逐项核验", documentIds: [output.id] }] },
    manualChecks: ARCHIVE_MANUAL_CHECKS.map(item => ({ ...item, confirmed: true, note: "合成人工核对" })),
    documents: snapshots, documentIds: [output.id],
    excludedDocuments: [source, issueSource, basis, revision, proof, unselected].map(doc => ({ id: doc.id, name: doc.name, folderName: null, size: doc.size })),
    submittedAt: stamp.toISOString(), previousRecordId: null,
  };
  await approvalTransaction(tx => saveClosureTx(tx, user.id, { matterId: matter.id, revision: null, financeOwnerId: null,
    serviceCompletedAt: stamp, reason: "合成服务已完成，无未处置业务或未结财务" }));
  const workflowSnapshot = await assertClosureReady(db, matter.id);
  expect(workflowSnapshot).not.toBeNull();
  // Seed the submission boundary only. This test does not exercise archiveMatter or cover/catalog rendering.
  const archive = await db.archiveRecord.create({ data: { matterId: matter.id, archiveNo: `SYNTHETIC-M3-${randomUUID()}`,
    summary: "合成结案小结", completedAt: stamp, closedReason: "OTHER", checklistJson: snapshot, missingItems: [],
    archivedBy: user.name, archivedById: user.id, archivedAt: stamp, status: "PENDING_REVIEW",
    workflowSnapshot: JSON.parse(JSON.stringify(workflowSnapshot)) as Prisma.InputJsonValue } });
  return { role, user, reviewer, matter, output, source, issueSource, basis, revision, proof, unselected,
    research, review, selectedDelivery, partialDelivery, archive, snapshot, actor: await actorFor(user), reviewerActor: await actorFor(reviewer) };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function approve(f: Fixture) {
  config.actor = f.reviewerActor;
  await expect(approveArchiveRecord({ archiveId: f.archive.id, verificationIds: requiredArchiveVerificationIds(f.snapshot),
    exceptionApproved: false, note: "合成独立审批人已逐项核验" })).resolves.toEqual({ ok: true });
  const row = await db.archiveRecord.findUniqueOrThrow({ where: { id: f.archive.id } });
  expect(row).toMatchObject({ status: "APPROVED", reviewedById: f.reviewer.id });
  expect(row.frozenManifest).not.toBeNull();
  return row.frozenManifest as unknown as Manifest;
}

describe.skipIf(!config.url)("M3 归档批准到实际 ZIP：真实 PostgreSQL、内存文件存储", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  beforeEach(() => { config.actor = null; config.onRead = null; vi.mocked(storage.readFile).mockClear(); });
  afterAll(async () => {
    config.onRead = null;
    await db.document.updateMany({ where: { id: { in: documents } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.firmFile.updateMany({ where: { id: { in: policies } }, data: { archivedAt: new Date() } });
    config.files.clear(); await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("真实批准固定三条 M3 关联；解包后清单与实际选定旧稿保持批准时内容", async () => {
    const f = await fixture(), frozen = await approve(f);
    expect(requireSession).toHaveBeenCalledWith("approval");
    expect((await db.matter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).toBe("ARCHIVED");
    const history = frozen.professionalHistory;
    expect(history.selectedDocumentIds).toEqual([f.output.id]);
    expect(history.research).toHaveLength(1);
    expect(history.research[0]).toMatchObject({ id: f.research.id, version: 1, issueRevisionId: f.research.issueRevisionId,
      checkedAt: null, opposingAnalysis: "合成反向依据", unresolved: "原文适用性仍待核对",
      sources: [{ documentId: f.source.id, documentSha256: f.source.sha256, lawMetadata: { version: "合成旧版" } }],
      outputDocuments: [{ documentId: f.output.id }] });
    expect(history.reviews).toHaveLength(1);
    expect(history.reviews[0]).toMatchObject({ id: f.review.id, state: "WAITING_CHECK",
      events: [{ disposition: "PARTIAL", revisionDocumentId: f.revision.id }] });
    expect(history.deliveries.map(row => row.id)).toEqual([f.selectedDelivery.id]);
    expect(history.deliveries[0]).toMatchObject({ recipientName: "合成接收人", disclosureScope: "仅本清单", unresolvedItems: "仍待客户决定" });
    expect(history.deliveries[0].events.map(row => row.kind).sort()).toEqual(["EXPORTED", "REPLIED", "SENT"]);
    expect(new Set(history.documentReferences.map(row => row.documentId))).toEqual(new Set([f.output.id, f.source.id, f.issueSource.id, f.basis.id, f.revision.id, f.proof.id]));
    expect(history.documentReferences.find(row => row.documentId === f.revision.id)?.documentVersion).toBe(2);
    const approvalAudit = await db.auditLog.findFirstOrThrow({ where: { targetId: f.archive.id, action: "ARCHIVE_APPROVE", detail: { path: ["policyVersion"], equals: "synthetic-v1" } } });
    expect(approvalAudit.userId).toBe(f.reviewer.id);

    const originalZip = await buildArchiveZip(f.archive.id, f.actor);
    await db.researchRevision.update({ where: { id: f.research.id }, data: { checkedAt: new Date(), checkedById: f.reviewer.id, checkNote: "批准后另行核对" } });
    await db.documentReviewEvent.create({ data: { issueId: f.review.id, kind: "CHECK", resolved: true, note: "批准后完成复核",
      actorId: f.reviewer.id, version: 3, requestId: randomUUID(), requestHash } });
    await db.documentReviewIssue.update({ where: { id: f.review.id }, data: { state: "RESOLVED", version: 3 } });
    await db.deliveryEvent.create({ data: { deliveryId: f.selectedDelivery.id, kind: "CONTENT_CONFIRMED", actorId: f.user.id,
      occurredAt: new Date(), note: "批准后收到内容确认", requestKey: randomUUID(), requestFingerprint: requestHash } });
    await db.matter.update({ where: { id: f.matter.id }, data: { title: "合成批准后更名" } });

    const exported = await buildArchiveZip(f.archive.id, f.actor), zip = new PizZip(exported.buffer);
    const zippedManifest = JSON.parse(zip.file(`${f.archive.archiveNo}/manifest.json`)!.asText());
    expect(zippedManifest).toEqual(frozen);
    expect(exported.buffer.equals(originalZip.buffer)).toBe(true);
    expect(exported).toMatchObject({ fileName: `${f.archive.archiveNo}.zip`, checksum: sha256(exported.buffer), size: exported.buffer.length });
    const materialPaths = Object.keys(zip.files).filter(path => path.includes("/材料/") && !zip.files[path].dir);
    expect(materialPaths).toHaveLength(1);
    expect(zip.file(materialPaths[0])!.asNodeBuffer()).toEqual(config.files.get(f.output.path));
    expect(materialPaths[0]).toContain(f.output.name);
    expect(zip.file(`${f.archive.archiveNo}/README.md`)!.asText()).toContain(f.matter.title);
    expect((await db.archiveRecord.findUniqueOrThrow({ where: { id: f.archive.id } })).frozenManifest).toEqual(frozen);
    expect(await db.deliveryEvent.count({ where: { deliveryId: f.selectedDelivery.id, kind: "EXPORTED" } })).toBe(1);
  });

  it("未逐项核验或批准前来源撤回均不产生批准、归档状态或冻结清单", async () => {
    const f = await fixture(); config.actor = f.reviewerActor;
    await expect(approveArchiveRecord({ archiveId: f.archive.id, verificationIds: [], exceptionApproved: false })).rejects.toThrow(/未完成审阅/);
    await db.document.update({ where: { id: f.source.id }, data: { deletedAt: new Date() } });
    await expect(approveArchiveRecord({ archiveId: f.archive.id, verificationIds: requiredArchiveVerificationIds(f.snapshot), exceptionApproved: false })).rejects.toThrow(/撤回/);
    expect(await db.archiveRecord.findUniqueOrThrow({ where: { id: f.archive.id } })).toMatchObject({ status: "PENDING_REVIEW", reviewedAt: null, frozenManifest: null });
    expect((await db.matter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).toBe(f.matter.status);
    expect(await db.auditLog.count({ where: { targetId: f.archive.id, action: "ARCHIVE_APPROVE" } })).toBe(0);
    expect(await db.timelineEvent.count({ where: { matterId: f.matter.id, eventType: "MATTER_ARCHIVED" } })).toBe(0);
    await expect(buildArchiveZip(f.archive.id, f.actor)).rejects.toThrow(/尚未批准/);
  });

  it("批准后来源及额外历史凭据撤回拒绝整包；读取字节期间撤回也被末尾复核拦截", async () => {
    const f = await fixture(), frozen = await approve(f);
    for (const document of [f.source, f.basis]) {
      await db.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
      vi.mocked(storage.readFile).mockClear();
      await expect(buildArchiveZip(f.archive.id, f.actor)).rejects.toThrow(/不可读取|撤回/);
      expect(storage.readFile).not.toHaveBeenCalled();
      await db.document.update({ where: { id: document.id }, data: { deletedAt: null } });
    }
    config.onRead = async path => {
      if (path !== f.output.path) return;
      config.onRead = null;
      await db.document.update({ where: { id: f.proof.id }, data: { deletedAt: new Date() } });
    };
    await expect(buildArchiveZip(f.archive.id, f.actor)).rejects.toThrow(/撤回/);
    expect(storage.readFile).toHaveBeenCalledWith(f.output.path);
    expect((await db.archiveRecord.findUniqueOrThrow({ where: { id: f.archive.id } })).frozenManifest).toEqual(frozen);
  });

  it("具体归档审批权不替代整包资格；撤销任一整包权限后旧 actor 也不能导出", async () => {
    const f = await fixture(), frozen = await approve(f);
    await expect(assertApprovalItem(f.reviewer.id, "ARCHIVE_APPROVE", f.archive.id)).resolves.toBeUndefined();
    vi.mocked(storage.readFile).mockClear();
    await expect(buildArchiveZip(f.archive.id, f.reviewerActor)).rejects.toThrow(/无权导出/);
    expect(storage.readFile).not.toHaveBeenCalled();
    await expect(buildArchiveZip(f.archive.id, f.actor)).resolves.toMatchObject({ fileName: `${f.archive.archiveNo}.zip` });
    for (const permissionKey of packagePermissions) {
      await db.rolePermission.delete({ where: { roleId_permissionKey: { roleId: f.role.id, permissionKey } } });
      vi.mocked(storage.readFile).mockClear();
      await expect(buildArchiveZip(f.archive.id, f.actor)).rejects.toThrow(/需要.*权限/);
      expect(storage.readFile).not.toHaveBeenCalled();
      await db.rolePermission.create({ data: { roleId: f.role.id, permissionKey, scope: "OWN" } });
    }
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(buildArchiveZip(f.archive.id, f.actor)).rejects.toThrow(/当前账号不可用/);
    expect((await db.archiveRecord.findUniqueOrThrow({ where: { id: f.archive.id } })).frozenManifest).toEqual(frozen);
  });
});
