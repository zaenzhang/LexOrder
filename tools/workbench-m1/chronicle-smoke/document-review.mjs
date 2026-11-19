import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const {
  cases: [a, b],
  request,
} = await fixture();
const ep = "/api/personal/document-review",
  workspace = "/api/personal/matter-workspace";
const api = async (path, body, code) => (await request(path, body, code)).json();
const tag = randomUUID().slice(0, 8),
  name = "合成文书送审" + tag + ".txt",
  v1 = "Original draft " + tag,
  v2 = "Revised draft " + tag;
const upload = new FormData();
for (const [k, v] of Object.entries({
  matterId: a.id,
  name,
  category: "PLEADING",
  requestKey: randomUUID(),
  sourceOrigin: "TEAM_PRODUCED",
}))
  upload.set(k, v);
upload.set("file", new File([v1], name, { type: "text/plain" }));
await api(workspace, upload);
const list = (id) => api(ep + "?matter=" + id);
const doc = (await list(a.id)).items.find((x) => x.name === name);
assert(doc);
const read = (id, matter = a.id) => api(ep + "?" + new URLSearchParams({ matter, document: id }));
const post = (action, data = {}, code, documentId = doc.id) =>
  api(ep, { action, matterId: a.id, documentId, ...data }, code);
const freeze = (id, status) =>
  api(
    workspace,
    {
      action: "prepare-delivery",
      data: {
        matterId: a.id,
        documentIds: [id],
        requestKey: randomUUID(),
        recipientName: "模拟客户",
        recipientContact: "合成现场",
        purpose: "交付成果",
        disclosureScope: "模拟收件人",
      },
    },
    status,
  );
const original = await read(doc.id);
assert(original.canSubmit);
assert.equal(original.expected.version, 1);
await request(ep + "?" + new URLSearchParams({ matter: b.id, document: doc.id }), null, 404);
await freeze(doc.id, 403);
await post("submit", { expected: original.expected });
const submitted = await read(doc.id);
assert.equal(submitted.status, "PENDING_REVIEW");
assert(submitted.canReview);
const issue = {
  requestId: randomUUID(),
  documentId: doc.id,
  title: "核对约定文本",
  location: "第一段",
  basis: "合成客户会议记录",
  basisDocumentId: null,
};
const record = await post("issue", { data: issue });
assert.equal((await post("issue", { data: issue })).id, record.id);
await post("approve", { expected: submitted.expected, note: "漏核新增项目", acknowledged: true }, 409);
const response = await post("respond", {
  data: {
    requestId: randomUUID(),
    issueId: record.id,
    expectedVersion: record.version,
    disposition: "REJECT",
    note: "原文已与客户记录核实，无需改正",
    revisionDocumentId: null,
    revisionLocation: null,
  },
});
await post("check", {
  data: {
    requestId: randomUUID(),
    issueId: record.id,
    expectedVersion: response.version,
    resolved: true,
    note: "已核对客户记录，问题已处理",
  },
});
const checked = await read(doc.id);
assert.equal(checked.review.issues[0].state, "RESOLVED");
await post("approve", { expected: { ...checked.expected, issues: [] }, note: "漏核", acknowledged: true }, 409);
await post("reject", { expected: checked.expected, note: "合成退回演示", acknowledged: true });
const returned = await read(doc.id);
assert.equal(returned.status, "DRAFT");
await post("submit", { expected: returned.expected });
const fresh = await read(doc.id);
await post("approve", { expected: fresh.expected, note: "逐项核对，批准本版", acknowledged: false }, 400);
await post("approve", { expected: fresh.expected, note: "逐项核对，批准本版", acknowledged: true });
assert.equal((await read(doc.id)).status, "APPROVED");
const exact = await freeze(doc.id);
const next = new FormData();
next.set("matterId", a.id);
next.set("documentId", doc.id);
next.set("file", new File([v2], name, { type: "text/plain" }));
next.set("requestKey", randomUUID());
next.set("contextInputs", "[]");
const latest = await api(ep, next);
assert.equal(latest.version, 2);
assert.equal((await api(ep, next)).id, latest.id);
const draft = await read(latest.id),
  old = await read(doc.id);
assert.equal(draft.status, "DRAFT");
assert.equal(draft.canSubmit, true);
assert.equal(old.status, "APPROVED");
assert.equal(old.isLatest, false);
await freeze(latest.id, 403);
await post("submit", { expected: draft.expected }, 200, latest.id);
const second = await read(latest.id);
await post("approve", { expected: second.expected, note: "独立核对新版", acknowledged: true }, 200, latest.id);
await freeze(latest.id);
const locked = await api(
  workspace + "?" + new URLSearchParams({ section: "delivery", matter: a.id, record: exact.id }),
);
assert.equal(locked.items[0].documentId, doc.id);
assert.equal(locked.items[0].documentVersion, 1);
assert.equal(await (await request("/api/documents/" + doc.id + "/download")).text(), v1);
assert.equal(await (await request("/api/documents/" + latest.id + "/download")).text(), v2);
console.log(
  "PASS fixed V1 issue, response, check, omission/stale refusal, return/resubmit and manual approval; delivery freeze exact V1; uploaded V2 requires independent review, both original byte streams and V1 manifest preserved.",
);
