import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mock = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), matterProcedure: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() }, materialIngestIntent: { count: vi.fn() }, auditLog: { count: vi.fn() }, timelineEvent: { count: vi.fn() }, procedureMemo: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() } };
  return { tx, transaction: vi.fn(), session: vi.fn(), lockWritable: vi.fn(), audit: vi.fn(), revalidate: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { ...mock.tx, $transaction: mock.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mock.session }));
vi.mock("@/server/matters/write-access", () => ({ lockWritableMatters: mock.lockWritable }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: mock.audit }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: mock.revalidate }));
import { addProcedureMemo, toggleProcedureMemo, deleteProcedureMemo, deleteProcedure } from "@/server/procedures/actions";

const id = "cmtestprocedure00000000001";
const matterId = "cmtestmatter00000000000001";
const userId = "cmtestowner000000000000001";
const emptyCounts = { stages: 0, deadlines: 0, hearings: 0, documents: 0, procedureParties: 0, memos: 0, billingScopes: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock.tx));
  mock.session.mockResolvedValue({ user: { id: userId, role: "LAWYER" } });
  mock.lockWritable.mockResolvedValue(undefined);
  mock.tx.matterProcedure.findUnique.mockResolvedValue({ matterId });
  mock.tx.matterProcedure.findFirst.mockResolvedValue({ id, matterId, status: "PENDING", _count: emptyCounts });
  mock.tx.materialIngestIntent.count.mockResolvedValue(0);
  mock.tx.auditLog.count.mockResolvedValue(0);
  mock.tx.timelineEvent.count.mockResolvedValue(0);
  mock.audit.mockResolvedValue(undefined);
  mock.tx.procedureMemo.create.mockResolvedValue({ id: "cmtestmemo0000000000000001" });
  mock.tx.procedureMemo.findUnique.mockResolvedValue({ id: "cmtestmemo0000000000000001", procedureId: id, done: false, procedure: { matterId } });
  mock.tx.procedureMemo.findFirst.mockResolvedValue({ id: "cmtestmemo0000000000000001", done: false });
});

describe("程序只删除无历史误建空对象", () => {
  it("未认证不探测期限、开庭或程序", async () => {
    mock.session.mockRejectedValueOnce(new ActionError("请登录"));
    await expect(deleteProcedure(id)).rejects.toThrow("请登录");
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.tx.matterProcedure.findFirst).not.toHaveBeenCalled();
  });

  it("事务内撤权后不读取程序及依赖", async () => {
    mock.lockWritable.mockRejectedValueOnce(new ActionError("当前岗位无权处理"));
    await expect(deleteProcedure(id)).rejects.toThrow("无权处理");
    expect(mock.tx.matterProcedure.findFirst).not.toHaveBeenCalled();
    expect(mock.tx.materialIngestIntent.count).not.toHaveBeenCalled();
  });

  it("删除使用主办/协办权限，程序已变化时不删除", async () => {
    mock.tx.matterProcedure.findFirst.mockResolvedValueOnce(null);
    await expect(deleteProcedure(id)).resolves.toEqual({ ok: false });
    expect(mock.lockWritable).toHaveBeenCalledWith(mock.tx, { id: userId, role: "LAWYER" }, "schedule.write", [matterId], true);
    expect(mock.tx.materialIngestIntent.count).not.toHaveBeenCalled();
    expect(mock.tx.matterProcedure.delete).not.toHaveBeenCalled();
  });

  it.each(Object.keys(emptyCounts) as (keyof typeof emptyCounts)[])("%s 有记录时禁止删除，查询不排除取消/完成/隐藏状态", async relation => {
    mock.tx.matterProcedure.findFirst.mockResolvedValueOnce({ id, matterId, status: "PENDING", _count: { ...emptyCounts, [relation]: 1 } });
    await expect(deleteProcedure(id)).rejects.toThrow("已有业务或历史记录");
    expect(mock.tx.matterProcedure.findFirst).toHaveBeenCalledWith({ where: { id, matterId }, include: { _count: { select: {
      stages: true, deadlines: true, hearings: true, documents: true, procedureParties: true, memos: true, billingScopes: true
    } } } });
    expect(mock.tx.matterProcedure.delete).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it("已移除的关联仍有审计历史时不能删除程序", async () => {
    mock.tx.auditLog.count.mockResolvedValueOnce(1);
    await expect(deleteProcedure(id)).rejects.toThrow("已有业务或历史记录");
    expect(mock.tx.auditLog.count).toHaveBeenCalledWith({ where: { action: { not: "PROCEDURE_CREATE" }, OR: [
      { targetType: "MatterProcedure", targetId: id }, { detail: { path: ["procedureId"], equals: id } }
    ] } });
    expect(mock.tx.matterProcedure.delete).not.toHaveBeenCalled();
  });

  it("已有结案结果不能因当前依赖为空而删除", async () => {
    mock.tx.matterProcedure.findFirst.mockResolvedValueOnce({ id, matterId, status: "PENDING", _count: emptyCounts, outcome: "WITHDRAWN" });
    await expect(deleteProcedure(id)).rejects.toThrow("已有业务或历史记录");
    expect(mock.tx.matterProcedure.delete).not.toHaveBeenCalled();
  });

  it("空程序的依赖检查、删除和 auditTx 在同一事务提交", async () => {
    await expect(deleteProcedure(id)).resolves.toEqual({ ok: true });
    expect(mock.tx.matterProcedure.delete).toHaveBeenCalledWith({ where: { id } });
    expect(mock.audit).toHaveBeenCalledWith(mock.tx, expect.objectContaining({ action: "PROCEDURE_DELETE", detail: { matterId } }));
    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
    expect(mock.revalidate).toHaveBeenCalledWith(matterId);
  });

  it("归档与审计失败不会返回删除成功", async () => {
    mock.lockWritable.mockRejectedValueOnce(new ActionError("案件已归档"));
    await expect(deleteProcedure(id)).rejects.toThrow("已归档");
    expect(mock.tx.matterProcedure.delete).not.toHaveBeenCalled();
    mock.audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(deleteProcedure(id)).rejects.toThrow("synthetic audit failure");
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
});


describe("备忘删除后仍保留程序历史", () => {
  it("备忘增、改、删都在实际写入事务留下 procedureId 审计", async () => {
    const memoId = "cmtestmemo0000000000000001";
    await addProcedureMemo({ procedureId: id, content: "合成备忘内容" });
    await toggleProcedureMemo(memoId);
    await deleteProcedureMemo(memoId);
    expect(mock.audit.mock.calls.map(call => call[1].action)).toEqual(["PROCEDURE_MEMO_CREATE", "PROCEDURE_MEMO_COMPLETE", "PROCEDURE_MEMO_DELETE"]);
    for (const call of mock.audit.mock.calls) {
      expect(call[0]).toBe(mock.tx);
      expect(call[1]).toEqual(expect.objectContaining({ targetType: "ProcedureMemo", targetId: memoId, detail: { matterId, procedureId: id } }));
      expect(call[1].detail).not.toHaveProperty("content");
    }
  });

  it("删除备忘的审计失败使事务回调失败，不刷新为删除成功", async () => {
    mock.audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(deleteProcedureMemo("cmtestmemo0000000000000001")).rejects.toThrow("synthetic audit failure");
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
});
