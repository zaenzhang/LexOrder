import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { allocationInput } from "@/lib/finance/ledger";
import { billingRegistrationInput, billingSignInput, receiptRegistrationInput } from "@/lib/finance/registration";
import { canConfirmReceipt, matterAssociationFilter, matterFinanceVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasPersonalCapability } from "@/lib/runtime/capabilities";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { getFinanceKpis, listAllFeeEntries, listPendingReceipts } from "@/server/finance/actions";
import { readMatterReview } from "@/server/conflicts/matter-review";
import { runMatterReview, decideMatterReview } from "@/server/conflicts/matter-actions";
import { allocateLedger, registerBilling, signBilling, confirmReceipt, getFinanceLedger, registerExpense, registerReceipt, rejectReceipt } from "@/server/finance/ledger-actions";

const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const target = z.object({ matterId: z.cuid(), id: z.string().min(1).max(80) });
const mutation = z.discriminatedUnion("action", [
  receiptRegistrationInput.extend({ action: z.literal("receipt"), matterId: z.cuid(), requestKey: z.uuid() }),
  receiptRegistrationInput.extend({ action: z.literal("expense"), matterId: z.cuid(), requestKey: z.uuid() }),
  z.object({ action: z.literal("contract"), input: billingRegistrationInput }),
  z.object({ action: z.literal("sign"), matterId: z.cuid(), input: billingSignInput }),
  z.object({ action: z.literal("allocate"), matterId: z.cuid(), input: allocationInput }),
  z.object({ action: z.literal("review"), matterId: z.cuid() }),
  z.object({ action: z.literal("decide-review"), matterId: z.cuid(), checkId: z.cuid(), expectedDecidedAt: z.coerce.date().nullable(),
    conclusion: z.enum(["DIFFERENT", "SAME_SUBJECT", "NEED_INFO"]), note: z.string().trim().min(1).max(2000) }),
  target.extend({ action: z.literal("confirm") }),
  target.extend({ action: z.literal("reject"), reason: z.string().trim().min(1, "请填写退回原因").max(1000) }),
]);

