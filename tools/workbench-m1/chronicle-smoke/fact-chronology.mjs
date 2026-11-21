// Runs on disposable Personal cases, using the actual files from the reference skill.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.mjs";
import { prepareObservation } from "../../../src/server/evidence/observation-contract.ts";

const [sourceSkill, generatedBase] = process.argv.slice(2);
assert(sourceSkill && generatedBase, "Provide the V8 skill directory and an independently generated .base.json.");
const base = JSON.parse(await readFile(generatedBase, "utf8"));
assert.equal(base.schema, "v8-base/1");
assert.equal(base.materials.length, 4);
assert.equal(base.facts.length, 7);
assert.equal(base.facts.flatMap(fact => fact.recs).length, 9);
const transfer = base.facts.find(fact => fact.id === "F02");
assert.deepEqual(transfer?.recs.map(entry => [entry.d, entry.s, entry.amt]), [
  ["L-02", "2023-03-03", 480000],
  ["L-03", "2023-03-01", 500000],
  ["L-04", "2023-03-03", 480000],
]);

const { workspace, cases: [matter, foreign], request } = await fixture();
const endpoint = "/api/personal/matter-workspace";
const post = async (body, expected) => (await request(endpoint, body, expected)).json();
const get = async (section, query, expected) => (await request(endpoint + "?" + new URLSearchParams({
  matter: matter.id, section, ...query,
}), undefined, expected)).json();
const folder = await (await request("/api/personal/matter-folder?matter=" + matter.id)).json();
if (folder.path) assert(folder.available);
else {
  const root = path.join(path.dirname(workspace), path.basename(workspace) + "-casebook");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await request("/api/personal/matter-folder", { matterId: matter.id, action: "bind", root });
}
const tag = randomUUID().slice(0, 8);
const files = new Map([
  ["L-01", "1-iou.txt"], ["L-02", "4-bank-receipt.txt"],
  ["L-03", "2-complaint.txt"], ["L-04", "3-defence.txt"],
]);
const documents = new Map();
const compoundTag = "涉外,已译 " + tag;
for (const material of base.materials) {
  const filename = files.get(material.id);
  assert(filename, material.id);
  const contents = await readFile(path.join(sourceSkill, "examples", "demo", "materials", filename));
  const name = material.name + " · V8 " + tag + ".txt";
  const form = new FormData();
  const category = material.kind === "statement" ? "PLEADING" : "EVIDENCE";
  const tags = [...(material.tags ?? []), ...(material.id === "L-02" ? [compoundTag] : [])];
  for (const [key, value] of Object.entries({ name, category, matterId: matter.id, requestKey: randomUUID() })) form.set(key, value);
  if (material.side) form.set("sourceParty", material.side);
  for (const label of tags) form.append("tags", label);
  if (tags.length) form.append("tags", " " + tags[0] + " ");
  form.set("file", new File([contents], name, { type: "text/plain" }));
  await request(endpoint, form);
  const matches = (await get("materials", { q: name })).documents;
  assert.equal(matches.length, 1, name);
  const [saved] = matches;
  assert.equal(saved.category, category);
  assert.equal(saved.sourceParty, material.side ?? null);
  assert.deepEqual(saved.tags, tags.sort());
  assert(!("textContent" in saved) && !("path" in saved));
  documents.set(material.id, saved.id);
}

const tagged = await get("materials", { tag: compoundTag, category: "EVIDENCE" });
assert.deepEqual(tagged.documents.map(row => row.id), [documents.get("L-02")]);
assert.deepEqual((await get("materials", { tag: compoundTag, category: "PLEADING" })).documents, []);
assert.deepEqual((await get("materials", { tag: "涉外" })).documents, []);
const foreignTags = await request(endpoint + "?" + new URLSearchParams({ section: "materials", matter: foreign.id, tag: compoundTag }));
assert.deepEqual((await foreignTags.json()).documents, []);
for (const invalid of ["AI审查", "阶段：举证", " ", "长".repeat(101)]) {
  const form = new FormData();
  form.set("matterId", matter.id);
  form.set("name", "无效标签 " + tag);
  form.set("category", "OTHER");
  form.set("requestKey", randomUUID());
  form.set("file", new File(["只用于验证拒绝。"], "invalid-tag.txt", { type: "text/plain" }));
  form.append("tags", invalid);
  await request(endpoint, form, 400);
}
assert.deepEqual((await get("materials", { q: "无效标签 " + tag })).documents, []);

