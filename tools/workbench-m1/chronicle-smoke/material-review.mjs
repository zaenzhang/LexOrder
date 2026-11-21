import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import path from "node:path";
import { fixture } from "./fixture.mjs";

const { workspace, cases: [a, b], request } = await fixture();
const root = path.join(path.dirname(workspace), path.basename(workspace) + "-casebook");
await mkdir(root, { recursive: true, mode: 0o700 });
for (const matter of [a, b]) {
  const result = await request("/api/personal/matter-folder?matter=" + matter.id);
  const state = await result.json();
  if (!state.path) await request("/api/personal/matter-folder", { matterId: matter.id, action: "bind", root });
  else assert(state.available);
}
const endpoint = "/api/personal/matter-workspace";
const listQuery = "?" + new URLSearchParams({ section: "materials", matter: a.id });
if (process.env.M1_CHRONICLE_ORIGIN) {
  const url = new URL("/api/personal/matter-workspace" + listQuery, process.env.M1_CHRONICLE_ORIGIN);
  for (const headers of [{}, { Cookie: "lexorder_local_channel=" + "0".repeat(64) }]) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /会话未连接/);
  }
  const crossOrigin = await fetch(url, {
    headers: { "Sec-Fetch-Site": "cross-site" }, signal: AbortSignal.timeout(5000),
  });
  assert.equal(crossOrigin.status, 403);
}
const materialList = await (await request(endpoint + listQuery)).json();
assert(Array.isArray(materialList.documents));

const tag = randomUUID().slice(0, 8);
const scopedProgram = await (await request(endpoint, {
  action: "add-procedure", data: { matterId: a.id, type: "CUSTOM", customLabel: "保全核对 " + tag },
})).json();
const stage = await (await request(endpoint, {
  action: "add-stage", matterId: a.id, data: { procedureId: scopedProgram.id, name: "核对材料" },
})).json();
const tasks = await (await request(endpoint + "?section=tasks&matter=" + a.id)).json();
const procedure = tasks.schedule.procedures.find(row => row.id === scopedProgram.id);
assert(procedure);
assert.deepEqual(procedure.hearings, []);
assert.deepEqual(procedure.stages, [{ id: stage.id, name: "核对材料" }]);
const ids = [];
for (const [matter, label] of [[a, "采购合同"], [a, "交接清单"], [b, "乙案材料"]]) {
  const name = label + "-" + tag + ".txt";
  const form = new FormData();
  for (const [key, value] of Object.entries({ name, category: "EVIDENCE", matterId: matter.id, requestKey: randomUUID() })) form.set(key, value);
  form.set("file", new File([label + "：清点数量 12，性能待核。"], name, { type: "text/plain" }));
  if (label === "交接清单") {
    form.set("stageId", stage.id);
    form.set("procedureId", scopedProgram.id);
    form.set("sourceParty", "合成供货方");
    form.set("sourceOrigin", "TEAM_PRODUCED");
    form.append("tags", "交接材料");
    const wrongMatter = new FormData();
    for (const [key, value] of form) wrongMatter.set(key, value);
    wrongMatter.set("matterId", b.id);
    await request(endpoint, wrongMatter, 400);
  }
  await request(endpoint, form);
  const query = new URLSearchParams({ matter: matter.id, section: "materials", q: name });
  const data = await (await request(endpoint + "?" + query)).json();
  assert.equal(data.documents.length, 1);
  ids.push(data.documents[0].id);
}
const folder = (matter, stageId) => endpoint + "?" + new URLSearchParams({ section: "materials", matter, stage: stageId });
const scoped = await (await request(folder(a.id, stage.id))).json();
assert.deepEqual(scoped.documents.map(row => row.id), [ids[1]]);
assert.deepEqual(scoped.materialStage, { id: stage.id, name: "核对材料", procedureId: scopedProgram.id });
assert.equal(scoped.documents[0].stageId, stage.id);
assert.equal(scoped.documents[0].procedureId, scopedProgram.id);
assert.equal(scoped.documents[0].sourceParty, "合成供货方");
assert.deepEqual(scoped.documents[0].tags, ["交接材料"]);
const programQuery = new URLSearchParams({ section: "materials", matter: a.id, program: scopedProgram.id });
assert.deepEqual((await (await request(endpoint + "?" + programQuery)).json()).documents.map(row => row.id), [ids[1]]);
await request(folder(b.id, stage.id), undefined, 403);

