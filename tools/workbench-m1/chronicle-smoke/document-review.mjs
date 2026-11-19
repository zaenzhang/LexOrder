import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import PizZip from "pizzip";
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
const delivery = (matter, record) =>
  workspace + "?" + new URLSearchParams({ section: "delivery", matter, ...(record && { record }) });
const deliveryState = async () => {
  const list = await api(delivery(a.id));
  return list.items.find(item => item.id === exact.id)?.state;
};
const exportV1 = async () => {
  const response = await request(workspace, {
    action: "export-delivery", matterId: a.id, deliveryId: exact.id, requestKey: randomUUID(),
  });
  assert.equal(response.headers.get("content-type"), "application/zip");
  const zip = new PizZip(await response.arrayBuffer());
  assert.equal(zip.file("材料/01_" + name)?.asText(), v1);
};
await exportV1();
assert.equal(await deliveryState(), "EXPORTED");
assert.deepEqual((await api(delivery(a.id, exact.id))).events.map(event => event.kind), ["EXPORTED"]);

const proofName = "签收回单-" + tag + ".txt";
const proofText = "Signed receipt for " + tag;
async function uploadProof(matterId, text) {
  const form = new FormData();
  form.set("matterId", matterId);
  form.set("name", proofName);
  form.set("category", "EVIDENCE");
  form.set("requestKey", randomUUID());
  form.set("file", new File([text], proofName, { type: "text/plain" }));
  await api(workspace, form);
  const options = await api(delivery(matterId) + "&options=1");
  const proof = options.documents.find(item => item.name === proofName);
  assert.ok(proof, "Uploaded proof must be selectable in its own case");
  return proof.id;
}
const proofId = await uploadProof(a.id, proofText);
const foreignProof = await uploadProof(b.id, "Other case receipt");
const decision = await api(workspace, {
  action: "save-context",
  data: {
    matterId: a.id,
    requestKey: randomUUID(),
    kind: "DECISION",
    visibility: "MATTER",
    content: "和解方案仍待客户核准",
    contextInputs: [],
    sourceDocumentId: doc.id,
    sourceDescription: "本次交付的和解方案 V1",
    occurredAt: new Date().toISOString(),
  },
});
const decisionHistory = () =>
  api(workspace + "?" + new URLSearchParams({ section: "context", matter: a.id, history: decision.id }));
const beforeReceipt = await decisionHistory();
assert.equal(beforeReceipt.records[0].source.id, doc.id);
assert.equal(beforeReceipt.records[0].confirmationStatus, "PENDING");

const recordEvent = (matterId, data, status) =>
  api(workspace, { action: "record-delivery-event", matterId, data }, status);
const receivedData = {
  deliveryId: exact.id,
  kind: "RECEIVED",
  requestKey: randomUUID(),
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  channel: "回执",
  note: "客户签收，内容仍待核准",
  proofDocumentId: proofId,
};
await recordEvent(a.id, receivedData, 403);
const sentData = {
  deliveryId: exact.id,
  kind: "SENT",
  requestKey: randomUUID(),
  occurredAt: new Date(Date.now() - 120_000).toISOString(),
  channel: "当面交接",
  note: "经办人登记当面交付",
};
await request(delivery(b.id, exact.id), null, 403);
await recordEvent(b.id, sentData, 403);
const sent = await recordEvent(a.id, sentData);
assert.equal((await recordEvent(a.id, sentData)).id, sent.id);
await recordEvent(a.id, { ...receivedData, proofDocumentId: foreignProof }, 403);
const received = await recordEvent(a.id, receivedData);
assert.equal((await recordEvent(a.id, receivedData)).id, received.id);
assert.equal(await deliveryState(), "SENT");
assert.deepEqual(await decisionHistory(), beforeReceipt);
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
const locked = await api(delivery(a.id, exact.id));
assert.equal(locked.items[0].documentId, doc.id);
assert.equal(locked.items[0].documentVersion, 1);
assert.equal(locked.items[0].newerVersionAvailable, true);
assert.equal(locked.recipientName, "模拟客户");
assert.equal(locked.recipientContact, "合成现场");
assert.deepEqual(locked.events.map(event => event.kind), ["EXPORTED", "SENT", "RECEIVED"]);
const [, shipment, receipt] = locked.events;
assert.equal(shipment.id, sent.id);
assert.equal(shipment.proofDocumentId, null);
for (const [event, input] of [[shipment, sentData], [receipt, receivedData]]) {
  assert.equal(event.occurredAt, input.occurredAt);
  assert.equal(event.channel, input.channel);
  assert.equal(event.note, input.note);
  assert.ok(event.actorName);
  assert.ok(Date.parse(event.recordedAt) > Date.parse(event.occurredAt));
}
assert.equal(receipt.id, received.id);
assert.equal(receipt.proofDocumentId, proofId);
assert.equal(receipt.proofName, proofName);
assert.equal(await (await request("/api/documents/" + receipt.proofDocumentId + "/download")).text(), proofText);
assert.equal(await (await request("/api/documents/" + locked.items[0].documentId + "/download")).text(), v1);
assert.equal(await (await request("/api/documents/" + latest.id + "/download")).text(), v2);
await exportV1();
console.log(
  "PASS V1 review and approval, frozen ZIP before sending, independent sent and received facts with same-case proof, unchanged pending decision, cross-case refusals, V2 review and reopened V1 original and ZIP.",
);
