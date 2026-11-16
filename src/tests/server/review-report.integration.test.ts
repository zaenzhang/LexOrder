// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("审阅报告验证仅允许独立 _test 数据库");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? new PrismaClient({ datasources: { db: { url } } }) : undefined };
});
const files = vi.hoisted(() => ({ writeFileAt: vi.fn(), deleteFile: vi.fn(), readFile: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: files }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { saveReviewToMatter } from "@/server/ai/save-review";
import { canReadDocument } from "@/lib/approvals/documents";
const userIds: string[] = [], matterIds: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成报告经办", email: `${randomUUID()}@example.invalid`, role: "LAWYER", passwordHash: "disabled-test-only" } });
  userIds.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成报告来源绑定", internalCode: `REVIEW-${randomUUID()}`, ownerId: user.id } });
  matterIds.push(matter.id);
  const source = await db.document.create({ data: { name: "合成来源.txt", matterId: matter.id, uploadedById: user.id, path: `synthetic/${randomUUID()}`, mimeType: "text/plain", sha256: "a".repeat(64), version: 1 } });
  const record = await db.reviewRecord.create({ data: { matterId: matter.id, documentId: source.id, reviewedById: user.id,
    itemCount: 0, itemsJson: [], textPreviewChars: 20, sourceSha256: source.sha256,
    coverageJson: { totalChars: 20, totalSegments: 1, segments: [{ index: 1, chars: 20, status: "SUCCEEDED", errorCode: null }], stopReason: null },
  } });
  vi.mocked(requireSession).mockResolvedValue({ user: { ...user, runtimeMode: "SERVER" }, expires: "2099-01-01" });
  files.writeFileAt.mockResolvedValue(undefined);
  return { user, matter, source, record, input: { matterId: matter.id, documentId: source.id, recordId: record.id } };
}
describe.skipIf(!databaseUrl)("审阅报告：真实 PG 身份与来源绑定（不调用模型）", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.document.updateMany({ where: { uploadedById: { in: userIds } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matterIds } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    await db.$disconnect();
  });
  it("报告沿用材料默认 cuid 和版本族，响应丢失重试仍定位同一报告", async () => {
    const f = await fixture(), first = await saveReviewToMatter(f.input);
    expect(z.string().cuid().safeParse(first.documentId).success).toBe(true);
    const report = await db.document.findUniqueOrThrow({ where: { id: first.documentId } });
    expect(report.familyId).toBeTruthy(); expect(report.status).toBe("DRAFT"); expect(report.isLatest).toBe(true);
    expect(await db.reviewRecord.findUniqueOrThrow({ where: { id: f.record.id } })).toMatchObject({ documentId: f.source.id, sourceSha256: f.source.sha256, reportDocumentId: report.id });
    const writes = files.writeFileAt.mock.calls.length;
    expect(await saveReviewToMatter(f.input)).toEqual(first); expect(files.writeFileAt).toHaveBeenCalledTimes(writes);
    expect(await db.auditLog.count({ where: { targetId: f.record.id, action: "AI_REVIEW_SAVE" } })).toBe(1);
    expect(await canReadDocument(f.user.id, report)).toBe(true);
    expect(files.readFile).not.toHaveBeenCalled();
  });
  it("并发保存不生成两个报告，原件撤回后现行读取与再保存同时拒绝", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([saveReviewToMatter(f.input), saveReviewToMatter(f.input)]);
    expect(attempts.some(result => result.status === "fulfilled")).toBe(true);
    const saved = await saveReviewToMatter(f.input);
    expect(await db.document.count({ where: { matterId: f.matter.id, tags: { has: "AI审查" } } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: f.record.id, action: "AI_REVIEW_SAVE" } })).toBe(1);
    const report = await db.document.findUniqueOrThrow({ where: { id: saved.documentId } });
    await db.document.update({ where: { id: f.source.id }, data: { deletedAt: new Date() } });
    expect(await canReadDocument(f.user.id, report)).toBe(false);
    await expect(saveReviewToMatter(f.input)).rejects.toThrow("原材料");
    expect((await db.reviewRecord.findUniqueOrThrow({ where: { id: f.record.id } })).reportDocumentId).toBe(report.id);
  });
});
