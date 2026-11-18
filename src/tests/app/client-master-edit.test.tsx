import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Contact } from "@prisma/client";
import type { RoleUser } from "@/lib/roles/catalog";

const mock = vi.hoisted(() => ({
  user: { id: "cmtestuser0000000000000001", role: "LAWYER", runtimeMode: "SERVER" } as RoleUser & { id: string },
  list: vi.fn(), get: vi.fn(), edit: vi.fn(), update: vi.fn(), create: vi.fn(), editableIds: vi.fn(),
  finance: vi.fn(), insights: vi.fn(), relationship: vi.fn(), history: vi.fn(), refresh: vi.fn(), error: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: mock.user }) }));
vi.mock("@/server/clients/actions", () => ({ listClients: mock.list, getClientById: mock.get, getClientForEdit: mock.edit, updateClient: mock.update, createClient: mock.create, getClientFinanceSummary: mock.finance, addContact: vi.fn() }));
vi.mock("@/server/clients/master-access", () => ({ editableClientIds: mock.editableIds }));
vi.mock("@/server/clients/insights", () => ({ getClientInsights: mock.insights }));
vi.mock("@/server/clients/relationship-actions", () => ({ getClientRelationship: mock.relationship, recordClientActivity: vi.fn(), getClientCommunicationPage: vi.fn(), getClientFollowUpPage: vi.fn() }));
vi.mock("@/server/clients/history-actions", () => ({ getClientHistoryPage: mock.history, getClientMatterPage: vi.fn(), getClientHistoryMatterPage: vi.fn() }));
vi.mock("@/server/clients/dedup", () => ({ mergeClientsByCode: vi.fn() }));
vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: vi.fn(), getEnterpriseDetail: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search), notFound: () => { throw new Error("not found"); } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: mock.error } }));

import ClientsPage from "@/app/(app)/clients/page";
import ClientDetailPage from "@/app/(app)/clients/[id]/page";
import { ClientsView } from "@/app/(app)/clients/_components/clients-view";
import { TopbarActionProvider, useTopbarActionValue } from "@/components/layout/topbar-action";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";
import { ActionError } from "@/lib/action-error";

const date = new Date("2026-11-16T00:00:00Z");
const id = "cmtestclient00000000000001";
const primary: Contact = { id: "cmtestcontact0000000000001", clientId: id, name: "合成主要联系人", isPrimary: true, title: null, phone: null, email: null, wechat: null, notes: null, createdAt: date, updatedAt: date };
const secondary: Contact = { ...primary, id: "cmtestcontact0000000000002", name: "合成次要联系人", isPrimary: false };
const client: Client = { id, name: "合成测试客户", type: "COMPANY", idType: "USCC", idNumber: null, idNumberBlind: null, address: null, legalRep: null, phone: null, email: null, source: null, cooperationStatus: "SIGNED", industry: null, gender: null, ethnicity: null, tags: [], notes: null, internalCode: "KH-TEST-0001", ownerUserId: "cmtestuser0000000000000001", createdAt: date, updatedAt: date, deletedAt: null };
const initialData = { items: [{ ...client, contacts: [primary], _count: { matters: 0, intakes: 0 } }], total: 1, page: 1, pageSize: 20 };
const filters = { search: "", type: "ALL" as const };

