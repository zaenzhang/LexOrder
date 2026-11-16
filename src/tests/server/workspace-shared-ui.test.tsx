import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const { sessionProvider, useSession, navCounts } = vi.hoisted(() => ({
  sessionProvider: vi.fn(({ children }: { children: React.ReactNode }) => children),
  useSession: vi.fn(),
  navCounts: vi.fn()
}));
vi.mock("next-auth/react", () => ({ SessionProvider: sessionProvider, useSession, signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
vi.mock("@/server/layout/nav-counts", () => ({ getNavCounts: navCounts }));

import { WorkspaceActorProvider, useWorkspaceActor } from "@/components/workspace-actor-provider";
import { AdminShell } from "@/components/layout/admin-shell";
import { NavContent } from "@/components/layout/sidebar";
import { isPersonalWorkspaceConfigurationPath } from "@/lib/runtime/workspace-navigation";

const actor: WorkspaceActor = {
  id: "cworkspace0000000000000001", name: "本机操作者", email: null, avatar: null,
  role: "INDEPENDENT_LAWYER", systemRole: "NONE", runtimeMode: "PERSONAL"
};
function ActorProbe() {
  const current = useWorkspaceActor();
  return <output aria-label="当前操作者">{current ? `${current.id}:${current.runtimeMode}` : "无操作者"}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  navCounts.mockResolvedValue(null);
  useSession.mockReturnValue({ data: { user: { ...actor, runtimeMode: undefined } } });
});
afterEach(cleanup);

describe("共用 UI 的操作者来源", () => {
  it("Personal 直接注入本机操作者，不挂载 NextAuth 或读取认证会话", () => {
    render(<WorkspaceActorProvider personalActor={actor}><ActorProbe /></WorkspaceActorProvider>);
    expect(screen.getByLabelText("当前操作者")).toHaveTextContent(`${actor.id}:PERSONAL`);
    expect(sessionProvider).not.toHaveBeenCalled();
    expect(useSession).not.toHaveBeenCalled();
  });

  it("Personal 无有效操作者时保持为空，不回退到 Server 认证", () => {
    render(<WorkspaceActorProvider personalActor={null}><ActorProbe /></WorkspaceActorProvider>);
    expect(screen.getByLabelText("当前操作者")).toHaveTextContent("无操作者");
    expect(sessionProvider).not.toHaveBeenCalled();
    expect(useSession).not.toHaveBeenCalled();
  });

  it("Server 继续使用 SessionProvider，并给原会话附上显示用模式", () => {
    render(<WorkspaceActorProvider><ActorProbe /></WorkspaceActorProvider>);
    expect(sessionProvider).toHaveBeenCalled();
    expect(useSession).toHaveBeenCalled();
    expect(screen.getByLabelText("当前操作者")).toHaveTextContent(`${actor.id}:SERVER`);
  });

  it("Personal 沿用原业务导航，包括财务、审批与报表", async () => {
    const { container } = render(<WorkspaceActorProvider personalActor={actor}>
      <NavContent firm={{ name: "测试工作区", subtitle: "", logoDataUrl: null }} />
    </WorkspaceActorProvider>);
    await waitFor(() => expect(navCounts).toHaveBeenCalled());
    for (const href of ["/", "/matters", "/approvals", "/schedule", "/clients", "/finance", "/reports"]) {
      expect(container.querySelector(`nav a[href="${href}"]`)).not.toBeNull();
    }
    expect(screen.getByText("个人工作区")).toBeInTheDocument();
    expect(useSession).not.toHaveBeenCalled();
  });
});

describe("工作区配置导航白名单", () => {
  it("Personal 保留业务设置，隐藏账号、组织、岗位与退出操作", () => {
    const { container } = render(<AdminShell firmName="测试工作区" user={{ name: actor.name!, roleName: "独立律师" }} isSystemAdmin={false} runtimeMode="PERSONAL"><div>业务设置</div></AdminShell>);
    for (const href of ["/admin", "/admin/firm-profile", "/admin/reminders", "/admin/archive-policy", "/admin/document-templates", "/admin/templates", "/admin/custom-fields", "/admin/ai", "/admin/express", "/admin/import", "/admin/audit"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    for (const href of ["/admin/users", "/admin/teams", "/admin/roles", "/admin/approval-permissions"]) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
    expect(screen.queryByText("超级管理员")).not.toBeInTheDocument();
  });

  it("Server 系统管理员继续看到人员管理与退出，普通业务管理人不获系统配置", () => {
    const { container, rerender } = render(<AdminShell firmName="测试律所" user={{ name: "管理员", roleName: "合伙人" }} isSystemAdmin><div /></AdminShell>);
    expect(container.querySelector('a[href="/admin/users"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    rerender(<AdminShell firmName="测试律所" user={{ name: "业务管理人", roleName: "合伙人" }} isSystemAdmin={false}><div /></AdminShell>);
    expect(container.querySelector('a[href="/admin/users"]')).toBeNull();
    expect(container.querySelector('a[href="/admin/ai"]')).toBeNull();
    expect(container.querySelector('a[href="/admin/reminders"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/import"]')).not.toBeNull();
  });

  it("未知配置路径和白名单的子路径默认不开放", () => {
    expect(isPersonalWorkspaceConfigurationPath("/admin/ai")).toBe(true);
    for (const path of ["/admin/users", "/admin/ai/users", "/admin/unknown", "/admin-other"]) {
      expect(isPersonalWorkspaceConfigurationPath(path)).toBe(false);
    }
  });
});
