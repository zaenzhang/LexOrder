import { act, cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientRelationshipPanel } from "@/app/(app)/clients/[id]/_components/client-relationship-panel";
import type { ClientRelationshipView } from "@/lib/clients/relationship";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";

const mock = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/clients/relationship-actions", () => ({ recordClientActivity: mock.save, getClientCommunicationPage: vi.fn(), getClientFollowUpPage: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn() }),
    Notification: Object.assign(semi.Notification, { success: vi.fn() })
  };
});
const view: ClientRelationshipView = { canWrite: true, activityCount: 0, openCount: 1, activities: [], followUps: [{ id: "cmtestfollowup000000000001", title: "核对材料", dueAt: "2027-01-02T02:00:00Z", assigneeName: "验收律师", overdue: false, canClose: true }] };

function renderPanel(data: ClientRelationshipView | null = view) {
  return render(<><ClientRelationshipPanel clientId="cmtestclient00000000000001" view={data} /><ConfirmHost /></>);
}

beforeEach(() => {
  mock.save.mockReset(); mock.refresh.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("客户沟通表单交互（组件环境）", () => {
  it("完成跟进时提交结果与上海时间的下一项", async () => {
    mock.save.mockResolvedValue({ ok: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "录入结果：核对材料" }));
    fireEvent.change(screen.getByLabelText("跟进结果 *"), { target: { value: "材料已齐备" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "安排下次跟进" }));
    fireEvent.change(screen.getByLabelText("下次跟进事项 *"), { target: { value: "讨论方案" } });
    fireEvent.change(screen.getByLabelText("跟进时间（北京时间）*"), { target: { value: "2027-01-03T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存结果" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
    expect(mock.save.mock.calls[0][0]).toMatchObject({ followUpId: view.followUps[0].id, content: "材料已齐备", closeStatus: "COMPLETED", nextFollowUp: { title: "讨论方案", dueAt: "2027-01-03T06:30:00.000Z" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "沟通与跟进" })).toHaveFocus());
  });

  it("保存失败保留输入并显示错误，取消要求原因", async () => {
    let rejectSave: (error: Error) => void = () => undefined;
    mock.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "取消跟进：核对材料" }));
    fireEvent.change(screen.getByLabelText("取消原因 *"), { target: { value: "客户调整计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存取消原因" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    const editor = screen.getByRole("dialog");
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(editor).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
    await act(async () => { rejectSave(new Error("授权范围已变化，请刷新后重试")); });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("授权范围已变化"));
    expect(screen.getByLabelText("取消原因 *")).toHaveValue("客户调整计划");
    expect(mock.save.mock.calls[0][0].closeStatus).toBe("CANCELLED");
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.getByLabelText("取消原因 *")).toHaveValue("客户调整计划"));
  });

  it("未保存沟通的 Esc、返回和 X 均可继续编辑，确认放弃后回入口且重开为空", async () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "记录沟通" });
    fireEvent.click(trigger);
    const editor = screen.getByRole("dialog", { name: "记录沟通" });
    const content = within(editor).getByLabelText("沟通内容 *");
    fireEvent.change(content, { target: { value: "待核实的合成沟通" } });
    fireEvent.click(within(editor).getByRole("checkbox", { name: "安排下次跟进" }));
    fireEvent.change(within(editor).getByLabelText("下次跟进事项 *"), { target: { value: "补齐材料" } });
    content.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    const continueButton = await screen.findByRole("button", { name: "继续编辑" });
    expect(continueButton).toHaveFocus();
    fireEvent.click(continueButton);
    await waitFor(() => expect(content).toHaveFocus());
    expect(content).toHaveValue("待核实的合成沟通");
    expect(within(editor).getByLabelText("下次跟进事项 *")).toHaveValue("补齐材料");

    fireEvent.click(within(editor).getByRole("button", { name: "返回" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument());
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("沟通内容 *")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "安排下次跟进" })).not.toBeChecked();
  });

  it("不同待跟进入口关闭后回到原行，未改动表单不询问放弃", async () => {
    renderPanel({ ...view, openCount: 2, followUps: [...view.followUps, { ...view.followUps[0], id: "cmtestfollowup000000000002", title: "核实授权" }] });
    const resultTrigger = screen.getByRole("button", { name: "录入结果：核实授权" });
    fireEvent.click(resultTrigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(resultTrigger).toHaveFocus());
    const cancelTrigger = screen.getByRole("button", { name: "取消跟进：核对材料" });
    fireEvent.click(cancelTrigger);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(cancelTrigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("沟通方式下拉在弹窗内逐层 Escape，变更后保留草稿", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "记录沟通" }));
    const editor = screen.getByRole("dialog", { name: "记录沟通" });
    const channel = screen.getByRole("combobox", { name: "沟通方式" });
    fireEvent.focus(channel);
    fireEvent.keyDown(channel, { key: "Enter", keyCode: 13 });
    expect(await within(editor).findByRole("option", { name: /其他/ })).toBeInTheDocument();
    fireEvent.keyDown(channel, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(within(editor).queryByRole("listbox")).not.toBeInTheDocument());
    expect(editor).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续编辑" })).not.toBeInTheDocument();
    fireEvent.keyDown(channel, { key: "Enter", keyCode: 13 });
    fireEvent.click(await within(editor).findByRole("option", { name: /其他/ }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "沟通方式" })).toHaveTextContent("其他"));
  });

  it("无沟通读取权限时不渲染记录或操作入口", () => {
    renderPanel(null);
    expect(screen.queryByRole("button", { name: "记录沟通" })).not.toBeInTheDocument();
    expect(screen.getByText("沟通记录仅向客户经办人员及获授权的管理人员开放。")).toBeInTheDocument();
  });
});
