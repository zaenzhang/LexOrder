import { createHash } from "node:crypto";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { getDocumentProxy } from "unpdf";
import { sourceVersionSchema, type ProcessingCoverage, type SourceAnchor, type SourceVersion } from "@/lib/workbench/contracts";
import { xlsxCellText } from "@/lib/documents/xlsx-cell-text";
import { ServiceFailure } from "./service-transport";

export interface OcrInput { bytes: Uint8Array; mimeType: string; page?: number }
export interface ParsedMaterial {
  state: "READY" | "PARTIAL" | "PENDING" | "FAILED" | "UNSUPPORTED";
  anchors: SourceAnchor[];
  coverage: ProcessingCoverage;
}
type Unit = { text?: string; location?: SourceAnchor["location"]; status: ProcessingCoverage["units"][number]["status"] };

/** M1 parser: preserves originals and honest unit coverage; no persistence/authorization. */
export async function parseMaterial(input: {
  bytes: Uint8Array; mimeType: string; source: SourceVersion; parseGenerationId: string;
  ocr?: (input: OcrInput) => Promise<string>;
  // Trusted, installed local PDF.js resources; never taken from uploaded content.
  pdfResources?: { cMapUrl: string; standardFontDataUrl: string };
}): Promise<ParsedMaterial> {
  const source = sourceVersionSchema.parse(input.source);
  if (!input.parseGenerationId || input.bytes.length > 25 * 1024 * 1024 ||
      createHash("sha256").update(input.bytes).digest("hex") !== source.sha256) throw new ServiceFailure("INVALID_INPUT");
  const units: Unit[] = [];
  let unitKind: ProcessingCoverage["unitKind"] = "SEGMENT";
  const addText = (text: string, location: SourceAnchor["location"]) => {
    units.push(text.trim() ? { text, location, status: "READY" } : { status: "UNSUPPORTED" });
  };
  const addTextBlocks = (text: string) => {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 4000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      addText(text.slice(start, end), { kind: "TEXT", start, end });
      start = end;
    }
  };
  const ocrUnit = async (page?: number): Promise<Unit> => {
    if (!input.ocr) return { status: "PENDING" };
    try {
      const text = await input.ocr({ bytes: input.bytes, mimeType: input.mimeType, page });
      return text.trim() ? { status: "READY", text,
        location: page ? { kind: "PAGE", page } : { kind: "IMAGE", x: 0, y: 0, width: 1, height: 1 } }
        : { status: "FAILED" };
    } catch { return { status: "FAILED" }; }
  };
  try {
    if (input.mimeType === "application/pdf") {
      unitKind = "PAGE";
      const pdf = await getDocumentProxy(new Uint8Array(input.bytes), { ...input.pdfResources, cMapPacked: true });
      try {
        if (pdf.numPages > 10_000) throw new ServiceFailure("UNSUPPORTED");
        for (let page = 1; page <= pdf.numPages; page++) {
          try {
            const content = await (await pdf.getPage(page)).getTextContent();
            const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
            if (text) addText(text, { kind: "PAGE", page });
            else units.push(await ocrUnit(page));
          } catch { units.push({ status: "FAILED" }); }
        }
      } finally { await pdf.destroy(); }
    } else if (input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      // Raw-text newlines are not original DOCX paragraph identities. Until an
      // OOXML map is available, cite offsets in this immutable extracted text.
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      addTextBlocks(value);
    } else if (input.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer);
      for (const sheet of workbook.worksheets) {
        sheet.eachRow((row, rowNumber) => row.eachCell((cell, column) => {
          if (cell.isMerged && cell.master.address !== cell.address) return;
          if (units.length >= 10_000) throw new ServiceFailure("UNSUPPORTED");
          const text = xlsxCellText(cell.value);
          if (text !== undefined) addText(text, { kind: "TABLE", sheet: sheet.name,
            rowStart: rowNumber, rowEnd: rowNumber, columnStart: column, columnEnd: column });
          else units.push({ status: "UNSUPPORTED" });
        }));
      }
    } else if (["image/png", "image/jpeg"].includes(input.mimeType)) {
      units.push(await ocrUnit());
    } else if (input.mimeType === "text/plain") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      addTextBlocks(text);
    } else return { state: "UNSUPPORTED", anchors: [], coverage: { unitKind, totalUnits: 1, units: [{ unit: 1, status: "UNSUPPORTED" }] } };
  } catch {
    // A file-level parse error does not provide a reliable total unit count.
    return { state: "FAILED", anchors: [], coverage: { unitKind, totalUnits: null, units: [] } };
  }
  if (!units.length) units.push({ status: "UNSUPPORTED" });
  const anchors = units.flatMap((unit, index): SourceAnchor[] => unit.status === "READY" && unit.text && unit.location ? [{
    anchorId: createHash("sha256").update(JSON.stringify([source, input.parseGenerationId, index + 1, unit.location, unit.text])).digest("hex"),
    source, parseGenerationId: input.parseGenerationId, unit: index + 1, location: unit.location, text: unit.text,
  }] : []);
  const coverage: ProcessingCoverage = { unitKind, totalUnits: units.length,
    units: units.map((unit, index) => ({ unit: index + 1, status: unit.status })) };
  return { state: units.every(unit => unit.status === "READY") ? "READY" : anchors.length ? "PARTIAL"
    : units.every(unit => unit.status === "PENDING") ? "PENDING"
    : units.every(unit => unit.status === "UNSUPPORTED") ? "UNSUPPORTED" : "FAILED", anchors, coverage };
}
