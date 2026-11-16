// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionKey } from "@/lib/roles/catalog";
import MattersPage from "@/app/(app)/matters/page";

const { requireSession, listClients, listMatters, listIntakes, getMatterTabCounts } = vi.hoisted(() => ({
  requireSession: vi.fn(), listClients: vi.fn(), listMatters: vi.fn(), listIntakes: vi.fn(), getMatterTabCounts: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/server/clients/actions", () => ({ listClients }));
vi.mock("@/server/matters/actions", () => ({ listMatters, getMatterTabCounts }));
vi.mock("@/server/intakes/actions", () => ({ listIntakes }));
vi.mock("@/server/users/actions", () => ({ listActiveColleagues: vi.fn(async () => []) }));
vi.mock("@/server/teams/actions", () => ({ listReadableTeams: vi.fn(async () => []) }));
vi.mock("@/app/(app)/matters/_components/matters-view-v4", () => ({ MattersViewV4: () => null }));

function grant(...keys: PermissionKey[]) {
  requireSession.mockResolvedValue({ user: { id: "reader", role: "CUSTOM", runtimeMode: "SERVER",
    rolePermissions: keys.map(permissionKey => ({ permissionKey, scope: "OWN" })) } });
}

beforeEach(() => {
  vi.clearAllMocks();
  grant("matters.read");
  listClients.mockRejectedValue(new Error("无客户读取权限"));
  listMatters.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
  listIntakes.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
  getMatterTabCounts.mockResolvedValue({ active: 0, intake: 0, revision: 0 });
});

describe("案件浏览与收案客户选项独立授权", () => {
  it.each(["active", "intake", "revision", "archived", "all"])("仅案件读取资格仍可打开 %s 列表", async tab => {
    const page = await MattersPage({ searchParams: Promise.resolve({ tab, new: "1" }) });
    expect(requireSession).toHaveBeenCalledWith("matters.read");
    expect(listClients).not.toHaveBeenCalled();
    expect(page.props.clientOptions).toEqual([]);
    expect(page.props.canCreateIntake).toBe(false);
    expect(page.props.canExportMatters).toBe(false);
    expect(tab === "intake" || tab === "revision" ? listIntakes : listMatters).toHaveBeenCalledOnce();
  });

  it("可登记收案但不可浏览客户档案时，不读取客户选项或取消收案资格", async () => {
    grant("matters.read", "intakes.create");
    const page = await MattersPage({ searchParams: Promise.resolve({ new: "1" }) });
    expect(listClients).not.toHaveBeenCalled();
    expect(page.props.clientOptions).toEqual([]);
    expect(page.props.canCreateIntake).toBe(true);
  });

  it("具备客户读取资格但不登记收案时，不为隐藏表单加载客户", async () => {
    grant("matters.read", "clients.read");
    const page = await MattersPage({ searchParams: Promise.resolve({}) });
    expect(listClients).not.toHaveBeenCalled();
    expect(page.props.canCreateIntake).toBe(false);
    expect(page.props.canExportMatters).toBe(false);
  });

  it("有登记和客户读取资格时沿用获授权的客户列表服务", async () => {
    grant("matters.read", "intakes.create", "clients.read");
    listClients.mockResolvedValue({ items: [{ id: "client", name: "合成客户", type: "COMPANY" }] });
    const page = await MattersPage({ searchParams: Promise.resolve({ new: "1", clientId: "client" }) });
    expect(listClients).toHaveBeenCalledExactlyOnceWith({ pageSize: 100 });
    expect(page.props.clientOptions).toEqual([{ id: "client", name: "合成客户", type: "COMPANY" }]);
    expect(page.props.initialClientId).toBe("client");
    expect(page.props.canCreateIntake).toBe(true);
  });
});
