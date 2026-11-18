import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mock = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), approve: vi.fn(), reject: vi.fn(), archive: vi.fn(),
  confirm: vi.fn(), prompt: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/server/external-contacts/actions", () => ({
  createExternalContact: mock.create, updateExternalContact: mock.update,
  approveExternalContact: mock.approve, rejectExternalContact: mock.reject, archiveExternalContact: mock.archive
}));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm, promptDialog: mock.prompt }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: mock.success }),
    Notification: Object.assign(semi.Notification, { success: mock.success, error: mock.error })
  };
});

import { ExternalContactDialog } from "@/app/(app)/contacts/_components/external-contact-dialog";
import { ContactsView } from "@/app/(app)/contacts/_components/contacts-view";

type Contact = ComponentProps<typeof ContactsView>["externalContacts"][number];
const contact: Contact = {
  id: "contact-synthetic-court", name: "合成法院联系人", category: "COURT", organization: "合成法院",
  title: "合成职务", phone: "000-0000", email: "court@example.invalid", wechat: "synthetic", address: "合成地址",
  notes: "合成备注", tags: ["已有标签"], status: "PENDING_REVIEW", createdBy: { id: "creator", name: "合成提交人" },
  reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: new Date("2026-11-18T00:00:00Z")
};

beforeEach(() => {
  vi.resetAllMocks();
  mock.create.mockResolvedValue({ status: "PENDING_REVIEW" });
  mock.update.mockResolvedValue({ ok: true });
  mock.approve.mockResolvedValue({ ok: true });
  mock.reject.mockResolvedValue({ ok: true });
  mock.archive.mockResolvedValue({ ok: true });
  mock.confirm.mockResolvedValue(true);
  mock.prompt.mockResolvedValue(null);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("通讯录 Semi 控件（服务动作替身）", () => {
  it("编辑的值与已有标签完整提交，失败保留输入，重试成功才关闭", async () => {
    mock.update.mockRejectedValueOnce(new Error("save failed"));
    const close = vi.fn();
    render(<ExternalContactDialog open onOpenChange={close} editing={contact} />);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "修改后合成联系人" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "修改后备注" } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith(expect.objectContaining({ title: "保存失败", content: expect.any(String) })));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("姓名")).toHaveValue("修改后合成联系人");
    expect(screen.getByLabelText("备注")).toHaveValue("修改后备注");
    expect(mock.update).toHaveBeenCalledWith({
      id: contact.id, name: "修改后合成联系人", category: "COURT", organization: contact.organization,
      title: contact.title, phone: contact.phone, email: contact.email, wechat: contact.wechat,
      address: contact.address, notes: "修改后备注", tags: ["已有标签"]
    });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mock.refresh).toHaveBeenCalledOnce();
  });

  it("类别下拉留在表单内，Escape 先关闭下拉，创建仍按服务端状态待审核", async () => {
    const close = vi.fn();
    render(<ExternalContactDialog open onOpenChange={close} editing={null} />);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "合成仲裁联系人" } });
    const category = screen.getByRole("combobox", { name: "类别 *" });
    fireEvent.click(category);
    const option = await screen.findByRole("option", { name: /仲裁/ });
    expect(screen.getByRole("dialog", { name: "新增外部联系人" })).toContainElement(option);
    fireEvent.keyDown(category, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(category).toHaveAttribute("aria-expanded", "false"));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(category);
    fireEvent.click(await screen.findByRole("option", { name: /仲裁/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ name: "合成仲裁联系人", category: "ARBITRATION", tags: [] })));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mock.success).toHaveBeenCalledWith("已提交审核，管理员通过后展示");
  });

  it("保存中锁住输入及关闭，失败后仍可继续编辑", async () => {
    let fail!: (reason: Error) => void;
    mock.update.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const close = vi.fn();
    render(<ExternalContactDialog open onOpenChange={close} editing={contact} />);
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
    expect(screen.getByLabelText("姓名")).toBeDisabled();
    expect(screen.getByLabelText("备注")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "类别 *" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(mock.update).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await act(async () => fail(new Error("save failed")));
    await waitFor(() => expect(screen.getByLabelText("姓名")).toBeEnabled());
    expect(screen.getByLabelText("姓名")).toHaveValue(contact.name);
    expect(close).not.toHaveBeenCalled();
  });

  it("类别与搜索共同筛选，普通经办人只编辑自己记录且没有审核按钮", async () => {
    const other: Contact = { ...contact, id: "contact-synthetic-expert", name: "合成鉴定联系人", category: "EXPERT", organization: "合成鉴定所", createdBy: { id: "other", name: "他人" } };
    render(<ContactsView colleagues={[]} externalContacts={[contact, other]} currentUserId="creator" currentUserRole="LAWYER" />);
    expect(screen.getByRole("button", { name: `编辑联系人 ${contact.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `编辑联系人 ${other.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "鉴定专家" }));
    expect(screen.queryByText(contact.name)).not.toBeInTheDocument();
    expect(screen.getByText(other.name)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索联系人" }), { target: { value: "不匹配" } });
    expect(screen.getByText("暂无匹配联系人")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索联系人" }), { target: { value: "鉴定所" } });
    expect(screen.getByText(other.name)).toBeInTheDocument();
  });

  it("审核与归档仍经确认，驳回携原联系人身份与原因", async () => {
    render(<ContactsView colleagues={[]} externalContacts={[contact]} currentUserId="reviewer" currentUserRole="PRINCIPAL_LAWYER" />);
    const row = screen.getByText(contact.name).closest("li")!;
    mock.confirm.mockResolvedValueOnce(false);
    fireEvent.click(within(row).getByRole("button", { name: "通过" }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledOnce());
    expect(mock.approve).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "通过" }));
    await waitFor(() => expect(mock.approve).toHaveBeenCalledWith({ id: contact.id }));
    mock.prompt.mockResolvedValueOnce("请核对合成联系方式");
    fireEvent.click(within(row).getByRole("button", { name: "驳回" }));
    await waitFor(() => expect(mock.reject).toHaveBeenCalledWith({ id: contact.id, note: "请核对合成联系方式" }));
    mock.confirm.mockResolvedValueOnce(false);
    fireEvent.click(within(row).getByRole("button", { name: `归档联系人 ${contact.name}` }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(3));
    expect(mock.archive).not.toHaveBeenCalled();
  });
});
