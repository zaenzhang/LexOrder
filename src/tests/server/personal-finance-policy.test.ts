// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

const { actor, state, db, auditTx, tail, timeline } = vi.hoisted(() => ({
  actor: { id: "local", role: "INDEPENDENT_LAWYER", runtimeMode: "PERSONAL" as const, managerAuthorized: false },
  state: { personal: true, receiptAuthor: "local", receiptState: "PENDING", correctionAuthor: "local", correctionRevision: 2 },
  db: { $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() }, matter: { findFirst: vi.fn() },
    feeEntry: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    commissionPlan: { findMany: vi.fn() }, notification: { createMany: vi.fn(), create: vi.fn() },
  }, auditTx: vi.fn(), tail: vi.fn(), timeline: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async (_db, id?: string) => {
  if (!state.personal) return null;
  if (id !== undefined && id !== actor.id) throw new ActionError("非本机操作者");
  return actor;
}) }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ ...actor, runtimeMode: state.personal ? "PERSONAL" : "SERVER", enabled: true })) }));
vi.mock("@/server/archive/closure", () => ({ assertTailAuthority: tail }));
vi.mock("@/server/audit", () => ({ auditTx }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: timeline }));
vi.mock("@/server/finance/ledger-storage", () => ({ requireFinanceLedger: vi.fn(), readLedger: vi.fn() }));

import { assertLedgerWrite } from "@/server/finance/ledger-access";
import { confirmReceiptTx, registerReceiptTx, rejectReceiptTx } from "@/server/finance/ledger-registration";
import { decideCorrectionTx } from "@/server/finance/ledger-corrections";

const transaction = db as unknown as Prisma.TransactionClient;
const target = { id: "receipt", matterId: "matter" };

beforeEach(() => {
  vi.clearAllMocks(); state.personal = true; state.receiptAuthor = actor.id; state.receiptState = "PENDING"; state.correctionAuthor = actor.id; state.correctionRevision = 2;
  db.user.findUnique.mockResolvedValue({ role: "INDEPENDENT_LAWYER", active: true });
  db.user.findMany.mockResolvedValue([]);
  db.matter.findFirst.mockResolvedValue({ status: "IN_PROGRESS" });
  db.feeEntry.findUnique.mockResolvedValue(target);
  db.feeEntry.updateMany.mockImplementation(async () => {
    if (state.receiptState !== "PENDING") return { count: 0 };
    state.receiptState = "CONFIRMED"; return { count: 1 };
  });
  db.feeEntry.deleteMany.mockResolvedValue({ count: 1 });
  db.commissionPlan.findMany.mockResolvedValue([]);
  db.$executeRaw.mockResolvedValue(1);
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (sql.includes('SELECT * FROM "FeeEntry"')) return [{ ...target, type: "RECEIVED", confirmState: state.receiptState, recordedById: state.receiptAuthor, amount: new Prisma.Decimal("100.00"), moneyKind: "LAWYER_FEE", occurredAt: new Date("2026-01-01"), billingId: null }];
    if (sql.includes('SELECT "matterId" FROM "FinanceCorrection"')) return [{ matterId: "matter" }];
    if (sql.includes('SELECT * FROM "FinanceCorrection"')) return [{ id: "correction", matterId: "matter", status: "PENDING", revision: state.correctionRevision, createdById: state.correctionAuthor }];
    return [];
  });
  tail.mockResolvedValue(undefined);
});

