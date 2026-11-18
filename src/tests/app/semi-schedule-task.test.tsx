import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mocks = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("@/server/tasks/actions", () => ({ createTask: mocks.create }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success, warning: mocks.warning } }));

import { AddTaskDialog } from "@/app/(app)/schedule/_components/add-task-dialog";

const matterId = "cmtestmatter00000000000001";
const matters = [{ id: matterId, internalCode: "MAT-2026-1", title: "合成任务事项" }];
const date = new Date(2026, 10, 18, 12);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.create.mockResolvedValue({ ok: true, id: "cmtesttask0000000000000001" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fillTask() {
  fireEvent.click(screen.getByRole("combobox", { name: /关联案件/ }));
  fireEvent.click(await screen.findByRole("option", { name: /MAT-2026-1.*合成任务事项/ }));
  fireEvent.change(screen.getByLabelText(/事项标题/), { target: { value: "提交合成证据" } });
  fireEvent.change(screen.getByLabelText("描述（可选）"), { target: { value: "核对后提交" } });
}

describe("Semi 日程新建任务", () => {
  it("服务拒绝后保留输入与原请求标识，再次保存才关闭并刷新", async () => {
    const change = vi.fn();
    mocks.create.mockRejectedValueOnce(new ActionError("事项已变化，请重试"));
    render(<AddTaskDialog open onOpenChange={change} date={date} matters={matters} />);
    await fillTask();
    const submit = screen.getByRole("button", { name: "创建任务" }) as HTMLButtonElement;
    const form = screen.getByLabelText(/事项标题/).closest("form");
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.form).toBe(form);
    fireEvent.submit(form!);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("创建失败", { description: "事项已变化，请重试" }));
    expect(change).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/事项标题/)).toHaveValue("提交合成证据");
    expect(screen.getByLabelText("描述（可选）")).toHaveValue("核对后提交");
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(false));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ matterId, title: "提交合成证据", description: "核对后提交", dueAt: new Date("2026-11-18T09:00:00+08:00") });
    expect(mocks.create.mock.calls[0][0].requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("下拉 Escape 只关选项；保存期间字段冻结且 Escape 不关外层", async () => {
    const change = vi.fn();
    let finish!: (value: { ok: boolean; id: string }) => void;
    mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<AddTaskDialog open onOpenChange={change} date={date} matters={matters} />);
    const picker = screen.getByRole("combobox", { name: /关联案件/ });
    fireEvent.click(picker);
    await screen.findByRole("option", { name: /合成任务事项/ });
    fireEvent.keyDown(picker, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("option", { name: /合成任务事项/ })).not.toBeInTheDocument());
    expect(change).not.toHaveBeenCalled();
    await fillTask();
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(screen.getByLabelText(/事项标题/)).toBeDisabled();
    expect(picker).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "全天" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "新建任务" }), { key: "Escape", code: "Escape" });
    expect(change).not.toHaveBeenCalled();
    await act(async () => { finish({ ok: true, id: "cmtesttask0000000000000001" }); });
    expect(change).toHaveBeenCalledWith(false);
  });

  it("全天和优先级使用实际选中值，保留上海业务日期", async () => {
    render(<AddTaskDialog open onOpenChange={vi.fn()} date={date} matters={matters} />);
    await fillTask();
    fireEvent.click(screen.getByRole("checkbox", { name: "全天" }));
    fireEvent.click(screen.getByRole("radio", { name: "紧急" }));
    expect(screen.getByLabelText("时间")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ priority: 2, dueAt: new Date("2026-11-18T23:59:00+08:00") });
  });
});
