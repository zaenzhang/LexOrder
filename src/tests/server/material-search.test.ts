// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, canRead, rows, session } = vi.hoisted(() => ({
  db: { document: { findMany: vi.fn(), count: vi.fn() }, matter: { findMany: vi.fn() }, client: { findMany: vi.fn() }, intake: { findMany: vi.fn() }, deadline: { findMany: vi.fn() } },
  canRead: vi.fn(), rows: { candidates: [] as Record<string, unknown>[], failures: [] as Record<string, unknown>[] },
  session: { user: { id: "owner", role: "CUSTOM", rolePermissions: [{ permissionKey: "documents.read", scope: "OWN" }] } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/lib/archive/guard", () => ({ isArchiveFolderName: vi.fn() }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(), checkRoleMutation: vi.fn() }));
vi.mock("@/lib/clients/id-number-crypto", () => ({ blindIdNumber: () => "fixture" }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));
import { globalSearch } from "@/server/search/actions";

const doc = { id: "doc", name: "合成材料.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "OTHER", textContent: "合同条款", tags: [], uploadedById: "owner",
  matterId: "matter", intakeId: null, sourceOrigin: null, textSource: "DOCX", deletedAt: null, sha256: "a".repeat(64), version: 1, parseGeneration: 0, parseRuns: [],
  matter: { id: "matter", title: "合成事项", internalCode: "SYNTHETIC-1" }, intake: null, stage: null };

beforeEach(() => {
  vi.resetAllMocks(); rows.candidates = []; rows.failures = [];
  db.document.findMany.mockImplementation(async (args: { where: { ocrStatus?: string } }) => args.where.ocrStatus ? rows.failures : rows.candidates);
  for (const model of [db.matter, db.client, db.intake, db.deadline]) model.findMany.mockResolvedValue([]);
  canRead.mockImplementation(async (_user: string, value: { id: string }) => value.id !== "forbidden");
});

describe("Server 材料正文搜索", () => {
  it("失败计数逐件授权，不读取全所失败总数", async () => {
    rows.failures = [doc, { ...doc, id: "forbidden" }];
    const result = await globalSearch("合同");
    expect(result.documentsFailedCount).toBe(1);
    expect(db.document.count).not.toHaveBeenCalled();
    expect(db.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deletedAt: null, ocrStatus: "FAILED", AND: expect.any(Array) }) }));
  });
  it("旧 DOCX 正文可搜，但不虚构物理第 1 页", async () => {
    rows.candidates = [doc];
    const result = await globalSearch("合同");
    expect(result.documents[0]).toMatchObject({ snippet: "合同条款", pageNo: null,
      href: "/api/documents/doc/preview", matterLink: "/matters/SYNTHETIC-1" });
    expect(result.documents[0].subtitle).not.toContain("第 1 页");
  });
  it("当前代次未发布时不从旧正文缓存制造命中", async () => {
    rows.candidates = [{ ...doc, parseGeneration: 2 }];
    expect((await globalSearch("合同")).documents).toEqual([]);
  });
  it("新正文命中返回当前真实 anchor，部分覆盖保持可见", async () => {
    const anchor = { anchorId: "a1", source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId: doc.matterId, sha256: doc.sha256 },
      parseGenerationId: "run", unit: 1, location: { kind: "PAGE", page: 1 }, text: "合同条款" };
    rows.candidates = [{ ...doc, name: "合成材料.pdf", mimeType: "application/pdf", parseGeneration: 1, textSource: "PDF_TEXT", parseRuns: [{ id: "run", documentId: doc.id, sourceSha256: doc.sha256,
      generation: 1, parserVersion: "fixture", state: "PARTIAL", finishedAt: new Date(), anchors: [anchor],
      coverage: { unitKind: "PAGE", totalUnits: 2, units: [{ unit: 1, status: "READY" }, { unit: 2, status: "PENDING" }] } }] }];
    expect((await globalSearch("合同")).documents[0]).toMatchObject({ parseRunId: "run", anchorId: "a1", pageNo: 1, meta: "仅部分内容已处理",
      href: "/api/documents/doc/download?inline=1#page=1", matterLink: "/matters/SYNTHETIC-1", documentVersion: 1 });
  });
  it("旧PDF正文命中保留真实页码，原件与所属收案是不同入口", async () => {
    rows.candidates = [{ ...doc, name: "合成来件.pdf", mimeType: "application/pdf", matterId: null, matter: null,
      intakeId: "intake", intake: { id: "intake", title: "合成收案" }, textContent: "首页说明\f第二页合同条款", textSource: "PDF_TEXT", version: 3 }];
    const result = (await globalSearch("合同")).documents[0];
    expect(result).toMatchObject({ id: "doc", documentVersion: 3, pageNo: 2,
      href: "/api/documents/doc/download?inline=1#page=2", matterLink: "/intakes/intake" });
    expect(result.parseRunId).toBeUndefined();
    expect(result.anchorId).toBeUndefined();
  });
  it.each([
    ["合同.docx", "application/octet-stream", "preview"],
    ["合同.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "preview"],
    ["合同.xls", "application/vnd.ms-excel", "preview"],
    ["合同.doc", "application/msword", "download?inline=1"],
    ["合同.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "download?inline=1"],
    ["合同.txt", "text/plain", "download?inline=1"],
  ])("名称命中 %s 复用受控格式入口，不臆造锚点或物理页", async (name, mimeType, path) => {
    rows.candidates = [{ ...doc, name, mimeType, textContent: null }];
    expect((await globalSearch("合同")).documents[0]).toMatchObject({ href: `/api/documents/doc/${path}`, pageNo: null,
      matchedBy: "名称命中", anchorId: undefined });
  });
  it("无所属对象但有材料读取资格时仍可打开具体原件，无权版本不返回链接", async () => {
    rows.candidates = [{ ...doc, id: "forbidden" }, { ...doc, matterId: null, matter: null }];
    const result = await globalSearch("合同");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ id: "doc", href: "/api/documents/doc/preview", matterLink: undefined });
  });
});
