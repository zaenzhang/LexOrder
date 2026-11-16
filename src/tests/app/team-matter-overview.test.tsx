import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleUser } from "@/lib/roles/catalog";
import { ActionError } from "@/lib/action-error";

const mock = vi.hoisted(() => ({
  user: { id: "cmtestuser000000000000001", role: "CUSTOM", runtimeMode: "SERVER" } as RoleUser & { id: string },
  session: vi.fn(), notes: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mock.session }));
vi.mock("@/server/notes/actions", () => ({ listNotes: mock.notes }));

import { TeamMatterOverview } from "@/app/(app)/matters/[id]/_components/team-matter-overview";

const matter = {
  id: "cmtestmatter00000000000001", internalCode: "A2026001", title: "合成团队只读事项",
  category: "CIVIL_COMMERCIAL", status: "ACTIVE", parties: [], primaryClient: null,
  claimAmount: null, intakeDate: null, firmCaseNo: null, cause: null, causeFreeText: null,
  owner: { id: "owner-1", name: "合成主办", roleName: "律师" }, ownerId: "owner-1", members: [],
  procedures: [], timelineEvents: [], registeredBy: null
} as unknown as Parameters<typeof TeamMatterOverview>[0]["matter"];

beforeEach(() => {
  mock.session.mockReset();
  mock.notes.mockReset();
  mock.user = { ...mock.user, rolePermissions: [{ permissionKey: "matters.read", scope: "TEAM" }] };
  mock.session.mockImplementation(async () => ({ user: mock.user }));
  mock.notes.mockResolvedValue([]);
});
afterEach(cleanup);

describe("团队事项概览记录权限（组件环境）", () => {
  it("无 schedule.read 时不调用记录服务，也不显示假空记录", async () => {
    render(await TeamMatterOverview({ matter }));
    expect(mock.session).toHaveBeenCalledWith("matters.read");
    expect(mock.notes).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "合成团队只读事项" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "记录" })).not.toBeInTheDocument();
    expect(screen.queryByText("暂无记录")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑|确认|下载/ })).not.toBeInTheDocument();
  });

  it("有 schedule.read 时继续经原服务复核，展示只读记录", async () => {
    mock.user.rolePermissions!.push({ permissionKey: "schedule.read", scope: "TEAM" });
    mock.notes.mockResolvedValue([{ id: "note-1", author: { name: "合成记录作者" }, occurredAt: new Date("2026-11-16T01:00:00Z"), content: "合成只读记录内容" }]);
    render(await TeamMatterOverview({ matter }));
    expect(mock.notes).toHaveBeenCalledWith(matter.id);
    expect(screen.getByRole("region", { name: "记录" })).toHaveTextContent("合成只读记录内容");
    expect(screen.queryByRole("button", { name: /编辑|确认|下载/ })).not.toBeInTheDocument();
  });

  it("记录服务拒绝或失败时显示错误与重载入口，不伪装为空记录", async () => {
    mock.user.rolePermissions!.push({ permissionKey: "schedule.read", scope: "TEAM" });
    mock.notes.mockRejectedValue(new ActionError("当前无权读取案件记录"));
    render(await TeamMatterOverview({ matter }));
    expect(screen.getByRole("alert")).toHaveTextContent("记录读取失败：当前无权读取案件记录");
    expect(screen.getByRole("link", { name: "重新加载" })).toHaveAttribute("href", "/matters/A2026001");
    expect(screen.queryByText("暂无记录")).not.toBeInTheDocument();
  });

  it("服务端内部异常只展示可重试提示，不把原始错误写入页面", async () => {
    mock.user.rolePermissions!.push({ permissionKey: "schedule.read", scope: "TEAM" });
    mock.notes.mockRejectedValue(new Error("Synthetic database connection details"));
    render(await TeamMatterOverview({ matter }));
    expect(screen.getByRole("alert")).toHaveTextContent("记录暂不可读取，请稍后重试");
    expect(screen.queryByText(/Synthetic database connection details/)).not.toBeInTheDocument();
    expect(screen.queryByText("暂无记录")).not.toBeInTheDocument();
  });
});
