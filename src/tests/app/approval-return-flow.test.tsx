import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getApprovalDetail, listApprovalWorkspace } from "@/server/approval-permissions/inbox";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), approve: vi.fn(), convert: vi.fn(), ask: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), params: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }), useSearchParams: () => new URLSearchParams(mocks.params) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/approval-permissions/inbox", () => ({ getApprovalDetail: mocks.detail }));
vi.mock("@/app/(app)/approvals/approval-create-menu", () => ({ ApprovalCreateMenu: () => null }));
vi.mock("@/components/matters/execution-termination-panel", () => ({ ExecutionTerminationPanel: () => null }));
vi.mock("@/app/(app)/approvals/invoice-recognition", () => ({ InvoiceRecognition: () => null }));
vi.mock("@/server/invoices/actions", () => ({ approveInvoiceRequest: mocks.approve, rejectInvoiceRequest: vi.fn() }));
vi.mock("@/server/intakes/actions", () => ({ convertIntakeToMatter: mocks.convert, declineIntake: vi.fn(), markIntakeNeedsRevision: vi.fn(), resubmitIntake: vi.fn() }));
vi.mock("@/server/documents/actions", () => ({ approveDocument: vi.fn(), rejectDocument: vi.fn(), submitDocumentForReview: vi.fn() }));
vi.mock("@/server/archive/actions", () => ({ approveArchiveRecord: vi.fn(), rejectArchiveRecord: vi.fn() }));
vi.mock("@/server/seals/actions", () => ({ approveSealRequest: vi.fn(), rejectSealRequest: vi.fn(), stampSealRequest: vi.fn(), cancelSealRequest: vi.fn(), listSealTypeConfigs: vi.fn() }));
vi.mock("@/app/(app)/approvals/seals/_components/seal-request-sheet", () => ({ SealRequestSheet: () => null }));
import { ApprovalInbox } from "@/app/(app)/approvals/approval-inbox";
import { ApprovalsPanel } from "@/app/(app)/matters/[id]/_components/approvals-panel";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;
const first = { id: "cinvoice0000000000000000001", action: "INVOICE_APPROVE" as const };
const second = { id: "cinvoice0000000000000000002", action: "INVOICE_APPROVE" as const };
const returnA = "/matters/LL-2026-CC-0001?view=work&workPane=facts&procedure=one&stage=two&detail=source&evidence=point&source=original#position";
const returnB = "/matters/LL-2026-CC-0002?view=money";
const data: Awaited<ReturnType<typeof listApprovalWorkspace>> = {
  rows: [], counts: { pending: 0, processed: 0, mine: 0, all: 0 }, canViewAll: false,
  total: 0, page: 1, pageSize: 20, query: { tab: "mine", page: 1 },
};
function detail(title: string, href: string | null = returnA): Detail {
  return { title, status: "PENDING", requester: "合成申请人", submittedAt: new Date("2026-11-16T08:00:00Z"), task: "approve",
    fields: [], attachments: [], history: [], intakeDetail: null, archiveReview: null, sealType: null, canResubmit: false, canCancel: false,
    returnTarget: href === null ? { status: "UNAVAILABLE", href: null } : { status: "AVAILABLE", href } };
}
const intakeSelection = { id: "cintake000000000000000001", action: "INTAKE_APPROVE" as const };
const materialHref = "/matters/TEST-CONVERTED?view=work&workPane=materials&procedure=actual-procedure&stage=unassigned";
const converted = { ok: true, matterId: "cmatter000000000000000003", internalCode: "TEST-CONVERTED", procedureId: "actual-procedure",
  materialContinuation: { status: "AVAILABLE", intakeHref: `/intakes/${intakeSelection.id}`, empty: false, unassigned: true,
    targets: [{ href: materialHref, label: "合成程序 · 未归属环节材料" }] } };
async function approveIntake() {
  await screen.findByRole("dialog", { name: "合成收案 A" });
  fireEvent.click(screen.getByRole("checkbox", { name: /已核对申请资料/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /同意按申请登记/ }));
  fireEvent.click(screen.getByRole("button", { name: "审批通过" }));
}
function prepareConversion(result = converted) {
  mocks.params = new URLSearchParams({ type: intakeSelection.action, id: intakeSelection.id, returnTo: returnA }).toString();
  window.history.replaceState(null, "", `/approvals?${mocks.params}`);
  mocks.detail.mockResolvedValue({ ...detail("合成收案 A"), intakeDetail: { rounds: [], currentParties: [], sections: [], checks: [] } });
  mocks.convert.mockResolvedValue(result);
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.ask.mockResolvedValue(false);
  mocks.params = new URLSearchParams({ tab: "mine", type: first.action, id: first.id, returnTo: returnA }).toString();
  mocks.detail.mockResolvedValue(detail("申请 A"));
});
afterEach(cleanup);

