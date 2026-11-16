// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ records: vi.fn(), session: vi.fn(), readMatter: vi.fn(), readDocument: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { reviewRecord: { findMany: mocks.records } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/permissions", () => ({ assertCanReadMatter: mocks.readMatter }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.readDocument }));

import { getMatterReviewSummary } from "@/server/ai/matter-review-summary";

const matterId = "synthetic-matter";
const user = { id: "synthetic-user", role: "CUSTOM", rolePermissions: [{ permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "documents.read", scope: "OWN" }] };
function record(id: string, documentId: string, reviewedAt: Date = new Date("2026-11-16T08:00:00Z")) {
  return { id, documentId, reviewedAt,
    itemsJson: [{ type: "RISK", severity: "HIGH", title: "合成风险 " + documentId, detail: "合成派生内容 " + documentId }],
    document: { id: documentId, name: "合成材料 " + documentId, matterId, intakeId: null, uploadedById: "synthetic-author", deletedAt: null as Date | null } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user });
  mocks.readMatter.mockResolvedValue(undefined);
  mocks.readDocument.mockResolvedValue(true);
});

describe("案件审查摘要的当前来源权限", () => {
  it("仅统计和下发逐件获准来源，保留没有全局下载权的审批特许读结果", async () => {
    const hidden = record("r-hidden", "restricted", new Date("2026-11-16T09:00:00Z"));
    const granted = record("r-granted", "approval-grant");
    mocks.records.mockResolvedValue([hidden, granted]);
    mocks.readDocument.mockImplementation(async (_id, document) => document.id === "approval-grant");
    const summary = await getMatterReviewSummary(matterId);
    expect(summary).toMatchObject({ recordCount: 1, documentCount: 1, totalItems: 1, bySeverity: { HIGH: 1, MEDIUM: 0, LOW: 0 }, latestReviewedAt: granted.reviewedAt });
    expect(summary.topHighItems).toEqual([expect.objectContaining({ documentId: "approval-grant", detail: "合成派生内容 approval-grant" })]);
    expect(JSON.stringify(summary)).not.toContain("restricted");
    expect(mocks.readDocument).toHaveBeenCalledWith(user.id, granted.document);
    expect(mocks.records).toHaveBeenCalledWith(expect.objectContaining({ where: { matterId, document: { matterId, deletedAt: null } } }));
  });

  it("已撤回或已移出当前事项的原件不产生摘要正文、名称或数量", async () => {
    const removed = record("r-removed", "removed"), moved = record("r-moved", "moved");
    removed.document.deletedAt = new Date();
    moved.document.matterId = "another-matter";
    mocks.records.mockResolvedValue([removed, moved]);
    expect(await getMatterReviewSummary(matterId)).toEqual({ recordCount: 0, documentCount: 0, totalItems: 0,
      bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 }, latestReviewedAt: null, topHighItems: [] });
    expect(mocks.readDocument).not.toHaveBeenCalled();
  });

  it("同一来源只在本次请求去重，下一次撤权立即清除已有派生摘要", async () => {
    mocks.records.mockResolvedValue([record("r-one", "same-document"), record("r-two", "same-document")]);
    expect(await getMatterReviewSummary(matterId)).toMatchObject({ recordCount: 2, documentCount: 1, totalItems: 2 });
    expect(mocks.readDocument).toHaveBeenCalledTimes(1);
    mocks.readDocument.mockResolvedValue(false);
    expect(await getMatterReviewSummary(matterId)).toMatchObject({ recordCount: 0, documentCount: 0, totalItems: 0, topHighItems: [] });
    expect(mocks.readDocument).toHaveBeenCalledTimes(2);
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.session).toHaveBeenCalledWith("matters.read");
    expect(mocks.readMatter).toHaveBeenLastCalledWith(user.id, user.role, matterId, user.rolePermissions);
  });

  it("当前会话或事项权限失效时，不查询原件派生记录", async () => {
    mocks.session.mockRejectedValueOnce(new Error("current account unavailable"));
    await expect(getMatterReviewSummary(matterId)).rejects.toThrow("current account unavailable");
    expect(mocks.records).not.toHaveBeenCalled();
    mocks.readMatter.mockRejectedValueOnce(new Error("matter access revoked"));
    await expect(getMatterReviewSummary(matterId)).rejects.toThrow("matter access revoked");
    expect(mocks.records).not.toHaveBeenCalled();
  });
});