function Topbar() {
  const action = useTopbarActionValue();
  return action && action !== "none" ? <button type="button" onClick={action.onClick} disabled={action.disabled}>{action.label}</button> : null;
}
function renderPage(page: React.ReactNode) {
  return render(<TopbarActionProvider><Topbar />{page}<ConfirmHost /></TopbarActionProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `/clients/${id}`);
  mock.user = { id: client.ownerUserId!, role: "LAWYER", runtimeMode: "SERVER" };
  mock.list.mockResolvedValue(initialData);
  mock.get.mockResolvedValue({ ...client, contacts: [primary, secondary], matters: [] });
  mock.edit.mockResolvedValue({ ...client, contacts: [primary, secondary] });
  mock.editableIds.mockResolvedValue([]);
  mock.update.mockResolvedValue({ ok: true });
  mock.create.mockResolvedValue({ ok: true });
  mock.finance.mockResolvedValue(null);
  mock.insights.mockResolvedValue({ matterPage: { items: [], total: 0, activeCount: 0, nextCursor: null }, suspects: [], source: null });
  mock.relationship.mockResolvedValue({ canWrite: true, activityCount: 0, openCount: 0, activities: [], followUps: [] });
  mock.history.mockResolvedValue({ items: [], nextCursor: null, selectedMatter: null });
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Server 客户编辑入口（组件环境）", () => {
  it("客户历史服务端首读使用返回游标，坏参数不会降级读取第一页", async () => {
    window.history.replaceState(null, "", `/clients/${id}?tab=history&historyCursor=opaque-page`);
    const rendered = renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: "history", historyCursor: "opaque-page" }) }));
    expect(mock.history).toHaveBeenCalledWith({ clientId: id, cursor: "opaque-page" });
    rendered.unmount(); mock.history.mockClear();
    window.history.replaceState(null, "", `/clients/${id}?tab=history&historyCursor=a&historyCursor=b`);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: "history", historyCursor: ["a", "b"] }) }));
    expect(mock.history).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("客户动态位置无效");
  });

  it.each([new Error("不得外泄的数据库连接细节"), new ActionError("分页位置已失效，请重新核对")])("客户历史读取错误只公开业务说明：%s", async error => {
    window.history.replaceState(null, "", `/clients/${id}?tab=history&historyCursor=opaque-page`);
    mock.history.mockRejectedValueOnce(error);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: "history", historyCursor: "opaque-page" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent(error instanceof ActionError ? error.message : "客户动态读取失败，请重试");
    expect(screen.queryByText("不得外泄的数据库连接细节")).not.toBeInTheDocument();
    expect(mock.history).toHaveBeenCalledOnce();
  });

  it("普通 LAWYER 的列表保留新建，桌面与移动端都不显示主档编辑", async () => {
    renderPage(await ClientsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "新建客户" })).toBeVisible();
    expect(screen.queryByRole("button", { name: `编辑 ${client.name}` })).not.toBeInTheDocument();
    expect(mock.editableIds).toHaveBeenCalledWith(mock.user, [id]);
  });

  it("只有读取授权的 CUSTOM 不显示新建或编辑", async () => {
    mock.user = { ...mock.user, role: "CUSTOM", rolePermissions: [{ permissionKey: "clients.read", scope: "ALL" }] };
    renderPage(await ClientsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "新建客户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `编辑 ${client.name}` })).not.toBeInTheDocument();
  });

  it("列表只为写入范围内的客户保留两种布局的编辑按钮", () => {
    const outside = { ...initialData.items[0], id: "cmtestclient00000000000002", name: "范围外合成客户" };
    renderPage(<ClientsView initialData={{ ...initialData, items: [...initialData.items, outside], total: 2 }} initialFilters={filters} canCreate editableClientIds={[id]} />);
    expect(screen.getAllByRole("button", { name: `编辑 ${client.name}` })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "编辑 范围外合成客户" })).not.toBeInTheDocument();
  });

  it("列表编辑先加载完整主档，保存姓名修改仍提交两个联系人", async () => {
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    const trigger = screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0];
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByDisplayValue("合成次要联系人")).toBeInTheDocument());
    expect(mock.edit).toHaveBeenCalledWith(id);
    fireEvent.change(screen.getByDisplayValue(client.name), { target: { value: "合成客户已更新" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(mock.update.mock.calls[0][0]).toMatchObject({ id, name: "合成客户已更新", contacts: [{ name: primary.name, isPrimary: true }, { name: secondary.name, isPrimary: false }] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("改名保存刷新后原行不再匹配筛选，关闭表单回搜索输入", async () => {
    let resolveSave: () => void = () => undefined;
    mock.update.mockImplementationOnce(() => new Promise(resolve => { resolveSave = () => resolve({ ok: true }); }));
    const selectedFilters = { ...filters, search: client.name };
    const rendered = renderPage(<ClientsView initialData={initialData} initialFilters={selectedFilters} canCreate editableClientIds={[id]} />);
    const trigger = screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0];
    fireEvent.click(trigger);
    const editor = await screen.findByRole("dialog", { name: "编辑客户" });
    fireEvent.change(within(editor).getByLabelText(/^客户名称\s*\*$/), { target: { value: "已改名的合成客户" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());

    rendered.rerender(<TopbarActionProvider><Topbar />
      <ClientsView initialData={{ ...initialData, items: [], total: 0 }} initialFilters={selectedFilters} canCreate editableClientIds={[]} />
      <ConfirmHost />
    </TopbarActionProvider>);
    expect(trigger.isConnected).toBe(false);
    expect(editor).toBeInTheDocument();
    await act(async () => { resolveSave(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "搜索客户" })).toHaveValue(client.name);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "搜索客户" })).toHaveFocus());
  });

  it("编辑字段可通过标签访问，X 和取消保护修改并回到原行", async () => {
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    const trigger = screen.getAllByRole("button", { name: `编辑 ${client.name}` })[1];
    fireEvent.click(trigger);
    const editor = await screen.findByRole("dialog", { name: "编辑客户" });
    const name = within(editor).getByLabelText(/^客户名称\s*\*$/);
    expect(within(editor).getByLabelText(/^类型\s*\*$/)).toHaveAttribute("role", "combobox");
    expect(within(editor).getByLabelText(/^证件类型\s*\*$/)).toHaveAttribute("role", "combobox");
    expect(within(editor).getByLabelText("合作状态")).toHaveAttribute("role", "combobox");
    expect(within(editor).getAllByLabelText(/^姓名\s*\*$/).map(input => (input as HTMLInputElement).value)).toEqual([primary.name, secondary.name]);
    expect(within(editor).getByRole("button", { name: `删除联系人 ${secondary.name}` })).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "未保存的客户名称" } });
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    const continueButton = await screen.findByRole("button", { name: "继续编辑" });
    expect(continueButton).toHaveFocus();
    fireEvent.click(continueButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument());
    expect(name).toHaveValue("未保存的客户名称");
    fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mock.update).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText(/^客户名称\s*\*$/)).toHaveValue(client.name));
  });

  it("新建时未添加的标签也受 Esc 保护，放弃后回到顶栏入口", async () => {
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    const trigger = screen.getByRole("button", { name: "新建客户" });
    trigger.focus();
    fireEvent.click(trigger);
    const editor = screen.getByRole("dialog", { name: "新建客户" });
    const tag = within(editor).getByLabelText("标签");
    fireEvent.change(tag, { target: { value: "尚未按回车" } });
    tag.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(tag).toHaveFocus());
    expect(tag).toHaveValue("尚未按回车");
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("详情仅切换主要联系人也受保护，未修改关闭可直接回资料入口", async () => {
    mock.editableIds.mockResolvedValue([id]);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "客户资料" }), { key: "Enter" });
    const trigger = screen.getByRole("button", { name: "编辑资料" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "主要联系人" })[1]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getAllByRole("checkbox", { name: "主要联系人" })[0]).toBeChecked();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("客户保存中关闭不打断请求，失败后继续编辑保留输入", async () => {
    let rejectSave: (error: Error) => void = () => undefined;
    mock.update.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    fireEvent.click(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]);
    const editor = await screen.findByRole("dialog", { name: "编辑客户" });
    fireEvent.change(within(editor).getByLabelText(/^客户名称\s*\*$/), { target: { value: "待保存的合成客户" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(within(editor).getByLabelText(/^客户名称\s*\*$/)).toBeDisabled();
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(editor).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    await act(async () => { rejectSave(new Error("合成保存失败")); });
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("保存失败", expect.any(Object)));
    expect(within(editor).getByLabelText(/^客户名称\s*\*$/)).toBeEnabled();
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.getByLabelText(/^客户名称\s*\*$/)).toHaveValue("待保存的合成客户"));
  });

  it("添加联系人标签可访问，普通关闭保留草稿且回添加入口", async () => {
    mock.editableIds.mockResolvedValue([id]);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "客户资料" }), { key: "Enter" });
    const trigger = screen.getByRole("button", { name: "添加联系人" });
    fireEvent.click(trigger);
    const editor = screen.getByRole("dialog", { name: "添加联系人" });
    fireEvent.change(within(editor).getByLabelText("姓名 *"), { target: { value: "合成联系人草稿" } });
    fireEvent.change(within(editor).getByLabelText("职务 / 对接事项"), { target: { value: "资料对接" } });
    fireEvent.change(within(editor).getByLabelText("电话"), { target: { value: "13800000000" } });
    fireEvent.change(within(editor).getByLabelText("邮箱"), { target: { value: "example@example.test" } });
    fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getByLabelText("姓名 *")).toHaveValue("合成联系人草稿");
    expect(screen.getByLabelText("职务 / 对接事项")).toHaveValue("资料对接");
    expect(screen.getByLabelText("电话")).toHaveValue("13800000000");
    expect(screen.getByLabelText("邮箱")).toHaveValue("example@example.test");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("完整主档加载失败不打开摘要表单，错误可见且可重试", async () => {
    mock.edit.mockRejectedValue(new Error("客户不存在或无权维护"));
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    fireEvent.click(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]);
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("无法打开客户编辑", expect.objectContaining({ description: expect.any(String) })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.update).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]).toBeEnabled());
  });

  it("Semi 主体下拉在客户抽屉内选择，Escape 分层关闭并保留草稿", async () => {
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    fireEvent.click(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]);
    const editor = await screen.findByRole("dialog", { name: "编辑客户" });
    const type = within(editor).getByRole("combobox", { name: /^类型\s*\*$/ });
    fireEvent.focus(type);
    fireEvent.keyDown(type, { key: "Enter", keyCode: 13 });
    const individual = await within(editor).findByRole("option", { name: /自然人/ });
    fireEvent.click(individual);
    expect(type).toHaveTextContent("自然人");
    expect(within(editor).getByRole("combobox", { name: /^证件类型\s*\*$/ })).toHaveTextContent("居民身份证");
    const name = within(editor).getByLabelText(/^客户名称\s*\*$/);
    fireEvent.change(name, { target: { value: "仍在编辑的合成客户" } });
    fireEvent.keyDown(type, { key: "Enter", keyCode: 13 });
    await within(editor).findByRole("listbox");
    fireEvent.keyDown(type, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(within(editor).queryByRole("listbox")).not.toBeInTheDocument());
    expect(editor).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    expect(name).toHaveValue("仍在编辑的合成客户");
    fireEvent.keyDown(editor, { key: "Escape", keyCode: 27 });
    expect(await screen.findByRole("button", { name: "继续编辑" })).toHaveFocus();
    expect(mock.update).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "继续编辑" })); });
    expect(name).toHaveValue("仍在编辑的合成客户");
  });

  it("Semi 主体与证件选择保原客户身份，下拉 Escape 不关闭客户表单", async () => {
    let finish!: () => void;
    mock.update.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true }); }));
    renderPage(<ClientsView initialData={initialData} initialFilters={filters} canCreate editableClientIds={[id]} />);
    fireEvent.click(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]);
    const editor = await screen.findByRole("dialog", { name: "编辑客户" });
    const type = within(editor).getByRole("combobox", { name: /^类型/ });
    fireEvent.click(type);
    await screen.findByRole("option", { name: /自然人/ });
    fireEvent.keyDown(type, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("option", { name: /自然人/ })).not.toBeInTheDocument());
    expect(editor).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    fireEvent.click(type);
    fireEvent.click(await screen.findByRole("option", { name: /自然人/ }));
    fireEvent.click(within(editor).getByRole("combobox", { name: /证件类型/ }));
    fireEvent.click(await screen.findByRole("option", { name: /护照/ }));
    fireEvent.change(within(editor).getByLabelText("证件号码"), { target: { value: "A12345678" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(mock.update.mock.calls[0][0]).toMatchObject({ id, type: "INDIVIDUAL", idType: "PASSPORT", idNumber: "A12345678", contacts: [{ name: primary.name }, { name: secondary.name }] });
    expect(type).toHaveAttribute("aria-disabled", "true");
    expect(within(editor).getByLabelText("证件号码")).toBeDisabled();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("详情只读用户看不到编辑/联系人/合并入口，沟通入口保留", async () => {
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "记录沟通" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "客户资料" }), { key: "Enter" });
    expect(screen.queryByRole("button", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加联系人" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "合并重复档案" })).not.toBeInTheDocument();
    expect(screen.queryByText(/可在「编辑资料」补充/)).not.toBeInTheDocument();
  });

  it("详情获授权客户保留原编辑、联系人和合并按钮", async () => {
    mock.user = { ...mock.user, role: "PRINCIPAL_LAWYER" };
    mock.editableIds.mockResolvedValue([id]);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "客户资料" }), { key: "Enter" });
    expect(screen.getByRole("button", { name: "编辑资料" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加联系人" })).toBeVisible();
    expect(screen.getByRole("button", { name: "合并重复档案" })).toBeVisible();
  });
});