async function handle(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method })) return new Response(null, { status: 403, headers });
  try {
    const { user } = await requireSession("finance.read");
    if (request.method === "POST") {
      const data = mutation.parse(await request.json().catch(() => null));
      let result;
      if (data.action === "review") return json(await runMatterReview(data.matterId));
      if (data.action === "decide-review") return json(await decideMatterReview(data));
      if (data.action === "contract") result = await registerBilling(data.input);
      else if (data.action === "sign") {
        if (!await prisma.billing.count({ where: { id: data.input.id, matterId: data.matterId } })) throw new ActionError("该合同不属于本案。");
        result = await signBilling(data.input);
      } else if (data.action === "allocate") {
        if (!await prisma.payment.count({ where: { id: data.input.paymentId, matterId: data.matterId } })) throw new ActionError("该笔收款不属于本案。");
        result = await allocateLedger(data.input);
      } else if (data.action === "receipt") result = await registerReceipt(data);
      else if (data.action === "expense") result = await registerExpense(data);
      else {
        if (!await prisma.feeEntry.count({ where: { id: data.id, matterId: data.matterId, recordedById: user.id, type: "RECEIVED" } }))
          throw new ActionError("当前案件没有这笔本人登记的实收。");
        result = data.action === "confirm" ? await confirmReceipt(data.id) : await rejectReceipt(data.id, data.reason);
      }
      return result.ok ? json(result) : json({ error: result.message }, 409);
    }
    const params = new URL(request.url).searchParams;
    const matter = params.has("matter") ? z.cuid().parse(params.get("matter")) : undefined;
    if (!matter) {
      const query = z.string().trim().max(100).parse(params.get("q") ?? "");
      const visible = matterFinanceVisibilityFilter(user.id, user.role, user.rolePermissions);
      if (params.has("q")) return json({ matters: await prisma.matter.findMany({ where: { AND: [visible, { deletedAt: null }, ...(query ? [{ OR: [{ title: { contains: query } }, { internalCode: { contains: query } }] }] : [])] },
          select: { id: true, internalCode: true, title: true }, take: 30, orderBy: [{ internalCode: "asc" }, { id: "asc" }] }) });
      const [kpis, entries, pending] = await Promise.all([getFinanceKpis(), listAllFeeEntries({ limit: 100 }), listPendingReceipts()]);
      return json({ metrics: [[kpis.ledgerReady ? "本月律师费净实收" : "本月已确认收款", kpis.monthlyReceived], ["本月待确认实收", kpis.monthPendingAmount]],
        entries: entries.map(e => ({ id: e.id, type: e.type, matterId: e.matter.id, matterTitle: e.matter.title, amount: e.amount, date: e.occurredAt, state: e.confirmState })),
        pending: pending.map(e => ({ id: e.id, matterId: e.matter.id, matterTitle: e.matter.title, payer: e.payerOrPayee,
          amount: e.amount, date: e.occurredAt, actionable: canConfirmReceipt(user) && e.recordedById === user.id })) });
    }
    if (params.get("section") === "review") {
      const owner = await prisma.matter.count({ where: { id: matter, deletedAt: null, ...matterAssociationFilter(user.id) } });
      if (!owner) throw new ActionError("当前不能读取本案的冲突复核。");
      return json(await readMatterReview(prisma, matter));
    }
    const ledger = await getFinanceLedger(matter);
    const current = ledger.matters[0];
    const invoiceLinked = new Map<string, Prisma.Decimal>();
    for (const link of ledger.invoiceLinks) invoiceLinked.set(link.paymentId, (invoiceLinked.get(link.paymentId) ?? new Prisma.Decimal(0)).plus(link.amount));
    const writable = current.status !== "ARCHIVED" || current.tailWritable;
    return json({ ready: ledger.ready, canWrite: ledger.ready && writable && hasPersonalCapability(user, "finance.write"),
      metrics: [["应收余额", ledger.summary.outstanding], ["已确认净收款", ledger.summary.netReceived], ["待分配", ledger.summary.unallocated]],
      canContract: current.status !== "ARCHIVED" && hasPersonalCapability(user, "finance.write") && ledger.ready,
      billings: ledger.billings.map(b => ({ id: b.id, title: b.title, moneyKind: b.moneyKind, amount: b.contractAmount, status: b.status,
        revision: b.revision, signable: !b.sourceBillingId && b.status === "DRAFT" && !b.signedAt, signedAt: b.signedAt })),
      payments: ledger.payments.map(p => ({ id: p.id, sourceId: p.feeEntryId, revision: p.revision, amount: p.amount, date: p.occurredAt, kind: p.moneyKind,
        unallocated: p.unallocated, invoiceRoom: new Prisma.Decimal(p.amount).minus(p.refundedAmount).minus(invoiceLinked.get(p.id) ?? 0).toFixed(2) })),
      invoices: ledger.invoices.map(i => ({ id: i.id, number: i.invoiceNo, amount: i.amount, outstanding: i.outstanding, linked: i.linked })),
      allocations: ledger.allocations, invoiceLinks: ledger.invoiceLinks,
      pending: ledger.pending.map(p => ({ id: p.id, matterId: matter, payer: p.payerOrPayee, amount: p.amount, date: p.occurredAt, actionable: writable && canConfirmReceipt(user) && p.recordedById === user.id })),
      entries: [...ledger.payments.map(p => ({ id: p.id, type: "RECEIVED", amount: p.amount, date: p.occurredAt, state: "CONFIRMED" })),
        ...ledger.expenses.map(e => ({ id: e.id, type: "COST", amount: e.amount, date: e.occurredAt, state: "CONFIRMED" }))].sort((a,b) => b.date.getTime() - a.date.getTime()),
      receivables: ledger.receivables.map(r => ({ id: r.id, title: r.title, amount: r.amount, outstanding: r.outstanding, state: r.status, kind: r.moneyKind, billingId: r.billingId, due: r.dueDate, dueCondition: r.dueCondition })) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "请核对财务登记内容。" }, 400);
    if (error instanceof ActionError) return json({ error: error.message }, 403);
    throw error;
  }
}
export { handle as GET, handle as POST };
