import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createContact: vi.fn(), updateContact: vi.fn(), searchEnterprise: vi.fn(), conflicts: vi.fn(),
  refresh: vi.fn(), error: vi.fn(), success: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success, warning: vi.fn() } }));
vi.mock("@/server/external-contacts/actions", () => ({ createExternalContact: mocks.createContact, updateExternalContact: mocks.updateContact }));
vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: mocks.searchEnterprise }));
vi.mock("@/server/conflicts/actions", () => ({ runCheckAndSave: mocks.conflicts }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));

import { ExternalContactDialog } from "@/app/(app)/contacts/_components/external-contact-dialog";
import { ClientCombobox } from "@/app/(app)/intakes/_components/client-combobox";
import { JurisdictionSelect } from "@/app/(app)/intakes/_components/jurisdiction-select";
import { ConflictsViewV4 } from "@/app/(app)/conflicts/_components/conflicts-view-v4";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchEnterprise.mockResolvedValue({ configured: false, items: [] });
  mocks.updateContact.mockResolvedValue({});
  mocks.createContact.mockResolvedValue({ status: "PENDING_REVIEW" });
  mocks.conflicts.mockResolvedValue({ hits: [] });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function RegionSheet() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  return <Sheet open={open} onOpenChange={setOpen}><SheetContent>
    <SheetTitle>程序修改</SheetTitle><SheetDescription>合成程序管辖地</SheetDescription>
    <JurisdictionSelect value={value} onChange={setValue} />
  </SheetContent></Sheet>;
}

describe("Semi 收案控件与原业务身份", () => {
  it("三级管辖地在原父抽屉内逐层关闭，退出下拉保留正在编辑的程序", async () => {
    render(<RegionSheet />);
    const trigger = screen.getByRole("button", { name: "选择管辖地" });
    fireEvent.click(trigger);
    const province = await screen.findByRole("combobox", { name: "省 / 直辖市" });
    fireEvent.click(province);
    await screen.findByRole("listbox");
    fireEvent.keyDown(document.activeElement ?? province, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() => expect(province).toHaveAttribute("aria-expanded", "false"));
    expect(screen.getByRole("dialog", { name: "程序修改" })).toBeVisible();
    expect(province).toBeVisible();
    fireEvent.keyDown(province, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "省 / 直辖市" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "程序修改" })).toBeVisible();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("客户下拉选择同名已有客户仍使用具体ID，明确新名称走新建回调", async () => {
    const pick = vi.fn(), create = vi.fn();
    render(<ClientCombobox clientId="" clientName="" clientType="INDIVIDUAL"
      options={[{ id: "first", name: "合成同名客户", type: "INDIVIDUAL" }, { id: "second", name: "合成同名客户", type: "INDIVIDUAL" }]}
      onPickExisting={pick} onTypeNew={create} onPickYuandian={vi.fn()} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "委托方客户" }));
    const options = await screen.findAllByRole("option", { name: /合成同名客户/ });
    fireEvent.click(options[1]);
    expect(pick).toHaveBeenCalledWith("second", "合成同名客户");
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "委托方客户" }));
    const search = screen.getByPlaceholderText("输入姓名 / 公司名");
    fireEvent.change(search, { target: { value: "合成新增委托方" } });
    fireEvent.click(await screen.findByRole("option", { name: /新建 合成新增委托方 为委托方/ }));
    expect(create).toHaveBeenCalledWith("合成新增委托方");
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("联系人更新失败保留修改后的输入和原ID，重试沿同一编辑对象", async () => {
    const close = vi.fn();
    mocks.updateContact.mockRejectedValueOnce(new Error("合成保存失败"));
    const editing = { id: "contact-original", name: "合成联系人", category: "COURT" as const, organization: "合成机构", title: null,
      phone: null, email: null, wechat: null, address: null, notes: null, tags: ["原标签"] };
    render(<ExternalContactDialog open onOpenChange={close} editing={editing} />);
    fireEvent.change(screen.getByRole("textbox", { name: "电话" }), { target: { value: "000-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "电话" })).toHaveValue("000-123456");
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.updateContact).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "contact-original", phone: "000-123456", tags: ["原标签"] }));
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("联系人类别下拉的 Escape 先收下拉，第二次才退出编辑", async () => {
    const close = vi.fn();
    render(<ExternalContactDialog open onOpenChange={close} editing={null} />);
    const category = screen.getByRole("combobox", { name: "类别 *" });
    fireEvent.click(category);
    await screen.findByRole("listbox");
    fireEvent.keyDown(category, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() => expect(category).toHaveAttribute("aria-expanded", "false"));
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(category, { key: "Escape", keyCode: 27, which: 27 });
    expect(close).toHaveBeenCalledWith(false);
  });

  it("冲突预检仍提交输入主体而非正式收案结论，失败后可沿原输入重试", async () => {
    mocks.conflicts.mockRejectedValueOnce(new Error("合成检索失败"));
    render(<ConflictsViewV4 prefillName="合成预检主体" />);
    fireEvent.change(screen.getByRole("textbox", { name: "证件号码" }), { target: { value: " ab 12 " } });
    fireEvent.click(screen.getByRole("button", { name: /开始预检|运行预检|运行检索|开始检索/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "证件号码" })).toHaveValue("AB12");
    fireEvent.click(screen.getByRole("button", { name: /开始预检|运行预检|运行检索|开始检索/ }));
    await waitFor(() => expect(mocks.conflicts).toHaveBeenCalledTimes(2));
    expect(mocks.conflicts).toHaveBeenLastCalledWith({ queries: [{ role: "CLIENT_PARTY", name: "合成预检主体", idNumber: "AB12" }] });
    expect(screen.queryByRole("button", { name: "可承接" })).not.toBeInTheDocument();
  });
});
