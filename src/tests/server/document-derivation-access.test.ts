// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  state: { associated: false, qualifiedTarget: true, qualifiedSource: false, restrictedSource: true, nested: false,
    sourceDeleted: false, sourceHash: "a".repeat(64), sourceMatterId: "matter", targetDeleted: false },
  db: { user: { findUnique: vi.fn() }, matter: { count: vi.fn() }, document: { findUnique: vi.fn(), findMany: vi.fn() },
    documentResearchSource: { findMany: vi.fn() }, sealRequest: { findFirst: vi.fn() }, invoiceRequest: { findMany: vi.fn() }, archiveRecord: { findMany: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ role: "CUSTOM", enabled: true,
  rolePermissions: mocks.state.associated ? [{ permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "documents.download", scope: "OWN" }] : [] })) }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: vi.fn(async (_userId: string, action: string, id: string) =>
  action === "DOCUMENT_APPROVE" && (id === "output" ? mocks.state.qualifiedTarget : id === "source" && mocks.state.qualifiedSource)), canExecuteInvoice: vi.fn(async () => false) }));
vi.mock("@/lib/approvals/history-access", () => ({ hasHandledApproval: vi.fn(async () => false) }));

import { canReadDocument } from "@/lib/approvals/documents";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";

function document(id: string) {
  return { id, uploadedById: "author", matterId: id === "source" ? mocks.state.sourceMatterId : "matter", intakeId: null,
    deletedAt: (id === "source" && mocks.state.sourceDeleted) || (id === "output" && mocks.state.targetDeleted) ? new Date() : null,
    sha256: id === "source" ? mocks.state.sourceHash : "b".repeat(64), status: id === "output" || (id === "source" && mocks.state.qualifiedSource) ? "PENDING_REVIEW" : "DRAFT",
    approvedById: null, reviewedById: null };
}
function input(sourceId: string) {
  return { researchRevision: { matterId: "matter", issueRevision: null,
    sources: [{ documentId: sourceId, documentSha256: sourceId === "source" ? "a".repeat(64) : "b".repeat(64) }] } };
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(mocks.state, { associated: false, qualifiedTarget: true, qualifiedSource: false, restrictedSource: true, nested: false,
    sourceDeleted: false, sourceHash: "a".repeat(64), sourceMatterId: "matter", targetDeleted: false });
  mocks.db.user.findUnique.mockResolvedValue({ active: true, role: "CUSTOM" });
  mocks.db.matter.count.mockImplementation(async () => mocks.state.associated ? 1 : 0);
  mocks.db.document.findUnique.mockImplementation(async ({ where }) => document(where.id));
  mocks.db.document.findMany.mockImplementation(async ({ where }) => where.id.in.map((id: string) => document(id)));
  mocks.db.documentResearchSource.findMany.mockImplementation(async ({ where }) => where.documentId === "output" ? [input("source")]
    : where.documentId === "source" && mocks.state.nested ? [input("leaf")] : []);
  mocks.db.sealRequest.findFirst.mockImplementation(async ({ where }) => mocks.state.restrictedSource && where.OR.some((part: { draftDocId?: string }) => part.draftDocId === "source")
    ? { id: "other-seal", requestedById: "other-applicant", status: "PENDING" } : null);
  mocks.db.invoiceRequest.findMany.mockResolvedValue([]); mocks.db.archiveRecord.findMany.mockResolvedValue([]);
});
const transaction = mocks.db as unknown as Prisma.TransactionClient;

describe("派生文书的原审批与来源权限", () => {
  it("精确文书审批可读取送审正文，不获得来源正文、对外导出或重新送审资格", async () => {
    expect(await canReadDocument("reviewer", document("output"), transaction)).toBe(true);
    expect(await canReadDocument("reviewer", document("source"), transaction)).toBe(false);
    await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose: "READ", db: transaction })).resolves.toBeUndefined();
    for (const purpose of ["EXPORT", "SUBMIT"] as const) {
      await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose, db: transaction })).rejects.toThrow("来源已撤回、变更或无权读取");
    }
  });

  it("同时具备经办身份和当前审批资格仍使用真实文书审批正文授权", async () => {
    mocks.state.associated = true;
    expect(await canReadDocument("reviewer", document("source"), transaction)).toBe(false);
    expect(await canReadDocument("reviewer", document("output"), transaction)).toBe(true);
    await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose: "READ", db: transaction })).resolves.toBeUndefined();
    for (const purpose of ["EXPORT", "SUBMIT"] as const) {
      await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose, db: transaction })).rejects.toThrow("来源已撤回、变更或无权读取");
    }
  });

  it.each(["撤回", "内容指纹变化", "跨案"])("来源%s后，具体审批授权也不能恢复 READ、EXPORT 或 SUBMIT", async change => {
    mocks.state.associated = true; mocks.state.restrictedSource = false;
    if (change === "撤回") mocks.state.sourceDeleted = true;
    if (change === "内容指纹变化") mocks.state.sourceHash = "c".repeat(64);
    if (change === "跨案") mocks.state.sourceMatterId = "other-matter";
    expect(await canReadDocument("reviewer", document("output"), transaction)).toBe(false);
    for (const purpose of ["READ", "EXPORT", "SUBMIT"] as const) {
      await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose, db: transaction })).rejects.toThrow("来源已撤回、变更或无权读取");
    }
  });

  it("普通读取检查来源，不能借一份下游来源的文书审批资格授权整份派生成果导出/送审", async () => {
    mocks.state.associated = true; mocks.state.qualifiedTarget = false; mocks.state.qualifiedSource = true; mocks.state.nested = true;
    expect(await canReadDocument("reviewer", document("source"), transaction)).toBe(true);
    expect(await canReadDocument("reviewer", document("output"), transaction)).toBe(true);
    for (const purpose of ["EXPORT", "SUBMIT"] as const) {
      await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose, db: transaction })).rejects.toThrow("来源已撤回、变更或无权读取");
    }
  });

  it("没有目标文书授权，不能以存在研究输入或其他来源读取权替代", async () => {
    mocks.state.qualifiedTarget = false;
    expect(await canReadDocument("reviewer", document("output"), transaction)).toBe(false);
    await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose: "READ", db: transaction })).rejects.toThrow("来源已撤回、变更或无权读取");
    mocks.state.qualifiedTarget = true; mocks.state.targetDeleted = true;
    await expect(assertDocumentDerivationAccess("reviewer", "output", { purpose: "READ", db: transaction })).rejects.toThrow("已撤回");
  });
});
