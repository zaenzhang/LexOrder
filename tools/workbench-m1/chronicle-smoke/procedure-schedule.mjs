// Run against the disposable two-case Personal fixture, optionally through the Chronicle proxy.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { fixture } from "./fixture.mjs";

const { cases: [a, b], manifest, request } = await fixture();
const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname), "Set DATABASE_URL to this fixture's loopback database");
const store = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const registered = (await store.systemSetting.findUniqueOrThrow({ where: { key: "personal-workspace" } })).value;
assert.equal(registered.workspaceId, manifest.workspaceId);
assert.equal(registered.actorId, manifest.actorId);
const tag = randomUUID().slice(0, 8);
const casesApi = "/api/personal/matter-workspace";
const practice = "/api/personal/practice";
const query = async (url, body, status) => (await request(url, body, status)).json();
const write = (matter, body, status) => query(casesApi, { ...body, matterId: matter.id }, status);
const inside = async matter => (await query(casesApi + "?section=tasks&matter=" + matter.id)).schedule;
const monthly = async () => (await query(practice + "?view=schedule&month=2030-05")).items;
const board = async (closed = false) => (await query(practice + "?view=responsibilities&closed=" + Number(closed))).items;
const resolve = (task, outcome, overrides = {}, status = 200) => query(practice, {
  action: "resolve-schedule-task", taskId: task.id, matterId: task.matterId, revision: task.revision,
  reason: "合成验收 " + tag, outcome, ...overrides,
}, status);

