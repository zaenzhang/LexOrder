import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, rgb } from "pdf-lib";
import { createSyntheticCase } from "./create-synthetic-case.mjs";

const endpoint = "/api/personal/matter-workspace";
const pdfName = "LexOrder 性能验收固定原件.pdf";
const pageSize = [595, 842];
export const fileCount = 8;
export const bytesPerFile = 512 * 1024;

export async function prepareCases(request, workspace, casebookRoot) {
  const fixtureFile = path.join(workspace, "chronicle-performance-fixture.json");
  const previous = await readFile(fixtureFile, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  async function identity(id) {
    const { title } = await (await request(endpoint + "?" + new URLSearchParams({ section: "identity", matter: id }))).json();
    assert(title.startsWith("性能验收合成案"));
    return { id, title };
  }
  if (previous) {
    const { cases, documentId } = JSON.parse(previous);
    assert(cases.length === 2 && documentId);
    return { cases: await Promise.all(cases.map(({ id }) => identity(id))), documentId };
  }
  const tag = randomUUID().slice(0, 8);
  const cases = [];
  for (const letter of ["甲", "乙"]) {
    const title = "性能验收合成案" + letter + " " + tag;
    const id = await createSyntheticCase(request, {
      title, clientName: "性能验收合成委托" + letter + " " + tag, description: "同案卷定向性能验收", casebookRoot,
    });
    cases.push(await identity(id));
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  const first = document.addPage(pageSize);
  // An unambiguous page marker, independent of fonts, browser UI and white loading surfaces.
  first.drawRectangle({ x: 72, y: 490, width: 450, height: 310, color: rgb(0.85, 0.10, 0.55) });
  const data = new FormData();
  data.set("file", new File([await document.save()], pdfName, { type: "application/pdf" }));
  for (const [key, value] of Object.entries({ matterId: cases[0].id, name: pdfName, category: "EVIDENCE", requestKey: randomUUID() })) data.set(key, value);
  await request(endpoint, data);
  const result = await (await request(endpoint + "?" + new URLSearchParams({ section: "materials", matter: cases[0].id }))).json();
  const documentId = result.documents.find(row => row.name === pdfName)?.id;
  assert(documentId);
  const fixture = { cases, documentId };
  await writeFile(fixtureFile, JSON.stringify(fixture), { flag: "wx" });
  return fixture;
}

export function syntheticImportFiles(tag) {
  return Array.from({ length: fileCount }, (_, index) => ({
    name: "性能验收导入-" + tag + "-" + (index + 1) + ".txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(bytesPerFile, String(index + 1) + " LexOrder synthetic intake\n"),
  }));
}

export function hasPerformancePdfMarker(rgba) {
  let matches = 0;
  for (let offset = 0; offset < rgba.length; offset += 16) {
    if (rgba[offset] >= 195 && rgba[offset + 1] <= 66 && rgba[offset + 2] >= 115 && rgba[offset + 2] <= 170) matches++;
  }
  return matches > 500;
}

export async function waitForImportParsing(request, matterId, tag) {
  const query = new URLSearchParams({ section: "materials", matter: matterId, q: tag });
  const { documents } = await (await request(endpoint + "?" + query)).json();
  assert.equal(documents.length, fileCount, "Expected the imported round's exact material catalog");
  const data = { matterId, documents: documents.map(({ id: documentId }) => ({ documentId })) };
  const deadline = performance.now() + 90_000;
  do {
    const preview = await (await request(endpoint, { action: "preview-skill-input", data })).json();
    assert.equal(preview.modelSupply.status, "NOT_SENT");
    assert.equal(preview.items.length, fileCount);
    const states = preview.items.map(item => item.processing?.state);
    assert(states.every(state => ["PENDING", "RUNNING", "READY", "PARTIAL"].includes(state)),
      "Unexpected parser states: " + states.join(", "));
    if (states.every(state => state === "READY" || state === "PARTIAL")) {
      assert(preview.items.every(item => item.run?.isCurrent && item.preparation.availableChars > 0),
        "All imports must have published anchored text for their current versions");
      return states;
    }
    await delay(750);
  } while (performance.now() < deadline);
  throw new Error("Timed out waiting for publication of all imported text sources");
}