const selected = Array.from(documents.values(), documentId => ({ documentId }));
let coverage;
const expires = Date.now() + 45_000;
for (;;) {
  coverage = await post({ action: "preview-skill-input", data: { matterId: matter.id, documents: selected } });
  assert.deepEqual(coverage.modelSupply, { status: "NOT_SENT", sentChars: 0 });
  if (coverage.items.every(item => item.processing?.state === "READY")) break;
  assert(Date.now() < expires, "Timed out waiting for all four reference materials");
  await delay(500);
}
assert.equal(coverage.items.length, 4);
for (const item of coverage.items) assert(item.run?.id && item.preparation.ranges.length);
const { id: evidenceItemId } = await post({
  action: "create-evidence",
  data: { matterId: matter.id, title: transfer.title + " · V8 " + tag, content: "核对回单与双方关于实际交付的记载。",
    requestKey: randomUUID(), kind: "FACT", sourceDocumentId: null, sourcePage: null, sourceRelation: "CONTEXT" },
});
let revision = 1;
const links = [];
const normalized = [];
const savedIds = [];
let firstObservation;
let firstRequest;
const transferAmounts = new Map([["L-02", "480,000.00"], ["L-03", "50 万元"], ["L-04", "48万元"]]);
function quotedSpan(anchor, quotation, from = 0) {
  const start = anchor.indexOf(quotation, from);
  assert(start >= from, quotation);
  return { start, end: start + quotation.length };
}
const openSource = async (sourceId, seenRevision, caseId = matter.id, status = 200) => (
  await request("/api/personal/evidence-review", {
    action: "open-evidence-source", matterId: caseId, evidenceItemId, sourceId, revision: seenRevision,
  }, status)
).json();
for (const entry of transfer.recs) {
  const documentId = documents.get(entry.d);
  const input = coverage.items.find(item => item.documentId === documentId);
  assert(input, entry.d);
  const result = await post({ action: "link-evidence", matterId: matter.id, data: {
    evidenceItemId, expectedRevision: revision, documentId, relation: entry.d === "L-02" ? "SUPPORTS" : "CONTEXT",
    parseRunId: input.run.id, anchorId: input.preparation.ranges[0].anchorId,
  } });
  revision = result.revision;
  const source = await openSource(result.sourceId, revision);
  assert.equal(source.status, "AVAILABLE");
  assert.equal(source.documentVersion, 1);
  assert(source.text?.includes(entry.q), entry.d + " · reference quotation from the actual parsed original");
  const quoteStart = source.text.indexOf(entry.q);
  const isBankRecord = entry.d === "L-02";
  const bankUnit = isBankRecord ? { unitSpan: quotedSpan(source.text, "金额（元）") } : {};
  const names = isBankRecord ? ["张三", "李四"].map(name => ({ span: quotedSpan(source.text, name) })) : [];
  const payment = isBankRecord ? {
    participants: names,
    relations: [{ kind: "PAYS_TO", from: 1, to: 2, span: { start: names[0].span.start, end: names[1].span.end } }],
  } : {};
  const inputFields = {
    ...payment,
    statement: isBankRecord ? "RECORD" : "PARTY_STATEMENT",
    date: { role: "OCCURRENCE", span: quotedSpan(source.text, entry.raw, quoteStart) },
    amount: { nature: "ACTUAL_TRANSFER", span: quotedSpan(source.text, transferAmounts.get(entry.d), quoteStart), ...bankUnit },
  };
  const resultFields = prepareObservation(inputFields, source.text);
  assert.deepEqual(resultFields.date.value, { precision: "EXACT", day: entry.s }, entry.d);
  assert.deepEqual(resultFields.amount.value, { currency: "CNY", value: String(entry.amt) }, entry.d);
  assert.throws(() => prepareObservation({
    ...inputFields, amount: { ...inputFields.amount, suggested: { currency: "CNY", value: "999000" } },
  }, source.text), /金额或币种/);
  assert.throws(() => prepareObservation({
    ...inputFields, date: { ...inputFields.date, suggested: { precision: "EXACT", day: "2023-03-30" } },
  }, source.text), /候选日期/);
  const record = (observation, overrides = {}) => ({
    action: "record-evidence-observation", matterId: matter.id, data: {
      evidenceItemId, expectedRevision: revision, sourceId: result.sourceId, requestKey: randomUUID(), observation,
      ...overrides,
    },
  });
  await post(record({ ...inputFields, amount: { ...inputFields.amount, suggested: { currency: "CNY", value: "999000" } } }), 403);
  await post(record({ ...inputFields, date: { ...inputFields.date, suggested: { precision: "EXACT", day: "2023-03-30" } } }), 403);
  if (isBankRecord) {
    await post(record({ ...inputFields, relations: [{ ...payment.relations[0], from: 2, to: 1 }] }), 403);
    firstRequest = record({ statement: inputFields.statement, amount: inputFields.amount });
    firstObservation = await post(firstRequest);
    revision = firstObservation.revision;
    assert.deepEqual(await post(firstRequest), firstObservation);
    await post(record(inputFields, { expectedRevision: revision - 1 }), 403);
  }
  const real = record(inputFields, isBankRecord ? { supersedesId: firstObservation.observationId } : {});
  await post({ ...real, matterId: foreign.id }, 403);
  const saved = await post(real);
  revision = saved.revision;
  savedIds.push(saved.observationId);
  normalized.push({ material: entry.d, statement: resultFields.statement, date: resultFields.date.value.day, amountCny: resultFields.amount.value.value });
  links.push(result.sourceId);
}
const evidence = (await get("evidence-items")).items.find(item => item.id === evidenceItemId);
assert.deepEqual(new Set(evidence.sources.map(it => it.id)), new Set(links));
assert.deepEqual(evidence.observations.map(item => item.id), savedIds);
assert.deepEqual(evidence.observations.map(item => [item.data.date.value.day, item.data.amount.value.value]),
  normalized.map(item => [item.date, item.amountCny]));
