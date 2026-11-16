import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Contact } from "@prisma/client";
import type { RoleUser } from "@/lib/roles/catalog";

const mock = vi.hoisted(() => ({
  user: { id: "cmtestuser0000000000000001", role: "LAWYER", runtimeMode: "SERVER" } as RoleUser & { id: string },
  list: vi.fn(), get: vi.fn(), edit: vi.fn(), update: vi.fn(), create: vi.fn(), editableIds: vi.fn(),
  finance: vi.fn(), insights: vi.fn(), relationship: vi.fn(), refresh: vi.fn(), error: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: mock.user }) }));
vi.mock("@/server/clients/actions", () => ({ listClients: mock.list, getClientById: mock.get, getClientForEdit: mock.edit, updateClient: mock.update, createClient: mock.create, getClientFinanceSummary: mock.finance, addContact: vi.fn() }));
vi.mock("@/server/clients/master-access", () => ({ editableClientIds: mock.editableIds }));
vi.mock("@/server/clients/insights", () => ({ getClientInsights: mock.insights }));
vi.mock("@/server/clients/relationship-actions", () => ({ getClientRelationship: mock.relationship, recordClientActivity: vi.fn(), getClientCommunicationPage: vi.fn(), getClientFollowUpPage: vi.fn() }));
vi.mock("@/server/clients/history-actions", () => ({ getClientHistoryPage: vi.fn(async () => ({ items: [], nextCursor: null })), getClientMatterPage: vi.fn() }));
vi.mock("@/server/clients/dedup", () => ({ mergeClientsByCode: vi.fn() }));
vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: vi.fn(), getEnterpriseDetail: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh, replace: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: mock.error } }));

import ClientsPage from "@/app/(app)/clients/page";
import ClientDetailPage from "@/app/(app)/clients/[id]/page";
import { ClientsView } from "@/app/(app)/clients/_components/clients-view";
import { TopbarActionProvider, useTopbarActionValue } from "@/components/layout/topbar-action";

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
  return render(<TopbarActionProvider><Topbar />{page}</TopbarActionProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
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
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Server 客户编辑入口（组件环境）", () => {
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
    fireEvent.click(screen.getAllByRole("button", { name: `编辑 ${client.name}` })[0]);
    await waitFor(() => expect(screen.getByDisplayValue("合成次要联系人")).toBeInTheDocument());
    expect(mock.edit).toHaveBeenCalledWith(id);
    fireEvent.change(screen.getByDisplayValue(client.name), { target: { value: "合成客户已更新" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledOnce());
    expect(mock.update.mock.calls[0][0]).toMatchObject({ id, name: "合成客户已更新", contacts: [{ name: primary.name, isPrimary: true }, { name: secondary.name, isPrimary: false }] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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

  it("详情只读用户看不到编辑/联系人/合并入口，沟通入口保留", async () => {
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }) }));
    expect(screen.queryByRole("button", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加联系人" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "合并重复档案" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记录沟通" })).toBeVisible();
    expect(screen.queryByText(/可在「编辑资料」补充/)).not.toBeInTheDocument();
  });

  it("详情获授权客户保留原编辑、联系人和合并按钮", async () => {
    mock.user = { ...mock.user, role: "PRINCIPAL_LAWYER" };
    mock.editableIds.mockResolvedValue([id]);
    renderPage(await ClientDetailPage({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole("button", { name: "编辑资料" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加联系人" })).toBeVisible();
    expect(screen.getByRole("button", { name: "合并重复档案" })).toBeVisible();
  });
});
