import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), readMatter: vi.fn(), handleMatter: vi.fn(), writable: vi.fn(), readDocument: vi.fn(),
  permission: vi.fn(), document: vi.fn(), matter: vi.fn(), evidence: vi.fn(), options: vi.fn(),
  family: vi.fn(), folders: vi.fn(), archives: vi.fn(), logs: vi.fn(), query: vi.fn(),
  canApprove: vi.fn(), handled: vi.fn(), context: vi.fn(), recipients: vi.fn(), selfConfirm: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findUnique: mocks.document, findMany: mocks.family }, matter: { findFirst: mocks.matter }, documentFolder: { findMany: mocks.folders }, archiveRecord: { findMany: mocks.archives }, auditLog: { findMany: mocks.logs }, $queryRaw: mocks.query } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/permissions", () => ({ assertCanReadMatter: mocks.readMatter, assertCanHandleMatter: mocks.handleMatter, matterAssociationFilter: (id: string) => ({ ownerId: id }) }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: mocks.writable }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.readDocument }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: mocks.canApprove, approvalContextFor: mocks.context, approvalRecipients: mocks.recipients }));
vi.mock("@/lib/approvals/history-access", () => ({ hasHandledApproval: mocks.handled }));
vi.mock("@/lib/approvals/self-confirm", () => ({ selfConfirmEligible: mocks.selfConfirm }));
vi.mock("@/lib/roles/catalog", () => ({ hasCustomPermission: mocks.permission }));
vi.mock("@/server/evidence/actions", () => ({ listEvidenceItems: mocks.evidence }));
vi.mock("@/server/evidence/source-links", () => ({ readableDocumentOptions: mocks.options }));
import { getCaseMaterialDetail, getEvidenceCreateOptions } from "@/server/evidence/workspace-actions";

const matterId = "cmatter00000000000000000001";
const documentId = "cdocume000000000000000000001";
const user = { id: "cuser0000000000000000000001", role: "LAWYER", rolePermissions: {} };
const document = { id: documentId, matterId, intakeId: null, uploadedById: user.id, deletedAt: null,
  name: "同名材料.pdf", version: 2, mimeType: "application/pdf", pageCount: 5, createdAt: new Date("2026-11-16"), updatedAt: new Date("2026-11-16"),
  status: "DRAFT", familyId: "cfamily00000000000000000001", isLatest: true, folderId: null, folder: null, tags: [], reviewReportFor: null,
  uploadedBy: { name: "合成上传人" }, approvedById: null, reviewedById: null, matter: { status: "ACTIVE" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user });
  mocks.document.mockResolvedValue(document);
  mocks.readDocument.mockResolvedValue(true);
  mocks.permission.mockReturnValue(true);
  mocks.matter.mockResolvedValue({ id: matterId, ownerId: user.id, members: [] });
  mocks.evidence.mockResolvedValue([]);
  mocks.options.mockResolvedValue([]);
  mocks.family.mockResolvedValue([document]); mocks.folders.mockResolvedValue([]); mocks.archives.mockResolvedValue([]); mocks.logs.mockResolvedValue([]);
  mocks.query.mockResolvedValue([{ count: BigInt(0) }]); mocks.canApprove.mockResolvedValue(false); mocks.handled.mockResolvedValue(false);
  mocks.context.mockResolvedValue({ action: "DOCUMENT_APPROVE", category: null, requesterId: user.id });
  mocks.recipients.mockResolvedValue(["approver"]); mocks.selfConfirm.mockResolvedValue(false);
});

