import { isPersonalMode } from "@/lib/runtime/mode";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { releaseDocumentRead } from "@/server/documents/read-release";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { officePreviewKind } from "@/lib/storage/mime-ext";
import { xlsxCellText } from "@/lib/documents/xlsx-cell-text";
import type { SourceAnchor } from "@/lib/workbench/contracts";
import { readMaterialSource } from "@/server/documents/material-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v0.42: 案件材料在线预览。
 * - docx → mammoth 转 HTML
 * - xlsx/xls → exceljs 读单元格转 HTML 表
 * 返回完整 HTML 文档，前端 <iframe> 内嵌。
 * pdf/图片/文本等浏览器原生可预览的走 download?inline=1（本路由不处理）。
 */
function htmlShell(title: string, body: string, cellTarget = false): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px 28px; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1a1a; line-height: 1.7; background: #fff; }
  .doc { max-width: 820px; margin: 0 auto; }
  .doc img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
  td, th { border: 1px solid #d4d4d4; padding: 4px 8px; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; }
  .sheet-name { margin: 18px 0 6px; font-weight: 600; font-size: 14px; color: #444; }
  .preview-note { padding-bottom: 12px; border-bottom: 1px solid #d4d4d4; color: #444; font-size: 13px; }
  #material-source { white-space: pre-wrap; scroll-margin-top: 24px; }
  #material-source:target { background: #fff4c2; outline: 2px solid #9a6700; outline-offset: -2px; }
  p { margin: 0.4em 0; }
</style></head>
<body><div class="doc"><p class="preview-note">${cellTarget
    ? "<strong>单元格转换预览</strong>：可核对所选单元格，转换版式可能与原件不同。"
    : "<strong>整份转换预览</strong>：以下内容由所选文件转换，版式可能与原件不同，未按引用位置跳转。"}</p>${body}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const doc = await prisma.document.findFirst({
    where: { id: (await params).id, deletedAt: null }
  });
  if (!doc) return NextResponse.json({ error: "材料不存在" }, { status: 404 });

  if (!await canReadDocument(session.user.id, doc)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const search = new URL(req.url).searchParams;
  const runIds = search.getAll("runId"), anchorIds = search.getAll("anchorId");
  const hasTarget = runIds.length > 0 || anchorIds.length > 0;
  if (hasTarget && (runIds.length !== 1 || anchorIds.length !== 1 ||
      !runIds[0] || !anchorIds[0] || runIds[0].length > 512 || anchorIds[0].length > 512)) {
    return NextResponse.json({ error: "来源位置参数不完整或无效" }, { status: 400 });
  }

  const kind = officePreviewKind(doc.mimeType, doc.name);
  if (!kind) {
    return NextResponse.json(
      { error: "该类型不支持在线预览，请下载查看" },
      { status: 415 }
    );
  }

  let target: { location: Extract<SourceAnchor["location"], { kind: "TABLE" }>; text: string } | undefined;
  if (hasTarget) {
    // The domain read preserves specific approval-attachment access. The action has a separate documents.read gate.
    const source = await readMaterialSource(session.user.id, { documentId: doc.id, runId: runIds[0], anchorId: anchorIds[0] });
    if (source.status === "UNAVAILABLE") return NextResponse.json({ error: "此固定来源当前不可读取" }, { status: 404 });
    if (source.document.sha256 !== doc.sha256) return NextResponse.json({ error: "材料版本已变化，请重新核对来源" }, { status: 409 });
    const location = source.anchor.location;
    if (kind !== "xlsx" || doc.mimeType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        location.kind !== "TABLE" || location.rowStart !== location.rowEnd || location.columnStart !== location.columnEnd) {
      return NextResponse.json({ error: "此固定位置暂不支持单元格转换预览，请查看片段或下载此版本" }, { status: 422 });
    }
    target = { location, text: source.anchor.text };
  }

  let buf: Buffer;
  try {
    const stored = await storage.readFile(doc.path);
    if (doc.encrypted) {
      if (!doc.iv || !doc.authTag) {
        return NextResponse.json({ error: "加密元数据损坏" }, { status: 500 });
      }
      buf = decryptBuffer(stored, doc.iv, doc.authTag);
    } else {
      buf = stored;
    }
  } catch (err) {
    if (isPersonalMode() && err instanceof ActionError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("[preview] 读取失败：", err);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }

  let html: string;
  try {
    if (kind === "docx") {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.convertToHtml({ buffer: buf });
      html = htmlShell(doc.name, result.value || "<p>（空文档）</p>");
    } else {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      let targetCount = 0;
      wb.eachSheet((ws) => {
        parts.push(`<div class="sheet-name">${escapeHtml(ws.name)}</div>`);
        const rows: string[] = [];
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
            const text = xlsxCellText(cell.value);
            const isTarget = target && ws.name === target.location.sheet && rowNumber === target.location.rowStart &&
              columnNumber === target.location.columnStart && (!cell.isMerged || cell.master.address === cell.address) &&
              text !== undefined && text === target.text;
            if (isTarget) targetCount++;
            const display = text ?? (cell.value == null ? "" : "未转换");
            cells.push(`<td${isTarget ? ' id="material-source"' : ""}>${escapeHtml(display)}</td>`);
          });
          rows.push(`<tr>${cells.join("")}</tr>`);
        });
        parts.push(`<table>${rows.join("")}</table>`);
      });
      if (target && targetCount !== 1) {
        return NextResponse.json({ error: "固定片段与文件中的单元格无法逐字对应，请核对片段或下载此版本" }, { status: 409 });
      }
      html = htmlShell(doc.name, parts.join("") || "<p>（空表格）</p>", Boolean(target));
    }
  } catch (err) {
    console.error("[preview] 转换失败：", err);
    return NextResponse.json({ error: "文档转换失败，请下载查看" }, { status: 500 });
  }

  const release = await releaseDocumentRead(session.user.id, doc.id, { action: "DOCUMENT_PREVIEW", kind });
  if (!release.ok) return NextResponse.json({ error: release.error }, { status: release.status });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Office content is untrusted. The preview must not inherit the application's origin
      // or execute scripts, including javascript: links preserved by the converter.
      "Content-Security-Policy": "sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
