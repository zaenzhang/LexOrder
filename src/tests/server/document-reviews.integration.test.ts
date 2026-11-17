// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// The coordinator migrates and runs this disposable database in its own supervisor.
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("文书复核测试仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});

import { prisma as db } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { checkDocumentReviewIssue, createDocumentReviewIssue, readDocumentReview, readDocumentReviewSourcePage, respondDocumentReviewIssue } from "@/server/document-reviews/service";

const userIds: string[] = [], roleIds: string[] = [], matterIds: string[] = [], documentIds: string[] = [], groupIds: string[] = [];
async function user(roleDefinitionId?: string) {
  const row = await db.user.create({ data: { name: roleDefinitionId ? "合成独立审批人" : "合成文书经办人",
    email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: roleDefinitionId ? "CUSTOM" : "LAWYER", roleDefinitionId } });
  userIds.push(row.id); return row;
}
async function fixture() {
  const owner = await user();
  const role = await db.roleDefinition.create({ data: { name: `合成仅审批-${randomUUID()}`, normalizedName: `review-${randomUUID()}` } });
  roleIds.push(role.id);
  const reviewer = await user(role.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成文书审批-${randomUUID()}`,
    members: { create: { userId: reviewer.id } }, rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } });
  groupIds.push(group.id);
  const matter = await db.matter.create({ data: { title: "合成文书复核事项", internalCode: `REVIEW-${randomUUID()}`, ownerId: owner.id } });
  matterIds.push(matter.id);
  const original = await document({ owner, matter }, { status: "PENDING_REVIEW", name: "合成待审法律意见.docx" });
  return { owner, reviewer, role, group, matter, original };
}
async function document(f: { owner: { id: string }; matter: { id: string } }, data: Partial<Prisma.DocumentUncheckedCreateInput> = {}) {
  const row = await db.document.create({ data: { name: "合成依据.pdf", path: `review-test/${randomUUID()}.pdf`, mimeType: "application/pdf",
    sha256: "a".repeat(64), uploadedById: f.owner.id, matterId: f.matter.id, tags: [], ...data } });
  documentIds.push(row.id); return row;
}
function issueInput(documentId: string, basisDocumentId: string | null = null) {
  return { requestId: randomUUID(), documentId, title: "金额构成与请求合计不符", location: "第 2 页第 3 段", basis: "逐项核对本金和费用，并说明差额。", basisDocumentId };
}
function responseInput(issueId: string, expectedVersion = 1) {
  return { requestId: randomUUID(), issueId, expectedVersion, disposition: "PARTIAL" as const, note: "接受金额更正；利息计算范围保留，理由见说明。",
    revisionDocumentId: null as string | null, revisionLocation: null as string | null };
}
function checkInput(issueId: string, expectedVersion: number, resolved = true) {
  return { requestId: randomUUID(), issueId, expectedVersion, resolved, note: resolved ? "已核对本条说明和实际修订位置。" : "依据仍不充分，保留未解决。" };
}

describe.skipIf(!databaseUrl)("具体文书人工审校：真实 PG", () => {
  beforeAll(async () => { vi.stubEnv("NEXTAUTH_SECRET", "synthetic-review-pagination-secret"); await db.$connect(); });
  afterAll(async () => {
    // Keep immutable review and audit history; only these synthetic actors and objects retire.
    await db.document.updateMany({ where: { id: { in: documentIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groupIds } }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roleIds } }, data: { active: false } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("独立审批人可提问和复核，不能回应、读取整案或凭问题关闭批准稿件", async () => {
    const f = await fixture(), other = await document(f);
    expect(await db.rolePermission.count({ where: { roleId: f.role.id } })).toBe(0);
    const before = await readDocumentReview(f.reviewer.id, f.original.id);
    expect(before).toMatchObject({ canCreate: true, canCheck: true, canRespond: false, sourceOptions: [], revisionOptions: [] });
    expect(await canReadDocument(f.reviewer.id, other)).toBe(false);
    const created = await createDocumentReviewIssue(f.reviewer.id, issueInput(f.original.id));
    await expect(respondDocumentReviewIssue(f.reviewer.id, responseInput(created.id))).rejects.toThrow("本案办理人员");
    await expect(checkDocumentReviewIssue(f.owner.id, checkInput(created.id, 1))).rejects.toThrow("当前合格审批人");
    await expect(checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, 1))).rejects.toThrow("状态已变化");
    const response = await respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id), disposition: "REJECT", note: "不接受；该合计已扣除对方认可的支付，原文无需修订。" });
    expect(await db.documentReviewIssue.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ state: "WAITING_CHECK", version: 2 });
    await checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, response.version));
    expect(await db.document.findUniqueOrThrow({ where: { id: f.original.id } })).toMatchObject({ status: "PENDING_REVIEW", approvedById: null });
    expect(await db.documentReviewIssue.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ state: "RESOLVED", version: 3 });
    expect(await db.documentReviewEvent.findMany({ where: { issueId: created.id }, orderBy: { version: "asc" } })).toMatchObject([
      { kind: "RESPONSE", disposition: "REJECT", revisionDocumentId: null, resolved: null, actorId: f.owner.id },
      { kind: "CHECK", disposition: null, resolved: true, actorId: f.reviewer.id },
    ]);
    await expect(respondDocumentReviewIssue(f.owner.id, responseInput(created.id, 3))).rejects.toThrow("已处理");
    expect(await db.auditLog.count({ where: { targetType: "DocumentReviewIssue", targetId: created.id } })).toBe(3);
  });

  it("作者只能关联同一文书族的真实后续版，旧批准不转给新稿，缺修订读取权不能完成原文复核", async () => {
    const f = await fixture();
    await db.document.update({ where: { id: f.original.id }, data: { familyId: f.original.id, isLatest: false, status: "APPROVED", approvedById: f.reviewer.id, approvedAt: new Date() } });
    const revision = await document(f, { name: "合成法律意见第二版.docx", familyId: f.original.id, version: 2, status: "DRAFT" });
    const unrelated = await document(f, { version: 3 });
    const otherMatter = await db.matter.create({ data: { title: "合成别案", internalCode: `OTHER-REVIEW-${randomUUID()}`, ownerId: f.owner.id } });
    matterIds.push(otherMatter.id);
    const crossMatter = await document({ owner: f.owner, matter: otherMatter }, { familyId: f.original.id, version: 4, isLatest: false });
    const created = await createDocumentReviewIssue(f.reviewer.id, issueInput(f.original.id));
    for (const invalid of [f.original, unrelated, crossMatter]) {
      await expect(respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id), revisionDocumentId: invalid.id, revisionLocation: "第 2 页" })).rejects.toThrow("实际产生的后续修订版本");
    }
    await expect(respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id), revisionDocumentId: revision.id })).rejects.toThrow("实际修订位置");
    const response = await respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id), revisionDocumentId: revision.id, revisionLocation: "第 2 页金额表" });
    const restricted = (await readDocumentReview(f.reviewer.id, f.original.id)).issues[0];
    expect(restricted).toMatchObject({ canResolve: false, events: [{ revisionUnavailable: true, note: null, revisionDocument: null }] });
    await expect(checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, response.version))).rejects.toThrow("修订文书不可读取");
    const unresolved = await checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, response.version, false));
    expect((await readDocumentReview(f.reviewer.id, f.original.id)).issues[0].events[1]).toMatchObject({ revisionUnavailable: true, note: null });
    await db.document.update({ where: { id: revision.id }, data: { status: "PENDING_REVIEW" } });
    const next = await respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id, unresolved.version), revisionDocumentId: revision.id, revisionLocation: "第 2 页金额表" });
    await checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, next.version));
    expect(await db.document.findUniqueOrThrow({ where: { id: f.original.id } })).toMatchObject({ status: "APPROVED", approvedById: f.reviewer.id });
    expect(await db.document.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ status: "PENDING_REVIEW", approvedById: null });
    expect((await readDocumentReview(f.reviewer.id, f.original.id)).issues[0].events[2].revisionDocument?.id).toBe(revision.id);
  });

  it("缺少明确文书族仍可提问和回应，但不猜测版本关系或关联看似后续的文书", async () => {
    const f = await fixture();
    const claimedRevision = await document(f, { familyId: f.original.id, version: 2, name: "合成不可推断的修订.docx" });
    expect(f.original.familyId).toBeNull();
    const view = await readDocumentReview(f.owner.id, f.original.id);
    expect(view).toMatchObject({ document: { id: f.original.id }, canCreate: true, canRespond: true, revisionOptions: [] });
    const created = await createDocumentReviewIssue(f.owner.id, issueInput(f.original.id));
    await expect(respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id), revisionDocumentId: claimedRevision.id,
      revisionLocation: "第 2 页" })).rejects.toThrow("缺少明确的版本关系");
    await respondDocumentReviewIssue(f.owner.id, responseInput(created.id));
    expect(await db.documentReviewIssue.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ state: "WAITING_CHECK", version: 2 });
    expect((await db.document.findUniqueOrThrow({ where: { id: f.original.id } })).familyId).toBeNull();
    expect(await db.documentReviewEvent.count({ where: { issueId: created.id } })).toBe(1);
  });

  it("依据超过100份仍可有界续查，页外所选旧版独立读取并以确切ID保存", async () => {
    const f = await fixture();
    const old = await document(f, { name: "G07-合成旧依据", version: 2, createdAt: new Date("2020-01-01T00:00:00.000Z") });
    await db.document.update({ where: { id: old.id }, data: { familyId: old.id, isLatest: false } });
    const newest = await document(f, { name: "G07-合成新依据", familyId: old.id, version: 3, createdAt: new Date("2026-01-01T00:00:00.000Z") });
    await db.document.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ name: `G07-批量合成依据-${index}`, path: `review-test/${randomUUID()}.pdf`,
      mimeType: "application/pdf", sha256: "a".repeat(64), uploadedById: f.owner.id, matterId: f.matter.id, tags: [], createdAt: new Date("2026-01-01T00:00:00.000Z") })) });
    const candidates = await db.document.findMany({ where: { matterId: f.matter.id, name: { startsWith: "G07-" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    documentIds.push(...candidates.map(row => row.id));
    const first = await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, query: " G07- ", selectedId: old.id });
    expect(first.items).toHaveLength(20); expect(first.items.some(row => row.id === old.id)).toBe(false);
    expect(first.selected).toEqual({ id: old.id, document: { id: old.id, name: old.name, version: 2,
      pageCount: null, isPdf: true, hasIdentity: true } });
    const seen = first.items.map(row => row.id); let cursor = first.nextCursor;
    while (cursor) {
      const next = await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, query: "G07-", cursor, selectedId: old.id });
      expect(next.items.length).toBeLessThanOrEqual(20); seen.push(...next.items.map(row => row.id)); cursor = next.nextCursor;
    }
    expect(seen).toEqual(candidates.map(row => row.id)); expect(new Set(seen).size).toBe(103); expect(seen.at(-1)).toBe(old.id);
    const named = await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, query: old.name, selectedId: old.id });
    expect(named.items.map(row => row.id)).toEqual([old.id]); expect(named.items.some(row => row.id === newest.id)).toBe(false);
    const saved = await createDocumentReviewIssue(f.owner.id, issueInput(f.original.id, old.id));
    expect((await readDocumentReview(f.owner.id, f.original.id)).issues.find(row => row.id === saved.id)?.basisDocument).toMatchObject({ id: old.id, version: 2 });
  });

  it("依据续查不能借独立审批枚举整案，所选别案/已删除版本明确不可读且归档后拒绝继续", async () => {
    const f = await fixture(), basis = await document(f);
    expect((await readDocumentReview(f.reviewer.id, f.original.id)).canBrowseSources).toBe(false);
    await expect(readDocumentReviewSourcePage(f.reviewer.id, { documentId: f.original.id })).rejects.toThrow("不能查找本案依据");
    const other = await fixture();
    const cross = await document(other);
    await db.matterMember.create({ data: { matterId: other.matter.id, userId: f.owner.id } });
    const outside = await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, selectedId: cross.id });
    expect(outside.selected).toEqual({ id: cross.id, document: null });
    await db.document.update({ where: { id: basis.id }, data: { deletedAt: new Date() } });
    expect((await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, selectedId: basis.id })).selected)
      .toEqual({ id: basis.id, document: null });
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id })).rejects.toThrow("不能查找本案依据");
    const standalone = await document(f, { matterId: null });
    expect(await readDocumentReview(f.owner.id, standalone.id)).toMatchObject({ canRespond: true, canBrowseSources: false });
  });

  it("依据游标绑定当前用户、被复核原文与规范化名称，不可跨查询或对象复用", async () => {
    const f = await fixture();
    await db.document.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ name: `合成续查-${index}`, path: `review-test/${randomUUID()}.pdf`,
      mimeType: "application/pdf", sha256: "a".repeat(64), uploadedById: f.owner.id, matterId: f.matter.id, tags: [] })) });
    documentIds.push(...(await db.document.findMany({ where: { matterId: f.matter.id }, select: { id: true } })).map(row => row.id));
    const cursor = (await readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, query: "合成续查" })).nextCursor!;
    const anotherDocument = await document(f), teammate = await user();
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: teammate.id } });
    for (const [userId, documentId, query] of [[f.owner.id, f.original.id, "不同名称"], [f.owner.id, anotherDocument.id, "合成续查"], [teammate.id, f.original.id, "合成续查"]]) {
      await expect(readDocumentReviewSourcePage(userId, { documentId, query, cursor })).rejects.toThrow("位置已失效");
    }
    await expect(readDocumentReviewSourcePage(f.owner.id, { documentId: f.original.id, query: "合成续查", cursor: `${cursor}x` })).rejects.toThrow("位置已失效");
  });

  it("不可读依据遮蔽原文和处理说明；不能确认已核对，撤销资格和归档阻止重放", async () => {
    const f = await fixture(), basis = await document(f, { name: "合成仅经办可读的金额明细.pdf" });
    const input = { ...issueInput(f.original.id, basis.id), basis: "仅在授权材料内展示的合成明细" };
    const created = await createDocumentReviewIssue(f.owner.id, input);
    const response = await respondDocumentReviewIssue(f.owner.id, responseInput(created.id));
    const view = (await readDocumentReview(f.reviewer.id, f.original.id)).issues[0];
    expect(view).toMatchObject({ basis: null, basisUnavailable: true, basisDocument: null, canResolve: false, events: [{ note: null }] });
    await expect(checkDocumentReviewIssue(f.reviewer.id, checkInput(created.id, response.version))).rejects.toThrow("依据不可读取");
    const check = checkInput(created.id, response.version, false);
    await checkDocumentReviewIssue(f.reviewer.id, check);
    await db.approvalPermissionMember.update({ where: { groupId_userId: { groupId: f.group.id, userId: f.reviewer.id } }, data: { active: false } });
    await expect(checkDocumentReviewIssue(f.reviewer.id, check)).rejects.toThrow(/无权读取|当前合格审批人/);
    await db.document.update({ where: { id: basis.id }, data: { deletedAt: new Date() } });
    await expect(createDocumentReviewIssue(f.owner.id, input)).rejects.toThrow("依据材料不可读取");
    await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED" } });
    await expect(respondDocumentReviewIssue(f.owner.id, responseInput(created.id, 3))).rejects.toThrow("案件已归档");
    expect(await db.documentReviewEvent.count({ where: { issueId: created.id } })).toBe(2);
  });

  it("同键重试只留一份记录，版本冲突和并发回应不覆盖既有历史，数据库拒绝改写问题正文/事件", async () => {
    const f = await fixture(), input = issueInput(f.original.id);
    const created = await createDocumentReviewIssue(f.reviewer.id, input);
    expect(await createDocumentReviewIssue(f.reviewer.id, input)).toEqual(created);
    await expect(createDocumentReviewIssue(f.reviewer.id, { ...input, basis: "另一份理由" })).rejects.toThrow("保存标识");
    const response = responseInput(created.id);
    const saved = await respondDocumentReviewIssue(f.owner.id, response);
    expect(await respondDocumentReviewIssue(f.owner.id, response)).toEqual(saved);
    await expect(respondDocumentReviewIssue(f.owner.id, { ...response, note: "同键不能换理由" })).rejects.toThrow("保存标识");
    await expect(respondDocumentReviewIssue(f.owner.id, responseInput(created.id))).rejects.toThrow("已有新处理");
    const check = checkInput(created.id, 2, false);
    const checked = await checkDocumentReviewIssue(f.reviewer.id, check);
    expect(await checkDocumentReviewIssue(f.reviewer.id, check)).toEqual(checked);
    const competing = await Promise.allSettled([
      respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id, 3), note: "合成并发回应甲" }),
      respondDocumentReviewIssue(f.owner.id, { ...responseInput(created.id, 3), note: "合成并发回应乙" }),
    ]);
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.documentReviewIssue.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ version: 4, state: "WAITING_CHECK" });
    const events = await db.documentReviewEvent.findMany({ where: { issueId: created.id }, orderBy: { version: "asc" } });
    expect(events.map(event => event.version)).toEqual([2, 3, 4]);
    expect(await db.auditLog.count({ where: { targetId: created.id, targetType: "DocumentReviewIssue" } })).toBe(4);
    await expect(db.documentReviewIssue.update({ where: { id: created.id }, data: { basis: "试图改写原问题" } })).rejects.toThrow(/immutable|fixed/i);
    await expect(db.documentReviewEvent.update({ where: { id: events[0].id }, data: { note: "试图覆盖回应" } })).rejects.toThrow(/immutable|fixed/i);
    await expect(db.documentReviewEvent.delete({ where: { id: events[0].id } })).rejects.toThrow(/immutable|fixed/i);
  });
});
