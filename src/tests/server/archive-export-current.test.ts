// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { ArchiveReviewSnapshot } from "@/lib/archive/snapshot";

const { db, readFile } = vi.hoisted(() => ({
  db: {
    archiveRecord: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    matter: { findUnique: vi.fn() }, document: { findMany: vi.fn() },
    firmFile: { findUnique: vi.fn() }, $queryRaw: vi.fn(),
  },
  readFile: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => ({ storage: { readFile } }));

import { sha256 } from "@/lib/storage/crypto";
import { buildArchiveZip } from "@/server/archive/export";

const ARCHIVE = "carchive00000000000000001";
const MATTER = "cmatter000000000000000001";
const POLICY = "cpolicy000000000000000001";
const COVER = "ccover0000000000000000001";
const CATALOG = "ccatalog00000000000000001";
const MATERIAL = "cmaterial000000000000001";
const NOW = new Date("2026-11-16T00:00:00Z");
const contents = new Map([
  ["policy", Buffer.from("合成归档制度")],
  [COVER, Buffer.from("合成批准封皮")],
  [CATALOG, Buffer.from("合成批准目录")],
  [MATERIAL, Buffer.from("合成批准原件")],
]);
const document = (id: string, name: string, order: number) => ({
  id, name, category: "OTHER", workflowStatus: "FILED", version: 1, isLatest: true,
  folderName: "归档", mimeType: "text/plain", size: contents.get(id)!.length,
  sha256: sha256(contents.get(id)!), checklistItemIds: [], order,
});
const snapshot = (): ArchiveReviewSnapshot => ({
  schemaVersion: 2,
  policy: { configured: true, name: "合成制度", version: "1", effectiveAt: "2026-01-01", sourceFileId: POLICY, sourceFileName: "合成制度.txt", sourceFileSha256: sha256(contents.get("policy")!) },
  checklist: { kind: "LITIGATION", title: "合成清单", items: [] }, manualChecks: [],
  documents: [document(MATERIAL, "合成原件.txt", 3), document(COVER, "封皮.txt", 1), document(CATALOG, "目录.txt", 2)],
  excludedDocuments: [], documentIds: [COVER, CATALOG, MATERIAL], submittedAt: NOW.toISOString(), previousRecordId: null,
});
const manifest = () => ({
  archiveNo: "AR-SYNTHETIC-001",
  matter: { id: MATTER, internalCode: "LL-2026-CC-9001", title: "批准时案件名称" },
  billings: [{ title: "批准时合同", contractAmount: "100.00" }],
  feeEntries: [{ type: "RECEIVED", amount: "30.00" }],
  documents: [...snapshot().documents].sort((a, b) => a.order - b.order),
});

beforeEach(() => {
  vi.resetAllMocks();
  const fixed = snapshot();
  db.archiveRecord.findUnique.mockResolvedValue({
    id: ARCHIVE, matterId: MATTER, status: "APPROVED", checklistJson: fixed,
    archiveNo: "AR-SYNTHETIC-001", archivedAt: NOW, archivedBy: "合成律师", completedAt: NOW,
    summary: "合成结案总结", judgmentSummary: null, missingItems: [], coverDocId: COVER, catalogDocId: CATALOG,
  });
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join("?").includes("to_regclass") ? [{ ready: false }] : [{ frozenManifest: manifest() }]);
  db.document.findMany.mockResolvedValue(fixed.documents.map(d => ({
    ...d, matterId: MATTER, status: d.workflowStatus, path: d.id, encrypted: false,
    iv: null, authTag: null, deletedAt: null, folder: { name: "归档" },
  })));
  db.firmFile.findUnique.mockResolvedValue({ id: POLICY, name: "合成制度.txt", path: "policy", sha256: fixed.policy.sourceFileSha256 });
  readFile.mockImplementation(async (path: string) => {
    const buffer = contents.get(path);
    if (!buffer) throw new Error("合成文件不存在");
    return buffer;
  });
});

describe("批准快照归档包", () => {
  it("缺冻结 manifest 明确失败，不从当前案件补造批准数据", async () => {
    db.$queryRaw.mockResolvedValue([{ frozenManifest: null }]);
    await expect(buildArchiveZip(ARCHIVE)).rejects.toThrow("批准时未固定卷宗数据");
    expect(db.matter.findUnique).not.toHaveBeenCalled();
    expect(db.archiveRecord.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("必需冻结列缺失时传播失败，不切到现数据导出", async () => {
    const unavailable = new Error('column "frozenManifest" does not exist');
    db.$queryRaw.mockRejectedValue(unavailable);
    await expect(buildArchiveZip(ARCHIVE)).rejects.toBe(unavailable);
    expect(db.matter.findUnique).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("输出固定清单、顺序及财务数据，封皮目录和原件复用校验过的 Buffer", async () => {
    db.matter.findUnique.mockResolvedValue({ title: "当前已更名", feeEntries: [{ amount: "999.00" }] });
    const result = await buildArchiveZip(ARCHIVE);
    const zip = new PizZip(result.buffer);
    const root = "AR-SYNTHETIC-001";
    expect(JSON.parse(zip.file(`${root}/manifest.json`)!.asText())).toEqual(manifest());
    expect(zip.file(`${root}/封皮和目录/卷宗封皮.docx`)!.asNodeBuffer()).toEqual(contents.get(COVER));
    expect(zip.file(`${root}/封皮和目录/卷宗目录.docx`)!.asNodeBuffer()).toEqual(contents.get(CATALOG));
    expect(zip.file(`${root}/材料/其他/001_合成原件.txt`)!.asNodeBuffer()).toEqual(contents.get(MATERIAL));
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(["policy", COVER, CATALOG, MATERIAL]);
    expect(db.matter.findUnique).not.toHaveBeenCalled();
    expect(result.checksum).toBe(sha256(result.buffer));
  });

  it("固定原件变更则整体失败", async () => {
    readFile.mockImplementation(async (path: string) => path === MATERIAL ? Buffer.from("已改变的合成内容") : contents.get(path)!);
    await expect(buildArchiveZip(ARCHIVE)).rejects.toThrow("内容已变化");
  });

  it("批准制度原文变更则停止，不继续读取案卷原件", async () => {
    readFile.mockResolvedValue(Buffer.from("已改变的合成制度"));
    await expect(buildArchiveZip(ARCHIVE)).rejects.toThrow("归档制度原文内容已变化");
    expect(db.document.findMany).not.toHaveBeenCalled();
  });

  it("固定材料缺失则整体失败，不生成缺件包", async () => {
    db.document.findMany.mockResolvedValue([]);
    await expect(buildArchiveZip(ARCHIVE)).rejects.toThrow("送审材料已缺失");
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(["policy"]);
  });
});
