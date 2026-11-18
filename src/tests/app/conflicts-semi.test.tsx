import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/server/conflicts/actions", () => ({ runCheckAndSave: mock.run }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error, warning: mock.warning } }));

import { ConflictsViewV4 } from "@/app/(app)/conflicts/_components/conflicts-view-v4";
import { TopbarActionProvider, useTopbarActionValue } from "@/components/layout/topbar-action";

function Topbar() {
  const action = useTopbarActionValue();
  return action && action !== "none" ? <button onClick={action.onClick} disabled={action.disabled}>{action.label}</button> : null;
}
function renderView(prefillName = "") {
  return render(<TopbarActionProvider><Topbar /><ConflictsViewV4 prefillName={prefillName} /></TopbarActionProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.run.mockResolvedValue({ hits: [] });
});
afterEach(cleanup);

describe("冲突预检 Semi 控件（服务动作替身）", () => {
  it("保留角色、名称及证件参数，空主体不提交，未命中不称无冲突", async () => {
    renderView();
    fireEvent.change(screen.getByRole("textbox", { name: "主体名称" }), { target: { value: "  合成设备公司  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "证件号码" }), { target: { value: " synth 123 " } });
    fireEvent.click(screen.getByRole("button", { name: "第三人" }));
    fireEvent.click(screen.getByRole("button", { name: "添加检索主体（自然人 / 机构）" }));
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));
    await waitFor(() => expect(mock.run).toHaveBeenCalledWith({ queries: [{ role: "THIRD_PARTY", name: "合成设备公司", idNumber: "SYNTH123" }] }));
    expect(await screen.findByText("不等于确认无冲突")).toBeInTheDocument();
    expect(screen.getByText(/合成设备公司\s*（第三人）/)).toBeInTheDocument();
  });

  it("失败保留输入可重试，查询中禁止重复提交或重置目标", async () => {
    let fail!: (reason: Error) => void;
    mock.run.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    renderView("合成失败重试主体");
    fireEvent.click(screen.getByRole("button", { name: "添加检索主体（自然人 / 机构）" }));
    const name = screen.getAllByRole("textbox", { name: "主体名称" })[0];
    fireEvent.keyDown(name, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(mock.run).toHaveBeenCalledOnce());
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /^(第三人|完成|移除该主体)$/ })) expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加检索主体（自然人 / 机构）" })).toBeDisabled();
    const reset = screen.getByRole("button", { name: "新建预检" });
    expect(reset).toBeDisabled();
    fireEvent.click(reset);
    expect(name).toHaveValue("合成失败重试主体");
    expect(screen.getByRole("button", { name: "开始预检" })).toBeDisabled();
    fireEvent.keyDown(name, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(mock.run).toHaveBeenCalledOnce();
    await act(async () => fail(new Error("request failed")));
    expect(name).toHaveValue("合成失败重试主体");
    await waitFor(() => expect(name).toBeEnabled());
    expect(mock.error).toHaveBeenCalledWith("检索失败", expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));
    await screen.findByText("不等于确认无冲突");
    expect(mock.run).toHaveBeenCalledTimes(2);
    expect(mock.run.mock.calls[1]).toEqual(mock.run.mock.calls[0]);
  });

  it("结果只为获准案件提供链接，在办收案与受限案件仍最小披露", async () => {
    const base = { hitType: "PARTY", matchedName: "合成主体", matchedField: "name", matchedValue: "合成主体", matchedRatio: 1, severity: "HIGH", reason: "角色提示", intakeInfo: null };
    const matter = { internalCode: "AJ-2026-0001", title: "合成可读案件", category: "CIVIL_COMMERCIAL", status: "ACTIVE", intakeDate: null, causeText: null, ownerName: "合成主办", partyRole: "OPPOSING_PARTY", partyStanding: "DEFENDANT" };
    mock.run.mockResolvedValueOnce({ hits: [
      { ...base, id: "h1", targetType: "Matter", targetId: "m1", matterInfo: { ...matter, matterId: "m1", canViewMatter: true } },
      { ...base, id: "h2", targetType: "Matter", targetId: "m2", matterInfo: { ...matter, internalCode: "AJ-2026-0002", title: "合成受限案件", matterId: null, canViewMatter: false } },
      { ...base, id: "h3", targetType: "Intake", targetId: "i1", matterInfo: null, intakeInfo: { title: "合成待办收案", status: "PENDING", receivedAt: "2026-11-18", registrantName: "合成登记人", partyRole: "CLIENT_PARTY", partyStanding: "PLAINTIFF" } }
    ] });
    renderView("合成主体");
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));
    const link = await screen.findByRole("link", { name: "查看案件" });
    expect(link).toHaveAttribute("href", "/matters/AJ-2026-0001");
    expect(screen.getAllByRole("link", { name: "查看案件" })).toHaveLength(1);
    expect(screen.getByText("你不是该案成员，如需了解请联系主办律师")).toBeInTheDocument();
    expect(screen.getByText("收案内容不因预检开放，如需了解请联系登记人")).toBeInTheDocument();
    const subject = screen.getByText("相关记录 3 处 · 名称相同").closest<HTMLElement>(".hit-card")!;
    expect(within(subject).getByText("合成待办收案")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建预检" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新建预检" }));
    expect(screen.getByRole("textbox", { name: "主体名称" })).toHaveValue("");
    expect(screen.queryByRole("link", { name: "查看案件" })).not.toBeInTheDocument();
  });
});
