// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { sha256 } from "@/lib/storage/crypto";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() }, matter: { findFirst: vi.fn(), findUnique: vi.fn() },
    document: { findMany: vi.fn() }, archiveRecord: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    note: { findMany: vi.fn() }, task: { findMany: vi.fn() }, $queryRaw: vi.fn(),
  },
  userActive: true, proofWithdrawn: false,
  historyBuilder: vi.fn(), verifyPolicy: vi.fn(), verifyDocuments: vi.fn(), readDocument: vi.fn(), storageWrite: vi.fn(), storageDelete: vi.fn(), auditTx: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ enabled: true, role: "LAWYER" })) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ user: actor() })) }));
vi.mock("@/lib/clients/id-number-crypto", () => ({ decryptIdNumber: vi.fn() }));
vi.mock("@/server/audit", () => ({ auditTx: mocks.auditTx }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: (fn: (db: unknown) => Promise<unknown>) => fn(mocks.db) }));
vi.mock("@/lib/storage", () => ({ storage: { writeFile: mocks.storageWrite, deleteFile: mocks.storageDelete } }));
vi.mock("@/server/documents/derivation-access", () => ({ assertDocumentDerivationAccess: vi.fn(async () => undefined) }));
vi.mock("@/server/archive/verification", () => ({ verifyArchivePolicySource: mocks.verifyPolicy,
  verifyArchiveSnapshotDocuments: mocks.verifyDocuments, readArchiveDocument: mocks.readDocument }));
vi.mock("@/server/archive/professional-history", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/archive/professional-history")>();
  return { ...actual, buildArchiveProfessionalHistory: mocks.historyBuilder };
});

import { buildArchiveZip } from "@/server/archive/export";
import { buildMatterBundle } from "@/server/matters/export-bundle";
import { GET as archiveExport } from "@/app/api/archive/[matterId]/export/route";

const ME = "cuser000000000000000000001", MATTER = "cmatter000000000000000001";
const DOC = "cdocument00000000000000001", PROOF = "cdocument00000000000000002", ARCHIVE = "carchive00000000000000001";
const NOW = new Date("2026-07-02T03:04:05.000Z"), oldBytes = Buffer.from("合成旧稿"), oldHash = sha256(oldBytes);
function actor(): WorkspaceActor { return { id: ME, name: "合成律师", role: "LAWYER", systemRole: "NONE", avatar: null, runtimeMode: "SERVER" }; }
function document(id = DOC) { return { id, matterId: MATTER, intakeId: null, uploadedById: ME, name: id === DOC ? "合成旧稿.txt" : "合成凭据.txt",
  version: 1, sha256: oldHash, size: oldBytes.length, category: "OTHER", mimeType: "text/plain", path: `synthetic/${id}.txt`,
  encrypted: false, iv: null, authTag: null, createdAt: NOW, deletedAt: id === PROOF && mocks.proofWithdrawn ? NOW : null }; }
function snapshot() { return {
  schemaVersion: 2, policy: { configured: true, name: "合成制度", version: "1", effectiveAt: "2026-01-01",
    sourceFileId: "cfirmfile00000000000000001", sourceFileName: "合成制度.pdf", sourceFileSha256: "a".repeat(64) },
  checklist: { kind: "LITIGATION", title: "合成清单", items: [] }, manualChecks: [],
  documents: [{ id: DOC, name: "合成旧稿.txt", category: "OTHER", workflowStatus: "APPROVED", version: 1, isLatest: false,
    folderName: null, mimeType: "text/plain", size: oldBytes.length, sha256: oldHash, checklistItemIds: [], order: 1 }],
  excludedDocuments: [], documentIds: [DOC], submittedAt: NOW.toISOString(), previousRecordId: null,
}; }
function frozenHistory() { return { matterId: MATTER, selectedDocumentIds: [DOC], research: [], reviews: [],
  documentReferences: [{ documentId: DOC, documentName: "合成旧稿.txt", documentVersion: 1, documentSha256: oldHash, roles: ["DELIVERY_ITEM"] },
    { documentId: PROOF, documentName: "合成凭据.txt", documentVersion: 1, documentSha256: oldHash, roles: ["DELIVERY_PROOF"] }],
  deliveries: [{ id: "cdelivery00000000000000001", events: [{ id: "cevent0000000000000000001", kind: "REPLIED", note: "批准时的原客户回复" }] }],
}; }
function archive() { return { id: ARCHIVE, matterId: MATTER, status: "APPROVED", archiveNo: "AR-M3", archivedAt: NOW,
  archivedBy: "合成律师", summary: "合成归档", judgmentSummary: null, completedAt: null, missingItems: [],
  coverDocId: null, catalogDocId: null, checklistJson: snapshot(),
  frozenManifest: { matter: { id: MATTER, title: "合成事项", internalCode: "M3-001" }, professionalHistory: frozenHistory(), documents: snapshot().documents },
}; }

