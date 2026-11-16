import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  matterProcedure: { findFirst: mock.find, updateMany: mock.update },
  $transaction: mock.transaction, $queryRaw: mock.lock
} }));
vi.mock("@/server/intakes/workflow", () => ({ currentActor: vi.fn() }));
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
  mock.find.mockResolvedValue({ id: procedureId, matterId: "cmtestmatter00000000000001", type: "FIRST_INSTANCE", updatedAt: version,
    procedureParties: [], matter: { status: "ACTIVE", primaryClientId: null, clientLinks: [] } });
  mock.update.mockResolvedValue({ count: 1 });
});

describe("程序终结联动", () => {
  it("填写结案时间时联动 CONCLUDED", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, concludedAt: "2026-11-16" });
    expect(mock.update.mock.calls[0][0].data).toEqual({ concludedAt: new Date("2026-11-16"), status: "CONCLUDED", updatedAt: expect.any(Date) });
  });
  it("省略结案时间既不清空日期，也不改变程序状态", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, caseNumber: "合成案号" });
    const data = mock.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("concludedAt");
    expect(data).not.toHaveProperty("status");
  });
});
