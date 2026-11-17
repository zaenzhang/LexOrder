// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentParseRun, Prisma } from "@prisma/client";
import type { SourceAnchor, ProcessingCoverage } from "@/lib/workbench/contracts";

const { db, canRead, leaseCheck } = vi.hoisted(() => ({
  db: { document: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() }, documentParseRun: { findFirst: vi.fn() }, $transaction: vi.fn() },
  canRead: vi.fn(), leaseCheck: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/lib/archive/guard", () => ({ isArchiveFolderName: vi.fn() }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(), checkRoleMutation: vi.fn() }));
vi.mock("@/server/cron/queue", () => ({ assertCurrentJobLease: leaseCheck }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));

import { materialTextProjection, publishedMaterialSnapshot, readMaterialSource, readMaterialSources, processMaterialJob } from "@/server/documents/material-processing";

const doc = { id: "doc", name: "合成材料.txt", version: 1, sha256: "a".repeat(64), matterId: "matter", intakeId: null,
  mimeType: "text/plain", uploadedById: "owner", deletedAt: null, parseGeneration: 2 };
const anchor: SourceAnchor = { anchorId: "anchor-1", source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId: doc.matterId, sha256: doc.sha256 },
  parseGenerationId: "run-1", unit: 1, location: { kind: "TEXT", start: 0, end: 4 }, text: "旧版原文" };
const coverage: ProcessingCoverage = { unitKind: "SEGMENT", totalUnits: 1, units: [{ unit: 1, status: "READY" }] };
const run = { id: "run-1", documentId: doc.id, generation: 1, parserVersion: "fixture", sourceSha256: doc.sha256,
  state: "READY", anchors: [anchor], coverage, finishedAt: new Date("2026-01-01") } as unknown as DocumentParseRun;

beforeEach(() => {
  vi.resetAllMocks();
  db.document.findUnique.mockResolvedValue(doc);
  db.document.findFirst.mockResolvedValue(doc);
  db.documentParseRun.findFirst.mockResolvedValue(run);
  canRead.mockResolvedValue(true);
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
});

describe("Server 材料来源边界", () => {
  it("历史引用仍返回旧代次文本，当前代次变化不会替换原文", async () => {
    const result = await readMaterialSource("owner", { documentId: doc.id, runId: run.id, anchorId: anchor.anchorId }, db as unknown as Prisma.TransactionClient);
    expect(result).toMatchObject({ status: "AVAILABLE", run: { id: "run-1", isCurrent: false }, anchor: { text: "旧版原文" },
      previewKind: "NATIVE", previewUrl: "/api/documents/doc/download?inline=1", downloadUrl: "/api/documents/doc/download" });
  });
  it.each([
    { name: "合成原件.pdf", mimeType: "application/pdf", location: { kind: "PAGE", page: 1 } as const,
      previewKind: "NATIVE", previewUrl: "/api/documents/doc/download?inline=1#page=1" },
    { name: "合成原件.docx", mimeType: "application/octet-stream", location: { kind: "TEXT", start: 0, end: 4 } as const,
      previewKind: "CONVERTED", previewUrl: "/api/documents/doc/preview" },
    { name: "合成原件.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      location: { kind: "TABLE", sheet: "费用表", rowStart: 3, rowEnd: 3, columnStart: 2, columnEnd: 4 } as const,
      previewKind: "CONVERTED", previewUrl: "/api/documents/doc/preview" },
    { name: "合成原件.bin", mimeType: "application/octet-stream", location: { kind: "TEXT", start: 0, end: 4 } as const,
      previewKind: "NONE", previewUrl: null },
  ])("来源展示保留 $name 的确切原文位置，预览与同版下载分开", async scenario => {
    const currentDocument = { ...doc, name: scenario.name, mimeType: scenario.mimeType };
    db.document.findUnique.mockResolvedValue(currentDocument); db.document.findFirst.mockResolvedValue(currentDocument);
    db.documentParseRun.findFirst.mockResolvedValue({ ...run, anchors: [{ ...anchor, location: scenario.location }],
      coverage: { ...coverage, unitKind: scenario.location.kind === "PAGE" ? "PAGE" : "SEGMENT" } });
    const result = await readMaterialSource("owner", { documentId: doc.id, runId: run.id, anchorId: anchor.anchorId });
    expect(result).toMatchObject({ status: "AVAILABLE", document: { id: doc.id, version: 1, sha256: doc.sha256 },
      run: { id: run.id, isCurrent: false }, anchor: { anchorId: anchor.anchorId, text: anchor.text, location: scenario.location },
      previewKind: scenario.previewKind, previewUrl: scenario.previewUrl, downloadUrl: "/api/documents/doc/download" });
  });
  it("读取期间撤回后不返回已经取得的历史正文", async () => {
    db.document.findFirst.mockResolvedValue(null);
    expect(await readMaterialSource("owner", { documentId: doc.id, runId: run.id, anchorId: anchor.anchorId })).toEqual({ status: "UNAVAILABLE" });
  });
  it("无权时不查询解析快照；空选择不查询全案", async () => {
    canRead.mockResolvedValue(false);
    expect(await readMaterialSource("other", { documentId: doc.id, runId: run.id, anchorId: anchor.anchorId })).toEqual({ status: "UNAVAILABLE" });
    expect(db.documentParseRun.findFirst).not.toHaveBeenCalled();
    expect(await readMaterialSources("owner", { matterId: doc.matterId, documentIds: [] })).toEqual({ items: [], nextOffset: null });
    expect(db.document.findMany).not.toHaveBeenCalled();
  });
  it("错误原件身份或未处理单元不能通过来源校验", () => {
    expect(publishedMaterialSnapshot(run, { ...doc, sha256: "b".repeat(64) })).toBeNull();
    expect(publishedMaterialSnapshot({ ...run, coverage: { ...coverage, units: [{ unit: 1, status: "PENDING" }] } }, doc)).toBeNull();
  });
  it("PDF 未处理页保留空位，搜索缓存不把第三页改成第二页", () => {
    const third: SourceAnchor = { ...anchor, unit: 3, location: { kind: "PAGE", page: 3 }, text: "第三页内容" };
    expect(materialTextProjection({ anchors: [{ ...anchor, location: { kind: "PAGE", page: 1 } }, third],
      coverage: { unitKind: "PAGE", totalUnits: 3, units: [{ unit: 1, status: "READY" }, { unit: 2, status: "PENDING" }, { unit: 3, status: "READY" }] } })).toBe("旧版原文\f\f第三页内容");
  });
  it("失去租约的任务在读取原件和写入状态之前停止", async () => {
    leaseCheck.mockRejectedValue(new Error("lease lost"));
    await expect(processMaterialJob({ runId: run.id }, { id: "job", leaseToken: "expired" })).rejects.toThrow("lease lost");
    expect(db.document.findUnique).not.toHaveBeenCalled();
  });
});
