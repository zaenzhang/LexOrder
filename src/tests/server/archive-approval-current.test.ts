// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requireClosure, buildManifest, approveAudit, notify, checkApproval, verifyPolicy, verifyDocuments } = vi.hoisted(() => ({
  db: {
    archiveRecord: { findUnique: vi.fn(), update: vi.fn() },
    matter: { update: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  },
  requireClosure: vi.fn(), buildManifest: vi.fn(), approveAudit: vi.fn(), notify: vi.fn(),
  checkApproval: vi.fn(), verifyPolicy: vi.fn(), verifyDocuments: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "creviewer000000000000001", name: "合成审批人" } })) }));
vi.mock("@/lib/approvals/service", () => ({
  approvalTransaction: vi.fn(async write => write(db)), approvalAudit: approveAudit,
  assertApprovalItem: checkApproval, requireApprovalRoute: vi.fn(),
}));
vi.mock("@/lib/roles/service", () => ({ roleMutation: vi.fn(), checkRoleMutation: vi.fn(), resolveRoleUser: vi.fn() }));
vi.mock("@/server/archive/closure", () => ({ assertClosureReady: requireClosure, closureReady: vi.fn(async () => true) }));
vi.mock("@/server/archive/export", () => ({ buildArchiveManifest: buildManifest }));
vi.mock("@/server/archive/verification", () => ({ createArchiveDocumentSnapshots: vi.fn(), verifyArchivePolicySource: verifyPolicy, verifyArchiveSnapshotDocuments: verifyDocuments }));
vi.mock("@/server/archive/render", () => ({ renderArchiveCover: vi.fn(), renderArchiveCatalog: vi.fn() }));
vi.mock("@/server/notifications/approval", () => ({ notifyRoleApprovers: vi.fn() }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { approveArchiveRecord, rejectArchiveRecord } from "@/server/archive/actions";

const ARCHIVE = "carchive00000000000000001";
const MATTER = "cmatter000000000000000001";
const DOC = "cdocument000000000000001";
const POLICY = "cpolicy000000000000000001";
const NOW = new Date("2026-11-16T00:00:00Z");
const record = () => ({
  id: ARCHIVE, matterId: MATTER, status: "PENDING_REVIEW", completedAt: NOW,
  archiveNo: "AR-SYNTHETIC-001", coverDocId: null, catalogDocId: null, archivedById: "creviewer000000000000001",
  checklistJson: {
    schemaVersion: 2,
    policy: { configured: true, name: "合成制度", version: "1", effectiveAt: "2026-01-01", sourceFileId: POLICY, sourceFileName: "制度.txt", sourceFileSha256: "policy-hash" },
    checklist: { kind: "LITIGATION", title: "合成清单", items: [] }, manualChecks: [],
    documents: [{ id: DOC, name: "合成材料", category: "OTHER", workflowStatus: "FILED", version: 1, isLatest: true, folderName: null, mimeType: "text/plain", size: 4, sha256: "content-hash", checklistItemIds: [], order: 1 }],
    excludedDocuments: [], documentIds: [DOC], submittedAt: NOW.toISOString(), previousRecordId: null,
  },
});
const input = () => ({ archiveId: ARCHIVE, verificationIds: [`document:${DOC}`], exceptionApproved: false });

beforeEach(() => {
  vi.resetAllMocks();
  db.archiveRecord.findUnique.mockResolvedValue(record());
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("?").includes("to_regclass") ? [{ ready: false }] : [{ workflowSnapshot: { fingerprint: "current-fingerprint" }, supplementOfId: null }]);
  buildManifest.mockResolvedValue({ archiveNo: "AR-SYNTHETIC-001", matter: { id: MATTER } });
  db.matter.findUnique.mockResolvedValue({ internalCode: "LL-2026-CC-9001", title: "合成案件" });
});

describe("归档批准必须固定当前快照", () => {
  it.each([null, {}])("缺核对快照或其指纹时不批准：%j", async workflowSnapshot => {
    db.$queryRaw.mockResolvedValue([{ workflowSnapshot, supplementOfId: null }]);
    await expect(approveArchiveRecord(input())).rejects.toThrow("缺少归档核对快照");
    expect(db.archiveRecord.update).not.toHaveBeenCalled();
    expect(approveAudit).not.toHaveBeenCalled();
    expect(buildManifest).not.toHaveBeenCalled();
  });

  it("必需快照读取失败不能跳过批准核对", async () => {
    const unavailable = new Error('column "workflowSnapshot" does not exist');
    db.$queryRaw.mockRejectedValue(unavailable);
    await expect(approveArchiveRecord(input())).rejects.toBe(unavailable);
    expect(db.archiveRecord.update).not.toHaveBeenCalled();
  });

  it("批准事务内复核指纹并固定 manifest，同时保留材料、制度和审批资格检查", async () => {
    await expect(approveArchiveRecord(input())).resolves.toEqual({ ok: true });
    expect(requireClosure).toHaveBeenCalledWith(db, MATTER, "current-fingerprint", { supplement: false });
    expect(checkApproval).toHaveBeenLastCalledWith("creviewer000000000000001", "ARCHIVE_APPROVE", ARCHIVE, db);
    expect(verifyPolicy).toHaveBeenCalledOnce();
    expect(verifyDocuments).toHaveBeenCalledOnce();
    expect(buildManifest).toHaveBeenCalledWith(db, ARCHIVE);
    expect(db.archiveRecord.update).toHaveBeenCalledWith({ where: { id: ARCHIVE }, data: { frozenManifest: { archiveNo: "AR-SYNTHETIC-001", matter: { id: MATTER } } } });
  });

  it("补充批准固定自己的快照，不再次改变原案归档状态", async () => {
    db.$queryRaw.mockResolvedValue([{ workflowSnapshot: { fingerprint: "current-fingerprint" }, supplementOfId: "cparent000000000000000001" }]);
    await expect(approveArchiveRecord(input())).resolves.toEqual({ ok: true });
    expect(requireClosure).toHaveBeenCalledWith(db, MATTER, "current-fingerprint", { supplement: true });
    expect(db.matter.update).not.toHaveBeenCalled();
    expect(buildManifest).toHaveBeenCalledWith(db, ARCHIVE);
  });

  it.each(["approve", "reject"] as const)("%s 通知使用真实案件编号和名称", async decision => {
    db.archiveRecord.findUnique.mockResolvedValue({ ...record(), archivedById: "capplicant000000000000001" });
    if (decision === "approve") await approveArchiveRecord(input());
    else await rejectArchiveRecord({ archiveId: ARCHIVE, note: "合成退回理由" });
    expect(db.matter.findUnique).toHaveBeenCalledWith({ where: { id: MATTER }, select: { title: true, internalCode: true } });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ href: "/matters/LL-2026-CC-9001", content: expect.stringContaining("LL-2026-CC-9001·合成案件") }));
  });
});
