// @vitest-environment node
// 2026-09-20 A 批 P1-3 回归：程序进入办理的门禁（合同覆盖 + 动态冲突复核）必须先于写入且整体原子。
// 验收口径：门禁失败时数据库零写入——updateMany 不被调用；重试场景下状态复读来自事务内 FOR UPDATE，
// 而不是复用事务外的旧快照跳过首次启动判断。
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, gate } = vi.hoisted(() => ({
  db: {
    matterProcedure: { findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn()
  },
  gate: { review: vi.fn(), covered: vi.fn(), ready: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "user1", role: "PRINCIPAL_LAWYER", rolePermissions: undefined } })) }));
vi.mock("@/server/conflicts/matter-review", () => ({ assertMatterReviewCurrent: gate.review }));
vi.mock("@/server/finance/ledger-contracts", () => ({ assertProcedureCovered: gate.covered }));
vi.mock("@/server/reminders/responsibility", () => ({ responsibilityReady: gate.ready, readWorkRows: vi.fn(async () => []), changeWorkTx: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/matters/write-access", () => ({ lockWritableMatters: vi.fn(async () => [{ id: "m1", status: "IN_PROGRESS" }]) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ assertCanModifyMatter: vi.fn(), assertCanAssociateMatter: vi.fn(), assertCanLeadMatter: vi.fn(), assertCanHandleMatter: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn() }));
import { updateProcedure } from "@/server/procedures/actions";

const CUID = "ckx1a2b3c4d5e6f7g8h9j0k1";
const expectedUpdatedAt = new Date("2026-11-16T01:00:00Z");
const existingRow = { updatedAt: expectedUpdatedAt, acceptedAt: null, concludedAt: null, outcome: null, outcomeNote: null, matterId: "m1", type: "FIRST_INSTANCE", status: "PENDING", engagement: "ENGAGED", jurisdiction: null, handlingAgency: null };

beforeEach(() => {
  vi.resetAllMocks();
  db.matterProcedure.findUnique.mockResolvedValue(existingRow);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.$queryRaw.mockResolvedValue([]);
  db.matterProcedure.updateMany.mockResolvedValue({ count: 1 });
  gate.ready.mockResolvedValue(true);
  gate.covered.mockResolvedValue(undefined);
  gate.review.mockResolvedValue(undefined);
});

describe("程序启动门禁事务（P1-3）", () => {
  it("动态冲突复核失败时零写入：updateMany 不被调用", async () => {
    gate.review.mockRejectedValue(new Error("存在待复核的主体或范围变更"));
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS" })).rejects.toThrow("待复核");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("合同覆盖校验失败时零写入", async () => {
    gate.covered.mockRejectedValue(new Error("当前代理范围没有有效合同覆盖"));
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS" })).rejects.toThrow("合同覆盖");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("首次启动以事务内复读的状态为准：事务外快照为非办理中、行内已是办理中时仍执行门禁", async () => {
    // 场景：第一次请求在旧实现里先把状态写成 IN_PROGRESS 后门禁才失败；重试时
    // 事务外快照（NOT_STARTED）会与行内真实值（IN_PROGRESS）不一致——
    // 新实现以 FOR UPDATE 行内值为准，门禁条件不成立、直接条件更新。
    db.matterProcedure.findUnique.mockResolvedValueOnce(existingRow).mockResolvedValueOnce({ ...existingRow, status: "IN_PROGRESS" });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS" })).resolves.toEqual({ ok: true });
    expect(gate.review).not.toHaveBeenCalled();
    expect(db.matterProcedure.updateMany).toHaveBeenCalledOnce();
  });

  it("非首次启动转换不做启动门禁，但条件更新带原状态", async () => {
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, caseNumber: "（2026）沪01民初1号" })).resolves.toEqual({ ok: true });
    expect(gate.review).not.toHaveBeenCalled();
    expect(db.matterProcedure.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CUID, updatedAt: expectedUpdatedAt } }));
  });

  it("条件更新失败时拒绝而非静默跳过", async () => {
    db.matterProcedure.findUnique.mockResolvedValueOnce(existingRow).mockResolvedValueOnce({ ...existingRow, status: "IN_PROGRESS" });
    db.matterProcedure.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "CONCLUDED", concludedAt: new Date("2026-11-16T00:00:00+08:00") })).rejects.toThrow("状态已变化");
  });

  it("所见版本失效时不覆盖新状态", async () => {
    db.matterProcedure.findUnique.mockResolvedValueOnce(existingRow).mockResolvedValueOnce({ ...existingRow, updatedAt: new Date(expectedUpdatedAt.getTime() + 1) });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS" })).rejects.toThrow("已被修改");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("终结要求实际日期，不能只把状态标为终结", async () => {
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "CONCLUDED" })).rejects.toThrow("实际终结日期");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("不能省略状态动作直接清空终结日期", async () => {
    db.matterProcedure.findUnique.mockResolvedValue({ ...existingRow, status: "CONCLUDED", concludedAt: expectedUpdatedAt });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, concludedAt: null })).rejects.toThrow("不能直接清空");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("不能把未来计划或早于受理的日期记录为实际终结", async () => {
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "CONCLUDED", concludedAt: new Date("2999-01-01T00:00:00+08:00") })).rejects.toThrow("不能晚于今天");
    db.matterProcedure.findUnique.mockResolvedValue({ ...existingRow, acceptedAt: new Date("2002-01-01T00:00:00+08:00") });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "CONCLUDED", concludedAt: new Date("2001-12-31T00:00:00+08:00") })).rejects.toThrow("不能早于立案／受理日期");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("恢复须说明原因，核对门禁后才清除当前终结信息", async () => {
    db.matterProcedure.findUnique.mockResolvedValue({ ...existingRow, status: "CONCLUDED", concludedAt: expectedUpdatedAt, outcome: "COMPLETED", outcomeNote: "原终结说明" });
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS" })).rejects.toThrow("恢复办理的原因");
    expect(db.matterProcedure.updateMany).not.toHaveBeenCalled();
    await expect(updateProcedure({ id: CUID, expectedUpdatedAt, status: "IN_PROGRESS", changeReason: "按客户指示继续办理" })).resolves.toEqual({ ok: true });
    expect(gate.covered).toHaveBeenCalled();
    expect(gate.review).toHaveBeenCalled();
    expect(db.matterProcedure.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "IN_PROGRESS", concludedAt: null, outcome: null, outcomeNote: null }) }));
  });

});
