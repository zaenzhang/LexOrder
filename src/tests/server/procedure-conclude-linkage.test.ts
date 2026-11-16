import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ find: vi.fn(), reference: vi.fn(), update: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  matterProcedure: { findUnique: mock.reference, findFirst: mock.find, updateMany: mock.update },
  $transaction: mock.transaction, $queryRaw: mock.lock
} }));
vi.mock("@/server/intakes/workflow", () => ({ currentActor: vi.fn(async () => ({ role: "LAWYER" })) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "cmtestowner000000000000001", role: "LAWYER" } })) }));
import { prisma } from "@/lib/prisma";
import { updateProcedureInfo } from "@/server/matters/actions";
const procedureId = "cmtestprocedure00000000001";
const version = new Date("2026-11-16T01:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  mock.reference.mockResolvedValue({ matterId: "cmtestmatter00000000000001" });
  mock.find.mockResolvedValue({ id: procedureId, matterId: "cmtestmatter00000000000001", type: "FIRST_INSTANCE", updatedAt: version,
    status: "IN_PROGRESS", acceptedAt: null, procedureParties: [], matter: { status: "IN_PROGRESS", primaryClientId: null, clientLinks: [] } });
  mock.update.mockResolvedValue({ count: 1 });
});

describe("程序信息编辑与显式终结边界", () => {
  it("填写终结日期不能绕过显式终结程序动作", async () => {
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version, concludedAt: "2026-11-16" })).rejects.toThrow("终结程序动作");
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("已终结程序不能通过清空日期绕过恢复动作", async () => {
    mock.find.mockResolvedValue({ id: procedureId, matterId: "cmtestmatter00000000000001", type: "FIRST_INSTANCE", updatedAt: version,
      status: "CONCLUDED", acceptedAt: null, procedureParties: [], matter: { status: "IN_PROGRESS", primaryClientId: null, clientLinks: [] } });
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version, concludedAt: null })).rejects.toThrow("恢复办理请使用程序状态动作");
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("省略结案时间既不清空日期，也不改变程序状态", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, caseNumber: "合成案号" });
    const data = mock.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("concludedAt");
    expect(data).not.toHaveProperty("status");
  });
});
