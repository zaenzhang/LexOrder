// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { tx, transaction, session, register, sign, draft, revalidate } = vi.hoisted(() => ({ tx: {}, transaction: vi.fn(), session: vi.fn(), register: vi.fn(), sign: vi.fn(), draft: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: revalidate }));
vi.mock("@/server/finance/ledger-registration", () => ({ registerBillingTx: register, signBillingTx: sign, registerReceiptTx: vi.fn(), registerExpenseTx: vi.fn(), confirmReceiptTx: vi.fn(), rejectReceiptTx: vi.fn(), confirmDueConditionTx: vi.fn() }));
vi.mock("@/server/finance/ledger-contracts", () => ({ draftAmendmentTx: draft, activateAmendmentTx: vi.fn(), cancelAmendmentTx: vi.fn(), bindContractScopeTx: vi.fn() }));
import { registerBilling, signBilling, draftAmendment } from "@/server/finance/ledger-actions";
import { ActionError } from "@/lib/action-error";

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: "synthetic-actor" } });
  transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
  register.mockResolvedValue({ id: "registered-contract", matterId: "synthetic-matter" });
  sign.mockResolvedValue({ id: "signed-contract", matterId: "synthetic-matter" });
  draft.mockResolvedValue({ id: "draft-amendment", matterId: "synthetic-matter" });
});

describe("合同动作返回具体对象", () => {
  it("登记、签署和补充协议返回领域真实 ID，原权限与事务保留", async () => {
    expect(await registerBilling({ matterId: "synthetic-matter", title: "合成合同", amount: "120", moneyKind: "LAWYER_FEE", installments: [] })).toEqual({ ok: true, id: "registered-contract", matterId: "synthetic-matter" });
    expect(await signBilling({ id: "signed-contract", revision: 1, signedAt: new Date(), installments: [] })).toEqual({ ok: true, id: "signed-contract", matterId: "synthetic-matter" });
    expect(await draftAmendment({ sourceBillingId: "signed-contract", sourceRevision: 2, title: "合成补充协议", type: "SCOPE_ONLY", amount: "0", signedAt: new Date(), effectiveAt: new Date(), reason: "合成范围调整", documentIds: ["synthetic-document"] })).toEqual({ ok: true, id: "draft-amendment", matterId: "synthetic-matter" });
    expect(session.mock.calls).toEqual([["finance.write"], ["finance.write"], ["finance.write"]]);
    for (const call of transaction.mock.calls) expect(call[1]).toMatchObject({ isolationLevel: "Serializable" });
    for (const service of [register, sign, draft]) expect(service.mock.calls[0].slice(0, 2)).toEqual([tx, "synthetic-actor"]);
  });
  it("领域拒绝仍保留失败结果，不返回猜测的合同 ID", async () => {
    register.mockRejectedValueOnce(new ActionError("案件已归档，不可登记合同"));
    expect(await registerBilling({ matterId: "synthetic-matter", title: "合成合同", amount: "120", moneyKind: "LAWYER_FEE", installments: [] })).toEqual({ ok: false, message: "案件已归档，不可登记合同" });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
