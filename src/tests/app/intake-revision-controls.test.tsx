import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ withdraw: vi.fn(), void: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn() }),
    Notification: Object.assign(semi.Notification, { error: mock.error, success: vi.fn() })
  };
});
vi.mock("@/app/(app)/intakes/_components/intake-wizard", () => ({ IntakeWizard: () => null }));
vi.mock("@/server/intakes/revision-actions", () => ({ getIntakeEditForm: vi.fn(), withdrawIntake: mock.withdraw }));
vi.mock("@/server/intakes/actions", () => ({ resubmitIntake: vi.fn(), voidIntake: mock.void }));
vi.mock("@/server/clients/actions", () => ({ listClients: vi.fn() }));
vi.mock("@/server/users/actions", () => ({ listActiveColleagues: vi.fn() }));
import { RevisionControls } from "@/app/(app)/intakes/[id]/_components/revision-controls";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("收案补正动作的 Semi 控件", () => {
  it("撤回提交中拒绝Escape，失败保留理由，重试使用原收案", async () => {
    let reject!: (error: Error) => void;
    mock.withdraw.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    render(<RevisionControls id="intake-original" status="PENDING_CONFIRMATION" />);
    const trigger = screen.getByRole("button", { name: "撤回补正" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox", { name: "撤回原因" }), { target: { value: "合成：需要补充资料" } });
    fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
    await waitFor(() => expect(mock.withdraw).toHaveBeenCalledWith("intake-original", "合成：需要补充资料"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "撤回原因" }), { key: "Escape", keyCode: 27 });
    expect(screen.getByRole("dialog", { name: "撤回补正" })).toBeVisible();
    await act(async () => reject(new Error("合成失败")));
    expect(screen.getByRole("textbox", { name: "撤回原因" })).toHaveValue("合成：需要补充资料");
    expect(mock.refresh).not.toHaveBeenCalled();
    // Semi Modal suppresses another confirmation click in its 100 ms debounce window.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 110)); });
    expect(screen.getByRole("button", { name: "撤回申请" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
    await waitFor(() => expect(mock.withdraw).toHaveBeenCalledTimes(2));
    expect(mock.withdraw.mock.calls[1]).toEqual(mock.withdraw.mock.calls[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("取消作废返回原按钮，不触发服务；失败后仍可修改理由", async () => {
    mock.void.mockRejectedValue(new Error("合成作废失败"));
    render(<RevisionControls id="intake-original" status="INTAKE" />);
    const trigger = screen.getByRole("button", { name: "作废草稿" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "作废原因" }), { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.void).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox", { name: "作废原因" }), { target: { value: "合成：重复登记" } });
    fireEvent.click(screen.getByRole("button", { name: "确认作废" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "作废原因" })).toHaveValue("合成：重复登记");
    expect(screen.getByRole("textbox", { name: "作废原因" })).toBeEnabled();
    expect(mock.void).toHaveBeenCalledWith({ id: "intake-original", reason: "合成：重复登记" });
  });
});
