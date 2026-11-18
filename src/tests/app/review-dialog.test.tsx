import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspaceDialog } from "@/components/patterns/workspace-dialog";
import { ReviewDialogContent, type ReviewTab } from "@/components/patterns/review-dialog";

let tabsStyle: HTMLStyleElement;

beforeAll(() => {
  // Vitest 不装载依赖 CSS；使用安装版的实际规则核对保留 DOM 的隐藏页。
  const require = createRequire(import.meta.url);
  tabsStyle = document.createElement("style");
  tabsStyle.textContent = readFileSync(require.resolve("@douyinfe/semi-foundation/lib/es/tabs/tabs.css"), "utf8");
  document.head.appendChild(tabsStyle);
});

afterEach(cleanup);
afterAll(() => tabsStyle.remove());

function DraftPane({ label, mounted }: { label: string; mounted?: () => void }) {
  const [value, setValue] = useState("");
  useEffect(() => { mounted?.(); }, [mounted]);
  return <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />;
}

function Review({ tab, onTabChange, mounted }: { tab?: string; onTabChange?: (id: string) => void; mounted?: () => void }) {
  const tabs: ReviewTab[] = [
    { id: "application-data", label: "申请资料", count: 0, content: <DraftPane label="资料草稿" mounted={mounted} /> },
    { id: "conflict-review", label: "冲突核查", count: 3, countTone: "red", content: <DraftPane label="核查草稿" mounted={mounted} /> },
    { id: "original-history", label: "历史记录", content: <p>本条历史记录仅供查阅</p> },
  ];
  return (
    <WorkspaceDialog open>
      <ReviewDialogContent
        title="复核申请"
        description="合成申请编号"
        tabs={tabs}
        tab={tab}
        onTabChange={onTabChange}
        sidebar={<textarea aria-label="审批意见" defaultValue="保留原意见" />}
        sidebarTitle="审批处理"
        footer={<button type="button" disabled>当前无审批权限</button>}
      />
    </WorkspaceDialog>
  );
}

describe("复核窗口的 Semi 页签", () => {
  it("所有页签首次挂载，切换后各自草稿与审批意见保留", async () => {
    const mounted = vi.fn();
    render(<Review mounted={mounted} />);
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(2));

    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
    const applicationDraft = screen.getByRole("textbox", { name: "资料草稿" });
    fireEvent.change(applicationDraft, { target: { value: "尚未提交的申请说明" } });
    fireEvent.change(screen.getByRole("textbox", { name: "审批意见" }), { target: { value: "尚未提交的审批意见" } });

    fireEvent.click(screen.getByRole("tab", { name: /冲突核查\s*3/ }));
    const conflictDraft = await screen.findByRole("textbox", { name: "核查草稿" });
    fireEvent.change(conflictDraft, { target: { value: "待人工核对的冲突说明" } });
    fireEvent.click(screen.getByRole("tab", { name: /申请资料\s*0/ }));

    expect(screen.getByRole("textbox", { name: "资料草稿" })).toBe(applicationDraft);
    expect(applicationDraft).toHaveValue("尚未提交的申请说明");
    expect(screen.getByRole("textbox", { name: "审批意见" })).toHaveValue("尚未提交的审批意见");
    fireEvent.click(screen.getByRole("tab", { name: /冲突核查\s*3/ }));
    expect(screen.getByRole("textbox", { name: "核查草稿" })).toBe(conflictDraft);
    expect(conflictDraft).toHaveValue("待人工核对的冲突说明");
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it("使用调用方原有的受控 ID，通知切换但不擅自改变当前页", () => {
    const onTabChange = vi.fn();
    const view = render(<Review tab="conflict-review" onTabChange={onTabChange} />);
    expect(screen.getByRole("tab", { name: /冲突核查\s*3/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /申请资料\s*0/ }));
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("application-data");
    expect(screen.getByRole("tab", { name: /冲突核查\s*3/ })).toHaveAttribute("aria-selected", "true");

    view.rerender(<Review tab="application-data" onTabChange={onTabChange} />);
    expect(screen.getByRole("tab", { name: /申请资料\s*0/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "资料草稿" })).toBeVisible();
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it("保留的非当前页面实际隐藏，计数与只读操作不随切换丢失", () => {
    render(<Review />);
    const conflictDraft = screen.getByLabelText("核查草稿");
    expect(conflictDraft).not.toBeVisible();
    expect(conflictDraft.closest('[role="tabpanel"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("textbox", { name: "核查草稿" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /申请资料\s*0/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /冲突核查\s*3/ })).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "历史记录" }));
    expect(screen.getByText("本条历史记录仅供查阅")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "资料草稿" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前无审批权限" })).toBeDisabled();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("方向键和首尾键沿 Semi 原生行为移焦，Enter 与空格激活目标页", async () => {
    render(<Review />);
    const applicationTab = screen.getByRole("tab", { name: /申请资料\s*0/ });
    const conflictTab = screen.getByRole("tab", { name: /冲突核查\s*3/ });
    const historyTab = screen.getByRole("tab", { name: "历史记录" });

    act(() => applicationTab.focus());
    fireEvent.keyDown(applicationTab, { key: "ArrowRight" });
    expect(conflictTab).toHaveFocus();
    expect(applicationTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(conflictTab, { key: "Enter" });
    await waitFor(() => expect(conflictTab).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("textbox", { name: "核查草稿" })).toBeVisible();

    fireEvent.keyDown(conflictTab, { key: "End" });
    expect(historyTab).toHaveFocus();
    fireEvent.keyDown(historyTab, { key: " " });
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("本条历史记录仅供查阅")).toBeVisible();

    fireEvent.keyDown(historyTab, { key: "Home" });
    expect(applicationTab).toHaveFocus();
    fireEvent.keyDown(applicationTab, { key: "Enter" });
    expect(applicationTab).toHaveAttribute("aria-selected", "true");
  });
});