describe("审批详情读取、轮次与返回案件", () => {
  it("案件用印详情直达现行审批入口，并将程序和列表位置带入获准回程", async () => {
    const seal = { id: "cseal000000000000000000001", action: "SEAL_APPROVE" as const };
    const returnTo = "/matters/LL-2026-CC-0001?view=seal&procedure=one&list=tab%3Dactive%26page%3D2";
    const { unmount } = render(<ApprovalsPanel matterId="cmatter000000000000000001" matterTitle="合成案件" canRequest={false} returnTo={returnTo}
      sealContracts={[{ id: seal.id, code: "SYNTHETIC-001", documentTitle: "合成用印申请", status: "PENDING", createdAt: new Date("2026-11-16T08:00:00Z"),
        draftDoc: { id: "cdocument0000000000000001", name: "合成材料.pdf", size: 10, createdAt: new Date("2026-11-16T08:00:00Z") }, stampedDoc: null }]} />);
    const target = new URL(screen.getByRole("link", { name: "详情" }).getAttribute("href")!, "http://lexorder.invalid");
    expect(target.pathname).toBe("/approvals");
    expect(target.searchParams.get("type")).toBe(seal.action);
    expect(target.searchParams.get("id")).toBe(seal.id);
    expect(target.searchParams.get("returnTo")).toBe(returnTo);
    unmount();
    mocks.params = target.searchParams.toString();
    mocks.detail.mockResolvedValue(detail("合成用印申请", returnTo));
    render(<ApprovalInbox data={data} initialSelection={seal} returnTo={target.searchParams.get("returnTo")!} />);
    const dialog = await screen.findByRole("dialog", { name: "合成用印申请" });
    expect(mocks.detail).toHaveBeenLastCalledWith({ ...seal, returnTo });
    expect(within(dialog).getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnTo);
  });

  it("失败深链接保留可重试详情，成功后关闭仍保留完整案件返回位置", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("合成读取失败"));
    render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    expect(await screen.findByText("合成读取失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    const dialog = await screen.findByRole("dialog", { name: "申请 A" });
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(mocks.detail).toHaveBeenLastCalledWith({ ...first, returnTo: returnA });
    expect(within(dialog).getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnA);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnA);
  });

  it("A 读取迟到不会覆盖 URL 已切换的 B 详情或返回链接", async () => {
    let finishA!: (value: Detail) => void;
    mocks.detail.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; })).mockResolvedValueOnce(detail("申请 B", returnB));
    const { rerender } = render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledOnce());
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    const dialog = await screen.findByRole("dialog", { name: "申请 B" });
    await act(async () => { finishA(detail("申请 A")); });
    expect(screen.getByRole("dialog", { name: "申请 B" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnB);
    expect(screen.queryByRole("dialog", { name: "申请 A" })).not.toBeInTheDocument();
  });

  it("关闭尚在读取的详情后，迟到结果不能重新打开或发布返回入口", async () => {
    let finish!: (value: Detail) => void;
    mocks.detail.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    fireEvent.click(await screen.findByRole("button", { name: "返回审批列表" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => { finish(detail("申请 A")); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "返回案件" })).not.toBeInTheDocument();
  });

  it("未保存意见关闭默认继续，拒绝 URL 换对象时保留草稿并恢复原申请位置", async () => {
    const { rerender } = render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    const note = await screen.findByRole("textbox", { name: "审批意见或驳回原因" });
    fireEvent.change(note, { target: { value: "尚未提交的核对意见" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续填写" })));
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    const restored = new URL(mocks.replace.mock.calls.at(-1)![0], "http://lexorder.invalid");
    expect(restored.searchParams.get("id")).toBe(first.id);
    expect(restored.searchParams.get("returnTo")).toBe(returnA);
    expect(screen.getByRole("textbox", { name: "审批意见或驳回原因" })).toHaveValue("尚未提交的核对意见");
    expect(mocks.detail).toHaveBeenCalledOnce();
  });

  it("相同对象重验返回地址不清空意见，错配来源不继续显示旧案件入口", async () => {
    const { rerender } = render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "保留当前意见" } });
    mocks.detail.mockResolvedValueOnce(detail("申请 A", null));
    mocks.params = new URLSearchParams({ type: first.action, id: first.id, returnTo: returnB }).toString();
    rerender(<ApprovalInbox data={data} initialSelection={first} returnTo={returnB} />);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("link", { name: "案件列表" })).toHaveAttribute("href", "/matters");
    expect(screen.queryByRole("link", { name: "返回案件" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "审批意见或驳回原因" })).toHaveValue("保留当前意见");
  });

  it("处理未决时阻止关闭和 URL 换对象；完成后保留返回案件入口", async () => {
    let finish!: (value: { ok: true }) => void;
    mocks.approve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    fireEvent.click(await screen.findByRole("button", { name: "审批通过" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.detail).toHaveBeenCalledOnce();
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnA);
  });

  it("G11 转案成功留在工作台并保 returnTo；旧结果链接读取后来审批的最新草稿", async () => {
    prepareConversion();
    const view = render(<ApprovalInbox data={data} initialSelection={intakeSelection} returnTo={returnA} />);
    await approveIntake();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("案件已创建 · TEST-CONVERTED")).toBeVisible();
    expect(screen.getByRole("link", { name: "合成程序 · 未归属环节材料" })).toHaveAttribute("href", materialHref);
    expect(screen.getByRole("link", { name: "返回案件" })).toHaveAttribute("href", returnA);
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    mocks.detail.mockResolvedValue(detail("后续申请 B", returnB));
    view.rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "B 的尚未保存意见" } });
    fireEvent.click(screen.getByText("合成程序 · 未归属环节材料", { selector: "a" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel" })));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "审批意见或驳回原因" })).toHaveValue("B 的尚未保存意见");
    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText("合成程序 · 未归属环节材料", { selector: "a" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(materialHref));
  });

  it("G11 结果链接等待放弃确认时若当前审批开始提交，不执行迟到导航", async () => {
    prepareConversion();
    const view = render(<ApprovalInbox data={data} initialSelection={intakeSelection} returnTo={returnA} />);
    await approveIntake(); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    mocks.detail.mockResolvedValue(detail("后续申请 B", returnB));
    view.rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "B 当前处理意见" } });
    let confirm!: (accepted: boolean) => void, finish!: (value: { ok: true }) => void;
    mocks.ask.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    mocks.approve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByText("合成程序 · 未归属环节材料", { selector: "a" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "审批通过" }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());
    await act(async () => confirm(true));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "审批意见或驳回原因" })).toHaveValue("B 当前处理意见");
    await act(async () => finish({ ok: true }));
  });

  it("G11 旧结果链接的放弃确认迟到时，不越过后来已经选择的另一申请", async () => {
    prepareConversion();
    const view = render(<ApprovalInbox data={data} initialSelection={intakeSelection} returnTo={returnA} />);
    await approveIntake(); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    mocks.params = new URLSearchParams({ type: second.action, id: second.id, returnTo: returnB }).toString();
    mocks.detail.mockResolvedValue(detail("后续申请 B", returnB));
    view.rerender(<ApprovalInbox data={data} initialSelection={second} returnTo={returnB} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "B 的意见" } });
    let confirm!: (accepted: boolean) => void;
    mocks.ask.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    fireEvent.click(screen.getByText("合成程序 · 未归属环节材料", { selector: "a" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce());
    mocks.ask.mockResolvedValueOnce(true);
    mocks.params = new URLSearchParams({ type: first.action, id: first.id, returnTo: returnA }).toString();
    mocks.detail.mockResolvedValue(detail("后来选择的申请 C", returnA));
    view.rerender(<ApprovalInbox data={data} initialSelection={first} returnTo={returnA} />);
    await screen.findByRole("dialog", { name: "后来选择的申请 C" });
    fireEvent.change(screen.getByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "C 的新草稿" } });
    await act(async () => confirm(true));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "审批意见或驳回原因" })).toHaveValue("C 的新草稿");
  });

  it("G11 材料接续失败仍显示创建成功，不猜收案重试链接，也不重读失效审批表单", async () => {
    prepareConversion();
    mocks.convert.mockResolvedValue({ ...converted, materialContinuation: { status: "UNAVAILABLE", intakeHref: null } });
    render(<ApprovalInbox data={data} initialSelection={intakeSelection} returnTo={returnA} />);
    await approveIntake();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("案件已创建 · TEST-CONVERTED")).toBeVisible();
    expect(screen.getByText(/材料接续暂不可用.*有权经办/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /材料|重新读取收案/ })).not.toBeInTheDocument();
    expect(mocks.convert).toHaveBeenCalledOnce(); expect(mocks.detail).toHaveBeenCalledOnce(); expect(mocks.push).not.toHaveBeenCalled();
  });
});
