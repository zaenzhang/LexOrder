import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientHistoryItem } from "@/lib/clients/history";

const mock = vi.hoisted(() => ({ history: vi.fn(), saveAi: vi.fn(), refresh: vi.fn(), scroll: vi.fn() }));
vi.mock("@/server/clients/history-actions", () => ({ getClientHistoryPage: mock.history, getClientHistoryMatterPage: vi.fn() }));
vi.mock("@/server/settings/ai-actions", () => ({ saveAiSettingsAction: mock.saveAi, clearAiKeyAction: vi.fn(), testAiConnection: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }), useSearchParams: () => new URLSearchParams(window.location.search) }));

import { ClientDetailTabs } from "@/app/(app)/clients/[id]/_components/client-detail-tabs";
import { ClientHistoryPanel } from "@/app/(app)/clients/[id]/_components/client-history-panel";
import { SettingsTabs } from "@/app/(admin)/admin/ai/_components/settings-tabs";
import { AiSettingsForm } from "@/app/(admin)/admin/ai/_components/ai-settings-form";
import { OcrSettingsForm } from "@/app/(admin)/admin/ai/_components/ocr-settings-form";

const clientId = "cmtestclient00000000000001";
const activity: ClientHistoryItem = {
  key: "CONTACT:first", source: "CONTACT", id: "first", at: "2026-11-16T10:00:00Z", recordedAt: "2026-11-16T10:00:00Z",
  title: "合成较新动态", meta: "客户档案维护", content: null, href: `/clients/${clientId}#client-contacts`, linkLabel: "查看联系人"
};
function customer(initialTab?: string) {
  return <ClientDetailTabs initialTab={initialTab} sections={{
    followups: <h2 id="client-relationship-title">合成沟通区域</h2>,
    matters: <p>合成关联案件</p>,
    history: <ClientHistoryPanel clientId={clientId} initial={{ items: [activity], nextCursor: "next-page", selectedMatter: null }} />,
    profile: <h2 id="client-contacts">合成联系人区域</h2>
  }} />;
}
function selectTab(name: string) {
  fireEvent.keyDown(screen.getByRole("tab", { name }), { key: "Enter" });
}
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `/clients/${clientId}`);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mock.scroll });
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("客户与服务分区状态（组件环境）", () => {
  it("客户动态翻页后切区不丢位置，来源先打开资料，返回恢复原动态", async () => {
    mock.history.mockResolvedValue({ items: [{ ...activity, key: "CONTACT:older", id: "older", title: "合成较早动态" }], nextCursor: null });
    render(customer());
    expect(screen.getByText("合成沟通区域")).toBeVisible();
    expect(screen.getByText("合成联系人区域").closest('[role="tabpanel"]')).toHaveAttribute("aria-hidden", "true");
    selectTab("客户动态");
    fireEvent.click(screen.getByRole("button", { name: "客户动态下一页" }));
    await waitFor(() => expect(screen.getByText("合成较早动态")).toBeVisible());
    selectTab("客户资料");
    selectTab("客户动态");
    expect(screen.getByText("合成较早动态")).toBeVisible();
    expect(mock.history).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link", { name: "查看联系人 →" }));
    expect(screen.getByRole("tab", { name: "客户资料" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByText("合成联系人区域")).toHaveFocus());
    expect(window.location.hash).toBe("#client-contacts");
    window.history.back();
    await waitFor(() => expect(screen.getByRole("tab", { name: "客户动态" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText("合成较早动态")).toBeVisible();
    expect(mock.history).toHaveBeenCalledOnce();
  });

  it("直接打开来源 hash 时先选对应区域", async () => {
    window.history.replaceState(null, "", `/clients/${clientId}?tab=history#client-contacts`);
    render(customer("history"));
    expect(screen.getByRole("tab", { name: "客户资料" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByText("合成联系人区域")).toHaveFocus());
  });

  it("未知分区与 hash 回到默认沟通页", () => {
    window.history.replaceState(null, "", `/clients/${clientId}?tab=unknown#__proto__`);
    render(customer("unknown"));
    expect(screen.getByRole("tab", { name: "沟通跟进" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("合成沟通区域")).toBeVisible();
  });

  it("模型和 OCR 来回切换保留各自输入，切换不会保存或调用服务", () => {
    window.history.replaceState(null, "", "/admin/ai");
    const defaults = { baseUrl: "https://example.test/v1", textModel: "synthetic-text", visionModel: "synthetic-vision" };
    render(<SettingsTabs sections={{
      models: <AiSettingsForm initial={{ ...defaults, enabled: false, credentialSaved: false, configured: false, apiKeyMasked: "" }} defaults={defaults} />,
      ocr: <OcrSettingsForm initial={{ endpoint: "", apiKey: "", supportsPdf: false, enabled: false }} />,
      database: <p>合成法库区域</p>, mcp: <p>合成 MCP 区域</p>, calls: <p>合成调用记录</p>
    }} />);
    fireEvent.change(screen.getByLabelText("接口密钥（API Key）"), { target: { value: "synthetic-unsaved-key" } });
    fireEvent.click(screen.getByRole("tab", { name: "OCR" }));
    fireEvent.change(screen.getByLabelText("OCR 网关地址（可选）"), { target: { value: "https://example.test/ocr" } });
    expect(screen.getByLabelText("接口密钥（API Key）")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "模型" }));
    expect(screen.getByLabelText("接口密钥（API Key）")).toHaveValue("synthetic-unsaved-key");
    expect(screen.getByLabelText("接口密钥（API Key）")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "OCR" }));
    expect(screen.getByLabelText("OCR 网关地址（可选）")).toHaveValue("https://example.test/ocr");
    expect(window.location.search).toBe("?tab=ocr");
    expect(mock.saveAi).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
  });
});