describe("Personal finance execution policy", () => {
  it.each(["finance.write", "finance.confirm", "finance.correct", "finance.settle"] as const)("permits %s only through the own-matter filter", async permission => {
    await expect(assertLedgerWrite(transaction, actor.id, "matter", permission)).resolves.toEqual(actor);
    expect(db.matter.findFirst).toHaveBeenCalledWith({ where: { id: "matter", deletedAt: null, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] }, select: { status: true } });
  });

  it("does not grant Server independent lawyers financial confirmation or execution", async () => {
    state.personal = false;
    for (const permission of ["finance.confirm", "finance.correct", "finance.settle"] as const) {
      await expect(assertLedgerWrite(transaction, actor.id, "matter", permission)).rejects.toThrow();
    }
    expect(db.matter.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a foreign actor, inactive user and unrelated matter before mutation", async () => {
    await expect(assertLedgerWrite(transaction, "other", "matter", "finance.confirm")).rejects.toThrow("非本机操作者");
    db.user.findUnique.mockResolvedValue({ role: "INDEPENDENT_LAWYER", active: false });
    await expect(assertLedgerWrite(transaction, actor.id, "matter", "finance.confirm")).rejects.toThrow("账号已停用");
    db.user.findUnique.mockResolvedValue({ role: "INDEPENDENT_LAWYER", active: true });
    db.matter.findFirst.mockResolvedValue(null);
    await expect(confirmReceiptTx(transaction, actor.id, target.id)).rejects.toThrow("无权处理");
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("retains archived-matter restrictions and designated-tail-owner checks", async () => {
    db.matter.findFirst.mockResolvedValue({ status: "ARCHIVED" });
    await expect(assertLedgerWrite(transaction, actor.id, "matter", "finance.write", { allowTail: false })).rejects.toThrow("归档后不得");
    expect(tail).not.toHaveBeenCalled();
    tail.mockRejectedValue(new ActionError("并非指定收尾人"));
    await expect(assertLedgerWrite(transaction, actor.id, "matter", "finance.confirm")).rejects.toThrow("并非指定收尾人");
  });

  it("keeps new receipts pending and creates no Payment or revenue timeline", async () => {
    await registerReceiptTx(transaction, actor.id, { matterId: "matter", amount: "100.00", moneyKind: "LAWYER_FEE", occurredAt: new Date("2026-01-01") });
    const writtenSql = db.$executeRaw.mock.calls.map(call => call[0].join("?"));
    expect(writtenSql).toHaveLength(1);
    expect(writtenSql[0]).toContain("'PENDING'");
    expect(writtenSql.join("\n")).not.toContain('INSERT INTO "Payment"');
    expect(timeline).not.toHaveBeenCalled();
    expect(auditTx).toHaveBeenCalledWith(transaction, expect.objectContaining({ action: "FEE_ENTRY_SUBMIT", detail: expect.objectContaining({ pendingConfirm: true, runtimeMode: "PERSONAL", decisionKind: "SUBMISSION" }) }));
  });

  it("requires the real recorder and remains pending on an ownership rejection", async () => {
    state.receiptAuthor = "historical-other";
    await expect(confirmReceiptTx(transaction, actor.id, target.id)).rejects.toThrow("历史操作者映射");
    await expect(rejectReceiptTx(transaction, actor.id, target.id, "合成退回理由")).rejects.toThrow("历史操作者映射");
    expect(state.receiptState).toBe("PENDING");
    expect(db.feeEntry.updateMany).not.toHaveBeenCalled(); expect(db.feeEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("confirms only once and distinguishes a manual self confirmation in audit", async () => {
    await confirmReceiptTx(transaction, actor.id, target.id);
    await expect(confirmReceiptTx(transaction, actor.id, target.id)).rejects.toThrow("已被处理");
    expect(db.$executeRaw.mock.calls.filter(call => call[0].join("?").includes('INSERT INTO "Payment"'))).toHaveLength(1);
    expect(auditTx).toHaveBeenCalledWith(transaction, expect.objectContaining({ userId: actor.id, action: "FEE_ENTRY_CONFIRM", detail: expect.objectContaining({ runtimeMode: "PERSONAL", decisionPolicy: "PERSONAL_SELF", decisionKind: "CONFIRMATION" }) }));
  });

  it("requires the real correction applicant and an unchanged revision", async () => {
    const input = { id: "correction", revision: 2, decision: "REJECTED" as const, note: "合成核对退回" };
    state.correctionAuthor = "historical-other";
    await expect(decideCorrectionTx(transaction, actor.id, input)).rejects.toThrow("历史操作者映射");
    state.correctionAuthor = actor.id; state.correctionRevision = 3;
    await expect(decideCorrectionTx(transaction, actor.id, input)).rejects.toThrow("发生变化");
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
