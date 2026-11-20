import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const { request, cases: [calendarMatter] } = await fixture();
const endpoint = "/api/personal/practice";
const send = async (body, status) =>
  (await request(endpoint, body, status)).json();
const read = async (view, params = {}) =>
  (
    await request(endpoint + "?" + new URLSearchParams({ view, ...params }))
  ).json();
const tag = randomUUID().slice(0, 8);
const client = await send({
  action: "create-client",
  input: { name: "合成客户" + tag, type: "COMPANY" },
});
await send({
  action: "client-contact",
  id: client.id,
  input: { name: "收件联系人", phone: "01000000000" },
});
await send({
  action: "create-contact",
  category: "COURT",
  name: "合成外部联系人" + tag,
  phone: "",
  organization: "测试机构",
});
assert.equal((await read("contacts", { q: tag })).length, 1);
const activity = {
  action: "client-activity",
  input: {
    clientId: client.id,
    requestKey: randomUUID(),
    channel: "PHONE",
    content: "合成事项确认",
    occurredAt: new Date().toISOString(),
    nextFollowUp: {
      title: "回访" + tag,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    },
  },
};
await send(activity);
await send(activity);
const detail = await read("client", { id: client.id });
assert.equal(detail.contacts.length, 1);
assert.equal(detail.relationship.activities.length, 1);
assert.equal(detail.relationship.followUps.length, 1);

const { id } = await send({
  action: "create-intake",
  input: {
    title: "合成非诉" + tag,
    category: "NON_LITIGATION",
    clientId: client.id,
    description: "委托方合同核查",
  },
});
const first = await read("intake-edit", { id });
const revision = {
  action: "revise-intake",
  id,
  title: "更新收案" + tag,
  description: "补正案情",
  revision: first.revision,
};
await send(revision);
await send(revision, 409);
assert.equal((await read("intake", { id })).title, revision.title);
async function checkAndSubmit() {
  await send({ action: "check-intake", id });
  const { check } = await read("intake", { id });
  await send({
    action: "decide-conflict",
    id: check.id,
    conclusion: "DIFFERENT",
    note: "合成当事人已人工核对",
  });
  await send({ action: "submit-intake", id });
}
await checkAndSubmit();
await send({ action: "withdraw-intake", id, reason: "申请人补充案情" });
const withdrawn = await read("intake-edit", { id });
await send({
  ...revision,
  revision: withdrawn.revision,
  description: "补齐后重提",
});
await checkAndSubmit();
const converted = await send({ action: "convert-intake", id });
assert.equal((await read("intake", { id })).matter.id, converted.matterId);
for (const view of [
  "today",
  "schedule",
  "follow-ups",
  "notifications",
  "workspace",
])
  await read(view);
console.log(
  "PASS client, contacts, follow-up replay, intake correction and stale revision, withdrawal, recheck and conversion",
);

const { day } = await read("today");
const offsetDay = (start, offset) =>
  new Date(Date.parse(start + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const due = offsetDay(day, 2);
const hearingDay = offsetDay(day, 3);
const casesApi = "/api/personal/matter-workspace";
const writeMatter = async (action, data) => (await request(casesApi, { action, matterId: calendarMatter.id, data })).json();
const program = await writeMatter("add-procedure", { matterId: calendarMatter.id,
  type: "CUSTOM", customLabel: "日程合成验收 " + tag, engagement: "ENGAGED" });
const hearing = await writeMatter("add-hearing", { procedureId: program.id, title: "法院开庭演练 " + tag,
  startsAt: hearingDay + "T09:30:00+08:00", address: "第一法庭（合成）" });
const deadline = await writeMatter("add-deadline", { requestKey: randomUUID(), procedureId: program.id,
  title: "举证期限演练 " + tag, duePrecision: "DATE", dueAt: due, remindDays: 2 });
const pending = await writeMatter("add-deadline", { requestKey: randomUUID(), procedureId: program.id,
  title: "规则候选期限 " + tag, duePrecision: "DATE", dueAt: due, sourceRuleId: "synthetic-rule-" + tag, remindDays: 2 });
const stage = await writeMatter("add-stage", { procedureId: program.id, name: "材料核对" });
const task = await (await request(casesApi, { action: "create-task", matterId: calendarMatter.id, title: "核对庭前材料演练 " + tag,
  stageId: stage.id, description: "", dueAt: due + "T13:00:00+08:00", priority: 0, requestKey: randomUUID() })).json();
const rawText = "【合成法院】开庭通知，演练编号 " + tag + "，请人工核对。";
const courtInbox = "/api/personal/court-inbox";
await request(courtInbox, { action: "paste", rawText, batch: false });
const inbox = (await (await request(courtInbox + "?state=unprocessed")).json()).items.find(item => item.text === rawText);
assert(inbox, "court notice persists");
const today = await read("today");
assert(today.courtInbox.some(item => item.id === inbox.id && String(item.title).endsWith("待处理")));
assert(!today.courtInbox.some(item => "rawText" in item || "text" in item));
const visibleCourtDates = await Promise.all([...new Set([due.slice(0, 7), hearingDay.slice(0, 7)])]
  .map(month => read("schedule", { month, grid: "1" }))).then(pages => pages.flatMap(page => page.items));
for (const [prefix, source, date, time] of [["h-", hearing, hearingDay, "09:30"], ["d-", deadline, due, null]]) {
  const event = visibleCourtDates.find(item => item.id === prefix + source.id);
  assert(event);
  assert.equal(event.day, date);
  assert.equal(event.clock, time);
  assert.equal(event.href, "/matters/" + calendarMatter.id + "/tasks?program=" + program.id);
}
assert(today.courtDates.every(item => (item.type === "hearing" || item.type === "deadline") && item.id !== "d-" + pending.id));
assert(!visibleCourtDates.some(item => item.id === "d-" + pending.id));
const taskHref = visibleCourtDates.find(item => item.id === "t-" + task.id)?.href;
assert.equal(taskHref, "/matters/" + calendarMatter.id + "/materials?task=" + task.id + "&from=schedule&day=" + due + "&stage=" + stage.id);

const appointment = { action: "create-calendar-entry", requestKey: randomUUID(),
  title: "工作安排 " + tag, day: "2030-05-01", startMinute: null, endMinute: null };
await send({ ...appointment, startMinute: 600, endMinute: 599 }, 400);
await send({ ...appointment, startMinute: 600 }, 400);
await send({ ...appointment, day: "2030-02-29" }, 400);
await send({ ...appointment, title: " " }, 400);
const [saved, replay] = await Promise.all([send(appointment), send(appointment)]);
assert.equal(saved.id, replay.id);
await send({ ...appointment, title: "同提交键但不同标题" }, 409);
const adjacent = await send({ ...appointment, requestKey: randomUUID(), day: "2030-04-30", startMinute: 5, endMinute: 10 });
const may = (await read("schedule", { month: "2030-05" })).items;
assert.equal(may.filter(item => item.id === saved.id && item.clock === null && item.matter === null).length, 1);
assert(!may.some(item => item.id === adjacent.id));
const grid = (await read("schedule", { month: "2030-05", grid: "1" })).items;
assert(grid.some(item => item.id === adjacent.id && item.clock === "00:05" && item.end === "00:10"));
assert(!(await read("today")).courtDates.some(item => item.id === saved.id));
console.log("PASS formal dates and excluded candidates, court inbox, dated task deep link, Beijing month edges, timed vs all-day, invalid input and concurrent replay");
