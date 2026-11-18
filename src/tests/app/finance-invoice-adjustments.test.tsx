import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceAdjustments } from "@/app/(app)/finance/reconciliation/_components/invoice-adjustments";
import type { getFinanceLedger } from "@/server/finance/ledger-actions";

const mocks = vi.hoisted(() => ({ adjust: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("@/server/finance/ledger-actions", () => ({ adjustInvoice: mocks.adjust }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn() }),
    Notification: Object.assign(semi.Notification, { success: vi.fn(), error: mocks.error })
  };
});

type Data = Awaited<ReturnType<typeof getFinanceLedger>>;
const data: Data = {
  contractDocuments: [], invoiceAdjustments: [], documents: [{ id: "proof", matterId: "matter", name: "合成红冲凭证" }],
  procedures: [], scopes: [], expenses: [], currentUserId: "finance-user", corrections: [], allocations: [], invoiceLinks: [],
  commissions: [], settlements: [], ready: true, matters: [],
  summary: { receivable: "0.00", outstanding: "0.00", netReceived: "0.00", unallocated: "0.00", lawyerFeeReceived: "0.00", clientFundsReceived: "0.00" },
  pending: [], billings: [], receivables: [], payments: [],
  invoices: [{ id: "original", matterId: "matter", invoiceNo: "TEST-001", amount: "120.00", linked: "0.00", outstanding: "120.00" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fill() {
  fireEvent.click(screen.getByRole("button", { name: "登记发票更正" }));
  fireEvent.change(await screen.findByLabelText("外部凭证编号"), { target: { value: "SYNTHETIC-RED-01" } });
  fireEvent.change(screen.getByLabelText("处理说明"), { target: { value: "合成红冲已在外部完成" } });
}
async function chooseProof() {
  fireEvent.click(screen.getByRole("combobox", { name: "本案处理依据文件" }));
  fireEvent.click(await screen.findByRole("option", { name: /合成红冲凭证/ }));
}

describe("发票外部处理登记", () => {
  it("Semi 选择框保留必选材料限制，失败保稿并按同一票据与材料重试", async () => {
    mocks.adjust.mockResolvedValueOnce({ ok: false, message: "登记暂未保存" }).mockResolvedValueOnce({ ok: true });
    render(<InvoiceAdjustments data={data} canCorrect />);
    await fill();
    expect(screen.getByRole("button", { name: "确认登记外部处理结果" })).toBeDisabled();
    await chooseProof();
    fireEvent.click(screen.getByRole("button", { name: "确认登记外部处理结果" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ title: "登记暂未保存" })));
    expect(screen.getByLabelText("外部凭证编号")).toHaveValue("SYNTHETIC-RED-01");
    expect(mocks.adjust.mock.calls[0][0]).toMatchObject({ invoiceId: "original", documentId: "proof", amount: "120.00", kind: "RED" });
    fireEvent.click(screen.getByRole("button", { name: "确认登记外部处理结果" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.adjust.mock.calls[1][0]).toEqual(mocks.adjust.mock.calls[0][0]);
  });

  it("保存期间显式禁用下拉并阻止 Escape，失败后可继续操作", async () => {
    let finish!: (result: { ok: boolean; message: string }) => void;
    mocks.adjust.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<InvoiceAdjustments data={data} canCorrect />);
    await fill();
    await chooseProof();
    fireEvent.click(screen.getByRole("button", { name: "确认登记外部处理结果" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "原发票" })).toHaveAttribute("aria-disabled", "true"));
    fireEvent.keyDown(screen.getByLabelText("外部凭证编号"), { key: "Escape", code: "Escape", keyCode: 27 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => finish({ ok: false, message: "稍后重试" }));
    expect(screen.getByRole("combobox", { name: "原发票" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByLabelText("处理说明")).toHaveValue("合成红冲已在外部完成");
    expect(mocks.adjust).toHaveBeenCalledOnce();
  });
});
