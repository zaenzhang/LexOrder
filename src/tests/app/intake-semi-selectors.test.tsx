import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ search: vi.fn(), existing: vi.fn(), create: vi.fn(), enterprise: vi.fn(), clear: vi.fn() }));
vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: mock.search }));
import { ClientCombobox } from "@/app/(app)/intakes/_components/client-combobox";
import { JurisdictionSelect } from "@/app/(app)/intakes/_components/jurisdiction-select";

beforeEach(() => {
  vi.clearAllMocks();
  mock.search.mockResolvedValue({ configured: false, items: [] });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function clients() {
  return render(<ClientCombobox clientId="" clientName="" clientType="INDIVIDUAL"
    options={[{ id: "client-1", name: "合成客户甲", type: "INDIVIDUAL" }, { id: "client-2", name: "合成客户甲", type: "COMPANY" }]}
    onPickExisting={mock.existing} onTypeNew={mock.create} onPickYuandian={mock.enterprise} onClear={mock.clear} />);
}

describe("收案 Semi 客户及管辖地选择", () => {
  it("同名客户仍按所选ID回传，不把选择当新建", async () => {
    clients();
    fireEvent.click(screen.getByRole("combobox", { name: "委托方客户" }));
    const matches = await screen.findAllByRole("option", { name: /合成客户甲/ });
    fireEvent.click(matches[1]);
    expect(mock.existing).toHaveBeenCalledWith("client-2", "合成客户甲");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("输入新客户名后明确选择新建，不发起企业服务", async () => {
    clients();
    fireEvent.click(screen.getByRole("combobox", { name: "委托方客户" }));
    fireEvent.change(await screen.findByPlaceholderText("输入姓名 / 公司名"), { target: { value: "  合成新客户  " } });
    fireEvent.click(await screen.findByRole("option", { name: /新建 合成新客户 为委托方/ }));
    expect(mock.create).toHaveBeenCalledWith("合成新客户");
    expect(mock.existing).not.toHaveBeenCalled();
    expect(mock.search).not.toHaveBeenCalled();
  });

  it("企业查询未返回仍可Escape关闭，迟到结果不会污染重开", async () => {
    let resolve!: (value: { configured: boolean; items: { id: string; name: string; creditCode: string }[] }) => void;
    mock.search.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<ClientCombobox clientId="" clientName="" clientType="COMPANY" options={[]}
      onPickExisting={mock.existing} onTypeNew={mock.create} onPickYuandian={mock.enterprise} onClear={mock.clear} />);
    const trigger = screen.getByRole("combobox", { name: "委托方客户" });
    fireEvent.click(trigger);
    const search = await screen.findByPlaceholderText("输入姓名 / 公司名");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "合成查询企业" } });
    await waitFor(() => expect(mock.search).toHaveBeenCalledWith("合成查询企业"));
    expect(screen.getByRole("status")).toHaveTextContent("正在查询企业信息");
    expect(screen.getByRole("option", { name: /新建 合成查询企业 为委托方/ })).toBeVisible();
    fireEvent.keyDown(search, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    await act(async () => resolve({ configured: true, items: [{ id: "enterprise-late", name: "迟到的合成企业", creditCode: "SYNTHETIC" }] }));
    fireEvent.click(trigger);
    expect(await screen.findByPlaceholderText("输入姓名 / 公司名")).toHaveValue("");
    expect(screen.queryByRole("option", { name: /迟到的合成企业/ })).not.toBeInTheDocument();
    expect(mock.enterprise).not.toHaveBeenCalled();
  });

  it("企业候选在关闭清查询前按原 ID 与信用代码交回", async () => {
    const candidate = { id: "enterprise-selected", name: "合成待选企业", creditCode: "SYNTHETIC-SELECTED" };
    mock.search.mockResolvedValue({ configured: true, items: [candidate] });
    render(<ClientCombobox clientId="" clientName="" clientType="COMPANY" options={[]}
      onPickExisting={mock.existing} onTypeNew={mock.create} onPickYuandian={mock.enterprise} onClear={mock.clear} />);
    const trigger = screen.getByRole("combobox", { name: "委托方客户" });
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByPlaceholderText("输入姓名 / 公司名"), { target: { value: "合成待选企业" } });
    fireEvent.click(await screen.findByRole("option", { name: /SYNTHETIC-SELECTED/ }));
    expect(mock.enterprise).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(mock.existing).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });

  it("管辖地允许只选省，再选择市；原路径串保持不变", async () => {
    function Wrapper() {
      const [value, setValue] = useState("");
      return <><JurisdictionSelect value={value} onChange={setValue} /><output aria-label="当前管辖地">{value}</output></>;
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByRole("button", { name: "选择管辖地" }));
    fireEvent.click(await screen.findByRole("combobox", { name: "省 / 直辖市" }));
    fireEvent.click(await screen.findByRole("option", { name: /浙江省/ }));
    await waitFor(() => expect(screen.getByLabelText("当前管辖地")).toHaveTextContent(/^浙江省$/));
    fireEvent.click(screen.getByRole("combobox", { name: "市" }));
    fireEvent.click(await screen.findByRole("option", { name: /杭州市/ }));
    await waitFor(() => expect(screen.getByLabelText("当前管辖地")).toHaveTextContent(/^浙江省\/杭州市$/));
    fireEvent.click(screen.getByRole("combobox", { name: "区 / 县（可选）" }));
    fireEvent.click(await screen.findByRole("option", { name: /上城区/ }));
    await waitFor(() => expect(screen.getByLabelText("当前管辖地")).toHaveTextContent(/^浙江省\/杭州市\/上城区$/));
  });
});