async function procedure(matter) {
  const { id } = await write(matter, { action: "add-procedure", data: {
    matterId: matter.id, type: "CUSTOM", engagement: "ENGAGED", customLabel: "准备程序 " + tag,
  } });
  const stage = await write(matter, { action: "add-stage", data: { procedureId: id, name: "材料核对" } });
  return { id, stageId: stage.id };
}
const pa = await procedure(a);
const pb = await procedure(b);
const addDeadline = (matter, procedureId, precision, date, status, requestKey = randomUUID()) => write(matter, {
  action: "add-deadline", data: { requestKey, procedureId, title: "举证期限 " + tag, duePrecision: precision, dueAt: date, remindDays: 3 },
}, status);
const addTask = (matter, stageId, status) => write(matter, {
  action: "create-task", requestKey: randomUUID(), title: "核对材料 " + tag, description: "", stageId,
  dueAt: "2030-05-01T00:15:00+08:00", priority: 0,
}, status);
try {
  const key = randomUUID();
  const da = await addDeadline(a, pa.id, "DATE", "2030-05-01", 200, key);
  assert.equal((await addDeadline(a, pa.id, "DATE", "2030-05-01", 200, key)).id, da.id);
  await addDeadline(a, pa.id, "DATE", "2030-05-02", 403, key);
  const db = await addDeadline(b, pb.id, "DATETIME", "2030-05-01T00:15:00+08:00");
  const deadlineIn = async (matter, procedureId, id) =>
    (await inside(matter)).procedures.find(p => p.id === procedureId).deadlines.find(d => d.id === id);
  const deadlineA = await deadlineIn(a, pa.id, da.id);
  const deadlineB = await deadlineIn(b, pb.id, db.id);
  assert.equal(deadlineA.dueLabel, "2030-05-01");
  assert.equal(deadlineB.dueLabel, "2030-05-01 00:15");
  const storedDeadlines = () => store.deadline.findMany({
    where: { id: { in: [da.id, db.id] } }, orderBy: { id: "asc" },
  });
  const before = await storedDeadlines();
  assert.equal(before.find(d => d.id === da.id).dueAt.toISOString(), "2030-04-30T16:00:00.000Z");
  assert.equal(before.find(d => d.id === db.id).dueAt.toISOString(), "2030-04-30T16:15:00.000Z");
  const ta = await addTask(a, pa.stageId);
  const tb = await addTask(b, pb.stageId);
  await addTask(a, pb.stageId, 403);
  await addDeadline(b, pa.id, "DATE", "2030-05-01", 403);
  const taskIn = async (matter, id) => (await inside(matter)).tasks.find(t => t.id === id);
  assert.equal((await taskIn(a, ta.id)).stageId, pa.stageId);
  assert.equal((await taskIn(b, tb.id)).stageId, pb.stageId);
  assert.equal((await taskIn(a, ta.id)).dueAt, "2030-04-30T16:15:00.000Z");
  const intake = await store.intake.create({ data: { title: "合成未转案 " + tag, createdById: manifest.actorId } });
  const urgent = await store.intakeUrgentItem.create({ data: { intakeId: intake.id, title: "合成收案紧急期限",
    assigneeId: manifest.actorId, dueAt: new Date("2030-05-01T00:00:00+08:00"), kind: "DEADLINE" } });
  const month = await monthly();
  assert.equal(month.find(row => row.id === "u-" + urgent.id)?.href, "/practice/intakes/" + intake.id);
  assert.equal(month.find(row => row.id === "d-" + da.id)?.href, "/matters/" + a.id + "/tasks?program=" + pa.id);
  for (const [id, matter, when] of [
    ["d-" + da.id, a, deadlineA.dueLabel], ["d-" + db.id, b, deadlineB.dueLabel],
    ["t-" + ta.id, a, "2030-05-01 00:15"], ["t-" + tb.id, b, "2030-05-01 00:15"],
  ]) assert(month.some(row => row.id === id && row.matter.id === matter.id && row.when === when));
  console.log("PASS Shanghai month boundary, date and exact time, two real stages, same-case guards");

  const open = await board();
  const first = open.find(row => row.id === ta.id && row.matterId === a.id);
  const second = open.find(row => row.id === tb.id && row.matterId === b.id);
  assert(first?.canWrite && second?.canWrite);
  assert(!open.some(row => row.id === da.id || row.id === db.id));
  await resolve(first, "CANCEL", { matterId: b.id }, 409);
  await resolve(first, "CANCEL", { taskId: da.id }, 409);
  await resolve(first, "CANCEL", { reason: "  " }, 400);
  await resolve(first, "COMPLETE");
  await resolve(first, "CANCEL", {}, 409);
  assert.equal((await taskIn(a, ta.id)).state, "DONE");
  assert.equal((await taskIn(b, tb.id)).state, "OPEN");
  await resolve(second, "CANCEL");
  assert.equal((await taskIn(b, tb.id)).state, "CANCELLED");
  assert(!(await board()).some(row => row.id === ta.id || row.id === tb.id));
  const closed = await board(true);
  assert.equal(closed.find(row => row.id === ta.id).state, "DONE");
  const cancelled = closed.find(row => row.id === tb.id);
  assert.equal(cancelled.state, "CANCELLED");
  await resolve(cancelled, "REOPEN");
  assert.equal((await taskIn(b, tb.id)).state, "OPEN");
  assert.equal((await taskIn(b, tb.id)).stageId, pb.stageId);
  assert.deepEqual(await deadlineIn(a, pa.id, da.id), deadlineA);
  assert.deepEqual(await deadlineIn(b, pb.id, db.id), deadlineB);
  console.log("PASS distinct responsibility states, stale action, wrong case/object, explicit reopen, original deadlines intact");

  // The desktop metadata editor does not expose procedure transitions. Seed only the
  // terminal state of the procedure created above, inside the verified disposable workspace.
  const ended = await store.matterProcedure.updateMany({
    where: { id: pa.id, matterId: a.id, matter: { ownerId: manifest.actorId, internalCode: a.internalCode } },
    data: { status: "CONCLUDED", concludedAt: new Date(Date.now() - 86400000) },
  });
  assert.equal(ended.count, 1);
  const rejected = await addTask(a, pa.stageId, 403);
  assert.match(rejected.error, /程序已终结/);
  assert.match((await addDeadline(a, pa.id, "DATE", "2030-05-02", 403)).error, /程序已终结/);
  assert.match((await resolve(closed.find(row => row.id === ta.id), "REOPEN", {}, 409)).error, /程序已终结/);
  assert.deepEqual(await deadlineIn(a, pa.id, da.id), deadlineA);
  assert.equal((await taskIn(a, ta.id)).state, "DONE");
  console.log("PASS concluded procedure blocks new deadlines, stage tasks and reopening; historical records retained");
  assert.deepEqual(await storedDeadlines(), before);
} finally {
  await store.$disconnect();
}
