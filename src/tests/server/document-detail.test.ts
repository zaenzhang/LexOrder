import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  db: { document: { findUnique: vi.fn(), findMany: vi.fn() }, documentContextInput: { findMany: vi.fn() }, user: { findUniqueOrThrow: vi.fn() }, matter: { count: vi.fn() }, archiveRecord: { findMany: vi.fn() }, $transaction: vi.fn() },
  read: vi.fn(), role: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mock.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "author", role: "LAWYER" } })) }));
// Exact-body/source grants are exercised by the dedicated access suites;
// this suite verifies that the detail projection checks every concrete version.
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mock.read }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: mock.role }));
import { getDocumentDetail } from "@/server/documents/detail-actions";

const matterId = "cm00000000000000000000001", otherMatterId = "cm00000000000000000000002";
const oldId = "cm00000000000000000000003", latestId = "cm00000000000000000000004";
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function document(changes: Record<string, unknown> = {}) {
  return { id: oldId, name: "合成旧版意见.docx", version: 1, familyId: oldId, isLatest: false,
    mimeType: docxMime, status: "APPROVED",
    createdAt: new Date("2026-11-16T08:00:00Z"), updatedAt: new Date("2026-11-16T08:00:00Z"), tags: [], reviewReportFor: null, uploadedById: "author", matterId, intakeId: null, deletedAt: null,
    matter: { status: "ACTIVE", deletedAt: null }, uploadedBy: { name: "合成作者" }, ...changes };
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.db.$transaction.mockImplementation(async callback => callback(mock.db));
  mock.db.document.findUnique.mockResolvedValue(document());
  mock.db.document.findMany.mockResolvedValue([document({ id: latestId, name: "合成未审新稿.docx", version: 2, status: "DRAFT", isLatest: true }), document()]);
  mock.db.user.findUniqueOrThrow.mockResolvedValue({ role: "LAWYER" });
  mock.db.matter.count.mockResolvedValue(1);
  mock.db.archiveRecord.findMany.mockResolvedValue([]);
  mock.db.documentContextInput.findMany.mockResolvedValue([]);
  mock.role.mockResolvedValue({ role: "LAWYER", enabled: true });
  mock.read.mockResolvedValue(true);
});

describe("指定文书版本详情", () => {
  it("旧版始终返回其具体身份和审批状态，新稿不替代旧版", async () => {
    const result = await getDocumentDetail(matterId, oldId);
    expect(result).toMatchObject({ id: oldId, name: "合成旧版意见.docx", version: 1, status: "APPROVED", isLatest: false, canUploadVersion: false });
    expect(result.versions).toEqual([
      { id: latestId, name: "合成未审新稿.docx", version: 2, status: "DRAFT", isLatest: true, mimeType: docxMime },
      { id: oldId, name: "合成旧版意见.docx", version: 1, status: "APPROVED", isLatest: false, mimeType: docxMime },
    ]);
    expect(mock.read).toHaveBeenCalledWith("author", expect.objectContaining({ id: oldId }), mock.db);
    expect(mock.read).toHaveBeenCalledWith("author", expect.objectContaining({ id: latestId }), mock.db);
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("extractedText");
  });

  it("与当前案件不符时在读取同族版本前拒绝，不借另一案件的可读权限显示正文", async () => {
    await expect(getDocumentDetail(otherMatterId, oldId)).rejects.toThrow("不存在、已撤回或无权读取");
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.db.document.findMany).not.toHaveBeenCalled();
  });

  it("缺少文书族时只显示该原件，允许从明确选中的当前版本建立新版本", async () => {
    mock.db.document.findUnique.mockResolvedValue(document({ familyId: null, isLatest: true }));
    const result = await getDocumentDetail(matterId, oldId);
    expect(result).toMatchObject({ id: oldId, name: "合成旧版意见.docx", status: "APPROVED", hasVersionFamily: false, canUploadVersion: true,
      versions: [{ id: oldId, version: 1, name: "合成旧版意见.docx", isLatest: true, status: "APPROVED" }] });
    expect(mock.read).toHaveBeenCalledWith("author", expect.objectContaining({ id: oldId, familyId: null }), mock.db);
    expect(mock.db.document.findMany).not.toHaveBeenCalled();
  });

  it("仅获具体送审稿读取资格者不会看到未审新稿，也不会得到案内修改或交付动作", async () => {
    mock.db.user.findUniqueOrThrow.mockResolvedValue({ role: "CUSTOM" });
    mock.role.mockResolvedValue({ role: "CUSTOM", enabled: true, rolePermissions: [] });
    mock.db.matter.count.mockResolvedValue(0);
    mock.read.mockImplementation(async (_actor, row) => row.id === oldId);
    const result = await getDocumentDetail(matterId, oldId);
    expect(result.versions.map(row => row.id)).toEqual([oldId]);
    expect(result).toMatchObject({ canUploadVersion: false, canSubmit: false, canFile: false, canPrepareDelivery: false });
  });

  it("来源撤权导致指定稿不可读时不枚举其他版本；归档仍可读但全部写动作关闭", async () => {
    mock.read.mockResolvedValueOnce(false);
    await expect(getDocumentDetail(matterId, oldId)).rejects.toThrow("无权读取");
    expect(mock.db.document.findMany).not.toHaveBeenCalled();
    mock.db.document.findUnique.mockResolvedValue(document({ isLatest: true, matter: { status: "ARCHIVED", deletedAt: null } }));
    const result = await getDocumentDetail(matterId, oldId);
    expect(result).toMatchObject({ id: oldId, canUploadVersion: false, canSubmit: false, canFile: false, canPrepareDelivery: false });
  });
});
