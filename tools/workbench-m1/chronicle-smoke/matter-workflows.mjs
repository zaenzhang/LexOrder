import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import PizZip from "pizzip";
const {
  cases: [a, b],
  request,
} = await fixture();
const path = "/api/personal/matter-workspace";
const get = async (matter, section, extra = {}) =>
  (await request(path + "?" + new URLSearchParams({ matter, section, ...extra }))).json();
const put = async (data, status) => (await request(path, data, status)).json();
const taskKey = randomUUID();
const task = {
  action: "create-task",
  matterId: a.id,
  requestKey: taskKey,
  title: "归档期限核对 " + taskKey.slice(0, 8),
  description: "核查待签收清单",
  priority: 1,
  stageId: "",
  dueAt: "2026-12-02T10:00:00+08:00",
};
const { id } = await put(task);
assert.equal((await put(task)).id, id);
let tasks = (await get(a.id, "tasks")).schedule;
const fresh = tasks.tasks.find((t) => t.id === id);
assert.ok(fresh, "task has responsibility record");
assert.equal(fresh.stageId, null);
assert.equal(fresh.state, "OPEN");
assert.equal(fresh.dueAt, "2026-12-02T02:00:00.000Z");
assert(!(await get(b.id, "tasks")).schedule.tasks.some((t) => t.id === id));
const update = {
  ...task,
  action: "update-task",
  id,
  revision: fresh.revision,
  description: "补核客户签收凭证",
};
await put({ ...update, matterId: b.id }, 403);
await put(update);
await put(update, 403);
let edited = (await get(a.id, "tasks")).schedule.tasks.find((t) => t.id === id);
assert.equal(edited.description, update.description);
assert(edited.revision > fresh.revision);
const finish = { action: "complete-task", matterId: a.id, id, revision: edited.revision };
await put({ ...finish, matterId: b.id }, 403);
await put({ ...finish, revision: fresh.revision }, 403);
await put(finish);
await put(finish);
assert.equal((await get(a.id, "tasks")).schedule.tasks.find((t) => t.id === id).state, "DONE");
console.log(
  "PASS A/B task isolation, create replay, unassigned task, UTC+8 time, edit, stale revision refusal, completion and replay",
);
const key = randomUUID();
const study = {
  action: "create-research",
  matterId: a.id,
  requestKey: key,
  researchedAt: new Date().toISOString(),
  question: "交付凭证与签收范围 " + key.slice(0, 8),
  scope: "演示卷内资料",
  conclusion: "需核实签收人",
  unresolved: "待补收件回执",
};
const research = await put(study);
assert.equal((await put(study)).id, research.id);
const detail = await get(a.id, "research", { record: research.id });
assert.equal(detail.content.question, study.question);
assert.equal(detail.checkedAt, null);
await request(
  path + "?" + new URLSearchParams({ matter: b.id, section: "research", record: research.id }),
  null,
  403,
);
await put(
  {
    action: "check-research",
    matterId: a.id,
    id: research.id,
    expectedVersion: 99,
    acknowledged: true,
    note: "测试",
  },
  403,
);
await put({
  action: "check-research",
  matterId: a.id,
  id: research.id,
  expectedVersion: 1,
  acknowledged: true,
  note: "核对范围内材料，签收仍待核实",
});
assert((await get(a.id, "research", { record: research.id })).checkedAt);
const createDoc = {
  action: "draft-research",
  matterId: a.id,
  researchRevisionId: research.id,
  requestKey: randomUUID(),
};
const doc = await put(createDoc);
assert.equal((await put(createDoc)).documentId, doc.documentId);
const document = (await get(a.id, "materials")).documents.find((r) => r.id === doc.documentId);
assert.equal(document.sourceOrigin, "TEAM_PRODUCED");
assert.equal(document.editable, true);
assert(!(await get(b.id, "materials")).documents.some((r) => r.id === doc.documentId));
const download = await request("/api/documents/" + doc.documentId + "/download");
assert.equal(download.status, 200, "research Word download");
assert.equal(
  Buffer.from(await download.arrayBuffer())
    .subarray(0, 2)
    .toString(),
  "PK",
);
console.log(
  "PASS research create/replay, fixed revision, opposite-case rejection, stale review rejection, checked research to a real downloadable Word draft, draft replay and A/B association",
);
const sampleName = "交付凭据-" + randomUUID().slice(0, 8) + ".txt";
const form = new FormData();
form.set("matterId", a.id);
form.set("name", sampleName);
form.set("requestKey", randomUUID());
form.set("category", "EVIDENCE");
form.set("file", new Blob(["SYNTHETIC RECEIPT: exact fixture bytes"], { type: "text/plain" }), sampleName);
await request(path, form);
const options = await get(a.id, "delivery", { options: "1" });
assert(options.canPrepare);
const evidence = options.documents.find((row) => row.name === sampleName);
assert.ok(evidence);
assert(evidence.canDeliver);
const prepare = {
  action: "prepare-delivery",
  data: {
    matterId: a.id,
    requestKey: randomUUID(),
    documentIds: [evidence.id],
    recipientName: "模拟客户",
    recipientContact: "隔离工作区",
    purpose: "归还凭据",
    disclosureScope: "该清单一份凭证",
    sourceDeclarations: [{ documentId: evidence.id, kind: "EXTERNAL_ATTACHMENT" }],
  },
};
const wrongDoc = {
  ...prepare.data,
  documentIds: [doc.documentId],
  sourceDeclarations: [],
  requestKey: randomUUID(),
};
await put({ action: "prepare-delivery", data: wrongDoc }, 403);
const delivery = await put(prepare);
assert.equal((await put(prepare)).id, delivery.id);
let frozen = await get(a.id, "delivery", { record: delivery.id });
assert.equal(frozen.items[0].documentId, evidence.id);
assert.equal(frozen.events.length, 0);
assert(!(await get(a.id, "delivery", { sent: "1" })).items.some((item) => item.id === delivery.id));
await request(
  path + "?" + new URLSearchParams({ matter: b.id, section: "delivery", record: delivery.id }),
  null,
  403,
);
const send = {
  action: "record-delivery-event",
  matterId: a.id,
  data: {
    deliveryId: delivery.id,
    requestKey: randomUUID(),
    kind: "SENT",
    channel: "模拟现场交接",
    note: "已实际交接该文件",
    occurredAt: new Date().toISOString(),
    proofDocumentId: evidence.id,
  },
};
await put({ ...send, matterId: b.id }, 403);
await put({ ...send, data: { ...send.data, kind: "RECEIVED" } }, 403);
const exportInput = {
  action: "export-delivery",
  matterId: a.id,
  deliveryId: delivery.id,
  requestKey: randomUUID(),
};
const exportRes = await request(path, exportInput);
assert.equal(exportRes.status, 200);
assert.equal(exportRes.headers.get("content-type"), "application/zip");
const zip = Buffer.from(await exportRes.arrayBuffer());
assert.equal(zip.subarray(0, 2).toString(), "PK");
const zipFiles = Object.values(new PizZip(zip).files);
assert(
  zipFiles.some((file) => !file.dir && file.asText().includes("SYNTHETIC RECEIPT: exact fixture bytes")),
);
assert(!(await get(a.id, "delivery", { sent: "1" })).items.some((item) => item.id === delivery.id));
const sent = await put(send);
assert.equal((await put(send)).id, sent.id);
await put({
  ...send,
  data: { ...send.data, requestKey: randomUUID(), kind: "RECEIVED", note: "客户已收悉", channel: "电话" },
});
await put({
  ...send,
  data: {
    ...send.data,
    requestKey: randomUUID(),
    kind: "SEND_CORRECTION",
    correctsEventId: sent.id,
    note: "补录经办人",
    channel: "模拟现场交接",
  },
});
frozen = await get(a.id, "delivery", { record: delivery.id });
assert.equal(frozen.events.length, 4);
assert(frozen.events.some((e) => e.kind === "SEND_CORRECTION" && e.correctsEventId === sent.id));
assert.equal(frozen.items[0].documentVersion, 1);
assert(!(await get(b.id, "delivery")).items.some((item) => item.id === delivery.id));
const sentSummary = (await get(a.id, "delivery", { sent: "1" })).items.find((item) => item.id === delivery.id);
assert.equal(sentSummary?.state, "SENT");
assert.equal(sentSummary.sentAt, new Date(send.data.occurredAt).toISOString());
assert(!(await get(b.id, "delivery", { sent: "1" })).items.some((item) => item.id === delivery.id));
const fact = {
  action: "create-evidence",
  data: {
    matterId: a.id,
    requestKey: randomUUID(),
    kind: "FACT",
    title: "合成交付日期",
    content: "按收件登记补录",
    sourceDocumentId: null,
    sourcePage: null,
    sourceRelation: "CONTEXT",
    eventDate: { precision: "EXACT", start: "2026-11-18", end: null, text: "2026年11月18日" },
  },
};
const factResult = await put(fact);
assert.equal((await put(fact)).id, factResult.id);
const factRows = async (matter) => (await get(matter, "evidence-items")).items;
const item = (await factRows(a.id)).find((r) => r.id === factResult.id);
assert(item);
assert.equal(item.kind, "FACT");
const link = {
  action: "link-evidence",
  matterId: a.id,
  data: {
    evidenceItemId: item.id,
    expectedRevision: item.revision,
    documentId: evidence.id,
    relation: "SUPPORTS",
    page: null,
  },
};
await put({ ...link, matterId: b.id }, 403);
const linked = await put(link);
assert(linked.revision > item.revision);
await put(link, 403);
const revision = {
  action: "revise-evidence",
  matterId: a.id,
  data: {
    evidenceItemId: item.id,
    expectedRevision: linked.revision,
    title: "补核交付日期",
    content: "记录已对照",
    kind: "FACT",
  },
};
await put(revision);
let current = (await factRows(a.id)).find((r) => r.id === item.id);
assert.equal(current.eventDate.start, "2026-11-18");
assert.equal(current.sources.length, 1);
await put({
  action: "unlink-evidence",
  matterId: a.id,
  data: { evidenceItemId: item.id, expectedRevision: current.revision, sourceId: linked.sourceId },
});
current = (await factRows(a.id)).find((r) => r.id === item.id);
assert.equal(current.sources.length, 0);
assert(!(await factRows(b.id)).some((r) => r.id === item.id));
console.log(
  "PASS evidence creation/replay, exact calendar date, fixed-source link, stale revision and wrong matter refusal, revised text, withdrawal",
);
console.log(
  "PASS A/B frozen delivery, unapproved draft rejection, pre-send receipt rejection, extracted ZIP exact source bytes, actual send replay, receipt and append-only correction with proof",
);
const overview = await get(a.id, "overview");
assert.equal(overview.title, a.title);
assert.ok(overview.brief);
for (const section of [
  "overview",
  "materials",
  "research",
  "tasks",
  "records",
  "delivery",
  "finance",
  "seal",
])
  await get(b.id, section);
console.log("PASS eight matter workspace projections on another matter");
