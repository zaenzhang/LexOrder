import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, Index } from "@lancedb/lancedb";
import { parseMaterial } from "../../src/server/rag/parse-material";
import { createLanceAdapter } from "../../src/server/rag/lancedb-adapter";
import { retrieveScopedEvidence } from "../../src/server/rag/retrieve";
import { createWorkPackage, digest } from "../../src/tests/fixtures/workbench-work-packages";
import { localTesseract } from "./ocr";
import type { IndexBinding, SourceVersion } from "../../src/lib/workbench/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), "lexorder-m1-"));
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log("PASS " + name); };
const embed = async (texts: readonly string[]) => texts.map(text => [...Buffer.from(digest(text), "hex").slice(0, 8)].map(value => (value + 1) / 256));
let connection: Awaited<ReturnType<typeof connect>> | undefined;
try {
  await promisify(execFile)("python", [path.join(here, "generate-samples.py"), "--out", path.join(work, "samples")]);
  const manifest = JSON.parse(await readFile(path.join(work, "samples/manifest.json"), "utf8"));
  const pdfResources = { cMapUrl: path.join(here, "node_modules/pdfjs-dist/cmaps/") + path.sep,
    standardFontDataUrl: path.join(here, "node_modules/pdfjs-dist/standard_fonts/") + path.sep };
  const ocr = process.env.M1_TESSDATA_DIR ? localTesseract(process.env.M1_TESSDATA_DIR, "chi_sim", pdfResources) : undefined;
  for (const sample of manifest.documents) {
    const bytes = await readFile(path.join(work, "samples", sample.file));
    assert.equal(digest(bytes), sample.sha256);
    const source: SourceVersion = { kind: "CASE_MATERIAL", documentId: sample.file, matterId: "synthetic-" + sample.workPackage, sha256: sample.sha256 };
    const parsed = await parseMaterial({ bytes, mimeType: sample.mimeType, source, parseGenerationId: "parse-1", pdfResources });
    if (sample.expected.state) assert.equal(parsed.state, sample.expected.state);
    if (sample.expected.pages) assert.equal(parsed.coverage.totalUnits, sample.expected.pages);
    for (const unit of sample.expected.pendingWithoutOcr ?? []) assert.equal(parsed.coverage.units[unit - 1].status, "PENDING");
    for (const text of sample.expected.contains ?? []) assert.ok(parsed.anchors.some(anchor => anchor.text.includes(text)), sample.file + " missing expected text");
    if (sample.expected.locationKind) assert.ok(parsed.anchors.every(anchor => anchor.location.kind === sample.expected.locationKind));
    if (sample.expected.cell) {
      const cell = sample.expected.cell;
      assert.ok(parsed.anchors.some(anchor => anchor.location.kind === "TABLE" && anchor.location.sheet === cell.sheet &&
        anchor.location.rowStart === cell.row && anchor.location.columnStart === cell.column && anchor.text === cell.text));
      assert.equal(parsed.state, "PARTIAL");
      assert.ok(parsed.coverage.units.some(unit => unit.status === "UNSUPPORTED"));
    }
    if (sample.expected.ocrContains && ocr) {
      const recognized = await parseMaterial({ bytes, mimeType: sample.mimeType, source, parseGenerationId: "ocr-1", ocr, pdfResources });
      assert.equal(recognized.state, "READY", sample.file);
      for (const text of sample.expected.ocrContains) assert.ok(recognized.anchors.some(anchor => anchor.text.replace(/\s/g, "").includes(text)), sample.file + " OCR expectation");
      check("real_chinese_ocr_" + sample.file);
    }
    check("format_" + sample.file);
  }
  const pack = createWorkPackage("civil");
  pack.scope.bindings.forEach(binding => { binding.profile.embeddingProvider = "engineering-fixture"; });
  const profile = pack.scope.bindings[0].profile;
  connection = await connect(path.join(work, "lance"));
  let table = await connection.createTable("materials", [{ rowId: "bootstrap", anchorId: "bootstrap", bindingId: "bootstrap", documentId: "bootstrap", indexGenerationId: "bootstrap", profileFingerprint: "bootstrap", text: "初始化", lexicalText: "初始化", vector: (await embed(["初始化"]))[0] }]);
  await table.delete("rowId = 'bootstrap'");
  let adapter = createLanceAdapter({ table, instanceId: "fixture-local", tableId: pack.scope.matterId, profile, embed });
  for (const doc of pack.documents) await adapter.write(doc.binding, doc.anchors);
  await table.createIndex("lexicalText", { config: Index.fts({ baseTokenizer: "icu", stem: false, removeStopWords: false, asciiFolding: false }), replace: true });
  for (const query of ["质量", "120000", "2026", "合成甲公司"]) {
    const rows = await table.query().nearestToText(query, ["lexicalText"]).limit(20).toArray();
    assert.ok(rows.length > 0, "real ICU query " + query);
  }
  check("real_lancedb_icu_chinese_names_amount_dates");
  const retrieve = () => retrieveScopedEvidence({ query: "质量异议", limit: 20 }, {
    loadScope: async () => pack.scope, retrieve: adapter.retrieve,
    loadAnchors: async ids => pack.anchors.filter(anchor => ids.includes(anchor.anchorId)),
  });
  const first = await retrieve();
  assert.equal(first.status, "PARTIAL");
  assert.ok("hits" in first && first.hits.some(hit => hit.text.includes("质量问题")));
  check("real_sdk_through_shared_scope_and_anchor_boundary");
  const doc = pack.documents[0];
  const next: IndexBinding = { ...doc.binding, indexGenerationId: "new-index" };
  await adapter.write(next, doc.anchors);
  const before = await table.countRows();
  await adapter.write(next, doc.anchors);
  assert.equal(await table.countRows(), before);
  await adapter.deleteGeneration(doc.binding);
  const newRows = await table.query().where("indexGenerationId = 'new-index'").toArray();
  assert.equal(newRows.length, doc.anchors.length);
  check("idempotent_write_and_generation_isolated_delete");
  pack.scope.bindings[0] = next;
  table.close(); connection.close();
  connection = await connect(path.join(work, "lance"));
  table = await connection.openTable("materials");
  adapter = createLanceAdapter({ table, instanceId: "fixture-local", tableId: pack.scope.matterId, profile, embed });
  assert.ok("hits" in await retrieve());
  check("lancedb_close_reopen");
  const restricted = { ...pack.scope, bindings: [next] };
  const bounded = await retrieveScopedEvidence({ query: "质量异议", limit: 20 }, {
    loadScope: async () => restricted, retrieve: adapter.retrieve,
    loadAnchors: async ids => pack.anchors.filter(anchor => ids.includes(anchor.anchorId)),
  });
  assert.ok("hits" in bounded && bounded.hits.every(anchor => anchor.source.kind === "CASE_MATERIAL" && anchor.source.documentId === doc.id));
  check("real_query_prefilter_excludes_other_documents");
  table.close();
  console.log(JSON.stringify({ status: "PASS_WITH_LIMITS", checks: checks.length, chineseOcr: ocr ? "PASS" : "NOT_CONFIGURED",
    semanticModel: "NOT_TESTED_DETERMINISTIC_VECTORS_ONLY", platform: `${process.platform}/${process.arch}` }));
} finally { connection?.close(); await rm(work, { recursive: true, force: true }); }
