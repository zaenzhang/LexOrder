import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn(), warning: vi.fn() }),
    Notification: Object.assign(semi.Notification, { error: vi.fn(), success: vi.fn(), warning: vi.fn() })
  };
});
vi.mock("@/server/clients/actions", () => ({ addContact: vi.fn() }));
vi.mock("@/server/clients/dedup", () => ({ mergeClientsByCode: vi.fn() }));

import { MergeBanner } from "@/app/(app)/clients/[id]/_components/client-detail-parts";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Semi 客户详情弹层回焦", () => {
  it.each([true, false])("合并入口（有建议：%s）取消与 Escape 回原按钮并保留依据", async (hasSuggestion) => {
    render(<MergeBanner keepId="cmtestclient00000000000001" keepName="合成保留客户" canMerge
      suspects={hasSuggestion ? [{ id: "cmtestclient00000000000002", name: "合成重复客户", internalCode: "KH-2026-0002", reason: "信用代码一致" }] : []} />);
    const trigger = screen.getByRole("button", { name: hasSuggestion ? "查看合并建议" : "合并重复档案" });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("合并依据（记入审计）"), { target: { value: "合成核对依据" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getByLabelText("合并依据（记入审计）")).toHaveValue("合成核对依据");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "合并客户档案" }), { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
