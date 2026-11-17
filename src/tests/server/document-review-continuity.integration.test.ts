// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const session = vi.hoisted(() => ({ actorId: "" }));
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("复核接续仅允许独立的 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: session.actorId }, expires: "2099-01-01" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { createReviewIssue, respondReviewIssue, checkReviewIssue, getDocumentReview, getDocumentReviewSourcePage,
  getDocumentReviewPositionOptions, previewDocumentReviewPosition, getSavedDocumentReviewPosition,
  getPreviousDocumentReviewIssue } from "@/server/document-reviews/actions";

const users: string[] = [], roles: string[] = [], groups: string[] = [], matters: string[] = [], documents: string[] = [];
async function fixture() {
  const owner = await db.user.create({ data: { name: "合成复核接续经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  const role = await db.roleDefinition.create({ data: { name: `合成仅审批-${randomUUID()}`, normalizedName: `review-position-${randomUUID()}` } }); roles.push(role.id);
  const reviewer = await db.user.create({ data: { name: "合成复核接续审批", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "CUSTOM", roleDefinitionId: role.id } });
  users.push(owner.id, reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成文书审批-${randomUUID()}`, members: { create: { userId: reviewer.id } },
    rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
  const matter = await db.matter.create({ data: { title: "合成复核接续事项", internalCode: `REVIEW-CONTINUITY-${randomUUID()}`, ownerId: owner.id } }); matters.push(matter.id);
  const f = { owner, reviewer, role, group, matter };
  const original = await document(f, { name: "合成原稿.pdf", status: "PENDING_REVIEW" });
  await db.document.update({ where: { id: original.id }, data: { familyId: original.id, isLatest: false } });
  session.actorId = owner.id;
  return { ...f, original };
}
async function document(f: { owner: { id: string }; matter: { id: string } }, data: Partial<Prisma.DocumentUncheckedCreateInput> = {}) {
  const row = await db.document.create({ data: { name: "合成依据.pdf", path: `review-continuity/${randomUUID()}.pdf`, mimeType: "application/pdf",
    sha256: "a".repeat(64), pageCount: 4, uploadedById: f.owner.id, matterId: f.matter.id, tags: [], ...data } });
  documents.push(row.id); return row;
}
function issueInput(documentId: string) {
  return { requestId: randomUUID(), documentId, title: "合成金额需核对", location: "人工说明位置", basis: "合成核对理由", basisDocumentId: null as string | null };
}
function responseInput(issueId: string, expectedVersion = 1) {
  return { requestId: randomUUID(), issueId, expectedVersion, disposition: "PARTIAL" as const, note: "合成回应，保留人工核对",
    revisionDocumentId: null as string | null, revisionLocation: null as string | null };
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, source: { id: string; sha256: string | null }, generation: number, text: string) {
  const run = await db.documentParseRun.create({ data: { documentId: source.id, generation, requestedById: f.owner.id,
    parserVersion: "review-continuity-fixture-v1", sourceSha256: source.sha256! } });
  const anchorId = "synthetic-page-two";
  // A published snapshot fixture, not a claim that OCR/parser or file bytes were executed here.
  await db.documentParseRun.update({ where: { id: run.id }, data: { state: "PARTIAL", finishedAt: new Date(),
    coverage: { unitKind: "PAGE", totalUnits: 4, units: [{ unit: 1, status: "FAILED" }, { unit: 2, status: "READY" }, { unit: 3, status: "FAILED" }, { unit: 4, status: "FAILED" }] },
    anchors: [{ anchorId, parseGenerationId: run.id, source: { kind: "CASE_MATERIAL", documentId: source.id,
      matterId: f.matter.id, sha256: source.sha256 }, unit: 2, location: { kind: "PAGE", page: 2 }, text }] } });
  await db.document.update({ where: { id: source.id }, data: { parseGeneration: generation } });
  return { parseRunId: run.id, anchorId };
}

describe.skipIf(!databaseUrl)("G08 复核接续公开 Action：真实 PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("NEXTAUTH_SECRET", "synthetic-review-continuity-secret"); await db.$connect(); });
  afterAll(async () => {
    await db.document.updateMany({ where: { id: { in: documents } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("三处固定页沿真实文档和服务器 SHA 保存，修订无需重复文字，读取不生成历史或 Evidence 关系", async () => {
    const f = await fixture(), basis = await document(f, { sha256: "b".repeat(64) });
    const revision = await document(f, { familyId: f.original.id, version: 2, sha256: "c".repeat(64) });
    const input = { ...issueInput(f.original.id), basisDocumentId: basis.id, position: { page: 1 }, basisPosition: { page: 2 } };
    const saved = await createReviewIssue(input);
    const response = { ...responseInput(saved.id), revisionDocumentId: revision.id, revisionPosition: { page: 3 } };
    const replied = await respondReviewIssue(response);
    expect(await createReviewIssue(input)).toEqual({ ...saved, version: replied.version });
    expect(await respondReviewIssue(response)).toEqual(replied);
    const issue = await db.documentReviewIssue.findUniqueOrThrow({ where: { id: saved.id }, include: { events: true } });
    expect(issue.position).toEqual({ documentSha256: f.original.sha256, location: { kind: "PAGE", page: 1 }, parseRunId: null, anchorId: null });
    expect(issue.basisPosition).toEqual({ documentSha256: basis.sha256, location: { kind: "PAGE", page: 2 }, parseRunId: null, anchorId: null });
    expect(issue.events[0]).toMatchObject({ revisionDocumentId: revision.id, revisionLocation: null,
      revisionPosition: { documentSha256: revision.sha256, location: { kind: "PAGE", page: 3 }, parseRunId: null, anchorId: null } });
    for (const [slot, documentId, page] of [["SUBJECT", f.original.id, 1], ["BASIS", basis.id, 2], ["REVISION", revision.id, 3]] as const) {
      const source = await getSavedDocumentReviewPosition({ issueId: saved.id, slot, ...(slot === "REVISION" ? { eventId: issue.events[0].id } : {}) });
      expect(source).toMatchObject({ status: "AVAILABLE", locationLabel: `第 ${page} 页`, downloadUrl: `/api/documents/${documentId}/download`,
        previewKind: "NATIVE", previewUrl: `/api/documents/${documentId}/download?inline=1#page=${page}` });
    }
    await getDocumentReview(f.original.id);
    expect(await db.documentReviewIssue.findUniqueOrThrow({ where: { id: saved.id }, include: { events: true } })).toEqual(issue);
    expect(await db.evidenceSourceLink.count({ where: { documentId: { in: [f.original.id, basis.id, revision.id] } } })).toBe(0);
    expect(await db.auditLog.count({ where: { targetType: "DocumentReviewIssue", targetId: saved.id } })).toBe(2);
    await expect(createReviewIssue({ ...input, position: { page: 2 } })).rejects.toThrow("保存标识");
    await expect(createReviewIssue({ ...issueInput(f.original.id), position: { page: 5 } })).rejects.toThrow();
    await expect(createReviewIssue({ ...issueInput(f.original.id), position: { page: 1, documentSha256: "d".repeat(64) } } as never)).rejects.toThrow();
    expect(requireSession).toHaveBeenLastCalledWith("approval");
  });

  it("更新解析代次或页数后仍读当时锚点和重放已存位置，SHA 改变明确不可用", async () => {
    const f = await fixture(), first = await publish(f, f.original, 1, "合成原代次第二页文字");
    const input = { ...issueInput(f.original.id), position: first };
    const saved = await createReviewIssue(input);
    const pageInput = { ...issueInput(f.original.id), position: { page: 4 } }, pageSaved = await createReviewIssue(pageInput);
    const latest = await publish(f, f.original, 2, "合成新代次文字");
    await db.document.update({ where: { id: f.original.id }, data: { pageCount: 1 } });
    expect((await getDocumentReviewPositionOptions({ documentId: f.original.id, slot: "SUBJECT" })).items[0].runId).toBe(latest.parseRunId);
    expect(await getSavedDocumentReviewPosition({ issueId: saved.id, slot: "SUBJECT" })).toMatchObject({ status: "AVAILABLE", text: "合成原代次第二页文字", historicalParse: true });
    expect(await createReviewIssue(input)).toEqual(saved);
    expect(await createReviewIssue(pageInput)).toEqual(pageSaved);
    expect(await previewDocumentReviewPosition({ documentId: f.original.id, slot: "SUBJECT", position: first })).toMatchObject({ status: "AVAILABLE", text: "合成原代次第二页文字", historicalParse: true });
    await db.document.update({ where: { id: f.original.id }, data: { sha256: "e".repeat(64) } });
    expect(await getSavedDocumentReviewPosition({ issueId: saved.id, slot: "SUBJECT" })).toEqual({ status: "UNAVAILABLE" });
    await expect(createReviewIssue(input)).rejects.toThrow("固定来源当前不可读取");
    expect((await db.documentReviewIssue.findUniqueOrThrow({ where: { id: saved.id } })).position).toMatchObject(first);
  });

  it("独立审批只读当前确切位置，不借此枚举整案；资格撤销后拒绝保存、重放和原位置", async () => {
    const f = await fixture(), unrelated = await document(f), selected = await publish(f, f.original, 1, "合成获准审批文书位置");
    session.actorId = f.reviewer.id;
    expect(await db.rolePermission.count({ where: { roleId: f.role.id } })).toBe(0);
    expect((await getDocumentReviewPositionOptions({ documentId: f.original.id, slot: "SUBJECT" })).items.map(row => row.documentId)).toEqual([f.original.id]);
    await expect(getDocumentReviewSourcePage({ documentId: f.original.id })).rejects.toThrow("不能查找本案依据");
    await expect(getDocumentReviewPositionOptions({ documentId: f.original.id, slot: "BASIS", sourceDocumentId: unrelated.id })).rejects.toThrow("无权读取");
    await expect(getDocumentReviewPositionOptions({ documentId: f.original.id, slot: "SUBJECT", sourceDocumentId: unrelated.id })).rejects.toThrow("不能选择");
    const input = { ...issueInput(f.original.id), position: selected }, saved = await createReviewIssue(input);
    expect(await getSavedDocumentReviewPosition({ issueId: saved.id, slot: "SUBJECT" })).toMatchObject({ status: "AVAILABLE" });
    await db.approvalPermissionMember.update({ where: { groupId_userId: { groupId: f.group.id, userId: f.reviewer.id } }, data: { active: false } });
    await expect(getSavedDocumentReviewPosition({ issueId: saved.id, slot: "SUBJECT" })).rejects.toThrow("无权读取");
    await expect(createReviewIssue(input)).rejects.toThrow("无权读取");
    await expect(getDocumentReviewPositionOptions({ documentId: f.original.id, slot: "SUBJECT" })).rejects.toThrow("无权读取");
  });

  it("无事项或可靠 SHA 保原人工流程；省略和 null 位置不改原请求指纹", async () => {
    const f = await fixture(), standalone = await document(f, { matterId: null, sha256: null, pageCount: null });
    const input = issueInput(standalone.id), saved = await createReviewIssue(input);
    const row = await db.documentReviewIssue.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row).toMatchObject({ position: null, basisPosition: null, requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex") });
    expect(await createReviewIssue({ ...input, position: null, basisPosition: null })).toEqual(saved);
    const response = responseInput(saved.id), responded = await respondReviewIssue(response);
    expect(await respondReviewIssue({ ...response, revisionPosition: null })).toEqual(responded);
    await expect(createReviewIssue({ ...issueInput(standalone.id), position: { page: 1 } })).rejects.toThrow("尚未关联案件");
    const noHash = await document(f, { sha256: null });
    await createReviewIssue(issueInput(noHash.id));
    await expect(createReviewIssue({ ...issueInput(noHash.id), position: { page: 1 } })).rejects.toThrow();
  });

  it("可选固定位置失效不新增人工回应或核对门禁，保留未解决首次和重放对称", async () => {
    const f = await fixture(), basis = await document(f, { status: "PENDING_REVIEW" });
    const saved = await createReviewIssue({ ...issueInput(f.original.id), basisDocumentId: basis.id, basisPosition: { page: 2 } });
    await db.document.update({ where: { id: basis.id }, data: { sha256: "b".repeat(64) } });
    const response = responseInput(saved.id), responded = await respondReviewIssue(response);
    expect(await respondReviewIssue(response)).toEqual(responded);
    session.actorId = f.reviewer.id;
    expect((await getDocumentReview(f.original.id)).issues[0]).toMatchObject({ basisUnavailable: false, basisPosition: { status: "UNAVAILABLE" }, canResolve: true });
    const input = { requestId: randomUUID(), issueId: saved.id, expectedVersion: responded.version, resolved: false, note: "来源位置待补核，保留未解决" };
    const checked = await checkReviewIssue(input);
    expect(await checkReviewIssue(input)).toEqual(checked);
    session.actorId = f.owner.id;
    const next = await respondReviewIssue(responseInput(saved.id, checked.version));
    session.actorId = f.reviewer.id;
    await checkReviewIssue({ ...input, requestId: randomUUID(), expectedVersion: next.version, resolved: true, note: "已人工核对当前可读原件" });
    expect((await db.documentReviewIssue.findUniqueOrThrow({ where: { id: saved.id } })).state).toBe("RESOLVED");
  });

  it("前版只按真实族和低版本返回未决，最新 RESPONSE 关联不被 CHECK 或更早回应冒充", async () => {
    const f = await fixture();
    const v2 = await document(f, { familyId: f.original.id, version: 2, name: "合成隐蔽第二版.pdf", status: "DRAFT", isLatest: false });
    const v3 = await document(f, { familyId: f.original.id, version: 3, name: "合成当前第三版.pdf", status: "PENDING_REVIEW" });
    const saved = await createReviewIssue(issueInput(f.original.id));
    let response = await respondReviewIssue({ ...responseInput(saved.id), revisionDocumentId: v2.id, revisionLocation: "人工第二页" });
    session.actorId = f.reviewer.id;
    const checked = await checkReviewIssue({ requestId: randomUUID(), issueId: saved.id, expectedVersion: response.version, resolved: false, note: "保留未决" });
    session.actorId = f.owner.id;
    expect((await getDocumentReview(v2.id)).previousIssues).toMatchObject([{ id: saved.id, linkedToCurrent: true, state: "OPEN" }]);
    response = await respondReviewIssue({ ...responseInput(saved.id, checked.version), revisionDocumentId: v3.id, revisionLocation: "人工第三页" });
    expect((await getDocumentReview(v2.id)).previousIssues).toMatchObject([{ id: saved.id, linkedToCurrent: false }]);
    const hidden = await createReviewIssue({ ...issueInput(v2.id), title: "合成未获准前版意见" });
    const unrelated = await document(f, { version: 1, familyId: randomUUID() });
    await createReviewIssue({ ...issueInput(unrelated.id), title: "合成其他族意见" });
    const before = await db.documentReviewIssue.findMany({ where: { documentId: { in: [f.original.id, v2.id, v3.id] } }, orderBy: { id: "asc" }, include: { events: true } });
    session.actorId = f.reviewer.id;
    const view = await getDocumentReview(v3.id);
    expect(view.previousIssues).toHaveLength(1);
    expect(view.previousIssues[0]).toMatchObject({ id: saved.id, document: { id: f.original.id }, linkedToCurrent: true });
    const previous = await getPreviousDocumentReviewIssue({ documentId: v3.id, issueId: saved.id });
    expect(previous.issue).toMatchObject({ id: saved.id, canResolve: false, events: [{ revisionUnavailable: true, note: null }, { note: null }, { revisionDocument: { id: v3.id } }] });
    await expect(getPreviousDocumentReviewIssue({ documentId: v3.id, issueId: hidden.id })).rejects.toThrow("当前不可读取");
    expect(await db.documentReviewIssue.findMany({ where: { documentId: { in: [f.original.id, v2.id, v3.id] } }, orderBy: { id: "asc" }, include: { events: true } })).toEqual(before);
    await checkReviewIssue({ requestId: randomUUID(), issueId: saved.id, expectedVersion: response.version, resolved: true, note: "已核对第三版，关闭原问题" });
    expect((await getDocumentReview(v3.id)).previousIssues).toEqual([]);
    await expect(getPreviousDocumentReviewIssue({ documentId: v3.id, issueId: saved.id })).rejects.toThrow("已变化");
  });

  it("数据库拒绝错误位置形状、缺少依据/修订身份以及固定字段改写", async () => {
    const f = await fixture(), pin = { documentSha256: f.original.sha256!, location: { kind: "PAGE", page: 1 }, parseRunId: null, anchorId: null };
    const saved = await createReviewIssue({ ...issueInput(f.original.id), position: { page: 1 } });
    await expect(db.documentReviewIssue.update({ where: { id: saved.id }, data: { position: { ...pin, location: { kind: "PAGE", page: 2 } } } })).rejects.toThrow();
    const rawIssue = { documentId: f.original.id, title: "合成约束测试", basis: "合成理由", createdById: f.owner.id, requestHash: "a".repeat(64) };
    for (const position of [Prisma.JsonNull, { ...pin, extra: "not allowed" }, { ...pin, parseRunId: f.original.id }, { ...pin, location: { kind: "PAGE", page: 0 } },
      { ...pin, location: { kind: "TEXT", start: 0, end: 2 } }]) {
      await expect(db.documentReviewIssue.create({ data: { ...rawIssue, requestId: randomUUID(), position } })).rejects.toThrow();
    }
    await expect(db.documentReviewIssue.create({ data: { ...rawIssue, requestId: randomUUID(), basisPosition: pin } })).rejects.toThrow();
    await respondReviewIssue(responseInput(saved.id));
    const event = await db.documentReviewEvent.findFirstOrThrow({ where: { issueId: saved.id } });
    await expect(db.documentReviewEvent.update({ where: { id: event.id }, data: { revisionPosition: pin } })).rejects.toThrow();
    await expect(db.documentReviewEvent.create({ data: { issueId: saved.id, version: 3, kind: "CHECK", resolved: false,
      note: "合成无效核对位置", actorId: f.reviewer.id, requestId: randomUUID(), requestHash: "a".repeat(64), revisionPosition: pin } })).rejects.toThrow();
    await expect(db.documentReviewEvent.create({ data: { issueId: saved.id, version: 3, kind: "RESPONSE", disposition: "ACCEPT",
      note: "合成缺修订身份", actorId: f.owner.id, requestId: randomUUID(), requestHash: "a".repeat(64), revisionPosition: pin } })).rejects.toThrow();
    expect(await db.documentReviewEvent.count({ where: { issueId: saved.id } })).toBe(1);
  });
});
