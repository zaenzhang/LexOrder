// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() }, document: { findUnique: vi.fn() }, matter: { count: vi.fn() },
  sealRequest: { findFirst: vi.fn() }, invoiceRequest: { findMany: vi.fn() }, archiveRecord: { findMany: vi.fn() },
  auditLog: { findFirst: vi.fn() }, systemSetting: { findUnique: vi.fn() },
  documentResearchSource: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: vi.fn(async () => false), canExecuteInvoice: vi.fn(async () => false) }));
vi.mock("@/lib/approvals/history-access", () => ({ hasHandledApproval: vi.fn(async () => false) }));
import { canReadDocument } from "@/lib/approvals/documents";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
const coverage = { totalChars: 10, totalSegments: 1, segments: [{ index: 1, chars: 10, status: "SUCCEEDED", errorCode: null }], stopReason: null };
function material(id: string) {
  return { id, matterId: "matter", intakeId: null, uploadedById: "lawyer", deletedAt: null as Date | null,
    tags: [] as string[], sha256: "a".repeat(64), status: "DRAFT", reviewReportFor: null as unknown };
}
let source: ReturnType<typeof material>, report: ReturnType<typeof material>;
beforeEach(() => {
  vi.resetAllMocks(); source = material("source-v1"); report = material("report"); report.tags = ["AI审查", "存档"];
  report.reviewReportFor = { matterId: "matter", documentId: source.id, reportDocumentId: report.id,
    sourceSha256: source.sha256, coverageJson: coverage, document: source };
  db.document.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === report.id ? report : where.id === source.id ? source : null);
  db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  db.matter.count.mockResolvedValue(1); db.sealRequest.findFirst.mockResolvedValue(null);
  db.invoiceRequest.findMany.mockResolvedValue([]); db.archiveRecord.findMany.mockResolvedValue([]);
  db.auditLog.findFirst.mockResolvedValue(null);
  db.documentResearchSource.findMany.mockResolvedValue([]);
});
describe("审阅报告与原文共同经过现行材料读取边界", () => {
  it("可读报告还须拥有具体原件的权限，报告不传播用章附件资格", async () => {
    expect(await canReadDocument("lawyer", report)).toBe(true);
    db.sealRequest.findFirst.mockImplementation(async ({ where }: { where: { OR: { draftDocId?: string }[] } }) =>
      where.OR[0].draftDocId === source.id ? { id: "restricted-seal", requestedById: "other", status: "PENDING" } : null);
    expect(await canReadDocument("lawyer", report)).toBe(false);
  });
  it("原件撤回或权威hash变化后，管理岗位也不能绕过来源校验", async () => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "PRINCIPAL_LAWYER" });
    source.deletedAt = new Date(); expect(await canReadDocument("lawyer", report)).toBe(false);
    source.deletedAt = null; source.sha256 = "b".repeat(64); expect(await canReadDocument("lawyer", report)).toBe(false);
  });
  it("旧审阅报告保留原读取权，但缺失来源证明时不能对外导出或重新送审", async () => {
    report.reviewReportFor = null;
    expect(await canReadDocument("lawyer", report)).toBe(true);
    await expect(assertDocumentDerivationAccess("lawyer", report.id, { purpose: "EXPORT" })).rejects.toThrow("来源");
    await expect(assertDocumentDerivationAccess("lawyer", report.id, { purpose: "SUBMIT" })).rejects.toThrow("来源");
    expect(await canReadDocument("lawyer", source)).toBe(true);
  });
  it("来源报告继续核对其自身原文，循环关系明确拒绝", async () => {
    source.tags = ["AI审查"];
    source.reviewReportFor = { matterId: "matter", documentId: report.id, reportDocumentId: source.id,
      sourceSha256: report.sha256, coverageJson: coverage, document: report };
    expect(await canReadDocument("lawyer", report)).toBe(false);
  });
});
