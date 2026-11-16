// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const { db, state, readWork, readLedger, commissions, terminations, audit } = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    matterProcedure: { findMany: vi.fn() }, preservationCase: { findMany: vi.fn() },
    feeEntry: { findMany: vi.fn() }, invoiceRequest: { findMany: vi.fn() }, sealRequest: { findMany: vi.fn() },
    matter: { update: vi.fn() }, user: { findUnique: vi.fn() },
  },
  state: {
    plan: null as null | { financeOwnerId: string | null; serviceCompletedAt: Date; reason: string; fingerprint: string; revision: number },
    unavailableTable: null as string | null,
  },
  readWork: vi.fn(), readLedger: vi.fn(), commissions: vi.fn(), terminations: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/reminders/responsibility", () => ({ readWorkRows: readWork }));
vi.mock("@/server/finance/ledger-storage", () => ({ readLedger }));
vi.mock("@/server/finance/ledger-corrections", () => ({ commissionPositions: commissions }));
vi.mock("@/server/approval-permissions/termination", () => ({ executionTerminations: terminations }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async () => null) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "clawyer000000000000000001", role: "LAWYER" } })) }));
vi.mock("@/lib/permissions", () => ({ assertCanLeadMatter: vi.fn(), matterAssociationFilter: vi.fn(() => ({})) }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn() }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: vi.fn(), resolveRoleUser: vi.fn(async () => ({ enabled: true, role: "FINANCE" })) }));
vi.mock("@/server/audit", () => ({ audit, auditTx: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/matters/write-access", () => ({ lockWritableMatters: vi.fn(async () => [{ id: "cmatter000000000000000001", status: "ACTIVE" }]) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/intakes/workflow", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/intakes/workflow")>();
  return { ...actual, fingerprint: vi.fn(actual.fingerprint) };
});

import { fingerprint } from "@/server/intakes/workflow";
import { assertClosureReady } from "@/server/archive/closure";
import { closeMatter } from "@/server/matters/lifecycle";

const MATTER = "cmatter000000000000000001";
const FINANCE = "cfinance00000000000000001";
const transaction = db as unknown as Prisma.TransactionClient;
const emptySnapshot = () => ({ procedures: [], work: [], preservations: [], handovers: [], receipts: [], invoices: [], seals: [], corrections: [] });
const ledger = (outstanding = "0.00") => ({ summary: { outstanding, unallocated: "0.00", clientFundsReceived: "0.00" }, invoices: [] });

beforeEach(() => {
  vi.clearAllMocks();
  state.unavailableTable = null;
  state.plan = { financeOwnerId: null, serviceCompletedAt: new Date("2026-01-01T00:00:00Z"), reason: "合成服务完成安排", fingerprint: fingerprint(emptySnapshot()), revision: 1 };
  vi.mocked(fingerprint).mockClear();
  db.$transaction.mockImplementation(async write => write(db));
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (state.unavailableTable && sql.includes(`FROM "${state.unavailableTable}"`)) throw new Error(`relation "${state.unavailableTable}" does not exist`);
    if (sql.includes("to_regclass")) return [{ ready: true }];
    if (sql.includes('SELECT * FROM "ArchiveClosurePlan"')) return state.plan ? [state.plan] : [];
    if (sql.includes('"financeOwnerId" FROM "ArchiveClosurePlan"')) return state.plan ? [{ financeOwnerId: state.plan.financeOwnerId }] : [];
    return [];
  });
  db.matterProcedure.findMany.mockResolvedValue([]);
  db.preservationCase.findMany.mockResolvedValue([]);
  db.feeEntry.findMany.mockResolvedValue([]);
  db.invoiceRequest.findMany.mockResolvedValue([]);
  db.sealRequest.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ active: true, role: "FINANCE" });
  readWork.mockResolvedValue([]); readLedger.mockResolvedValue(ledger()); commissions.mockResolvedValue([]); terminations.mockResolvedValue([]);
});

