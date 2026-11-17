import { useState, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getCauseById } from "@/server/causes/actions";

const mock = vi.hoisted(() => ({ lookup: vi.fn(), search: vi.fn(), change: vi.fn() }));
vi.mock("@/server/causes/actions", () => ({ getCauseById: mock.lookup, searchCauses: mock.search }));

import { CauseCombobox } from "@/app/(app)/matters/_components/cause-combobox";

type Cause = NonNullable<Awaited<ReturnType<typeof getCauseById>>>;
type Props = ComponentProps<typeof CauseCombobox>;
function cause(id: string, name = `合成案由 ${id}`): Cause {
  return { id, name, category: "CIVIL_COMMERCIAL", code: "CC-4", shortName: null,
    level: 2, parentId: null, l1Name: "合成一级", l2Name: name };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Controlled({ initialValue = "", ...props }: Omit<Props, "value" | "onChange"> & { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return <>
    <CauseCombobox {...props} value={value} onChange={(id, name) => { mock.change(id, name); setValue(id); }} />
    <output aria-label="当前案由 ID">{value}</output>
  </>;
}
const props = { category: "CIVIL_COMMERCIAL" as const, onChange: mock.change };
const trigger = () => within(screen.getByRole("combobox"));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mock.lookup.mockResolvedValue(null);
  mock.search.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// 使用真实选择器和浮层组件、mock 服务响应；只作为组件证据，不替代浏览器或真实数据库验收。
describe("已有案由按 ID 回显", () => {
  it("初次空值只显示 placeholder，不读取案由或改值", () => {
    render(<CauseCombobox {...props} value="" placeholder="选择本案案由" />);
    expect(trigger().getByText("选择本案案由")).toBeVisible();
    expect(mock.lookup).not.toHaveBeenCalled();
    expect(mock.search).not.toHaveBeenCalled();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it("初次已有 ID 在打开前加载名称，保持受控 ID 且不加载全库", async () => {
    const pending = deferred<Cause | null>();
    mock.lookup.mockReturnValue(pending.promise);
    render(<Controlled category="CIVIL_COMMERCIAL" initialValue="A" />);
    expect(trigger().getByText("案由名称加载中…")).toBeVisible();
    expect(mock.lookup).toHaveBeenCalledWith("A");
    await act(async () => { pending.resolve(cause("A")); });
    expect(trigger().getByText("合成案由 A")).toBeVisible();
    expect(screen.getByLabelText("当前案由 ID")).toHaveTextContent("A");
    expect(mock.lookup).toHaveBeenCalledOnce();
    expect(mock.search).not.toHaveBeenCalled();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it("已回显 A 切换 B 后，不在新名称加载期间继续显示 A", async () => {
    const pendingB = deferred<Cause | null>();
    mock.lookup.mockImplementation((id: string) => id === "A" ? Promise.resolve(cause("A")) : pendingB.promise);
    const view = render(<CauseCombobox {...props} value="A" />);
    await trigger().findByText("合成案由 A");
    view.rerender(<CauseCombobox {...props} value="B" />);
    expect(trigger().getByText("案由名称加载中…")).toBeVisible();
    expect(screen.queryByText("合成案由 A")).not.toBeInTheDocument();
    await act(async () => { pendingB.resolve(cause("B")); });
    expect(trigger().getByText("合成案由 B")).toBeVisible();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it.each(["success", "error"] as const)("B 先完成后，A 迟到的 %s 不覆盖当前名称", async (outcome) => {
    const pendingA = deferred<Cause | null>();
    const pendingB = deferred<Cause | null>();
    mock.lookup.mockImplementation((id: string) => id === "A" ? pendingA.promise : pendingB.promise);
    const view = render(<CauseCombobox {...props} value="A" />);
    view.rerender(<CauseCombobox {...props} value="B" />);
    await act(async () => { pendingB.resolve(cause("B")); });
    expect(trigger().getByText("合成案由 B")).toBeVisible();
    await act(async () => {
      if (outcome === "success") pendingA.resolve(cause("A"));
      else pendingA.reject(new Error("合成旧请求失败"));
    });
    expect(trigger().getByText("合成案由 B")).toBeVisible();
    expect(mock.lookup.mock.calls.map(([id]) => id)).toEqual(["A", "B"]);
    expect(mock.change).not.toHaveBeenCalled();
  });

  it.each(["success", "error"] as const)("清空后，迟到的 %s 不恢复旧名称或覆盖 placeholder", async (outcome) => {
    const pending = deferred<Cause | null>();
    mock.lookup.mockReturnValue(pending.promise);
    const view = render(<CauseCombobox {...props} value="A" />);
    view.rerender(<CauseCombobox {...props} value="" />);
    expect(trigger().getByText("点击选择")).toBeVisible();
    await act(async () => {
      if (outcome === "success") pending.resolve(cause("A"));
      else pending.reject(new Error("合成已清空请求失败"));
    });
    expect(trigger().getByText("点击选择")).toBeVisible();
    expect(mock.lookup).toHaveBeenCalledOnce();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it.each(["success", "error"] as const)("卸载后能够收尾迟到的 %s，不触发业务回调", async (outcome) => {
    const pending = deferred<Cause | null>();
    mock.lookup.mockReturnValue(pending.promise);
    const view = render(<CauseCombobox {...props} value="A" />);
    view.unmount();
    await act(async () => {
      if (outcome === "success") pending.resolve(cause("A"));
      else pending.reject(new Error("合成已卸载请求失败"));
    });
    expect(view.container).toBeEmptyDOMElement();
    expect(mock.lookup).toHaveBeenCalledOnce();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", "未找到已选案由"],
    ["error", "案由名称加载失败"]
  ] as const)("读取结果为 %s 时明确提示并保留 ID", async (status, label) => {
    if (status === "missing") mock.lookup.mockResolvedValue(null);
    else mock.lookup.mockRejectedValue(new Error("合成服务失败"));
    render(<Controlled category="CIVIL_COMMERCIAL" initialValue="A" />);
    expect(await trigger().findByText(label)).toBeVisible();
    expect(screen.getByLabelText("当前案由 ID")).toHaveTextContent("A");
    expect(mock.change).not.toHaveBeenCalled();
    expect(mock.search).not.toHaveBeenCalled();
  });
});

describe("候选列表与案由范围保持既有规则", () => {
  it("选择已加载节点和搜索结果时正常回调，不额外读取名称", async () => {
    const parent = cause("parent", "合成合同纠纷");
    const sale = { ...cause("sale", "合成买卖合同纠纷"), level: 3, parentId: parent.id, l2Name: parent.name };
    const loan = { ...cause("loan", "合成借款合同纠纷"), level: 3, parentId: parent.id, l2Name: parent.name };
    mock.search.mockResolvedValue([parent, sale, loan]);
    render(<Controlled category="CIVIL_COMMERCIAL" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("button", { name: parent.name }));
    expect(mock.change).toHaveBeenLastCalledWith(parent.id, parent.name);
    expect(trigger().getByText(parent.name)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: sale.name }));
    expect(mock.change).toHaveBeenLastCalledWith(sale.id, sale.name);
    expect(trigger().getByText(sale.name)).toBeVisible();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("搜索案由，或下方逐级浏览"), { target: { value: "借款" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(loan.name) }));
    expect(mock.change).toHaveBeenLastCalledWith(loan.id, loan.name);
    expect(trigger().getByText(loan.name)).toBeVisible();
    expect(mock.change).toHaveBeenCalledTimes(3);
    expect(mock.lookup).not.toHaveBeenCalled();
    expect(mock.search).toHaveBeenCalledOnce();
    expect(mock.search).toHaveBeenCalledWith({ category: "CIVIL_COMMERCIAL", procedureType: undefined, limit: 2000 });
  });

  it("列表已取得当前 ID 的名称时优先显示它，旧按 ID 响应不能替换", async () => {
    const pending = deferred<Cause | null>();
    mock.lookup.mockReturnValue(pending.promise);
    mock.search.mockResolvedValue([cause("A", "列表中的当前案由")]);
    render(<CauseCombobox {...props} value="A" />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(await trigger().findByText("列表中的当前案由")).toBeVisible();
    await act(async () => { pending.resolve(cause("A", "迟到的旧名称")); });
    expect(trigger().getByText("列表中的当前案由")).toBeVisible();
    expect(screen.queryByText("迟到的旧名称")).not.toBeInTheDocument();
    expect(mock.change).not.toHaveBeenCalled();
  });

  it("一审改二审属于同一范围，不清空或重复读取当前案由", async () => {
    mock.lookup.mockResolvedValue(cause("A"));
    const view = render(<Controlled category="CIVIL_COMMERCIAL" procedureType="FIRST_INSTANCE" initialValue="A" />);
    await trigger().findByText("合成案由 A");
    view.rerender(<Controlled category="CIVIL_COMMERCIAL" procedureType="SECOND_INSTANCE" initialValue="A" />);
    expect(trigger().getByText("合成案由 A")).toBeVisible();
    expect(screen.getByLabelText("当前案由 ID")).toHaveTextContent("A");
    expect(mock.change).not.toHaveBeenCalled();
    expect(mock.lookup).toHaveBeenCalledOnce();
  });

  it("真实范围变化沿既有回调清空值和列表，下次打开读取新范围", async () => {
    mock.search.mockResolvedValueOnce([cause("A")]).mockResolvedValueOnce([]);
    const view = render(<Controlled category="CIVIL_COMMERCIAL" procedureType="FIRST_INSTANCE" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("button", { name: "合成案由 A" }));
    expect(screen.getByLabelText("当前案由 ID")).toHaveTextContent("A");
    mock.change.mockClear();
    view.rerender(<Controlled category="CIVIL_COMMERCIAL" procedureType="COMMERCIAL_ARBITRATION" />);
    expect(trigger().getByText("点击选择")).toBeVisible();
    expect(screen.getByLabelText("当前案由 ID")).toBeEmptyDOMElement();
    expect(mock.change).toHaveBeenCalledExactlyOnceWith("", "");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(mock.search).toHaveBeenCalledTimes(2));
    expect(mock.search).toHaveBeenLastCalledWith({ category: "CIVIL_COMMERCIAL", procedureType: "COMMERCIAL_ARBITRATION", limit: 2000 });
    expect(mock.lookup).not.toHaveBeenCalled();
  });
});
