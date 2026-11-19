import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const {
  cases: [a, b],
  request,
} = await fixture();
const api = request;
const base = "/api/personal/court-inbox",
  text = "【合成法院】请查收测试材料，来件编号 " + randomUUID();
const action = async (d, status) => (await api(base, d, status)).json();
const first = await action({ action: "paste", rawText: text, batch: false }),
  id = first.ids[0];
assert.equal((await action({ action: "paste", rawText: text, batch: false })).duplicates, 1);
const form = new FormData();
form.append("files", new File(["合成补交附件原文"], "法庭通知.txt", { type: "text/plain" }));
form.set("smsId", id);
const saved = await action(form);
assert.equal(saved.saved.length, 1);
assert.equal((await action(form)).skippedDuplicates.length, 1);
const read = async (state) =>
  (await (await api(base + "?state=" + state)).json()).items.find((row) => row.id === id);
assert(!(await read("unprocessed")).files[0].documentId);
await action({ action: "finish", id, note: "" }, 409);
const match = await action({ action: "match", smsId: id, matterId: a.id });
assert.equal(match.filedFiles, 1, (await read("unprocessed"))?.note ?? "附件未入卷");
await action({ action: "match", smsId: id, matterId: b.id }, 409);
const entry = await read("unprocessed"),
  docId = entry.files[0].documentId;
assert.equal(await (await api("/api/documents/" + docId + "/download")).text(), "合成补交附件原文");
await action({ action: "finish", id, note: "已核对归入本案的固定原件" });
assert.equal((await read("processed")).files[0].documentId, docId);
console.log(
  "PASS inbox: duplicate paste + original, pending attachment guard, match + immutable bytes, stale cross-case reassignment rejected, processed readback",
);
