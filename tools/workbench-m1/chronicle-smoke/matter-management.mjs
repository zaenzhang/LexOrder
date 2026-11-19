import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
const {
  cases: [a, b],
  request,
} = await fixture();
const path = "/api/personal/matter-workspace";
const get = async (matter, section, extra = {}) =>
  (await request(path + "?" + new URLSearchParams({ matter, section, ...extra }))).json();
const put = async (data, status) => (await request(path, data, status)).json();
const tag = randomUUID().slice(0, 8);
const more = (action, data, matterId, status) => put({ action, data, matterId }, status);
const folder = async (matter) => {
  const res = await request("/api/personal/matter-folder?matter=" + matter);
  assert.equal(res.status, 200);
  return res.json();
};
const A = await get(a.id, "overview"),
  B = await get(b.id, "overview");
assert(
  !/\s/.test(A.title),
  "Reseed the two synthetic acceptance cases with unspaced names before testing rename/restore",
);
assert(A.editor);
assert(B.editor);
const base = {
  id: a.id,
  title: A.title,
  causeId: A.editor.causeId ?? "",
  causeFreeText: A.editor.causeFreeText ?? "",
  claimAmount: A.editor.claimAmount ?? null,
  ourStanding: A.editor.ourStanding ?? null,
};
const before = await folder(a.id),
  docs = await get(a.id, "materials");
assert(before.available);
assert(docs.documents.length > 0);
const rename = { ...base, expectedUpdatedAt: A.editor.updatedAt, title: "临时测试" + tag };
await more("edit-matter", rename);
try {
  const after = await get(a.id, "overview");
  assert.equal(after.title, rename.title);
  assert.equal(after.internalCode, A.internalCode);
  assert.equal((await folder(a.id)).path, before.path);
  assert((await get(a.id, "materials")).documents.some((row) => row.id === docs.documents[0].id));
  assert.equal((await get(b.id, "overview")).title, B.title);
  await more("edit-matter", rename, undefined, 403);
  await more(
    "edit-matter",
    { id: a.id, title: "未审核字段", expectedUpdatedAt: after.editor.updatedAt },
    undefined,
    400,
  );
} finally {
  const fresh = await get(a.id, "overview");
  await more("edit-matter", { ...base, expectedUpdatedAt: fresh.editor.updatedAt });
}
assert.equal((await get(a.id, "overview")).title, A.title);
console.log(
  "PASS case rename/reopen, stable internal number, bound physical path, retained material ID, stale write and omitted-field refusal, B unchanged and A restored",
);
const info = {
  matterId: a.id,
  type: "CUSTOM",
  customLabel: "庭前程序" + tag,
  caseNumber: "演示" + tag,
  engagement: "INFORMATIONAL",
  handlingAgency: "",
};
const { id: procedureId } = await more("add-procedure", info);
const procs = async (matter) => (await get(matter, "tasks")).schedule.procedures;
const proc = (await procs(a.id)).find((x) => x.id === procedureId);
assert(proc);
assert(!(await procs(b.id)).some((x) => x.id === procedureId));
const change = {
  id: procedureId,
  expectedUpdatedAt: proc.updatedAt,
  customLabel: "文书核对" + tag,
  changeReason: "更正程序名称",
};
await more("edit-procedure", change, b.id, 403);
await more("edit-procedure", change, a.id);
await more("edit-procedure", change, a.id, 403);
await more("add-stage", { procedureId, name: "材料交接" + tag }, b.id, 403);
await more("add-stage", { procedureId, name: "材料交接" + tag }, a.id);
await more(
  "add-hearing",
  { procedureId, title: "合成庭期" + tag, startsAt: "2026-12-23T09:30:00+08:00", address: "演示地点" },
  a.id,
);
await more(
  "add-deadline",
  { procedureId, title: "合成期限" + tag, duePrecision: "DATE", dueAt: "2026-12-20", remindDays: 2 },
  a.id,
);
const revised = (await procs(a.id)).find((x) => x.id === procedureId);
assert.equal(revised.customLabel, change.customLabel);
assert(revised.stages.some((s) => s.name === "材料交接" + tag));
assert(
  revised.hearings.some((s) => s.title === "合成庭期" + tag && s.startsAt === "2026-12-23T01:30:00.000Z"),
);
assert(revised.deadlines.some((s) => s.title === "合成期限" + tag && s.dueLabel === "2026-12-20"));
console.log(
  "PASS procedure create/edit, stale and cross-case refusal, stage creation, civil-date deadline and UTC+8 hearing",
);
const content = {
  matterId: a.id,
  requestKey: randomUUID(),
  kind: "GOAL",
  visibility: "MATTER",
  content: "目标" + tag,
  occurredAt: new Date().toISOString(),
  sourceDescription: "客户合成面谈",
  sourceDocumentId: docs.documents[0].id,
  contextInputs: [],
};
const prior = await more("save-context", content);
assert.equal(prior.version, 1);
assert.equal((await more("save-context", content)).id, prior.id);
await more("save-context", { ...content, matterId: b.id, requestKey: randomUUID() }, undefined, 403);
const confirm = { matterId: a.id, id: prior.id, expectedVersion: 1, acknowledged: true };
await more("confirm-context", { ...confirm, matterId: b.id }, undefined, 403);
await more("confirm-context", confirm);
assert((await more("confirm-context", confirm)).replayed);
const choices = await get(a.id, "context", { inputs: "1" });
const choice = choices.choices.find((c) => c.selection.recordId === prior.id);
assert(choice.selection.expectedConfirmedAt);
const plan = {
  ...content,
  requestKey: randomUUID(),
  kind: "OPTION",
  content: "方案" + tag,
  contextInputs: [choice.selection],
};
const option = await more("save-context", plan);
const update = { ...content, requestKey: randomUUID(), supersedesId: prior.id, content: "修订目标" + tag };
const next = await more("save-context", update);
assert.equal(next.version, 2);
await more("save-context", { ...update, requestKey: randomUUID() }, undefined, 403);
await more("confirm-context", confirm, undefined, 403);
const records = (await get(a.id, "context")).records;
assert(!records.some((r) => r.id === prior.id));
assert(records.some((r) => r.id === next.id && r.confirmationStatus === "PENDING"));
const locked = records.find((r) => r.id === option.id).contextInputs.inputs[0];
assert.equal(locked.selection.recordId, prior.id);
assert(locked.changed);
await more("save-context", { ...plan, supersedesId: option.id, requestKey: randomUUID() }, undefined, 403);
const options = await get(a.id, "context", { inputs: "1" });
const newer = options.choices.find((c) => c.selection.recordId === next.id);
const amend = {
  ...plan,
  supersedesId: option.id,
  requestKey: randomUUID(),
  contextInputs: [newer.selection],
  content: "方案采用新目标" + tag,
};
assert.equal((await more("save-context", amend)).version, 2);
const history = await get(a.id, "context", { history: next.id });
assert.deepEqual(
  history.records.map((r) => r.version),
  [2, 1],
);
assert.equal(history.records[1].content, content.content);
assert.equal(history.records[1].source.id, content.sourceDocumentId);
assert(!(await get(b.id, "context")).records.some((r) => r.id === next.id));
await request(
  path + "?" + new URLSearchParams({ matter: b.id, section: "context", history: next.id }),
  null,
  403,
);
console.log(
  "PASS context source binding, real adoption, checks and replay, revision history, stale adoption and confirmation refusal, plan re-adoption and cross-case isolation",
);
