// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { parseMaterial } from "@/server/rag/parse-material";
import type { MaterialSourceResult } from "@/server/documents/material-processing";

const { findDocument, readFile, canRead, release, readSource, currentSession, session } = vi.hoisted(() => ({
  findDocument: vi.fn(), readFile: vi.fn(), canRead: vi.fn(), release: vi.fn(),
  readSource: vi.fn(), currentSession: vi.fn(),
  session: { user: { id: "cpreview00000000000000001", role: "LAWYER", systemRole: "NONE", avatar: null, runtimeMode: "SERVER" as const } }
}));
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findFirst: findDocument } } }));
vi.mock("@/lib/auth/session", () => ({ getSession: currentSession }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/lib/storage", () => ({ storage: { readFile } }));
vi.mock("@/server/documents/read-release", () => ({ releaseDocumentRead: release }));
vi.mock("@/server/documents/material-processing", () => ({ readMaterialSource: readSource }));

import { GET } from "@/app/api/documents/[id]/preview/route";

/** Synthetic DOCX, built in memory. Its harmless link is deliberately preserved by real Mammoth. */
function untrustedDocx() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId2"><w:r><w:t>测试链接</w:t></w:r></w:hyperlink></w:p></w:body></w:document>');
  zip.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:window.__lexorder_preview_probe=1" TargetMode="External"/></Relationships>');
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

beforeEach(() => {
  vi.resetAllMocks();
  currentSession.mockResolvedValue(session);
  readSource.mockResolvedValue({ status: "UNAVAILABLE" });
  findDocument.mockResolvedValue({ id: "doc", name: "测试.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", path: "fixture.docx", encrypted: false, uploadedById: session.user.id, matterId: "matter", intakeId: null });
  canRead.mockResolvedValue(true);
  release.mockResolvedValue({ ok: true });
  readFile.mockResolvedValue(untrustedDocx());
});

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const cellText = " 同值 \n二行<&> ";
async function fixedWorkbook() {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("明细");
  sheet.getCell("C4").value = cellText;
  sheet.getCell("B7").value = new Date("2024-02-29T12:34:56.000Z");
  sheet.getCell("D7").value = { richText: [{ text: "首段\n" }, { text: " 末段 ", font: { bold: true } }] };
  sheet.getCell("A9").value = { formula: "1-1", result: 0 };
  sheet.getCell("B9").value = { formula: "1=2", result: false };
  sheet.getCell("C9").value = { formula: '" 保留 "', result: " 保留 " };
  sheet.getCell("D9").value = { text: "显示文字", hyperlink: "https://example.invalid/source" };
  sheet.getCell("E9").value = { formula: "1+2" };
  sheet.getCell("F9").value = { formula: "1/0", result: { error: "#DIV/0!" } };
  sheet.getCell("G9").value = false; sheet.getCell("H9").value = 0;
  sheet.getCell("I9").value = " \n "; sheet.getCell("J9").value = "";
  sheet.mergeCells("B12:C12"); sheet.getCell("B12").value = "合并主格";
  sheet.fillFormula("A15:B15", "1+1", [2, 3]);
  sheet.getCell("C15").value = { formula: "DATE(2024,2,29)", result: new Date("2024-02-29T00:00:00Z") };
  sheet.getCell("C15").numFmt = "yyyy-mm-dd";
  workbook.addWorksheet("另一表").getCell("C4").value = cellText;
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(bytes as unknown as ArrayBuffer);
  // ExcelJS 4.4.0 retains these OOXML caches on cell.result but drops falsy
  // fields from cell.value. Preserve the parser's existing unsupported units.
  expect(loaded.worksheets[0].getCell("A9").result).toBe(0);
  expect(loaded.worksheets[0].getCell("A9").value).toEqual({ formula: "1-1" });
  expect(loaded.worksheets[0].getCell("B9").result).toBe(false);
  expect(loaded.worksheets[0].getCell("B9").value).toEqual({ formula: "1=2" });
  expect(loaded.worksheets[0].getCell("B15").value).toEqual({ sharedFormula: "A15", result: 3 });
  expect(loaded.worksheets[0].getCell("C15").value).toEqual({ formula: "DATE(2024,2,29)", result: new Date("2024-02-29T00:00:00Z") });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const doc = { id: "sheet", name: "合成定位.xlsx", mimeType: xlsxMime, sha256, version: 2,
    path: "fixture.xlsx", encrypted: false, uploadedById: session.user.id, matterId: "matter", intakeId: null };
  const parsed = await parseMaterial({ bytes, mimeType: xlsxMime,
    source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId: doc.matterId, sha256 }, parseGenerationId: "run-old" });
  findDocument.mockResolvedValue(doc); readFile.mockResolvedValue(bytes);
  function source(unit: number): Extract<MaterialSourceResult, { status: "AVAILABLE" }> {
    const anchor = parsed.anchors.find(value => value.unit === unit);
    if (!anchor) throw new Error(`Synthetic fixture unit ${unit} has no parser anchor`);
    return { status: "AVAILABLE", document: doc, run: { id: "run-old", generation: 1, parserVersion: "fixture", isCurrent: false },
      anchor, coverage: parsed.coverage, locationLabel: "合成固定位置", previewKind: "TABLE",
      previewUrl: `/api/documents/sheet/preview?runId=run-old&anchorId=${anchor.anchorId}#material-source`, downloadUrl: "/api/documents/sheet/download" };
  }
  return { bytes, doc, parsed, source };
}
function previewRequest(query = "") {
  return GET(new Request(`http://localhost/api/documents/sheet/preview${query}`), { params: Promise.resolve({ id: "sheet" }) });
}
function fixedRequest(source: Extract<MaterialSourceResult, { status: "AVAILABLE" }>) {
  readSource.mockResolvedValue(source);
  return previewRequest(`?runId=${encodeURIComponent(source.run.id)}&anchorId=${encodeURIComponent(source.anchor.anchorId)}`);
}

describe("固定 XLSX 单格转换：真实工作簿及真实 parser，身份/资格适配层替身", () => {
  it("抽取保持明确的文本、真实坐标和unit顺序；空白/无缓存占位，合并从格跳过", async () => {
    const { parsed } = await fixedWorkbook();
    expect(parsed.state).toBe("PARTIAL");
    // Literal expectations deliberately do not call the shared formatter.
    expect(parsed.anchors.map(anchor => ({ unit: anchor.unit, location: anchor.location, text: anchor.text }))).toEqual([
      [1, "明细", 4, 3, cellText], [2, "明细", 7, 2, "2024-02-29T12:34:56.000Z"], [3, "明细", 7, 4, "首段\n 末段 "],
      [6, "明细", 9, 3, " 保留 "], [7, "明细", 9, 4, "显示文字"],
      [10, "明细", 9, 7, "false"], [11, "明细", 9, 8, "0"], [14, "明细", 12, 2, "合并主格"],
      [15, "明细", 15, 1, "2"], [16, "明细", 15, 2, "3"], [18, "另一表", 4, 3, cellText],
    ].map(([unit, sheet, row, column, text]) => ({ unit, text, location: { kind: "TABLE", sheet, rowStart: row, rowEnd: row, columnStart: column, columnEnd: column } })));
    expect(parsed.coverage).toEqual({ unitKind: "SEGMENT", totalUnits: 18, units: Array.from({ length: 18 }, (_, index) => ({
      unit: index + 1, status: [4, 5, 8, 9, 12, 13, 17].includes(index + 1) ? "UNSUPPORTED" : "READY",
    })) });
  });

  it("稀疏行列与跨表同值仍只定位原表原格，旧run原样传入，HTML转义且保换行", async () => {
    const fixture = await fixedWorkbook(), source = fixture.source(18);
    const response = await fixedRequest(source), html = await response.text();
    expect(response.status).toBe(200);
    expect(readSource).toHaveBeenCalledWith(session.user.id, { documentId: "sheet", runId: "run-old", anchorId: source.anchor.anchorId });
    expect(html.match(/id="material-source"/g)).toHaveLength(1);
    const [firstSheet, otherSheet] = html.split('<div class="sheet-name">另一表</div>');
    expect(firstSheet).not.toContain('id="material-source"');
    expect(otherSheet).toContain('<td id="material-source"> 同值 \n二行&lt;&amp;&gt; </td>');
    expect(html).toContain("#material-source:target"); expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("单元格转换预览"); expect(html).not.toContain("未按引用位置跳转");
    expect(html).toContain("<td>未转换</td><td>未转换</td>");
    expect(html).not.toContain('href="https://example.invalid/source"');
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox;");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(release).toHaveBeenCalledWith(session.user.id, "sheet", { action: "DOCUMENT_PREVIEW", kind: "xlsx" });
  });

  it.each([[2, "2024-02-29T12:34:56.000Z"], [3, "首段\n 末段 "], [10, "false"], [11, "0"], [6, " 保留 "], [7, "显示文字"], [14, "合并主格"], [16, "3"]] as const)(
    "真实unit %s 的固定文本可逐字定位", async (unit, expected) => {
      const fixture = await fixedWorkbook(), source = fixture.source(unit);
      expect(source.anchor.text).toBe(expected);
      const response = await fixedRequest(source);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`<td id="material-source">${expected}</td>`);
    });

  it.each(["?runId=old", "?anchorId=old", "?runId=&anchorId=old", "?runId=old&anchorId=", "?runId=old&runId=old&anchorId=one",
    "?runId=old&runId=new&anchorId=one", "?runId=old&anchorId=one&anchorId=two", "?runId=old&anchorId=one&anchorId=one",
    `?runId=${"x".repeat(513)}&anchorId=one`, `?runId=old&anchorId=${"x".repeat(513)}`])(
    "无效成对参数 %s 不降为整份或读文件", async query => {
      expect((await previewRequest(query)).status).toBe(400);
      expect(readSource).not.toHaveBeenCalled(); expect(readFile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    });

  it("未发布/不匹配固定来源由领域拒绝后，route不另找新run或返回整份", async () => {
    const { source } = await fixedWorkbook();
    readSource.mockResolvedValue({ status: "UNAVAILABLE" });
    const response = await previewRequest(`?runId=wrong-run&anchorId=${source(1).anchor.anchorId}`);
    expect(response.status).toBe(404); expect(readSource).toHaveBeenCalledTimes(1);
    expect(readFile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });

  it("源服务返回另一SHA时拒绝读取本次文件快照", async () => {
    const fixture = await fixedWorkbook(), source = fixture.source(1);
    source.document = { ...source.document, sha256: "b".repeat(64) };
    expect((await fixedRequest(source)).status).toBe(409);
    expect(readFile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });

  it.each(["缺格", "错表", "逐字不符", "合并从格", "无缓存", "错误缓存", "缓存0", "缓存false", "日期缓存"] as const)(
    "矛盾AVAILABLE替身的%s被真实文件核对拒绝；这不是parser产生的合法anchor", async scenario => {
      const fixture = await fixedWorkbook(), source = fixture.source(1);
      const location = { kind: "TABLE" as const, sheet: "明细", rowStart: 4, rowEnd: 4, columnStart: 3, columnEnd: 3 };
      if (scenario === "缺格") { location.rowStart = 100; location.rowEnd = 100; }
      if (scenario === "错表") location.sheet = "不存在表";
      if (scenario === "逐字不符") source.anchor = { ...source.anchor, text: cellText.trim() };
      if (scenario === "合并从格") { location.rowStart = 12; location.rowEnd = 12; source.anchor = { ...source.anchor, text: "合并主格" }; }
      if (scenario === "无缓存" || scenario === "错误缓存") {
        location.rowStart = 9; location.rowEnd = 9; location.columnStart = scenario === "无缓存" ? 5 : 6; location.columnEnd = location.columnStart;
        source.anchor = { ...source.anchor, text: "未转换" };
      }
      if (scenario === "缓存0" || scenario === "缓存false") {
        location.rowStart = 9; location.rowEnd = 9; location.columnStart = scenario === "缓存0" ? 1 : 2; location.columnEnd = location.columnStart;
        source.anchor = { ...source.anchor, text: scenario === "缓存0" ? "0" : "false" };
      }
      if (scenario === "日期缓存") {
        location.rowStart = 15; location.rowEnd = 15; source.anchor = { ...source.anchor, text: "2024-02-29T00:00:00.000Z" };
      }
      source.anchor = { ...source.anchor, location };
      const response = await fixedRequest(source);
      expect(response.status).toBe(409); expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(release).not.toHaveBeenCalled();
    });

  it.each(["多格", "TEXT", "xls", "不可靠MIME"] as const)("已可读来源的%s不进入本批定位", async scenario => {
    const fixture = await fixedWorkbook(), source = fixture.source(1);
    if (scenario === "多格") source.anchor = { ...source.anchor, location: { kind: "TABLE", sheet: "明细", rowStart: 4, rowEnd: 4, columnStart: 2, columnEnd: 3 } };
    if (scenario === "TEXT") source.anchor = { ...source.anchor, location: { kind: "TEXT", start: 0, end: 5 } };
    if (scenario === "xls" || scenario === "不可靠MIME") findDocument.mockResolvedValue({ ...fixture.doc,
      mimeType: scenario === "xls" ? "application/vnd.ms-excel" : "application/octet-stream" });
    expect((await fixedRequest(source)).status).toBe(422);
    expect(readFile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });

  it("无session、无文档和非Office类型各沿原失败出口", async () => {
    currentSession.mockResolvedValueOnce(null);
    expect((await previewRequest()).status).toBe(401); expect(findDocument).not.toHaveBeenCalled();
    findDocument.mockResolvedValueOnce(null);
    expect((await previewRequest()).status).toBe(404);
    findDocument.mockResolvedValueOnce({ id: "sheet", name: "合成原件.pdf", mimeType: "application/pdf" });
    expect((await previewRequest()).status).toBe(415);
    expect(readFile).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });

  it.each([401, 403])("精确目标转换后最终资格%s仍不释放HTML", async status => {
    const fixture = await fixedWorkbook();
    release.mockResolvedValue({ ok: false, status, error: "合成最终资格失效" });
    const response = await fixedRequest(fixture.source(1));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: "合成最终资格失效" });
  });

  it.each(["读取", "转换"] as const)("固定目标%s失败沿500且不记成功预览", async failure => {
    const fixture = await fixedWorkbook(), log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (failure === "读取") readFile.mockRejectedValue(new Error("synthetic read error"));
      else readFile.mockResolvedValue(Buffer.from("synthetic invalid xlsx"));
      expect((await fixedRequest(fixture.source(1))).status).toBe(500); expect(release).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});

describe("Server 文档预览隔离", () => {
  it("真实转换保留的javascript链接位于无脚本、无同源权限的sandbox中", async () => {
    const response = await GET(new Request("http://localhost/api/documents/doc/preview"), { params: Promise.resolve({ id: "doc" }) });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('href="javascript:window.__lexorder_preview_probe=1"');
    expect(html).toContain("整份转换预览"); expect(html).toContain("版式可能与原件不同，未按引用位置跳转");
    const directives = response.headers.get("Content-Security-Policy")!.split(";").map(value => value.trim());
    expect(directives).toContain("sandbox");
    expect(directives).toContain("script-src 'none'");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("style-src 'unsafe-inline'");
    expect(directives).toContain("img-src data:");
    expect(directives.join(" ")).not.toContain("allow-scripts");
    expect(directives.join(" ")).not.toContain("allow-same-origin");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("材料读取权仍在转换和文件读取之前校验", async () => {
    canRead.mockResolvedValue(false);
    const response = await GET(new Request("http://localhost/api/documents/doc/preview"), { params: Promise.resolve({ id: "doc" }) });
    expect(response.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("真实表格转换同样标明整份预览，保留工作表与单元格内容", async () => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("合成费用表").addRow(["合成费用", 20]);
    readFile.mockResolvedValue(Buffer.from(await workbook.xlsx.writeBuffer()));
    findDocument.mockResolvedValue({ id: "sheet", name: "合成费用.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "fixture.xlsx", encrypted: false, uploadedById: session.user.id, matterId: "matter", intakeId: null });
    const response = await GET(new Request("http://localhost/api/documents/sheet/preview"), { params: Promise.resolve({ id: "sheet" }) });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("整份转换预览"); expect(html).toContain("未按引用位置跳转");
    expect(html).toContain("合成费用表"); expect(html).toContain("<td>合成费用</td><td>20</td>");
    expect(release).toHaveBeenCalledWith(session.user.id, "sheet", { action: "DOCUMENT_PREVIEW", kind: "xlsx" });
  });

  it("转换类型不能冒充转换成功，损坏文档仍返回失败且不登记成功读取", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      readFile.mockResolvedValue(Buffer.from("synthetic invalid docx"));
      const response = await GET(new Request("http://localhost/api/documents/doc/preview"), { params: Promise.resolve({ id: "doc" }) });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "文档转换失败，请下载查看" });
      expect(release).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("转换完成后当前资格被拒，静态预览说明也不携正文返回", async () => {
    release.mockResolvedValue({ ok: false, status: 403, error: "当前材料不可读取" });
    const response = await GET(new Request("http://localhost/api/documents/doc/preview"), { params: Promise.resolve({ id: "doc" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "当前材料不可读取" });
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
