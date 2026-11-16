// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";

const { findDocument, readFile, canRead, session } = vi.hoisted(() => ({
  findDocument: vi.fn(), readFile: vi.fn(), canRead: vi.fn(),
  session: { user: { id: "cpreview00000000000000001", role: "LAWYER", systemRole: "NONE", avatar: null, runtimeMode: "SERVER" as const } }
}));
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findFirst: findDocument } } }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => session) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/lib/storage", () => ({ storage: { readFile } }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));

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
  findDocument.mockResolvedValue({ id: "doc", name: "测试.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", path: "fixture.docx", encrypted: false, uploadedById: session.user.id, matterId: "matter", intakeId: null });
  canRead.mockResolvedValue(true);
  readFile.mockResolvedValue(untrustedDocx());
});

describe("Server 文档预览隔离", () => {
  it("真实转换保留的javascript链接位于无脚本、无同源权限的sandbox中", async () => {
    const response = await GET(new Request("http://localhost/api/documents/doc/preview"), { params: Promise.resolve({ id: "doc" }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="javascript:window.__lexorder_preview_probe=1"');
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
});