beforeEach(() => {
  vi.clearAllMocks(); mocks.userActive = true; mocks.proofWithdrawn = false;
  mocks.db.user.findUnique.mockImplementation(async () => ({ active: mocks.userActive, role: "LAWYER" }));
  mocks.db.matter.findFirst.mockResolvedValue({ id: MATTER });
  mocks.db.matter.findUnique.mockResolvedValue({ id: MATTER, internalCode: "M3-001", title: "合成事项", status: "ARCHIVED", createdAt: NOW, notes: null });
  mocks.db.document.findMany.mockImplementation(async ({ where }) => {
    const rows = [document(), document(PROOF)];
    return rows.filter(row => (!where.id?.in || where.id.in.includes(row.id)) && (where.deletedAt !== null || !row.deletedAt));
  });
  mocks.db.archiveRecord.findUnique.mockImplementation(async () => archive());
  mocks.db.archiveRecord.findFirst.mockImplementation(async () => archive());
  mocks.db.archiveRecord.update.mockResolvedValue({});
  mocks.db.note.findMany.mockResolvedValue([]); mocks.db.task.findMany.mockResolvedValue([]);
  mocks.db.$queryRaw.mockResolvedValue([{ contractTotal: "0", received: "0", outstanding: "0" }]);
  mocks.historyBuilder.mockRejectedValue(new Error("下载不能重建现行专业历史"));
  mocks.verifyPolicy.mockResolvedValue(undefined);
  mocks.verifyDocuments.mockResolvedValue({ documents: new Map([[DOC, document()]]), buffers: new Map([[DOC, oldBytes]]) });
  mocks.readDocument.mockResolvedValue(oldBytes);
  mocks.storageWrite.mockResolvedValue("synthetic/archive.zip");
  mocks.storageDelete.mockResolvedValue(undefined);
});

describe("M3 固定归档包与释放前授权边界（合成 I/O）", () => {
  it("原专业历史及选定旧稿直接来自批准快照，不查询当前历史补齐", async () => {
    const result = await buildArchiveZip(ARCHIVE, actor());
    const zip = new PizZip(result.buffer);
    const manifest = JSON.parse(zip.file("AR-M3/manifest.json")!.asText());
    expect(manifest.professionalHistory).toEqual(frozenHistory());
    expect(zip.file("AR-M3/材料/其他/001_合成旧稿.txt")?.asText()).toBe(oldBytes.toString());
    expect(Object.keys(zip.files).some(name => name.includes("凭据"))).toBe(false);
    expect(mocks.historyBuilder).not.toHaveBeenCalled();
  });

  it("缺少批准时的结构化快照拒绝导出，不回退到现行案件", async () => {
    mocks.db.archiveRecord.findUnique.mockResolvedValue({ ...archive(), frozenManifest: null });
    await expect(buildArchiveZip(ARCHIVE, actor())).rejects.toThrow(/未固定卷宗数据/);
    expect(mocks.historyBuilder).not.toHaveBeenCalled();
    expect(mocks.verifyDocuments).not.toHaveBeenCalled();
  });

  it("构建文件期间证明材料被撤回，最终检查阻断整个包", async () => {
    mocks.verifyDocuments.mockImplementation(async () => {
      mocks.proofWithdrawn = true;
      return { documents: new Map([[DOC, document()]]), buffers: new Map([[DOC, oldBytes]]) };
    });
    await expect(buildArchiveZip(ARCHIVE, actor())).rejects.toThrow(/撤回/);
    expect(mocks.verifyDocuments).toHaveBeenCalledTimes(1);
    expect(mocks.historyBuilder).not.toHaveBeenCalled();
  });

  it.each(["账号停用", "凭据撤回"])("归档包落盘期间%s，响应释放前仍须拒绝下载", async change => {
    mocks.storageWrite.mockImplementation(async () => {
      if (change === "账号停用") mocks.userActive = false; else mocks.proofWithdrawn = true;
      return "synthetic/archive.zip";
    });
    const result = await archiveExport(new Request(`http://localhost/api/archive/${MATTER}/export`), { params: Promise.resolve({ matterId: MATTER }) });
    expect(result.status).not.toBe(200);
    expect(result.headers.get("content-type")).toContain("application/json");
    expect(await result.text()).not.toContain("批准时的原客户回复");
    expect(mocks.db.archiveRecord.update).not.toHaveBeenCalled();
    expect(mocks.auditTx).not.toHaveBeenCalled();
    expect(mocks.storageDelete).toHaveBeenCalledWith("synthetic/archive.zip");
  });

  it("在办完整包的实际字节不符登记 hash 时停止，不带旧标识输出改过的文件", async () => {
    mocks.readDocument.mockResolvedValue(Buffer.from("原件已变化"));
    const failure = await buildMatterBundle(MATTER, actor()).then(() => null, error => error as Error);
    expect(failure).toMatchObject({ message: expect.stringMatching(/原件|变化|不一致/) });
  });
});
