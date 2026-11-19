import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
const {
  cases: [a, b],
  request,
} = await fixture();
const base = "/api/personal/finance-desk";
const ledger = async () => (await request(base + "?matter=" + a.id)).json();
const post = async (body, status) => (await request(base, body, status)).json();
const draft = {
  action: "contract",
  input: {
    matterId: a.id,
    title: "合成分期合同 " + randomUUID(),
    moneyKind: "LAWYER_FEE",
    amount: "100.00",
    installments: [],
    draftRequestKey: randomUUID(),
  },
};
const { id } = await post(draft);
assert.equal((await post(draft)).id, id);
const sign = {
  action: "sign",
  matterId: a.id,
  input: {
    id,
    revision: 0,
    signedAt: "2025-01-01T00:00:00+08:00",
    installments: [
      { title: "首期", amount: "60", dueState: "DATE_SET", dueDate: "2026-01-02T00:00:00+08:00" },
      { title: "尾款", amount: "40", dueState: "CONDITIONAL", dueCondition: "完成合成服务" },
    ],
  },
};
await post({ ...sign, matterId: b.id }, 403);
await post({ action: "review", matterId: a.id });
const review = await (await request(base + "?matter=" + a.id + "&section=review")).json();
const check = review.checks[0];
assert(check.current);
await post({
  action: "decide-review",
  matterId: a.id,
  checkId: check.id,
  expectedDecidedAt: check.decidedAt,
  conclusion: "DIFFERENT",
  note: "合成样本已人工核对，不涉及真实客户",
});
await post(sign);
await post(sign, 409);
let data = await ledger();
const bill = data.billings.find((row) => row.id === id);
assert.equal(bill.status, "ACTIVE");
const dues = data.receivables.filter((row) => row.billingId === id);
assert.equal(dues.length, 2);
const key = randomUUID();
await post({
  action: "receipt",
  matterId: a.id,
  billingId: id,
  moneyKind: "LAWYER_FEE",
  amount: "80",
  occurredAt: "2025-01-01T00:00:00+08:00",
  requestKey: key,
});
await post({ action: "confirm", matterId: a.id, id: key });
data = await ledger();
let payment = data.payments.find((p) => p.sourceId === key);
assert(payment);
const allocation = {
  action: "allocate",
  matterId: a.id,
  input: {
    kind: "RECEIVABLE",
    paymentId: payment.id,
    revision: payment.revision,
    items: [
      { targetId: dues.find((r) => r.title === "首期").id, amount: "60" },
      { targetId: dues.find((r) => r.title === "尾款").id, amount: "20" },
    ],
  },
};
await post(allocation);
await post(allocation, 409);
data = await ledger();
payment = data.payments.find((p) => p.sourceId === key);
assert.equal(payment.unallocated, "0.00");
assert.equal(payment.invoiceRoom, "80.00");
assert.equal(data.receivables.find((r) => r.billingId === id && r.title === "尾款").outstanding, "20.00");
const invoice = data.invoices.find((i) => i.number === a.internalCode + "-ISSUED");
assert(invoice);
const link = {
  action: "allocate",
  matterId: a.id,
  input: {
    kind: "INVOICE",
    paymentId: payment.id,
    revision: payment.revision,
    items: [{ targetId: invoice.id, amount: "50.00" }],
  },
};
await post(link);
await post(link, 409);
data = await ledger();
assert.equal(data.payments.find((p) => p.sourceId === key).invoiceRoom, "30.00");
assert.equal(
  data.invoiceLinks.find((l) => l.invoiceId === invoice.id && l.paymentId === payment.id).amount,
  "50.00",
);
console.log(
  "PASS signed contract, two installments, human conflict decision, partial receivable settlement and independent issued-invoice reconciliation, stale revisions and cross-case refusal",
);