const taskTitle = "交接清单复核 " + tag;
const task = await (await request(endpoint, {
  action: "create-task", matterId: a.id, title: taskTitle, description: "", priority: 0,
  stageId: stage.id, requestKey: randomUUID(),
})).json();
const taskMaterials = (overrides = {}) => endpoint + "?" + new URLSearchParams({
  section: "materials", matter: a.id, stage: stage.id, program: scopedProgram.id, task: task.id, ...overrides,
});
const taskScope = await (await request(taskMaterials())).json();
assert.equal(taskScope.materialTask.id, task.id);
assert.equal(taskScope.materialTask.title, taskTitle);
assert(Number.isInteger(taskScope.materialTask.reviewRevision));
assert.deepEqual(taskScope.documents.map(row => row.id), [ids[1]]);
const allForTask = new URLSearchParams({ section: "materials", matter: a.id, program: scopedProgram.id, task: task.id });
const programTaskScope = await (await request(endpoint + "?" + allForTask)).json();
assert.equal(programTaskScope.materialStage, null);
assert.deepEqual(programTaskScope.documents.map(row => row.id), [ids[1]]);

const otherProgram = await (await request(endpoint, {
  action: "add-procedure", data: { matterId: a.id, type: "CUSTOM", customLabel: "另一程序 " + tag },
})).json();
const otherStage = await (await request(endpoint, {
  action: "add-stage", matterId: a.id, data: { procedureId: scopedProgram.id, name: "另一环节 " + tag },
})).json();
await request(taskMaterials({ program: otherProgram.id }), undefined, 403);
await request(taskMaterials({ stage: otherStage.id }), undefined, 403);
await request(taskMaterials({ matter: b.id }), undefined, 403);

const pair = (first, second) => {
  const query = new URLSearchParams({ matter: a.id, section: "material-pair" });
  query.append("document", first);
  query.append("document", second);
  return endpoint + "?" + query;
};
const visible = await (await request(pair(ids[1], ids[0]))).json();
assert.deepEqual(visible.versions.map(row => row.id), [ids[1], ids[0]]);
assert.match(await (await request("/api/documents/" + ids[0] + "/download")).text(), /清点数量 12/);
await request(pair(ids[0], ids[2]), undefined, 403);
await request(pair(ids[0], ids[0]), undefined, 400);
const preview = (documents, status) => request(endpoint, {
  action: "preview-skill-input", data: { matterId: a.id, documents },
}, status);
const selected = [{ documentId: ids[0] }, { documentId: ids[2] }];
let coverage;
const deadline = Date.now() + 45_000;
do {
  coverage = await (await preview(selected)).json();
  if (coverage.items[0]?.processing?.state === "READY") break;
  await new Promise(resolve => setTimeout(resolve, 500));
} while (Date.now() < deadline);
assert.equal(coverage.items[0]?.processing?.state, "READY");
assert(coverage.items[0].preparation.preparedChars > 0);
assert.deepEqual(coverage.modelSupply, { status: "NOT_SENT", sentChars: 0 });
assert.equal(coverage.items[0].documentVersion, 1);
assert.equal(coverage.items[0].documentId, ids[0]);
assert.deepEqual(coverage.items[1], { status: "UNAVAILABLE", documentId: ids[2] });
await preview([{ documentId: ids[0] }, { documentId: ids[0] }], 400);

