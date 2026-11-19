// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw Error("Only run against an isolated _test database");
  return { url };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused@127.0.0.1:1/fact_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { getSession, requireSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { GET as download } from "@/app/api/documents/[id]/download/route";
import { saveFactReview } from "@/app/api/personal/evidence-review/fact-review";
import { addEvidenceSource, confirmEvidenceItem, createEvidenceItem, listEvidenceItems, removeEvidenceSource } from "@/server/evidence/actions";
import { getResearch, checkResearchRevision, getResearchHistory, getResearchList, getResearchSource, saveResearchRevision } from "@/server/research/actions";

const files: string[] = [];
const matters: string[] = [];
let userId: string;

async function makeMatter() {
  const row = await db.matter.create({ data: { title: "合成到账争点", internalCode: randomUUID(), ownerId: userId } });
  matters.push(row.id);
  return row.id;
}

async function material(matterId: string, pages: string[], familyId: string = randomUUID(), version = 1) {
  const pdf = await PDFDocument.create();
  for (const text of pages) pdf.addPage().drawText(text);
  const bytes = Buffer.from(await pdf.save());
  const path = await storage.writeFile("fact-review-test", bytes);
  files.push(path);
  return db.document.create({ data: { matterId, familyId, version, uploadedById: userId, path,
    name: "CT-01.pdf", mimeType: "application/pdf", pageCount: pages.length, tags: [],
    sha256: createHash("sha256").update(bytes).digest("hex") } });
}

async function openPage(matterId: string, researchId: string, sourceId: string, documentId: string, page: number) {
  const ref = await getResearchSource(matterId, researchId, sourceId);
  expect(ref).toMatchObject({ status: "AVAILABLE", previewUrl: `/api/documents/${documentId}/download?inline=1#page=${page}` });
  if (ref.status !== "AVAILABLE" || !ref.previewUrl) throw Error("缺少固定原件");
  const response = await download(new Request(new URL(ref.previewUrl, "http://localhost")), { params: Promise.resolve({ id: documentId }) });
  expect(response.status).toBe(200);
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  try {
    const content = await (await pdf.getPage(page)).getTextContent();
    return content.items.map(item => "str" in item ? item.str : "").join(" ");
  } finally { await pdf.destroy(); }
}

describe.skipIf(!config.url)("桌面争点取舍 → 固定研究修订 / PostgreSQL", () => {
  beforeAll(async () => {
    const user = await db.user.create({ data: { name: "合成律师", email: randomUUID() + "@example.invalid", role: "LAWYER", passwordHash: "disabled-test-only" } });
    userId = user.id;
    const session = { user: { id: user.id, role: user.role, name: user.name, runtimeMode: "SERVER" as const } };
    vi.mocked(requireSession).mockResolvedValue(session as Awaited<ReturnType<typeof requireSession>>);
    vi.mocked(getSession).mockResolvedValue(session as Awaited<ReturnType<typeof getSession>>);
  });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    if (userId) await db.user.update({ where: { id: userId }, data: { active: false } });
    await Promise.all(files.map(path => storage.deleteFile(path)));
    await db.$disconnect();
  });

  it("按来源身份选第二页；重排、换版、撤关联后仍从研究读取原值、理由及双方原件", async () => {
    const matterId = await makeMatter();
    const a = await material(matterId, ["A1-P1 other payment", "A1-P2 CT-01 03-01 CNY 120000"]);
    const b = await material(matterId, ["B1-P1 CT-01 03-03 CNY 112000"]);
    const issue = await createEvidenceItem({ matterId, requestKey: randomUUID(), kind: "ISSUE", title: "CT-01 到账争点",
      content: "相同附言的两份材料记载不同", sourceDocumentId: a.id, sourcePage: 1, sourceRelation: "SUPPORTS" });
    const adopted = await addEvidenceSource({ evidenceItemId: issue.id, expectedRevision: 1, documentId: a.id, page: 2, relation: "SUPPORTS" });
    const opposing = await addEvidenceSource({ evidenceItemId: issue.id, expectedRevision: adopted.revision, documentId: b.id, page: 1, relation: "REBUTS" });
    await confirmEvidenceItem({ evidenceItemId: issue.id, expectedRevision: opposing.revision, confirm: true });
    const confirmedAt = (await listEvidenceItems(matterId))[0].confirmedAt!.toISOString();
    const input = { action: "save-fact-review" as const, matterId, evidenceItemId: issue.id, revision: opposing.revision, confirmedAt,
      sourceId: adopted.sourceId, value: "3 月 1 日到账 120,000 元", reason: "按 CT-01 对应的银行入账行，差额 8,000 元待核。", requestKey: randomUUID(), researchedAt: new Date().toISOString() };
    const saved = await saveFactReview(input);
    await checkResearchRevision({ matterId, id: saved.id, expectedVersion: saved.version, acknowledged: true, note: "逐页复核，保留反证" });
    const firstRead = await getResearch(matterId, saved.id);
    expect(firstRead.checkNote).toBe("逐页复核，保留反证");
    expect(firstRead.sources).toHaveLength(1);
    expect(firstRead.sources[0]).toMatchObject({ documentId: a.id, page: 2 });
    // Force a different persisted presentation order without changing any link's identity or business revision.
    await db.evidenceSourceLink.update({ where: { id: opposing.sourceId }, data: { createdAt: new Date(0) } });
    const [current] = await listEvidenceItems(matterId);
    expect(current.sources[0].id).toBe(opposing.sourceId);
    expect((await saveFactReview(input)).id).toBe(saved.id);
    const reordered = await saveFactReview({ ...input, requestKey: randomUUID() });
    expect((await getResearch(matterId, reordered.id)).sources[0]).toMatchObject({ documentId: a.id, page: 2 });

    await db.document.update({ where: { id: a.id }, data: { isLatest: false } });
    const a2 = await material(matterId, ["A2-P1", "A2-P2 changed 118000"], a.familyId!, 2);
    const added = await addEvidenceSource({ evidenceItemId: issue.id, expectedRevision: opposing.revision, documentId: a2.id, page: 2, relation: "SUPPORTS" });
    await removeEvidenceSource({ evidenceItemId: issue.id, expectedRevision: added.revision, sourceId: adopted.sourceId });
    const [changed] = await listEvidenceItems(matterId);
    expect(changed.sources.map(source => source.id)).toContain(added.sourceId);
    expect(changed.sources.map(source => source.id)).not.toContain(adopted.sourceId);
    expect(changed.confirmedAt).toBeNull();
    const read = await getResearch(matterId, saved.id);
    expect(read.content).toMatchObject({ conclusion: input.value, supportingAnalysis: input.reason });
    expect(read.checkedAt).toBe(firstRead.checkedAt);
    expect(read.issue).toMatchObject({ revision: opposing.revision, confirmedAt, changed: true });
    expect(read.sources[0]).toMatchObject({ id: firstRead.sources[0].id, documentId: a.id, changed: true, version: 1, page: 2 });
    expect(read.sources[0].documentId).not.toBe(a2.id);
    expect(read.issue?.sources.map(source => source.id)).toEqual(firstRead.issue?.sources.map(source => source.id));
    expect(read.issue?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "issue:" + adopted.sourceId, documentId: a.id }),
      expect.objectContaining({ id: "issue:" + opposing.sourceId, documentId: b.id, relation: "REBUTS" }),
    ]));
    expect(await openPage(matterId, saved.id, read.sources[0].id, a.id, 2)).toContain("A1-P2 CT-01 03-01 CNY 120000");
    expect(await openPage(matterId, saved.id, "issue:" + opposing.sourceId, b.id, 1)).toContain("B1-P1 CT-01 03-03 CNY 112000");
    expect((await saveFactReview(input)).id).toBe(saved.id);
    await expect(saveFactReview({ ...input, requestKey: randomUUID() })).rejects.toThrow("已变化");

    const supplement = await material(matterId, ["ONLY REFERENCED BY V2"]);
    const successor = await saveResearchRevision({ ...firstRead.content!, conclusion: "另行复核后修订", matterId,
      sources: [{ ...firstRead.content!.sources[0], documentId: supplement.id, page: 1 }],
      requestKey: randomUUID(), supersedesId: saved.id, expectedVersion: saved.version,
      issueSelection: { kind: "SAVED", researchRevisionId: saved.id } });
    const history = await getResearchHistory(matterId, successor.id);
    expect(history.records.map(row => row.id)).toEqual([successor.id, saved.id]);
    expect(history.records[0].checkedAt).toBeNull();
    const historical = await getResearch(matterId, history.records[1].id);
    expect(historical).toMatchObject({ current: false, checkedAt: firstRead.checkedAt, content: { conclusion: input.value, supportingAnalysis: input.reason } });
    expect(await openPage(matterId, historical.id, historical.sources[0].id, a.id, 2)).toContain("A1-P2 CT-01 03-01 CNY 120000");

    await db.document.update({ where: { id: supplement.id }, data: { deletedAt: new Date() } });
    const { records } = await getResearchList(matterId);
    expect(records.find(row => row.id === successor.id)).toMatchObject({ version: 2, readable: false, question: null });
    expect(records.some(row => row.id === saved.id)).toBe(false);
    const restrictedHistory = await getResearchHistory(matterId, successor.id);
    expect(restrictedHistory.records).toMatchObject([
      { id: successor.id, readable: false, content: null, issue: null, sources: [], canCheck: false, canDraft: false },
      { id: saved.id, readable: true, content: { conclusion: input.value } },
    ]);
    await expect(getResearchSource(matterId, successor.id, history.records[0].sources[0].id)).rejects.toThrow("撤回");
    const older = restrictedHistory.records[1];
    expect(await openPage(matterId, older.id, older.sources[0].id, a.id, 2)).toContain("A1-P2 CT-01 03-01 CNY 120000");
    await expect(getResearchHistory(await makeMatter(), successor.id)).rejects.toThrow("不属于");
  });

  it("两个可办理案件混用争点、来源、研究修订或出处时拒绝，原件撤回后旧引证停止展示", async () => {
    const a = await makeMatter(), b = await makeMatter();
    async function issue(matterId: string) {
      const doc = await material(matterId, ["CASE SELECTED ORIGINAL"]);
      const point = await createEvidenceItem({ matterId, requestKey: randomUUID(), kind: "ISSUE", title: "同名到账争点", content: "待复核" });
      const source = await addEvidenceSource({ evidenceItemId: point.id, expectedRevision: 1, documentId: doc.id, page: 1, relation: "SUPPORTS" });
      return { point, doc, source };
    }
    const left = await issue(a), right = await issue(b);
    const input = { action: "save-fact-review" as const, matterId: a, evidenceItemId: left.point.id, revision: left.source.revision, confirmedAt: null,
      sourceId: left.source.sourceId, value: "120,000 元", reason: "银行行记载", requestKey: randomUUID(), researchedAt: new Date().toISOString() };
    await expect(saveFactReview({ ...input, matterId: b })).rejects.toThrow("当前案件");
    await expect(saveFactReview({ ...input, sourceId: right.source.sourceId })).rejects.toThrow("不属于");
    expect(await db.researchRevision.count({ where: { matterId: { in: [a,b] } } })).toBe(0);
    const result = await saveFactReview(input);
    await expect(getResearchSource(b, result.id, "issue:" + left.source.sourceId)).rejects.toThrow("不属于");
    await expect(getResearchSource(a, result.id, "issue:" + right.source.sourceId)).rejects.toThrow("不属于");
    await db.document.update({ where: { id: left.doc.id }, data: { deletedAt: new Date() } });
    expect(await getResearch(a, result.id)).toMatchObject({ readable: false, content: null, sources: [] });
    await expect(getResearchSource(a, result.id, "issue:" + left.source.sourceId)).rejects.toThrow("撤回");
    await expect(saveFactReview(input)).rejects.toThrow("撤回");
  });
});
