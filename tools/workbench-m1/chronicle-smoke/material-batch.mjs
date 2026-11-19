import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const { addBatchFiles, batchRows, clearCompletedRows, submitBatch } =
  require("../../../desktop/personal-chronicle/features/matters/material-batch-queue.ts");

const { cases: [a, b], request } = await fixture();
const tag = randomUUID().slice(0, 8);
const firstName = "首份材料-" + tag + ".txt";
const retriedName = "待重试材料-" + tag + ".txt";
const firstBytes = "A 首份原件 " + tag;
const retriedBytes = "A 重试原件 " + tag;
const bBytes = "B 独立同名材料 " + tag;
const posted = [];
const originalFetch = globalThis.fetch;
const gate = Promise.withResolvers();
let loseReceipt = true;
globalThis.fetch = async (url, options) => {
  if (url !== "/api/personal-runtime/matter-workspace") return originalFetch(url, options);
  const form = options.body;
  const entry = { matterId: form.get("matterId"), key: form.get("requestKey"), name: form.get("name") };
  posted.push(entry);
  // Keep A in progress while B is opened and submitted.
  if (posted.length === 1) await gate.promise;
  const response = await request("/api/personal/matter-workspace", form);
  if (entry.name === retriedName && loseReceipt) {
    loseReceipt = false;
    throw Error("模拟已入卷后客户端收取回执失败");
  }
  return response;
};

try {
  const file = (bytes, name) => new File([bytes], name, { type: "text/plain" });
  addBatchFiles(a.id, [file(firstBytes, firstName), file(retriedBytes, retriedName)], "OTHER");
  addBatchFiles(b.id, [file(bBytes, firstName)], "OTHER");
  const firstRun = submitBatch(a.id, "waiting");
  await submitBatch(a.id, "waiting");
  assert.equal(posted.length, 1);
  await submitBatch(b.id, "waiting");
  gate.resolve();
  await firstRun;
  assert.deepEqual(batchRows(a.id).map(row => row.status), ["done", "failed"]);
  assert.deepEqual(batchRows(b.id).map(row => row.status), ["done"]);
  const retryKey = batchRows(a.id)[1].key;
  await submitBatch(a.id, "failed");
  assert.deepEqual(posted.map(row => row.matterId), [a.id, b.id, a.id, a.id]);
  assert.equal(posted[2].key, retryKey);
  assert.equal(posted[3].key, retryKey);
  assert(batchRows(a.id).every(row => row.status === "done" && row.file === undefined));
  for (const [matter, expected] of [[a, [firstBytes, retriedBytes]], [b, [bBytes]]]) {
    const response = await request("/api/personal/matter-workspace?section=materials&matter=" + matter.id);
    const docs = (await response.json()).documents.filter(doc => doc.name.includes(tag));
    assert.equal(docs.length, expected.length);
    const bytes = await Promise.all(docs.map(async doc => (await request("/api/documents/" + doc.id + "/download")).text()));
    assert.deepEqual(bytes.sort(), expected.sort());
  }
  clearCompletedRows(a.id);
  assert.equal(batchRows(a.id).length, 0);
  assert.equal(batchRows(b.id).length, 1);
  console.log("PASS batched material import, case switch with in-flight file, duplicate click, per-file receipts, idempotent retry after response loss and download byte comparison");
} finally {
  gate.resolve();
  globalThis.fetch = originalFetch;
}
