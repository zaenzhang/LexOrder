// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type UserRole } from "@prisma/client";
import { emptyLawMetadata, emptyResearchContent, type ResearchSaveInput } from "@/server/research/contracts";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("研究集成测试只允许独立 _test 数据库");
  return { url, written: new Map<string, Buffer>(), failStorage: false };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasources: { db: { url: config.url ?? "postgresql://unused:unused@127.0.0.1:1/research_test" } } }) };
});
vi.mock("@/lib/storage", () => ({ storage: {
  writeFileAt: vi.fn(async (path: string, bytes: Buffer) => { if (config.failStorage) throw new Error("simulated storage failure"); config.written.set(path, bytes); }),
  deleteFile: vi.fn(async (path: string) => { config.written.delete(path); }),
} }));

import { prisma as db } from "@/lib/prisma";
import { checkResearch, listResearch, readResearch, readResearchHistory, readResearchOptions, saveResearch } from "@/server/research/service";
import { createResearchDraft } from "@/server/research/draft";
import { deliveryApprovalBlock, prepareDeliveryForActor } from "@/server/deliveries/service";

const users: string[] = [], matters: string[] = [], clients: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成研究律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" as UserRole } });
  users.push(user.id);
  const client = await db.client.create({ data: { name: "合成研究客户", type: "INDIVIDUAL", tags: [], ownerUserId: user.id } }); clients.push(client.id);
  const matter = await db.matter.create({ data: { internalCode: `M3-RESEARCH-${randomUUID()}`, title: "合成法律研究事项", ownerId: user.id, primaryClientId: client.id } }); matters.push(matter.id);
  const document = await db.document.create({ data: { name: "合成旧法资料.pdf", matterId: matter.id, uploadedById: user.id,
    path: `synthetic/${randomUUID()}.bin`, category: "OTHER", mimeType: "application/pdf", pageCount: 3, sha256: "a".repeat(64), tags: [], familyId: randomUUID() } });
  const actor = { id: user.id, role: user.role, runtimeMode: "SERVER" as const };
  return { actor, matter, document };
}
function input(matterId: string, patch: Partial<ResearchSaveInput> = {}): ResearchSaveInput {
  return { ...emptyResearchContent(), matterId, requestKey: randomUUID(), supersedesId: null, expectedVersion: null,
    question: "旧法期间的合同责任如何判断", ...patch };
}

