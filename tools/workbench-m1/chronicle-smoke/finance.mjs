import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const {
  cases: [a, b],
  request,
} = await fixture();
const api = async (suffix, body, status) =>
  (await request("/api/personal/finance-desk" + suffix, body, status)).json();
const key = randomUUID(),
  form = {
    action: "receipt",
    matterId: a.id,
    amount: "123.45",
    moneyKind: "LAWYER_FEE",
    occurredAt: "2026-09-01T00:00:00+08:00",
    payerOrPayee: "合成回传验收",
    requestKey: key,
  };
await api("", form);
assert.equal((await api("", form)).id, key);
await api("", { ...form, amount: "1.00" }, 409);
const pending = (await api("")).pending.filter((p) => p.id === key);
assert.equal(pending.length, 1);
assert.equal(pending[0].actionable, true);
await api("", { action: "confirm", id: key, matterId: b.id }, 403);
await api("", { action: "confirm", id: key, matterId: a.id });
await api("", { action: "confirm", id: key, matterId: a.id }, 409);
assert.equal((await api("", form)).id, key);
let data = await api("?matter=" + a.id);
assert(!data.pending.find((p) => p.id === key));
assert(data.entries.some((p) => p.type === "RECEIVED" && p.amount === "123.45"));
const rej = { ...form, requestKey: randomUUID() };
await api("", rej);
await api("", { action: "reject", id: rej.requestKey, matterId: a.id, reason: "银行无此记录" });
await api("", rej, 409);
const exp = { ...form, action: "expense", moneyKind: "OTHER", amount: "56.78", requestKey: randomUUID() };
await api("", exp);
await api("", exp);
data = await api("?matter=" + a.id);
assert.equal(data.entries.filter((e) => e.id === exp.requestKey && e.type === "COST").length, 1);
console.log(
  "PASS original PG ledger: same-key replay incl. after confirmation, wrong case denied, single confirmed payment, rejection + removed entry replay denied, expense exact-once, case/global reread",
);