assert.equal(evidence.observations[0].revision, 2);
assert.deepEqual(evidence.observations[0].data.participants.map(person => person.text), ["张三", "李四"]);
const [payment] = evidence.observations[0].data.relations;
assert.deepEqual([payment.kind, payment.from, payment.to, payment.text], ["PAYS_TO", 1, 2, "张三 ｜ 李四"]);
const historical = (await get("evidence-items", { history: evidenceItemId })).items.find(item => item.revision === firstObservation.revision);
assert.deepEqual(historical.observations.map(item => item.id), [firstObservation.observationId]);
assert.equal(historical.observations[0].data.date, undefined);
assert.equal(historical.observations[0].data.participants, undefined);
assert(historical.observations[0].data.amount);
const old = await openSource(links[0], firstObservation.revision);
assert.equal(old.status, "AVAILABLE");
assert(old.text.includes(transfer.recs[0].q));
assert.deepEqual(await openSource(links.at(-1), firstObservation.revision), { status: "UNAVAILABLE" });
await openSource(links[0], revision, foreign.id, 403);
assert.deepEqual(await post(firstRequest), firstObservation);
await post({ ...firstRequest, data: { ...firstRequest.data,
  observation: { ...firstRequest.data.observation, statement: "PARTY_STATEMENT" } } }, 403);

const complaint = await openSource(links[1], revision);
const relief = "借款本金 50 万元";
const alternative = await post({ action: "record-evidence-observation", matterId: matter.id, data: {
  evidenceItemId, expectedRevision: revision, sourceId: links[1], requestKey: randomUUID(),
  observation: { statement: "PARTY_STATEMENT", amount: {
    nature: "CLAIMED_RELIEF", span: quotedSpan(complaint.text, "50 万元", complaint.text.indexOf(relief)),
  } },
} });
revision = alternative.revision;
const multi = (await get("evidence-items")).items.find(item => item.id === evidenceItemId);
assert.deepEqual(multi.observations.filter(item => item.sourceId === links[1]).map(item => item.data.amount.nature),
  ["ACTUAL_TRANSFER", "CLAIMED_RELIEF"]);
await post({ action: "record-evidence-observation", matterId: matter.id, data: {
  ...firstRequest.data, expectedRevision: revision, requestKey: randomUUID(), supersedesId: firstObservation.observationId,
} }, 403);
const removed = await post({ action: "unlink-evidence", matterId: matter.id, data: { evidenceItemId, expectedRevision: revision, sourceId: links[1] } });
const now = (await get("evidence-items")).items.find(item => item.id === evidenceItemId);
assert.deepEqual(now.observations.map(item => item.sourceId), [links[0], links[2]]);
assert.deepEqual(await openSource(links[1], removed.revision), { status: "UNAVAILABLE" });
const beforeUnlink = (await get("evidence-items", { history: evidenceItemId })).items.find(item => item.revision === revision);
assert.equal(beforeUnlink.observations.filter(item => item.sourceId === links[1]).length, 2);
assert.equal((await openSource(links[1], revision)).status, "AVAILABLE");
console.log(JSON.stringify({
  matterId: matter.id, evidenceItemId, revision, skillMaterials: documents.size, matchedTransferQuotes: links.length,
  normalized,
  checks: ["directory tags and categories", "compound tag and scope", "invalid tag refusal", "fixed version", "historical revision", "cross-case refusal", "independently verified date and amount", "wrong-value rejection", "fixed participant and payment direction", "idempotent record", "immutable field revision", "multiple observations per source", "unlink preserves history", "no model calls"],
}));
