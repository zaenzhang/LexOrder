import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  push: vi.fn(), signOut: vi.fn(), counts: vi.fn(), admin: false,
  permissions: new Set<string>(["matters.read", "clients.read"]),
}));
vi.mock("next/navigation", () => {
  const router = { push: mock.push };
  return { useRouter: () => router, usePathname: () => "/matters/TEST-01" };
});
vi.mock("next-auth/react", () => ({ signOut: mock.signOut }));
vi.mock("@/components/workspace-actor-provider", () => {
  const user = { id: "synthetic-user", name: "合成用户", runtimeMode: "SERVER", role: "LAWYER", systemRole: "NONE" };
  return { useWorkspaceActor: () => user };
});
vi.mock("@/lib/roles/catalog", () => ({
  hasCustomPermission: (_: unknown, permission: string) => mock.permissions.has(permission),
  customOrLegacy: (_: unknown, permission: string) => mock.permissions.has(permission),
  roleDisplayName: () => "律师",
}));
vi.mock("@/lib/auth/system-role", () => ({ canEnterAdminWorkspace: () => mock.admin }));
vi.mock("@/server/layout/nav-counts", () => ({ getNavCounts: mock.counts }));

import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { NavContent } from "@/components/layout/sidebar";
import { ToolsDialog } from "@/components/layout/tools-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  mock.admin = false;
  mock.counts.mockResolvedValue({ matters: 3, clients: 2, approvals: 1 });
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function AccountHarness() {
  return <WorkspaceAccountMenu position="bottomRight"><button>账户菜单</button></WorkspaceAccountMenu>;
}
function NavigationHarness() {
  const [open, setOpen] = useState(false);
  return <><NavContent firm={{ name: "合成律所", subtitle: "合成工作台", logoDataUrl: null }} onOpenTools={() => setOpen(true)} /><ToolsDialog open={open} onOpenChange={setOpen} /></>;
}

describe("Semi 导航使用当前资格与稳定入口", () => {
  it("账户菜单键盘选择后关闭并沿原个人资料路由导航", async () => {
    render(<AccountHarness />);
    const trigger = screen.getByRole("button", { name: "账户菜单" });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const profile = await screen.findByRole("menuitem", { name: "个人设置" });
    expect(screen.queryByRole("menuitem", { name: "管理后台" })).not.toBeInTheDocument();
    profile.focus();
    fireEvent.keyDown(profile, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/settings/profile"));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "个人设置" })).not.toBeInTheDocument());
  });

  it("Escape 返回账户触发器，获准管理入口另页打开并关闭菜单", async () => {
    mock.admin = true;
    render(<AccountHarness />);
    const trigger = screen.getByRole("button", { name: "账户菜单" });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const admin = await screen.findByRole("menuitem", { name: "管理后台" });
    admin.focus(); fireEvent.keyDown(admin, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "管理后台" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "管理后台" }));
    expect(window.open).toHaveBeenCalledWith("/admin", "_blank", "noopener,noreferrer");
    expect(screen.queryByRole("menuitem", { name: "管理后台" })).not.toBeInTheDocument();
  });

  it("业务导航按原资格过滤，键盘目标是链接且走客户端跳转", async () => {
    render(<NavigationHarness />);
    const matters = screen.getByRole("link", { name: /^案件/ });
    expect(matters).toHaveAttribute("aria-current", "page");
    expect(matters).toHaveAttribute("tabindex", "0");
    expect(matters.closest("li")).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("link", { name: "财务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "报表" })).not.toBeInTheDocument();
    matters.focus();
    fireEvent.keyPress(matters, { key: "Enter", keyCode: 13, charCode: 13 });
    fireEvent.click(matters, { button: 0, detail: 0 });
    expect(mock.push).toHaveBeenCalledOnce();
    expect(mock.push).toHaveBeenCalledWith("/matters");
    await waitFor(() => expect(mock.counts).toHaveBeenCalled());
  });

  it("更多应用先关闭菜单再打开工具，Escape 回稳定入口并保留草稿", async () => {
    render(<NavigationHarness />);
    const trigger = screen.getByRole("button", { name: "更多应用" });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const tools = await screen.findByRole("menuitem", { name: "实务工具" });
    tools.focus(); fireEvent.keyDown(tools, { key: "Enter", keyCode: 13 });
    const dialog = await screen.findByRole("dialog", { name: "实务工具" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "实务工具" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("诉讼标的金额（元）"), { target: { value: "321000" } });
    fireEvent.keyDown(dialog, { key: "Escape", keyCode: 27 });
    // jsdom lacks AnimationEvent, so React subscribes to the WebKit-prefixed event.
    expect(dialog).toHaveClass("semi-modal-content-animate-hide");
    fireEvent(dialog, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "实务工具" }));
    await screen.findByRole("dialog", { name: "实务工具" });
    expect(screen.getByLabelText("诉讼标的金额（元）")).toHaveValue(321000);
  });
});
