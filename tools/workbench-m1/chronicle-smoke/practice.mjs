import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const { request } = await fixture();
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
