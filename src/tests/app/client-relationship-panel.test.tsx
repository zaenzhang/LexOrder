import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientRelationshipPanel } from "@/app/(app)/clients/[id]/_components/client-relationship-panel";
import type { ClientRelationshipView } from "@/lib/clients/relationship";

const mock = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/clients/relationship-actions", () => ({ recordClientActivity: mock.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const view: ClientRelationshipView = { canWrite: true, activityCount: 0, openCount: 1, activities: [], followUps: [{ id: "cmtestfollowup000000000001", title: "核对材料", dueAt: "2027-01-02T02:00:00Z", assigneeName: "验收律师", overdue: false, canClose: true }] };

beforeEach(() => {
  mock.save.mockReset(); mock.refresh.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("客户沟通表单交互（组件环境）", () => {
  it("完成跟进时提交结果与上海时间的下一项", async () => {
    mock.save.mockResolvedValue({ ok: true });
    render(<ClientRelationshipPanel clientId="cmtestclient00000000000001" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "录入结果：核对材料" }));
    fireEvent.change(screen.getByLabelText("跟进结果 *"), { target: { value: "材料已齐备" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "安排下次跟进" }));
    fireEvent.change(screen.getByLabelText("下次跟进事项 *"), { target: { value: "讨论方案" } });
    fireEvent.change(screen.getByLabelText("跟进时间（北京时间）*"), { target: { value: "2027-01-03T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.calls[0][0]).toMatchObject({ followUpId: view.followUps[0].id, content: "材料已齐备", closeStatus: "COMPLETED", nextFollowUp: { title: "讨论方案", dueAt: "2027-01-03T06:30:00.000Z" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("保存失败保留输入并显示错误，取消要求原因", async () => {
    mock.save.mockRejectedValue(new Error("授权范围已变化，请刷新后重试"));
    render(<ClientRelationshipPanel clientId="cmtestclient00000000000001" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "取消跟进：核对材料" }));
    fireEvent.change(screen.getByLabelText("取消原因 *"), { target: { value: "客户调整计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存取消原因" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("授权范围已变化"));
    expect(screen.getByLabelText("取消原因 *")).toHaveValue("客户调整计划");
    expect(mock.save.mock.calls[0][0].closeStatus).toBe("CANCELLED");
  });

  it("无沟通读取权限时不渲染记录或操作入口", () => {
    render(<ClientRelationshipPanel clientId="cmtestclient00000000000001" view={null} />);
    expect(screen.queryByRole("button", { name: "记录沟通" })).not.toBeInTheDocument();
    expect(screen.getByText("沟通记录仅向客户经办人员及获授权的管理人员开放。")).toBeInTheDocument();
  });
});
