import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const { request } = await fixture();
const ep = "/api/personal/practice-resources";
const tag = randomUUID().slice(0, 8);
async function upload(text, supersedesId, status) {
  const form = new FormData();
  form.set("action", "upload-resource");
  form.set("category", "GUIDE");
  form.set("file", new File([text], "guide.txt", { type: "text/plain" }));
  form.set("name", "合成指引" + tag);
  if (supersedesId) form.set("supersedesId", supersedesId);
  return (await request(ep, form, status)).json();
}
const first = await upload("合成 V1");
const next = await upload("合成 V2", first.id);
await upload("过期", first.id, 409);
const latest = await (await request(ep + "?view=resources&q=" + tag)).json();
assert.deepEqual(
  latest.map((row) => row.id),
  [next.id],
);
const history = await (
  await request(ep + "?view=history&id=" + next.id)
).json();
assert.deepEqual(
  history.map((row) => row.id),
  [next.id, first.id],
);
for (const [id, data] of [
  [first.id, "合成 V1"],
  [next.id, "合成 V2"],
]) {
  assert.equal(
    await (await request("/api/firm-files/" + id + "/download")).text(),
    data,
  );
}
for (const view of ["profile", "reports", "templates", "audit"])
  await request(ep + "?view=" + view);
const sheet = await request("/api/reports/export?period=month");
assert.equal(
  Buffer.from(await sheet.arrayBuffer())
    .subarray(0, 2)
    .toString(),
  "PK",
);
console.log(
  "PASS resource replacement, previous bytes, version chain, profile, reports XLSX and audit",
);