describe("材料详情与新建选项读取边界", () => {
  it("读取绑定确切版本，复用已脱敏要点，只返回该版本的关联", async () => {
    const related = { id: "evidence-1", title: "来源不可用的要点", content: "", restricted: true, sources: [{ documentId }] };
    mocks.evidence.mockResolvedValue([related, { id: "evidence-2", sources: [{ documentId: "another-version" }] }]);
    const result = await getCaseMaterialDetail({ matterId, documentId });
    expect(mocks.session).toHaveBeenCalledWith("documents.read");
    expect(mocks.readMatter).toHaveBeenCalledWith(user.id, user.role, matterId, user.rolePermissions);
    expect(mocks.readDocument).toHaveBeenCalledWith(user.id, document);
    expect(result.document).toMatchObject({ id: documentId, version: 2, originalUrl: `/api/documents/${documentId}/download?inline=1` });
    expect(result.document).not.toHaveProperty("uploadedById");
    expect(result.items).toEqual([related]);
    expect(result.canCreateEvidence).toBe(true);
    expect(result.actions.canUploadVersion).toBe(true);
    expect(result.document.reviewReport).toBeNull();
  });

  it.each(["relation", "unbound-marker"])("固定报告按 %s 禁止传新版，仅真实关联返回原材料 ID", async kind => {
    const sourceDocumentId = "cdocume000000000000000000002";
    mocks.document.mockResolvedValue({ ...document,
      reviewReportFor: kind === "relation" ? { documentId: sourceDocumentId } : null,
      tags: kind === "unbound-marker" ? ["AI审查"] : [],
    });
    const result = await getCaseMaterialDetail({ matterId, documentId });
    expect(result.actions.canUploadVersion).toBe(false);
    expect(result.document.reviewReport).toEqual({ sourceDocumentId: kind === "relation" ? sourceDocumentId : null });
  });

  it.each(["foreign", "deleted", "denied"])("%s 材料不得返回元信息或读取关联要点", async reason => {
    if (reason === "foreign") mocks.document.mockResolvedValue({ ...document, matterId: "cmatter00000000000000000002" });
    if (reason === "deleted") mocks.document.mockResolvedValue({ ...document, deletedAt: new Date() });
    if (reason === "denied") mocks.readDocument.mockResolvedValue(false);
    await expect(getCaseMaterialDetail({ matterId, documentId })).rejects.toThrow("材料不存在或当前无权读取");
    expect(mocks.evidence).not.toHaveBeenCalled();
  });

  it("有材料读取资格但没有案件写入资格时不提供新建动作", async () => {
    mocks.permission.mockReturnValue(false);
    expect((await getCaseMaterialDetail({ matterId, documentId })).canCreateEvidence).toBe(false);
    expect(mocks.matter).not.toHaveBeenCalled();
  });

  it.each([
    { name: "材料.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", previewable: true, endpoint: "preview" },
    { name: "材料.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", previewable: true, endpoint: "preview" },
    { name: "材料.pdf", mimeType: "application/pdf", previewable: true, endpoint: "download?inline=1" },
    { name: "材料.zip", mimeType: "application/zip", previewable: false, endpoint: "download" },
  ])("$name 沿用实际预览入口且下载使用同一材料授权", async type => {
    mocks.document.mockResolvedValue({ ...document, name: type.name, mimeType: type.mimeType });
    const result = await getCaseMaterialDetail({ matterId, documentId });
    expect(result.document).toMatchObject({ previewable: type.previewable, originalUrl: `/api/documents/${documentId}/${type.endpoint}`, downloadUrl: `/api/documents/${documentId}/download` });
  });

  it("新建选项复用当前经办、归档守卫及实际来源信息", async () => {
    const options = [{ id: documentId, name: document.name, version: 2, isPdf: true, pageCount: 5, hasIdentity: true }];
    mocks.options.mockResolvedValue(options);
    expect(await getEvidenceCreateOptions(matterId)).toEqual(options);
    expect(mocks.session).toHaveBeenCalledWith("matters.write");
    expect(mocks.handleMatter).toHaveBeenCalledWith(user, matterId);
    expect(mocks.writable).toHaveBeenCalledWith(matterId, { allowPrincipal: true });
    expect(mocks.options).toHaveBeenCalledWith(user.id, matterId);
  });

  it("写入资格或归档守卫拒绝时不读取材料选项", async () => {
    mocks.writable.mockRejectedValue(new Error("案件已归档"));
    await expect(getEvidenceCreateOptions(matterId)).rejects.toThrow("案件已归档");
    expect(mocks.options).not.toHaveBeenCalled();
  });

  it("版本只按真实族读取，受限当前版不泄露且不把历史版提升为当前", async () => {
    const historical = { ...document, isLatest: false, version: 1 };
    mocks.document.mockResolvedValue(historical);
    mocks.family.mockResolvedValue([{ ...document, id: "restricted-current", name: "不可披露的当前版本" }, historical]);
    mocks.readDocument.mockImplementation(async (_user, doc) => doc.id !== "restricted-current");
    const result = await getCaseMaterialDetail({ matterId, documentId });
    expect(mocks.family).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: document.familyId, matterId, deletedAt: null } }));
    expect(result.versions).toEqual([{ id: documentId, name: document.name, version: 1, isLatest: false, status: "DRAFT" }]);
    expect(result.currentVersionUnavailable).toBe(true);
    expect(result.actions.canUploadVersion).toBe(false);
    expect(JSON.stringify(result)).not.toContain("不可披露");
  });

  it("上传人草稿按实际审批路径显示送审或本人确认，无路由给出原因", async () => {
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions.submitMode).toBe("review");
    mocks.recipients.mockResolvedValue([]);
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions).toMatchObject({ submitMode: null, submitBlockedReason: expect.stringContaining("尚无可审批人员") });
    mocks.selfConfirm.mockResolvedValue(true); mocks.recipients.mockClear();
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions.submitMode).toBe("self");
    expect(mocks.recipients).not.toHaveBeenCalled();
  });

  it("其他上传人的普通经办者不能送审或管理卷宗，精确审批资格独立显示", async () => {
    mocks.document.mockResolvedValue({ ...document, uploadedById: "another", status: "PENDING_REVIEW" });
    mocks.matter.mockResolvedValue({ id: matterId, ownerId: "another", members: [{ role: "MEMBER" }] });
    mocks.canApprove.mockResolvedValue(true);
    const result = await getCaseMaterialDetail({ matterId, documentId });
    expect(result.actions).toMatchObject({ submitMode: null, canMoveFolder: false, canWithdraw: false, canDecide: true });
    expect(mocks.canApprove).toHaveBeenCalledWith(user.id, "DOCUMENT_APPROVE", documentId);
  });

  it("批准历史版仍可入卷；归档或固定收案原件不得出现入卷入口", async () => {
    mocks.document.mockResolvedValue({ ...document, isLatest: false, status: "APPROVED" });
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions).toMatchObject({ canFile: true, canUploadVersion: false });
    mocks.matter.mockResolvedValue(null);
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions.canFile).toBe(false);
    mocks.matter.mockResolvedValue({ id: matterId, ownerId: user.id, members: [] });
    mocks.document.mockResolvedValue({ ...document, status: "APPROVED", intakeId: "cintake0000000000000000001" });
    mocks.query.mockResolvedValue([{ count: BigInt(1) }]);
    expect((await getCaseMaterialDetail({ matterId, documentId })).actions).toMatchObject({ canFile: false, canUploadVersion: false, canWithdraw: false, restriction: expect.stringContaining("固定于收案") });
  });
});