describe.skipIf(!config.url)("M3 研究修订、来源与分析稿 / PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });

  it("同键并发保存只有一份研究，重试核对原请求；无程序事项可保存并重开", async () => {
    const f = await fixture(), data = input(f.matter.id);
    const results = await Promise.all([saveResearch(db, f.actor, data), saveResearch(db, f.actor, data)]);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(await db.researchRevision.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.actor.id, action: "RESEARCH_CREATE" } })).toBe(1);
    expect((await readResearch(db, f.actor, f.matter.id, results[0].id)).content?.question).toBe(data.question);
    await expect(saveResearch(db, f.actor, { ...data, question: "重试时更换问题" })).rejects.toThrow("不同内容");
  });

  it("旧法日期、反向材料与链接查询固定保存；正文与法源元信息不能原位改写", async () => {
    const f = await fixture();
    const saved = await saveResearch(db, f.actor, input(f.matter.id, { relevantDate: "2019-06-10", jurisdiction: "中国大陆",
      queryLog: [{ query: "未收到答辩材料", location: "合成来件记录", access: "NONE", outcome: "NOT_OBTAINED", notes: "不能据此推定对方无异议" },
        { query: "某法规网站", location: "https://example.invalid/law", access: "LINK", outcome: "UNREAD", notes: "仅记录链接，未取得全文" }],
      sources: [{ documentId: f.document.id, page: 2, relation: "REBUTS", lawMetadata: { ...emptyLawMetadata(), kind: "STATUTE", title: "合成旧版规范",
        jurisdiction: "中国大陆", authority: "合成机关", effectiveFrom: "2018-01-01", effectiveTo: "2020-12-31", verification: "CHECKED" } }] }));
    const reopened = await readResearch(db, f.actor, f.matter.id, saved.id);
    expect(reopened.content?.relevantDate).toBe("2019-06-10");
    expect(reopened.sources[0]).toMatchObject({ documentId: f.document.id, relation: "REBUTS", version: 1 });
    expect(reopened.content?.queryLog.map(query => query.outcome)).toEqual(["NOT_OBTAINED", "UNREAD"]);
    await expect(db.researchRevision.update({ where: { id: saved.id }, data: { question: "直接覆盖" } })).rejects.toThrow();
    await expect(db.researchSource.update({ where: { id: reopened.sources[0].id }, data: { lawMetadata: {} } })).rejects.toThrow();
  });

  it("已核对研究另存新修订，核对不继承；并发更正不能分叉", async () => {
    const f = await fixture(), old = await saveResearch(db, f.actor, input(f.matter.id));
    await checkResearch(db, f.actor, { matterId: f.matter.id, id: old.id, expectedVersion: 1, acknowledged: true, note: "范围已核对，法源全文仍待取得" });
    const changes = await Promise.allSettled(["甲", "乙"].map(conclusion => saveResearch(db, f.actor,
      input(f.matter.id, { supersedesId: old.id, expectedVersion: 1, conclusion }))));
    expect(changes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const history = await readResearchHistory(db, f.actor, f.matter.id, old.id);
    expect(history.records.map(row => row.version)).toEqual([2, 1]);
    expect(history.records[0].checkedAt).toBeNull();
    expect(history.records[1].checkedAt).not.toBeNull();
    await expect(checkResearch(db, f.actor, { matterId: f.matter.id, id: old.id, expectedVersion: 1, acknowledged: true, note: "覆盖旧核对" })).rejects.toThrow("新修订");
  });

  it("来源撤回后列表、正文、历史、核对与生成均不泄露派生正文", async () => {
    const f = await fixture();
    const saved = await saveResearch(db, f.actor, input(f.matter.id, { conclusion: "不应继续下发的派生正文", sources: [
      { documentId: f.document.id, relation: "SUPPORTS", lawMetadata: emptyLawMetadata() },
    ] }));
    await db.document.update({ where: { id: f.document.id }, data: { deletedAt: new Date() } });
    const [detail, list, history] = await Promise.all([readResearch(db, f.actor, f.matter.id, saved.id), listResearch(db, f.actor, f.matter.id), readResearchHistory(db, f.actor, f.matter.id, saved.id)]);
    expect(detail).toMatchObject({ readable: false, content: null, sources: [], canDraft: false });
    expect(list.records[0].question).toBeNull();
    expect(history.records[0].content).toBeNull();
    await expect(checkResearch(db, f.actor, { matterId: f.matter.id, id: saved.id, expectedVersion: 1, acknowledged: true, note: "已核对" })).rejects.toThrow("来源");
    await expect(createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: saved.id, requestKey: randomUUID() })).rejects.toThrow("来源");
  });

  it("关联争点绑定确切修订，并继续校验该修订全部来源；越案争点拒绝", async () => {
    const f = await fixture(), other = await fixture();
    const issue = await db.evidenceItem.create({ data: { matterId: f.matter.id, title: "合成争点", content: "来源中的争点", kind: "ISSUE", createdById: f.actor.id,
      revisions: { create: { revision: 1, title: "合成争点", content: "来源中的争点", kind: "ISSUE", editedById: f.actor.id,
        sourceSnapshot: [{ id: "test", documentId: f.document.id, documentSha256: f.document.sha256, relation: "CONTEXT", location: { kind: "PAGE", page: 1 }, parseRunId: null, anchorId: null, legacy: false }] } } }, include: { revisions: true } });
    const revision = issue.revisions[0];
    expect((await readResearchOptions(db, f.actor, f.matter.id)).issues).toContainEqual({ id: issue.id, revisionId: revision.id, revision: 1, title: "合成争点" });
    await expect(saveResearch(db, other.actor, input(other.matter.id, { issueId: issue.id, issueRevisionId: revision.id }))).rejects.toThrow("争点");
    const saved = await saveResearch(db, f.actor, input(f.matter.id, { issueId: issue.id, issueRevisionId: revision.id }));
    await db.document.update({ where: { id: f.document.id }, data: { deletedAt: new Date() } });
    expect((await readResearch(db, f.actor, f.matter.id, saved.id)).content).toBeNull();
  });

  it("未核对研究也可生成确切版本 DRAFT；重试不重复，后续研究不重绑旧稿", async () => {
    const f = await fixture();
    const saved = await saveResearch(db, f.actor, input(f.matter.id, { conclusion: "合成分析甲" }));
    const request = { matterId: f.matter.id, researchRevisionId: saved.id, requestKey: randomUUID() };
    const first = await createResearchDraft(db, f.actor, request), replay = await createResearchDraft(db, f.actor, request);
    expect(replay).toMatchObject({ documentId: first.documentId, replayed: true });
    const draft = await db.document.findUniqueOrThrow({ where: { id: first.documentId } });
    expect(draft.status).toBe("DRAFT"); expect(draft.sourceOrigin).toBe("TEAM_PRODUCED"); expect(draft.encrypted).toBe(true); expect(draft.familyId).toBeTruthy();
    expect(deliveryApprovalBlock(draft)).toBe("该成果版本须先完成文书审批");
    await expect(prepareDeliveryForActor(f.actor.id, { matterId: f.matter.id, requestKey: randomUUID(), documentIds: [draft.id],
      recipientName: "合成客户", recipientContact: "合成当面交接地点", purpose: "合成分析结论交付", disclosureScope: "仅当前分析稿" })).rejects.toThrow("须先完成文书审批");
    expect(draft.textContent).toContain("研究待核对"); expect(draft.textContent).toContain("合成分析甲");
    const next = await saveResearch(db, f.actor, input(f.matter.id, { supersedesId: saved.id, expectedVersion: 1, conclusion: "合成分析乙" }));
    expect(next.version).toBe(2);
    expect(await db.documentResearchSource.findMany({ where: { documentId: first.documentId }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: saved.id }]);
    expect((await db.document.findUniqueOrThrow({ where: { id: first.documentId } })).textContent).not.toContain("合成分析乙");
    await expect(createResearchDraft(db, f.actor, { ...request, researchRevisionId: next.id })).rejects.toThrow("生成标识");
  });

  it("文件保存失败不发布无来源文书，同一请求可重试", async () => {
    const f = await fixture(), saved = await saveResearch(db, f.actor, input(f.matter.id));
    const request = { matterId: f.matter.id, researchRevisionId: saved.id, requestKey: randomUUID() };
    config.failStorage = true;
    try { await expect(createResearchDraft(db, f.actor, request)).rejects.toThrow("simulated storage failure"); }
    finally { config.failStorage = false; }
    expect(await db.document.count({ where: { generationRequestKey: request.requestKey } })).toBe(0);
    const result = await createResearchDraft(db, f.actor, request);
    expect(await db.documentResearchSource.count({ where: { documentId: result.documentId, researchRevisionId: saved.id } })).toBe(1);
  });

  it("停用操作者后不能用原请求键重放读取或生成", async () => {
    const f = await fixture(), request = input(f.matter.id);
    const saved = await saveResearch(db, f.actor, request);
    await db.user.update({ where: { id: f.actor.id }, data: { active: false } });
    await expect(saveResearch(db, f.actor, request)).rejects.toThrow("账号");
    await expect(readResearch(db, f.actor, f.matter.id, saved.id)).rejects.toThrow("账号");
  });
});
