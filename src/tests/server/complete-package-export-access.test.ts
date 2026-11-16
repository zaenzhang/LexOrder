// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { createHash } from "node:crypto";
import { ActionError } from "@/lib/action-error";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const { db, state, readDocument, assertDerivation, archiveZip, storageWrite } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    matter: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    matterMember: { findUnique: vi.fn() },
    archiveBorrowRequest: { findFirst: vi.fn() },
    document: { findMany: vi.fn() },
    note: { findMany: vi.fn() }, task: { findMany: vi.fn() },
    archiveRecord: { findFirst: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn()
  },
  state: {
    actor: null as WorkspaceActor | null,
    ownerId: "", members: [] as string[], deleted: false, teamRead: false, active: true,
    currentActor: null as WorkspaceActor | null,
  },
  readDocument: vi.fn(), assertDerivation: vi.fn(), archiveZip: vi.fn(), storageWrite: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => state.actor ? { user: state.actor } : null) }));
vi.mock("@/server/documents/derivation-access", () => ({ assertDocumentDerivationAccess: assertDerivation }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ ...(state.currentActor ?? state.actor), enabled: true })) }));
vi.mock("@/server/archive/verification", () => ({ readArchiveDocument: readDocument }));
vi.mock("@/server/archive/export", () => ({ buildArchiveZip: archiveZip, assertArchiveExportAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/storage", () => ({ storage: { writeFile: storageWrite } }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: (fn: (db: unknown) => Promise<unknown>) => fn(db) }));

import { GET as liveExport } from "@/app/api/matters/[id]/export-bundle/route";
import { GET as archiveExport } from "@/app/api/archive/[matterId]/export/route";

const ME = "clawyer000000000000000001";
const OTHER = "clawyer000000000000000002";
const MATTER = "cmatter000000000000000001";
const DOC = "cm00000000000000000000002";
const HASH = createHash("sha256").update("test").digest("hex");
const NOW = new Date("2026-11-16T00:00:00.000Z");
const actor = (): WorkspaceActor => ({ id: ME, name: "测试律师", role: "LAWYER", systemRole: "NONE", avatar: null, runtimeMode: "SERVER" });
const document = () => ({
  id: DOC, uploadedById: ME, matterId: MATTER, intakeId: null, deletedAt: null,
  name: "测试材料.txt", category: "OTHER", mimeType: "text/plain", size: 4, sha256: HASH,
  path: "fixture.txt", encrypted: false, iv: null, authTag: null, createdAt: NOW,
});
const snapshot = () => ({
  schemaVersion: 2,
  policy: { configured: true, name: "测试制度", version: "1", effectiveAt: "2026-11-16", sourceFileId: "cm00000000000000000000001", sourceFileName: "制度.pdf", sourceFileSha256: "policy-hash" },
  checklist: { kind: "LITIGATION", title: "测试清单", items: [] }, manualChecks: [],
  documents: [{ id: DOC, name: "测试材料.txt", category: "OTHER", workflowStatus: "FILED", version: 1, isLatest: true, folderName: null, mimeType: "text/plain", size: 4, sha256: HASH, checklistItemIds: [], order: 1 }],
  excludedDocuments: [], documentIds: [DOC], submittedAt: NOW.toISOString(), previousRecordId: null
});
type PackageKind = "live" | "archive";
async function requestPackage(kind: PackageKind) {
  return kind === "live"
    ? liveExport(new Request(`http://localhost/api/matters/${MATTER}/export-bundle`), { params: Promise.resolve({ id: MATTER }) })
    : archiveExport(new Request(`http://localhost/api/archive/${MATTER}/export`), { params: Promise.resolve({ matterId: MATTER }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  state.actor = actor(); state.currentActor = null; state.active = true; state.ownerId = ME; state.members = []; state.deleted = false; state.teamRead = false;
  db.user.findUnique.mockImplementation(async () => ({ active: state.active, role: (state.currentActor ?? state.actor)?.role }));
  // Real export scopes and the former overview-only predicate see the same synthetic relationships.
  db.matter.findFirst.mockImplementation(async ({ where }) => {
    if (state.deleted || where.id !== MATTER) return null;
    if (where.AND) return state.teamRead ? { id: MATTER } : null;
    if (!where.OR) return { id: MATTER };
    return state.ownerId === ME || state.members.includes(ME) ? { id: MATTER } : null;
  });
  db.matter.findUnique.mockResolvedValue({ id: MATTER, internalCode: "M-001", title: "测试事项", status: "ARCHIVED", createdAt: NOW, notes: null });
  db.matter.count.mockImplementation(async () => state.ownerId === ME || state.members.includes(ME) ? 1 : 0);
  db.matterMember.findUnique.mockImplementation(async () => state.members.includes(ME) ? { userId: ME } : null);
  db.archiveBorrowRequest.findFirst.mockResolvedValue(null);
  db.document.findMany.mockResolvedValue([document()]);
  db.note.findMany.mockResolvedValue([]); db.task.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([{ contractTotal: "100", received: "30", outstanding: "70" }]);
  db.archiveRecord.findFirst.mockResolvedValue({ id: "carchive00000000000000001", archiveNo: "AR-001", checklistJson: snapshot() });
  assertDerivation.mockResolvedValue(undefined);
  readDocument.mockResolvedValue(Buffer.from("test"));
  archiveZip.mockResolvedValue({ buffer: Buffer.from("archive"), fileName: "archive.zip", size: 7, checksum: "fixture-checksum" });
  storageWrite.mockResolvedValue("archive-test.zip");
});

function expectNoPrivateExportRead() {
  expect(db.document.findMany).not.toHaveBeenCalled();
  expect(db.$queryRaw).not.toHaveBeenCalled();
  expect(readDocument).not.toHaveBeenCalled();
  expect(archiveZip).not.toHaveBeenCalled();
  expect(storageWrite).not.toHaveBeenCalled();
}

describe("Server 完整案卷导出范围", () => {
  it("团队只读仍可看到概况，但不能通过在办完整包取得附件和财务", async () => {
    state.ownerId = OTHER; state.teamRead = true;
    expect((await requestPackage("live")).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it("有效借阅不替代在办完整包导出资格", async () => {
    state.ownerId = OTHER;
    db.archiveBorrowRequest.findFirst.mockResolvedValue({ id: "valid-borrow" });
    expect((await requestPackage("live")).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：业务管理权不能导出没有经办关联的事项", async kind => {
    state.ownerId = OTHER;
    state.actor = { ...actor(), managerAuthorized: true, rolePermissions: [{ permissionKey: "matters.read", scope: "ALL" }, { permissionKey: "finance.read", scope: "ALL" }] };
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：系统管理员身份也不能代替经办关联", async kind => {
    state.ownerId = OTHER; state.actor = { ...actor(), systemRole: "SUPER_ADMIN" };
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：自定义角色的全所查看授权不放大仅限本人办理的导出", async kind => {
    state.ownerId = OTHER;
    state.actor = { ...actor(), role: "CUSTOM", rolePermissions: [
      { permissionKey: "matters.export", scope: "OWN" }, { permissionKey: "matters.read", scope: "ALL" },
      { permissionKey: "finance.read", scope: "ALL" }, { permissionKey: "documents.download", scope: "OWN" },
      { permissionKey: "archive.read", scope: "ALL" },
    ] };
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：有经办关联仍需独立财务查看权限", async kind => {
    state.actor = { ...actor(), role: "CUSTOM", rolePermissions: [
      { permissionKey: "matters.export", scope: "OWN" }, { permissionKey: "matters.read", scope: "OWN" },
      { permissionKey: "documents.download", scope: "OWN" }, { permissionKey: "archive.read", scope: "OWN" },
    ] };
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：主办不依赖冗余的MatterMember行即可导出", async kind => {
    const response = await requestPackage(kind);
    expect(response.status).toBe(200);
    expect(assertDerivation).toHaveBeenCalledWith(ME, DOC, expect.objectContaining({ purpose: "EXPORT" }));
    if (kind === "live") {
      const zip = new PizZip(Buffer.from(await response.arrayBuffer()));
      expect(JSON.parse(zip.file("M-001/manifest.json")!.asText())).toMatchObject({ exportedBy: ME, finance: { received: 30 } });
      expect(zip.file("M-001/材料/其他/001_测试材料.txt")!.asText()).toBe("test");
    }
  });

  it.each(["live", "archive"] as const)("%s：实际成员或Server合伙人保留原导出能力", async kind => {
    state.ownerId = OTHER; state.members = [ME];
    expect((await requestPackage(kind)).status).toBe(200);
    state.members = []; state.actor = { ...actor(), role: "PRINCIPAL_LAWYER" };
    expect((await requestPackage(kind)).status).toBe(200);
  });

  it.each(["live", "archive"] as const)("%s：已删除事项即使仍有成员关系也不能导出", async kind => {
    state.deleted = true;
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it("在办包先逐件核权，后续材料拒绝时不读取任何文件或财务", async () => {
    db.document.findMany.mockResolvedValue([document(), { ...document(), id: "cm00000000000000000000003" }]);
    assertDerivation.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ActionError("来源当前不可读取"));
    expect((await requestPackage("live")).status).toBe(403);
    expect(assertDerivation).toHaveBeenCalledTimes(2);
    expect(readDocument).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("归档快照内存在无读取资格材料时不生成或落盘完整包", async () => {
    assertDerivation.mockRejectedValue(new ActionError("来源当前不可读取"));
    expect((await requestPackage("archive")).status).toBe(403);
    expect(archiveZip).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("归档快照材料缺失时不通过授权预检", async () => {
    db.document.findMany.mockResolvedValue([]);
    expect((await requestPackage("archive")).status).toBe(403);
    expect(archiveZip).not.toHaveBeenCalled();
  });
  it.each(["live", "archive"] as const)("%s：会话仍有效时账号停用，完整包入口也重新拒绝", async kind => {
    state.active = false;
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

  it.each(["live", "archive"] as const)("%s：旧会话的内置岗位不能覆盖当前岗位已撤销的导出权", async kind => {
    state.currentActor = { ...actor(), role: "CUSTOM", rolePermissions: [] };
    expect((await requestPackage(kind)).status).toBe(403);
    expectNoPrivateExportRead();
  });

});