const reviewApi = (query = {}, matter = a.id) => endpoint + "?" + new URLSearchParams({
  section: "task-material-reviews", matter, task: task.id, ...query,
});
const pdf = await PDFDocument.create();
pdf.addPage().drawText("First-page source", { x: 72, y: 720 });
pdf.addPage().drawText("Second-page source", { x: 72, y: 720 });
const pdfName = "验收报告-" + tag + ".pdf";
const pdfUpload = new FormData();
for (const [key, value] of Object.entries({ name: pdfName, category: "EVIDENCE", matterId: a.id, requestKey: randomUUID() })) pdfUpload.set(key, value);
pdfUpload.set("file", new File([await pdf.save()], pdfName, { type: "application/pdf" }));
await request(endpoint, pdfUpload);
const pdfList = await (await request(endpoint + "?" + new URLSearchParams({ section: "materials", matter: a.id, q: pdfName }))).json();
assert.equal(pdfList.documents.length, 1);
const pdfId = pdfList.documents[0].id;
const optionsUrl = reviewApi() + "&document=" + pdfId + "&document=" + ids[1];
let options;
const readyUntil = Date.now() + 45_000;
do {
  options = await (await request(optionsUrl)).json();
  if (options[0]?.pdfPages === 2) break;
  await new Promise(resolve => setTimeout(resolve, 500));
} while (Date.now() < readyUntil);
assert.deepEqual(options.map(row => [row.id, row.pdfPages]), [[pdfId, 2], [ids[1], null]]);
await request(reviewApi() + "&document=" + ids[2], undefined, 403);
const note = {
  action: "save-task-material-review", matterId: a.id, taskId: task.id, taskRevision: taskScope.materialTask.reviewRevision,
  requestKey: randomUUID(), content: "第 2 页需与签收清单交叉核对，整体性能待补证。",
  sources: [{ documentId: pdfId, page: 2 }, { documentId: ids[1], page: null }],
};
const putReview = (override, code) => request(endpoint, { ...note, ...override }, code);
await putReview({ sources: [] }, 400);
await putReview({ sources: [note.sources[0], note.sources[0]] }, 400);
await putReview({ sources: [{ documentId: pdfId, page: 3 }] }, 403);
await putReview({ sources: [{ documentId: ids[1], page: 1 }] }, 403);
await putReview({ sources: [{ documentId: ids[2], page: null }] }, 403);
await putReview({ taskRevision: note.taskRevision + 1 }, 403);
await putReview({ content: "   " }, 400);
const [record, replay] = await Promise.all([putReview(), putReview()].map(async outcome => (await outcome).json()));
assert.equal(record.id, replay.id);
await putReview({ content: "旧提交标识不能覆盖原意见" }, 403);
const history = await (await request(reviewApi())).json();
assert.equal(history.items.length, 1);
assert.equal(history.items[0].id, record.id);
assert.equal(history.items[0].sourceCount, 2);
assert(!Object.hasOwn(history.items[0], "content"));
const detail = await (await request(reviewApi({ record: record.id }))).json();
assert.equal(detail.state, "AVAILABLE");
assert.equal(detail.content, note.content);
assert.deepEqual(detail.sources.map(row => [row.documentId, row.version, row.page]), [[pdfId, 1, 2], [ids[1], 1, null]]);
assert.match(detail.sources[0].previewUrl, /#page=2$/);
await request(reviewApi({ record: record.id }, b.id), undefined, 403);
const recordFeed = await (await request(endpoint + "?section=records&matter=" + a.id)).json();
assert.deepEqual(recordFeed.events.filter(row => row.taskReview?.id === record.id).map(row => row.taskReview), [{ taskId: task.id, id: record.id }]);
assert(!JSON.stringify(recordFeed).includes(note.content));
const currentTask = (await (await request(endpoint + "?section=tasks&matter=" + a.id)).json()).schedule.tasks.find(item => item.id === task.id);
assert.equal(currentTask.state, "OPEN");
assert.equal(currentTask.revision, note.taskRevision);
console.log("PASS task review saves exact PDF page and source versions, restores history, links the record feed, rejects invalid or stale inputs, and preserves task state");

const closedTaskTitle = "关闭后拒绝核对 " + tag;
const closedTask = await (await request(endpoint, {
  action: "create-task", matterId: a.id, title: closedTaskTitle, description: "", priority: 0, stageId: stage.id, requestKey: randomUUID(),
})).json();
const beforeClose = (await (await request(taskMaterials({ task: closedTask.id }))).json()).materialTask;
await request(endpoint, { action: "complete-task", matterId: a.id, id: closedTask.id, revision: beforeClose.reviewRevision });
const afterClose = (await (await request(taskMaterials({ task: closedTask.id }))).json()).materialTask;
assert.equal(afterClose.reviewRevision, null);
await putReview({ taskId: closedTask.id, taskRevision: beforeClose.reviewRevision, requestKey: randomUUID() }, 403);

for (const view of ["open", "waiting", "done"]) {
  const response = await request("/api/personal/practice?view=responsibilities&taskView=" + view);
  assert(Array.isArray((await response.json()).items));
}
console.log("PASS material session status and authorized read, scoped stage filing without an artificial hearing, program and task scope on material reads, exact material pair, immutable bytes, cross-case and duplicate refusal, input coverage without model dispatch, and all three Today views");

const revisionForm = new FormData();
revisionForm.set("matterId", a.id);
revisionForm.set("documentId", ids[1]);
revisionForm.set("requestKey", randomUUID());
revisionForm.set("file", new File(["交接清单修订：只做换版核对。"], "交接清单修订-" + tag + ".txt", { type: "text/plain" }));
const revised = await (await request("/api/personal/document-review", revisionForm)).json();
assert(revised.id && revised.id !== ids[1]);
const taggedProgram = endpoint + "?" + new URLSearchParams({ ...Object.fromEntries(programQuery), tag: "交接材料" });
const { documents: versions } = await (await request(taggedProgram)).json();
assert.deepEqual(versions.map(row => [row.id, row.version, row.isLatest]), [[revised.id, 2, true], [ids[1], 1, false]]);
for (const row of versions) {
  assert.equal(row.familyId, versions[0].familyId);
  assert.equal(row.category, "EVIDENCE");
  assert.equal(row.sourceOrigin, "TEAM_PRODUCED");
  assert.equal(row.sourceParty, "合成供货方");
  assert.equal(row.procedureId, scopedProgram.id);
  assert.equal(row.stageId, stage.id);
  assert.deepEqual(row.tags, ["交接材料"]);
}
assert.match(await (await request("/api/documents/" + ids[1] + "/download")).text(), /性能待核/);
console.log("PASS catalog preserves tags, source and placement across exact historical versions");
