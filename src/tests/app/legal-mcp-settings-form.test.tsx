import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMcpConfig } from "@/lib/legal-mcp/contracts";

const mock = vi.hoisted(() => ({ save: vi.fn(), discover: vi.fn(), test: vi.fn(), query: vi.fn() }));
vi.mock("@/server/legal/mcp-actions", () => ({ saveLegalMcpSettingsAction: mock.save, discoverLegalMcpTools: mock.discover, testLegalMcpConnection: mock.test, queryLegalMcpTool: mock.query }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { LegalMcpSettingsForm } from "@/app/(admin)/admin/ai/_components/legal-mcp-settings-form";

const initial: PublicMcpConfig = {
  id: "custom-11111111-1111-4111-8111-111111111111", name: "合成现有服务", endpoint: "https://example.test/mcp", enabled: true,
  authentication: "none", revision: "11111111-1111-4111-8111-111111111111", hasKey: false, allowedTools: [], state: "CHECKED",
  checks: { connection: { ok: true, at: "2026-11-16T10:00:00Z" } }
};
const saved: PublicMcpConfig = { ...initial, revision: "22222222-2222-4222-8222-222222222222", state: "UNVERIFIED", checks: {} };
function openEditor() {
  const editor = screen.getByText(initial.name).closest("details")!;
  fireEvent.click(editor.querySelector("summary")!);
  return editor;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("MCP 配置连续操作（组件环境）", () => {
  it("保存已有服务保留当前展开及未提交的新服务草稿", async () => {
    mock.save.mockResolvedValue(saved);
    render(<LegalMcpSettingsForm initial={[initial]} />);
    const editor = openEditor();
    fireEvent.click(screen.getByRole("button", { name: "添加自定义服务" }));
    const newName = document.getElementById("mcp-new-name")!;
    fireEvent.change(newName, { target: { value: "合成未保存服务" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "保存配置" })).toBeEnabled());
    expect(mock.save).toHaveBeenCalledOnce();
    expect(editor).toHaveAttribute("open");
    expect(screen.getByDisplayValue("合成未保存服务")).toBeVisible();
    expect(within(editor).queryByText(/通过 ·/)).not.toBeInTheDocument();
    expect(within(editor).getAllByText("未验证")).toHaveLength(3);
  });

  it("保存白名单保留同一服务的工具格式，改地址后清除旧工具和检查", async () => {
    mock.discover.mockResolvedValue({ ok: true, checks: { tools: { ok: true, at: "2026-11-16T10:01:00Z" } }, tools: [{ name: "case.search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] });
    mock.save.mockResolvedValueOnce({ ...saved, allowedTools: ["case.search"] }).mockResolvedValueOnce({ ...saved, endpoint: "https://different.example.test/mcp", allowedTools: ["case.search"], revision: "33333333-3333-4333-8333-333333333333" });
    render(<LegalMcpSettingsForm initial={[initial]} />);
    const editor = openEditor();
    fireEvent.click(within(editor).getByRole("button", { name: "发现工具" }));
    await waitFor(() => expect(within(editor).getByText("查看已发现的工具（1）")).toBeVisible());
    fireEvent.change(within(editor).getByLabelText("只读工具白名单（每行一个完整工具名）"), { target: { value: "case.search" } });
    fireEvent.click(within(editor).getByRole("checkbox", { name: /我已核实白名单/ }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(within(editor).getByText("该工具声明的输入格式")).toBeVisible());
    expect(editor).toHaveAttribute("open");
    expect(within(editor).getAllByText("未验证")).toHaveLength(3);
    fireEvent.change(within(editor).getByLabelText("远程 Streamable HTTP 地址"), { target: { value: "https://different.example.test/mcp" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(editor).queryByText("该工具声明的输入格式")).not.toBeInTheDocument());
    expect(within(editor).queryByText("查看已发现的工具（1）")).not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "检查连接" })).toBeEnabled();
    expect(mock.test).not.toHaveBeenCalled();
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("新服务保存成功后仍展开，供用户继续检查连接", async () => {
    mock.save.mockResolvedValue({ ...saved, name: "合成新服务" });
    render(<LegalMcpSettingsForm initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "添加自定义服务" }));
    fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "合成新服务" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(screen.getByText("合成新服务")).toBeVisible());
    expect(screen.getByText("合成新服务").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "检查连接" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "添加自定义服务" })).toBeEnabled();
  });
});
