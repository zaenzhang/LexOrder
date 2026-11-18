import { createCanvas } from "@napi-rs/canvas";
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createWorkPackage } from "./workbench-work-packages";

export type M3FormatKind = "civil" | "arbitration";
export interface M3FormatFile { name: string; mimeType: string; bytes: Buffer }
export const M3_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const M3_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const notice = "合成工程验收资料，不用于真实事项；专业验收尚未完成。";

/** Ordinary OOXML table, not a fake text file or a fabricated paragraph map. */
export async function createM3Docx(name: string, lines: string[]): Promise<M3FormatFile> {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph(notice), new Paragraph(name),
    new Table({ rows: lines.map((line, index) => new TableRow({ children: [
      new TableCell({ children: [new Paragraph(String(index + 1))] }),
      new TableCell({ children: [new Paragraph(line)] }),
    ] })) }),
  ] }] }));
  return { name, mimeType: M3_DOCX_MIME, bytes };
}

async function ledger(lines: string[], amount: number): Promise<M3FormatFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("付款台账");
  sheet.getCell("B2").value = notice;
  sheet.getCell("C8").value = lines[0];
  sheet.getCell("D8").value = amount;
  if (lines[1]) sheet.getCell("C9").value = lines[1];
  // Deliberately no cached `result`: the production parser must not invent a value.
  sheet.getCell("F10").value = { formula: "SUM(D8:D9)" };
  return { name: "合成付款台账.xlsx", mimeType: M3_XLSX_MIME,
    bytes: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

async function threePagePdf(kind: M3FormatKind): Promise<M3FormatFile> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const support = kind === "civil" ? [
    "Delivery receipt: goods signed for on 2026-05-10.",
    "Quantity receipt only; quality acceptance is separate.",
  ] : [
    "Delivery email dated 2026-06-15: the provider says the system was delivered.",
    "The provider asks the customer to arrange acceptance.",
  ];
  const rebuttal = kind === "civil" ? [
    "On 2026-05-12 the other party alleged quality problems.",
    "Quality objection remains unverified.",
  ] : [
    "On 2026-06-16 the customer listed unfinished work.",
    "The customer objects to acceptance; completion remains disputed.",
  ];
  for (const lines of [support, null, rebuttal]) {
    const page = pdf.addPage([612, 792]);
    if (lines) {
      ["SYNTHETIC ENGINEERING MATERIAL - NOT FOR A REAL MATTER", ...lines]
        .forEach((text, index) => page.drawText(text, { x: 32, y: 740 - index * 32, size: 11, font }));
    } else {
      // A meaningful raster source, not a blank page. All page 2 markings are in
      // the embedded PNG; there is no PDF text layer, footer or page-number text.
      const canvas = createCanvas(1100, 700);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#152b40";
      context.font = "26px sans-serif";
      const imageLines = kind === "civil" ? [
        "SYNTHETIC CUSTOMER CONVERSATION - IMAGE ORIGINAL",
        "Customer says delivery met the agreement.",
        "Other party requests further acceptance documents.",
        "This image has not been processed by OCR.",
      ] : [
        "SYNTHETIC SERVICE REPORT - IMAGE ORIGINAL",
        "The report records completion of a demonstration.",
        "Other acceptance items have not been processed.",
        "This image has not been processed by OCR.",
      ];
      imageLines.forEach((text, index) => context.fillText(text, 38, 90 + index * 90));
      const png = await pdf.embedPng(canvas.toBuffer("image/png"));
      page.drawImage(png, { x: 20, y: 205, width: 572, height: 364 });
    }
  }
  return { name: "合成支持反向材料三页.pdf", mimeType: "application/pdf", bytes: Buffer.from(await pdf.save()) };
}

/** Reuse only the old package's original statements and author expectations.
 * No old IDs, scope, anchors, bindings or simulated parse snapshots escape here.
 * Every business identity and citation is obtained from the live services later.
 */
export async function createM3FormatWorkPackage(kind: M3FormatKind) {
  const old = createWorkPackage(kind, "SERVER");
  const lines = old.documents.map(document => document.original.split("\n").slice(1));
  const civil = kind === "civil";
  const contract = await createM3Docx("合成合同.docx", lines[0]);
  const recorded = civil
    ? await createM3Docx("合成签收及付款记录.docx", [...lines[1], ...lines[2]])
    : await ledger(lines[5], 30000);
  const claim = await createM3Docx("合成当事人陈述.docx", civil ? lines[6].slice(0, 2) : lines[6]);
  const versionOriginal = civil ? await ledger(lines[3], 40000)
    : await createM3Docx("合成会议纪要.docx", lines[2]);
  const versionNew = civil ? await ledger(lines[4], 50000)
    : await createM3Docx("合成会议纪要.docx", lines[3]);
  return {
    kind, provenance: "SYNTHETIC" as const, professionalReview: "PENDING" as const, runtimeMode: "SERVER" as const,
    expected: structuredClone(old.expected),
    contract, recorded, claim, versionOriginal, versionNew, pdf: await threePagePdf(kind),
    factText: civil ? lines[2][0] : lines[5][0],
    claimText: lines[6][0],
    versionOldText: civil ? lines[3][0] : lines[2][0],
    versionNewText: civil ? lines[4][0] : lines[3][1],
    versionExtraText: civil ? lines[4][1] : null,
    pdfSupport: civil ? "Quantity receipt only" : "the provider says the system was delivered",
    pdfRebuttal: civil ? "Quality objection remains unverified" : "customer objects to acceptance",
    question: civil ? "合同款的支付记录与质量争议还需核实哪些条件" : "服务验收与付款记载冲突还需核实哪些条件",
  };
}
