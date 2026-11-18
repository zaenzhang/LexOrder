import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { context, search, prepare, create, upload, push } = vi.hoisted(() => ({ context: vi.fn(), search: vi.fn(), prepare: vi.fn(), create: vi.fn(), upload: vi.fn(), push: vi.fn() }));
vi.mock("@/server/finance/actions", () => ({ getMatterInvoiceContext: context, searchMattersForInvoice: search, prepareInvoiceRequestUpload: prepare, createInvoiceRequest: create }));
vi.mock("@/server/documents/actions", () => ({ uploadDocument: upload }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/matters/TEST-001", useSearchParams: () => new URLSearchParams("view=finance") }));
import { InvoiceRequestSheet } from "@/app/(app)/matters/[id]/_components/invoice-request-sheet";
import { InvoiceCreateDialog } from "@/app/(app)/finance/_components/invoice-create-dialog";

const MATTER = "cmatter000000000000000001", SECOND = "cmatter000000000000000002", DOC = "cdocument000000000000001";
const data = (id = MATTER) => ({ matterId: id, matterTitle: id === MATTER ? "合成案件一" : "合成案件二", internalCode: id === MATTER ? "TEST-001" : "TEST-002", clientOptions: [{ id: "client-a", name: "合成购方 A", taxNo: "SYNTHETIC-A", isPrimary: true }], evidenceDocuments: [{ id: DOC, name: "已有委托依据", version: 1 }] });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  context.mockImplementation(async (id: string) => data(id));
  search.mockResolvedValue([{ id: MATTER, internalCode: "TEST-001", title: "合成案件一" }, { id: SECOND, internalCode: "TEST-002", title: "合成案件二" }]);
  prepare.mockResolvedValue(undefined); create.mockResolvedValue({ id: "cinvoice000000000000001", status: "PENDING" });
  upload.mockResolvedValue({ ok: true, id: "cuploaded00000000000001" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
}
async function fillBase() {
  fireEvent.change(await screen.findByLabelText("开票金额（元） *"), { target: { value: "120" } });
  await choose("开票类型 *", "普通发票");
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "提交申请" })); }

describe("开票申请恢复与上下文", () => {
  it("已有材料直接提交并定位本次申请，带回案件财务位置", async () => {
    render(<InvoiceRequestSheet matterId={MATTER} open onOpenChange={vi.fn()} />);
    await fillBase();
    fireEvent.click(screen.getByRole("checkbox", { name: "已有委托依据 v1" }));
    submit();
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({ matterId: MATTER, evidenceDocIds: [DOC], requestKey: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(upload).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    const url = new URL(push.mock.calls[0][0], "https://synthetic.test");
    expect(url.searchParams.get("id")).toBe("cinvoice000000000000001");
    expect(url.searchParams.get("returnTo")).toBe("/matters/TEST-001?view=finance");
  });
  it("客户 A 切换至无税号的 B 时整体重置购方，不沿用地址、电话和账户", async () => {
    context.mockResolvedValue({ ...data(), clientOptions: [...data().clientOptions, { id: "client-b", name: "合成购方 B", taxNo: null, isPrimary: false }] });
    render(<InvoiceRequestSheet matterId={MATTER} open onOpenChange={vi.fn()} />);
    await screen.findByLabelText("开票金额（元） *");
    await choose("开票抬头 *", "合成购方 A（主要客户）");
    await choose("开票类型 *", "增值税专用发票");
    for (const label of ["开户银行 *", "银行账号 *", "购方地址 *", "购方电话 *"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "A 的合成资料" } });
    expect(screen.getByLabelText("纳税人识别号 *")).toHaveValue("SYNTHETIC-A");
    await choose("开票抬头 *", "合成购方 B");
    for (const label of ["纳税人识别号 *", "开户银行 *", "银行账号 *", "购方地址 *", "购方电话 *"]) expect(screen.getByLabelText(label)).toHaveValue("");
  });
  it("案件资料真实加载与失败重试，迟到的旧案件不覆盖新案件", async () => {
    let resolveFirst!: (value: ReturnType<typeof data>) => void;
    context.mockImplementation((id: string) => id === MATTER ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(data(SECOND)));
    render(<InvoiceCreateDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "TEST-001 · 合成案件一" }));
    await screen.findByText("正在读取案件资料…");
    expect(screen.getByRole("button", { name: "提交申请" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "更换案件" }));
    fireEvent.click(screen.getByRole("button", { name: "TEST-002 · 合成案件二" }));
    await screen.findByLabelText("开票金额（元） *");
    await act(async () => resolveFirst({ ...data(), clientOptions: [{ id: "old", name: "迟到的旧购方", taxNo: "OLD", isPrimary: true }] }));
    expect(screen.queryByText("迟到的旧购方")).not.toBeInTheDocument();
    expect(screen.getByText("TEST-002 · 合成案件二")).toBeInTheDocument();
  });
  it("上下文读取失败留在当前操作，可重试，失败时不能提交", async () => {
    context.mockRejectedValueOnce(new Error("案件资料暂时无法读取"));
    render(<InvoiceRequestSheet matterId={MATTER} open onOpenChange={vi.fn()} />);
    await screen.findByText("案件资料暂时无法读取");
    expect(screen.getByRole("button", { name: "提交申请" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    await screen.findByLabelText("开票金额（元） *");
    expect(context).toHaveBeenCalledTimes(2);
  });
  it("第二个附件失败只续传失败项；申请响应丢失重试保留提交键及成功附件 ID", async () => {
    const firstDoc = "cuploaded00000000000001", secondDoc = "cuploaded00000000000002";
    upload.mockResolvedValueOnce({ ok: true, id: firstDoc }).mockResolvedValueOnce({ ok: false, code: "REJECTED_BEFORE_RESERVATION", message: "第二份暂时上传失败" }).mockResolvedValueOnce({ ok: true, id: secondDoc });
    create.mockRejectedValueOnce(new Error("申请响应中断")).mockResolvedValue({ id: "cinvoice000000000000001", status: "APPROVED" });
    render(<InvoiceRequestSheet matterId={MATTER} open onOpenChange={vi.fn()} />);
    await fillBase();
    fireEvent.change(screen.getByLabelText("添加开票依据"), { target: { files: [new File(["first"], "第一份.txt", { type: "text/plain" }), new File(["second"], "第二份.txt", { type: "text/plain" })] } });
    submit();
    await screen.findByText("第二份暂时上传失败");
    expect(create).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledTimes(2);
    const firstKey = (upload.mock.calls[0][0] as FormData).get("requestKey"), secondKey = (upload.mock.calls[1][0] as FormData).get("requestKey");
    expect(firstKey).not.toBe(secondKey);
    fireEvent.click(screen.getByRole("button", { name: "重试上传" }));
    await waitFor(() => expect(screen.getAllByText("已保存")).toHaveLength(2));
    expect(upload).toHaveBeenCalledTimes(3);
    expect((upload.mock.calls[2][0] as FormData).get("requestKey")).toBe(secondKey);
    submit();
    await screen.findByText("申请响应中断");
    const identity = create.mock.calls[0][0].requestKey;
    expect(create.mock.calls[0][0].evidenceDocIds).toEqual([firstDoc, secondDoc]);
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(create.mock.calls[1][0]).toMatchObject({ requestKey: identity, evidenceDocIds: [firstDoc, secondDoc] });
    expect(upload).toHaveBeenCalledTimes(3); expect(prepare).toHaveBeenCalledTimes(2);
  });
});