describe("归档现行收尾合同", () => {
  it("必需收尾表缺失时失败，不以尚未启用跳过核对", async () => {
    state.unavailableTable = "ArchiveClosurePlan";
    await expect(assertClosureReady(transaction, MATTER)).rejects.toThrow('relation "ArchiveClosurePlan" does not exist');
  });

  it("同次核对的清单和审批指纹各算一次，复用当前审批指纹", async () => {
    const submitted = await assertClosureReady(transaction, MATTER);
    if (!submitted) throw new Error("测试环境未启用收尾表");
    vi.mocked(fingerprint).mockClear();
    const reviewed = await assertClosureReady(transaction, MATTER, submitted.fingerprint);
    if (!reviewed) throw new Error("测试环境未启用收尾表");
    expect(reviewed.fingerprint).toBe(submitted.fingerprint);
  });

  it("未变化的历史全计划指纹仍可核验，避免误判旧审批", async () => {
    const submitted = await assertClosureReady(transaction, MATTER);
    if (!submitted) throw new Error("测试环境未启用收尾表");
    const oldFingerprint = fingerprint({ facts: submitted.facts, plan: submitted.plan });
    expect(oldFingerprint).not.toBe(submitted.fingerprint);
    vi.mocked(fingerprint).mockClear();
    await expect(assertClosureReady(transaction, MATTER, oldFingerprint)).resolves.toMatchObject({ fingerprint: submitted.fingerprint });
  });

  it("补充归档仍允许独立财务收尾及合格责任交接，不改原服务完成事实", async () => {
    const submitted = await assertClosureReady(transaction, MATTER, undefined, { supplement: true });
    if (!submitted) throw new Error("测试环境未启用收尾表");
    state.plan = { ...submitted.plan, financeOwnerId: FINANCE, reason: "合成收尾责任交接", revision: 2 };
    readLedger.mockResolvedValue(ledger("100.00"));
    const reviewed = await assertClosureReady(transaction, MATTER, submitted.fingerprint, { supplement: true });
    if (!reviewed) throw new Error("测试环境未启用收尾表");
    expect(reviewed.fingerprint).toBe(submitted.fingerprint);
    expect(reviewed.finance.outstanding).toBe("100.00");
    expect(reviewed.plan.financeOwnerId).toBe(FINANCE);
    expect(reviewed.plan.serviceCompletedAt).toEqual(submitted.plan.serviceCompletedAt);
  });

  it("归档仍拒绝待确认实收及没有责任人的未结财务", async () => {
    db.feeEntry.findMany.mockResolvedValue([{ id: "receipt", amount: "100.00" }]);
    await expect(assertClosureReady(transaction, MATTER)).rejects.toThrow("实收待确认");
    db.feeEntry.findMany.mockResolvedValue([]);
    readLedger.mockResolvedValue(ledger("100.00"));
    await expect(assertClosureReady(transaction, MATTER)).rejects.toThrow("请指定收尾负责人");
  });

  it("当前指定收尾人停用后不能继续送审或批准", async () => {
    state.plan!.financeOwnerId = FINANCE;
    db.user.findUnique.mockResolvedValue({ active: false, role: "FINANCE" });
    await expect(assertClosureReady(transaction, MATTER)).rejects.toThrow("收尾负责人账号无效");
  });
});

describe("结案前置与归档前置分离", () => {
  it("收尾功能启用时，开放程序阻断结案", async () => {
    db.matterProcedure.findMany.mockResolvedValue([{ id: "procedure", status: "OPEN" }]);
    await expect(closeMatter({ id: MATTER, summary: "合成结案小结" })).rejects.toThrow("结案前须处理开放程序");
    expect(db.matter.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("必需办理事实读取失败时不写结案状态", async () => {
    state.unavailableTable = "MatterHandover";
    await expect(closeMatter({ id: MATTER, summary: "合成结案小结" })).rejects.toThrow('relation "MatterHandover" does not exist');
    expect(db.matter.update).not.toHaveBeenCalled();
  });

  it("办理前置已满足时，未结款及待确认实收不新增为结案门禁", async () => {
    readLedger.mockResolvedValue(ledger("100.00"));
    db.feeEntry.findMany.mockResolvedValue([{ id: "receipt", amount: "100.00" }]);
    await expect(closeMatter({ id: MATTER, summary: "合成结案小结" })).resolves.toEqual({ ok: true });
    expect(db.matter.update).toHaveBeenCalledWith({ where: { id: MATTER }, data: { status: "CLOSED", closedAt: expect.any(Date) } });
  });
});
