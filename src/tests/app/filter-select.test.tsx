import { useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterSelect } from "@/components/patterns/filter-select";

const options = [{ value: "active", label: "办理中" }, { value: "closed", label: "已结案" }];

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ControlledFilter({ initial, clearable = true, onChange = () => {} }: { initial?: string; clearable?: boolean; onChange?: (value: string | undefined) => void }) {
  const [value, setValue] = useState(initial);
  return <FilterSelect label="状态" value={value} options={options} clearable={clearable} allLabel="全部获权状态" onChange={next => { setValue(next); onChange(next); }} />;
}

describe("公共 Semi 页面筛选", () => {
  it.each(["click", "Enter", " "])("用 %s 重复激活筛选入口后关闭菜单并返回焦点", async (activation) => {
    const onChange = vi.fn();
    render(<ControlledFilter onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "状态" });
    function activateTrigger() {
      trigger.focus();
      if (activation === "click") {
        fireEvent.mouseDown(trigger);
        fireEvent.click(trigger);
      } else {
        const event = createEvent.keyDown(trigger, { key: activation });
        fireEvent(trigger, event);
        if (!event.defaultPrevented) fireEvent.click(trigger);
      }
    }

    activateTrigger();
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    activateTrigger();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("选择真实业务值后立即关闭，清除返回 undefined 并保留焦点", async () => {
    const onChange = vi.fn();
    render(<ControlledFilter onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "状态" });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "状态筛选" });
    // Semi 先离屏挂载再定位；等待真实可见状态后操作菜单。
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "办理中" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("active");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    const selected = screen.getByRole("button", { name: "状态 办理中" });
    expect(selected).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "清除状态筛选" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("button", { name: "状态" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "清除状态筛选" })).not.toBeInTheDocument();
  });

  it("菜单内全部与清除使用同一未筛选语义", async () => {
    const onChange = vi.fn();
    render(<ControlledFilter initial="closed" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "状态 已结案" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "全部获权状态" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getByRole("button", { name: "状态" })).toHaveFocus();
  });

  it("不可清空的范围不提供全部或清除，但可切换原值", async () => {
    const onChange = vi.fn();
    render(<ControlledFilter initial="active" clearable={false} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "清除状态筛选" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "状态 办理中" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("全部获权状态")).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "已结案" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("closed");
  });

  it.each(["Enter", " "])("键盘 %s 只激活一次，Escape 关闭菜单并返回筛选入口", async (key) => {
    const onChange = vi.fn();
    render(<ControlledFilter onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "状态" });
    trigger.focus();
    const event = createEvent.keyDown(trigger, { key, code: key === " " ? "Space" : "Enter", keyCode: key === " " ? 32 : 13 });
    fireEvent(trigger, event);
    // fireEvent.keyDown 不执行原生按钮默认激活，补上未被阻止的默认 click。
    if (!event.defaultPrevented) fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const item = within(menu).getByRole("menuitem", { name: "办理中" });
    item.focus();
    fireEvent.keyDown(item, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("保留 ArrowDown 打开入口，菜单中的方向键继续交给 Semi", async () => {
    render(<ControlledFilter />);
    const trigger = screen.getByRole("button", { name: "状态" });
    trigger.focus();
    const event = createEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    fireEvent(trigger, event);
    expect(event.defaultPrevented).toBe(true);
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    expect(within(menu).getByRole("menuitem", { name: "全部获权状态" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    expect(within(menu).getByRole("menuitem", { name: "办理中" })).toHaveFocus();
  });

  it("读取父级受控值，不把外部刷新当作一次用户筛选", () => {
    const onChange = vi.fn();
    const view = render(<FilterSelect label="状态" value="active" options={options} onChange={onChange} />);
    view.rerender(<FilterSelect label="状态" value="closed" options={options} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "状态 已结案" })).toBeInTheDocument();
    view.rerender(<FilterSelect label="状态" value={undefined} options={options} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "状态" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
