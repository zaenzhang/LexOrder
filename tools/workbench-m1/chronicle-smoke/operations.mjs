import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";

const {
  cases: [a, b],
  request,
} = await fixture();
const api = async (suffix, body, status) =>
  (await request("/api/personal/practice-operations" + suffix, body, status)).json();
const code = randomUUID();
const e = await api("", {
  action: "express",
  matterId: a.id,
  trackingNo: "LEX-TEST-" + code.slice(0, 8),
  purpose: "交付测试材料",
  direction: "OUTBOUND",
  recipient: "合成客户",
});
const read = (m, s) => api("?matter=" + m.id + "&section=" + s);
assert((await read(a, "express")).items.find((row) => row.id === e.id));
assert(!(await read(b, "express")).items.find((row) => row.id === e.id));
await api("", { action: "track", matterId: b.id, id: e.id }, 409);
const p = await api("", {
  action: "preserve",
  matterId: a.id,
  type: "LITIGATION",
  court: "测试法院",
  rulingNumber: code,
  firstTarget: "合成被保全人",
  firstPropertyType: "VEHICLE",
  firstAmount: 1000,
  firstStartDate: "2026-01-01T00:00:00+08:00",
  firstExpiryDate: "2027-01-01T00:00:00+08:00",
  firstDuration: 365,
});
const found = (await read(a, "preservation")).items.find((row) => row.rulingNumber === code);
assert(found);
const prop = found.targets[0].properties[0];
const renew = {
  action: "renew",
  propertyId: prop.id,
  newExpiryDate: "2027-03-01T00:00:00+08:00",
  renewalDuration: 59,
  note: "续期凭据已核",
};
await api("", { ...renew, matterId: b.id }, 409);
await api("", { ...renew, matterId: a.id });
const renewed = (await read(a, "preservation")).items.find((row) => row.id === found.id).targets[0]
  .properties[0];
assert.equal(renewed.renewals[0].note, "续期凭据已核");
const initial = await read(a, "closure");
assert(initial.blockers.some((s) => s.includes("保全")));
const close = {
  action: "closure",
  matterId: a.id,
  personalFinance: true,
  revision: initial.plan?.revision ?? null,
  reason: "合成服务结束后待处理保全与账款",
  serviceCompletedAt: "2025-01-01T00:00:00+08:00",
};
await api("", close);
const updated = await read(a, "closure");
assert.equal(updated.plan.reason, close.reason);
assert.equal(updated.plan.personalFinance, true);
await api("", close, 409);
console.log(
  "PASS express register + same-case readback, cross-case rejected; preservation target/property + renewal and history; archive blockers, personal closure plan persisted, stale revision rejected",
);
