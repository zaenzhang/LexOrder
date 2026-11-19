import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { Document, Packer, Paragraph } from "docx";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
const {
  cases: [a, b],
  request,
} = await fixture();
const path = "/api/personal/matter-workspace";
const get = async (matter, section, extra = {}) =>
  (await request(path + "?" + new URLSearchParams({ matter, section, ...extra }))).json();
const put = async (data, status) => (await request(path, data, status)).json();

const { sealWorkspace } = await get(a.id, "seal");
const purpose = sealWorkspace.purposes.find((p) => p.name === "合成测试事项");
assert(purpose, "Seed the two enabled stamp types and synthetic purpose before running.");
const template = await Packer.toBuffer(
  new Document({ sections: [{ children: [new Paragraph("案名 {{matter.title}}")] }] }),
);
const form = new FormData();
form.set("action", "add-template");
form.set("name", "合成案情说明 " + randomUUID().slice(0, 8));
form.set("category", "WORK_PRODUCT");
form.set(
  "file",
  new Blob([template], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  "blank.docx",
);
const upload = await put(form);
assert((await get(a.id, "templates")).templates.some((x) => x.id === upload.id));
const prep = await put({ action: "prepare-template", data: { matterId: a.id, templateId: upload.id } });
assert(prep.fields.some((f) => f.path === "matter.title" && f.value === a.title));
const data = {
  matterId: a.id,
  templateId: upload.id,
  templateUpdatedAt: prep.templateUpdatedAt,
  selection: prep.selection,
  requestKey: randomUUID(),
  folderId: null,
  expectedValues: prep.expectedValues,
  expectedSubjects: prep.expectedSubjects,
  overrides: {},
  reviewed: true,
};
await put(
  {
    action: "render-template",
    data: {
      ...data,
      expectedValues: { ...data.expectedValues, "matter.title": "错误的案件" },
      requestKey: randomUUID(),
    },
  },
  403,
);
const draft = await put({ action: "render-template", data });
assert.equal((await put({ action: "render-template", data })).documentId, draft.documentId);
const download = await request("/api/documents/" + draft.documentId + "/download");
assert.equal(download.status, 200);
assert(
  new PizZip(Buffer.from(await download.arrayBuffer())).file("word/document.xml").asText().includes(a.title),
);
assert(!(await get(b.id, "materials")).documents.some((d) => d.id === draft.documentId));
console.log(
  "PASS DOCX template import, case-selection preview, changed-field refusal, rendered real Word content, replay and A/B association",
);
const pdf = await PDFDocument.create();
pdf.addPage();
const pdfFile = new Blob([await pdf.save()], { type: "application/pdf" });
function sealForm(type) {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    action: "create-seal",
    matterId: a.id,
    sealType: type,
    purposeConfigId: purpose.id,
    purpose: "隔离业务验收",
    documentTitle: "本案合成用印文件",
    copies: "1",
    pageCount: "1",
  }))
    f.set(key, value);
  f.set("draftDoc", pdfFile, "demo.pdf");
  return f;
}
await put(sealForm("LEGAL_REP_SEAL"), 403);
const seal = await put(sealForm("OFFICIAL_SEAL"));
async function row() {
  return (await get(a.id, "seal")).sealWorkspace.seals.find((x) => x.id === seal.id);
}
let rec = await row();
assert.equal(rec.status, "PENDING");
assert(rec.canApprove);
assert(!rec.canStamp);
await put({ action: "approve-seal", matterId: b.id, data: { id: seal.id, note: "错案拒绝" } }, 403);
await put({ action: "approve-seal", matterId: a.id, data: { id: seal.id, note: "本人核对合成材料" } });
rec = await row();
assert.equal(rec.status, "APPROVED");
assert(!rec.canApprove);
assert(rec.canStamp);
await put({ action: "reject-seal", matterId: a.id, data: { id: seal.id, reason: "批准后禁止驳回" } }, 403);
const stamp = new FormData();
stamp.set("matterId", a.id);
stamp.set("id", seal.id);
stamp.set("action", "stamp-seal");
pdf.getPage(0).drawText("Synthetic stamped copy", { x: 48, y: 48 });
const stampedBytes = Buffer.from(await pdf.save());
stamp.set("stampedDoc", new Blob([stampedBytes], { type: "application/pdf" }), "signed.pdf");
await put(stamp);
rec = await row();
assert.equal(rec.status, "STAMPED");
assert(rec.stampedDoc.id !== rec.draftDoc.id);
const originalDownload = await request("/api/documents/" + rec.draftDoc.id + "/download");
const resultDownload = await request("/api/documents/" + rec.stampedDoc.id + "/download");
assert.deepEqual(Buffer.from(await originalDownload.arrayBuffer()), Buffer.from(await pdfFile.arrayBuffer()));
assert.deepEqual(Buffer.from(await resultDownload.arrayBuffer()), stampedBytes);
const seal2 = await put(sealForm("OFFICIAL_SEAL"));
await put({ action: "cancel-seal", matterId: a.id, data: { id: seal2.id } });
const seal3 = await put(sealForm("OFFICIAL_SEAL"));
await put({ action: "reject-seal", matterId: a.id, data: { id: seal3.id, reason: "合成扫描件不清" } });
const rows = (await get(a.id, "seal")).sealWorkspace.seals;
assert.equal(rows.find((x) => x.id === seal2.id).status, "CANCELLED");
assert.equal(rows.find((x) => x.id === seal3.id).status, "REJECTED");
assert(!(await get(b.id, "seal")).sealWorkspace.seals.some((x) => x.id === seal.id));
console.log(
  "PASS seal PENDING -> personal manual confirmation -> actual stamped PDF, separate draft/receipt, rejection/cancel, legal-representative and wrong-case refusals",
);
