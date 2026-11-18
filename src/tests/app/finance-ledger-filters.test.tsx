import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceViewV4 } from "@/app/(app)/finance/_components/finance-view-v4";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), reject: vi.fn(), prompt: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/finance/actions", () => ({ confirmFeeEntry: mocks.confirm, rejectFeeEntry: mocks.reject }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ promptDialog: mocks.prompt }));
vi.mock("@/components/dashboard/revenue-chart", () => ({ RevenueChart: () => null }));
vi.mock("@/app/(app)/finance/_components/invoice-create-dialog", () => ({ InvoiceCreateDialog: () => null }));
vi.mock("@/app/(app)/finance/_components/invoice-management", () => ({ InvoiceManagementSection: () => null }));
vi.mock("@/app/(app)/finance/_components/record-fee-launcher", () => ({ RecordFeeLauncher: () => null }));

type Props = ComponentProps<typeof FinanceViewV4>;
type Entry = Props["entries"][number];

function entry(id: string, title: string, type: Entry["type"], daysAgo: number): Entry {
  return {
    id, type, amount: 120.1, occurredAt: new Date(Date.now() - daysAgo * 86_400_000),
    payerOrPayee: null, method: null, invoiceNo: null, note: null, confirmed: false,
    confirmState: "CONFIRMED", matter: { id, internalCode: id, title },
    beneficiaryUser: null, recordedBy: { id: "author", name: "合成登记人" }, confirmedBy: null,
  };
}

const agingEntry = {
  id: "overdue", title: "合成逾期应收", outstanding: 120, dueDate: null, overdueDays: 10,
  matter: { id: "aging-matter", internalCode: "aging-matter", title: "合成事项", clientName: null },
};

const baseProps: Props = {
  entries: [], monthly: [], aging: {
    items: [agingEntry], buckets: [{ key: "notDue", label: "未到期", amount: 0, count: 0 }, { key: "d30", label: "逾期 1–30 天", amount: 120, count: 1 }],
    totalOutstanding: 120, overdueAmount: 120, worst: agingEntry, matterCount: 1,
  },
  stats: {
    monthlyReceived: 0, monthlyReceivable: 0, yearlyReceived: 0, yearlyReceivable: 0,
    lastMonthReceived: 0, personalMonthly: 0, personalYearly: 0, monthlyIssued: 0,
    pendingInvoiceCount: 0, monthConfirmedCount: 0, monthPendingCount: 0, monthPendingAmount: 0,
  },
  invoiceRequests: [], invoiceReconciliation: [],
  canApproveInvoice: false, canExport: false, canWrite: false, canConfirmReceipt: false,
};

async function choose(filter: string, option: string) {
  const control = screen.getByRole("combobox", { name: filter });
  fireEvent.click(control);
  expect(control).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(await screen.findByRole("option", { name: name => name === option || name === "tick " + option }));
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe("财务 Semi 流水控件", () => {
  it("默认近 90 天；重置期间与按类型、搜索筛选可叠加", async () => {
    render(<FinanceViewV4 {...baseProps} entries={[
      entry("recent-fee", "本月合成收款", "RECEIVED", 1),
      entry("old-cost", "历史合成付款", "COST", 120),
    ]} />);
    expect(screen.getByText("本月合成收款")).toBeInTheDocument();
    expect(screen.queryByText("历史合成付款")).not.toBeInTheDocument();

    const period = screen.getByRole("combobox", { name: "期间" });
    act(() => period.focus());
    fireEvent.keyDown(period, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    expect(period).toHaveAttribute("aria-expanded", "true");
    const allPeriods = await screen.findByRole("option", { name: /^(?:tick )?全部$/ });
    expect(period).toHaveAttribute("aria-activedescendant", allPeriods.id);
    fireEvent.keyDown(period, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(screen.getByText("历史合成付款")).toBeInTheDocument();
    await choose("类型", "付款");
    expect(screen.queryByText("本月合成收款")).not.toBeInTheDocument();
    expect(screen.getByText("历史合成付款")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索流水" }), { target: { value: "无匹配案件" } });
    expect(screen.getByText("没有匹配的收付记录")).toBeInTheDocument();
  });

  it("无确认权限时不呈现动作，有权限取消退回原因时不写入", async () => {
    const pendingEntries = [{ ...entry("pending-fee", "待确认收款", "RECEIVED", 1), confirmState: "PENDING" as const }];
    const { rerender } = render(<FinanceViewV4 {...baseProps} pendingEntries={pendingEntries} />);
    expect(screen.queryByRole("button", { name: "确认到账" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退回" })).not.toBeInTheDocument();

    mocks.prompt.mockResolvedValueOnce(null);
    rerender(<FinanceViewV4 {...baseProps} pendingEntries={pendingEntries} canConfirmReceipt />);
    expect(screen.getByRole("button", { name: "确认到账" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "退回" }));
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({ required: true, danger: true })));
    expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
