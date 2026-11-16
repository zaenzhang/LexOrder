import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { ledger, session, register, sign, amendment, workspace, push, replace, refresh } = vi.hoisted(() => ({ ledger: vi.fn(), session: vi.fn(), register: vi.fn(), sign: vi.fn(), amendment: vi.fn(), workspace: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: session }));
vi.mock("@/server/finance/ledger-actions", () => ({ getFinanceLedger: ledger, registerBilling: register, signBilling: sign, draftAmendment: amendment, bindContractScope: vi.fn(), activateAmendment: vi.fn(), cancelAmendment: vi.fn(), registerExpense: vi.fn(), registerReceipt: vi.fn(), confirmReceipt: vi.fn(), rejectReceipt: vi.fn(), confirmDueCondition: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/app/(app)/finance/reconciliation/_components/ledger-workspace", () => ({ LedgerWorkspace: (props: unknown) => { workspace(props); return <div>合成财务工作区</div>; } }));
import ReconciliationPage from "@/app/(app)/finance/reconciliation/page";
import { ContractWorkspace } from "@/app/(app)/finance/reconciliation/_components/contract-workspace";
import type { getFinanceLedger } from "@/server/finance/ledger-actions";
import { contractTermsInput } from "@/lib/finance/contracts";
import { billingRegistrationInput } from "@/lib/finance/registration";
import { ActionError } from "@/lib/action-error";

type Data = Awaited<ReturnType<typeof getFinanceLedger>>;
const MATTER = "cmatter000000000000000001", FIRST = "original-1", SECOND = "original-2", RETURN = "/matters/TEST-001?view=finance&item=contracts#position";
function data(): Data {
  const base: Data["billings"][number] = { id: FIRST, matterId: MATTER, title: "合成合同一", contractAmount: "100.00", moneyKind: "LAWYER_FEE", status: "ACTIVE", signedAt: new Date("2026-01-01T00:00:00Z"), revision: 1, sourceBillingId: null, amendmentType: "ORIGINAL", resultingAmount: null, previousAmount: null, effectiveAt: null, endsAt: null, draftTerms: null, completedWork: null, handoverWork: null, terminationReason: null };
  return { contractDocuments: [], invoiceAdjustments: [], documents: [{ id: "cdocument000000000000001", matterId: MATTER, name: "合成变更依据" }], procedures: [], scopes: [], expenses: [], currentUserId: "clawyer00000000000000001", corrections: [], allocations: [], invoiceLinks: [], commissions: [], settlements: [], ready: true, matters: [{ id: MATTER, title: "合成案件", internalCode: "TEST-001", status: "IN_PROGRESS", tailWritable: false }], summary: { receivable: "0.00", outstanding: "0.00", netReceived: "0.00", unallocated: "0.00", lawyerFeeReceived: "0.00", clientFundsReceived: "0.00" }, pending: [], billings: [base, { ...base, id: SECOND, title: "合成合同二", revision: 2 }], receivables: [], payments: [], invoices: [] };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  ledger.mockResolvedValue(data()); session.mockResolvedValue({ user: { id: "clawyer00000000000000001", role: "LAWYER" } });
  register.mockResolvedValue({ ok: true, id: "created-contract", matterId: MATTER });
  sign.mockResolvedValue({ ok: true, id: SECOND, matterId: MATTER });
  amendment.mockResolvedValue({ ok: true, id: "created-amendment", matterId: MATTER });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("合同明确入口与返回", () => {
  it("具体合同直达合同页签，保留当前授权案件完整返回位置", async () => {
    render(await ReconciliationPage({ searchParams: Promise.resolve({ matterId: MATTER, tab: "contracts", billingId: SECOND, returnTo: RETURN }) }));
    expect(workspace).toHaveBeenCalledWith(expect.objectContaining({ tab: "contracts", billingId: SECOND, selectedMatterId: MATTER, createContract: false, returnTo: RETURN }));
    expect(screen.getByRole("link", { name: "返回案件" })).toHaveAttribute("href", RETURN);
  });
  it.each([
    { matterId: MATTER, tab: "contracts", billingId: "missing" },
    { matterId: MATTER, tab: "contracts", returnTo: "https://example.invalid" },
    { matterId: MATTER, tab: "contracts", returnTo: "/matters/OTHER?view=finance" },
    { matterId: MATTER, tab: "contracts", action: "create", billingId: SECOND },
    { matterId: MATTER, tab: "ledger", action: "create" },
    { tab: "contracts", billingId: SECOND },
  ])("显式无效入口不静默打开另一个合同或操作：%j", async params => {
    render(await ReconciliationPage({ searchParams: Promise.resolve(params) }));
    expect(screen.getByRole("alert")).toBeInTheDocument(); expect(workspace).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "查看合同列表" })).toBeInTheDocument();
  });
  it("无参数保留总览，只有 action=create 主动打开登记", async () => {
    render(await ReconciliationPage({ searchParams: Promise.resolve({}) }));
    expect(workspace).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "overview", createContract: false }));
    cleanup();
    render(await ReconciliationPage({ searchParams: Promise.resolve({ matterId: MATTER, tab: "contracts", action: "create", returnTo: RETURN }) }));
    expect(workspace).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "contracts", createContract: true, returnTo: RETURN }));
  });
  it("无权案件只展示当前失败出口，不进入工作区", async () => {
    ledger.mockRejectedValueOnce(new ActionError("案件不存在或无权查看财务"));
    render(await ReconciliationPage({ searchParams: Promise.resolve({ matterId: "unavailable", tab: "contracts" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("无权查看财务"); expect(workspace).not.toHaveBeenCalled();
  });
  it("登记失败保留填写内容，成功使用服务返回的真实合同 ID 定位", async () => {
    register.mockResolvedValueOnce({ ok: false, message: "收费安排暂未保存" }).mockResolvedValue({ ok: true, id: "created-contract", matterId: MATTER });
    render(<ContractWorkspace data={data()} canWrite canCorrect={false} selectedMatterId={MATTER} createContract returnTo={RETURN} />);
    fireEvent.change(screen.getByLabelText("合同名称"), { target: { value: "合成新合同" } });
    fireEvent.change(screen.getByLabelText("合同金额（元）"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("金额（元）"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "登记合同" }));
    await screen.findByText("收费安排暂未保存");
    expect(screen.getByLabelText("合同名称")).toHaveValue("合成新合同"); expect(replace).not.toHaveBeenCalled();
    expect(billingRegistrationInput.safeParse(register.mock.calls[0][0]).success).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "登记合同" }));
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    const url = new URL(replace.mock.calls[0][0], "http://lexorder.invalid");
    expect(url.searchParams.get("billingId")).toBe("created-contract"); expect(url.searchParams.get("returnTo")).toBe(RETURN);
  });
  it("从第二份合同发起补充协议，来源固定为该合同，不默认第一份", async () => {
    render(<ContractWorkspace data={data()} canWrite canCorrect={false} selectedMatterId={MATTER} billingId={SECOND} returnTo={RETURN} />);
    expect(screen.queryByText("合成合同一")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增补充协议" }));
    fireEvent.change(screen.getByLabelText("本次追加或调减金额"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("变更原因、服务范围或零收费依据"), { target: { value: "合成追加委托" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "合成变更依据" }));
    fireEvent.click(screen.getByRole("button", { name: "添加新增分期" }));
    fireEvent.change(screen.getByLabelText("新增第1期金额"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存变更草稿" }));
    await waitFor(() => expect(amendment).toHaveBeenCalledOnce());
    expect(amendment.mock.calls[0][0]).toMatchObject({ sourceBillingId: SECOND, sourceRevision: 2 });
    expect(contractTermsInput.safeParse(amendment.mock.calls[0][0]).success).toBe(true);
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(new URL(replace.mock.calls[0][0], "http://lexorder.invalid").searchParams.get("billingId")).toBe("created-amendment");
  });
  it("指定原合同草稿接现行签署服务并定位原 ID", async () => {
    const rows = data(); rows.billings[1] = { ...rows.billings[1], status: "DRAFT", signedAt: null };
    render(<ContractWorkspace data={rows} canWrite canCorrect={false} selectedMatterId={MATTER} billingId={SECOND} returnTo={RETURN} />);
    fireEvent.click(screen.getByRole("button", { name: "确认签署" }));
    fireEvent.click(screen.getByRole("button", { name: "确认签署" }));
    await waitFor(() => expect(sign).toHaveBeenCalledOnce());
    expect(sign.mock.calls[0][0]).toMatchObject({ id: SECOND, revision: 2 });
    expect(new URL(replace.mock.calls[0][0], "http://lexorder.invalid").searchParams.get("billingId")).toBe(SECOND);
  });
});
