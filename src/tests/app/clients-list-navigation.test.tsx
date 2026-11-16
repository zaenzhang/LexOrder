import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mock = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mock.replace }) }));
vi.mock("@/server/clients/actions", () => ({ getClientForEdit: vi.fn() }));
vi.mock("@/app/(app)/clients/_components/client-sheet", () => ({ ClientSheet: () => null }));

import { ClientsView } from "@/app/(app)/clients/_components/clients-view";
import { clientListReturnHref } from "@/lib/clients/navigation";

type Props = ComponentProps<typeof ClientsView>;
const date = new Date("2026-11-16T00:00:00Z");
const initialData: Props["initialData"] = {
  items: [{
    id: "cmtestclient00000000000001", name: "M2 合成客户", type: "INDIVIDUAL", idType: "ID_CARD", idNumber: null, idNumberBlind: null,
    address: null, legalRep: null, phone: null, email: null, source: null, cooperationStatus: "SIGNED", industry: null, gender: null,
    ethnicity: null, tags: [], notes: null, internalCode: "KH-TEST-0001", ownerUserId: null, createdAt: date, updatedAt: date,
    deletedAt: null, contacts: [], _count: { matters: 0, intakes: 0 }
  }], total: 47, page: 3, pageSize: 20
};
function list(initialFilters: Props["initialFilters"]) {
  return render(<ClientsView initialData={initialData} initialFilters={initialFilters} canCreate={false} editableClientIds={[]} />);
}
function detailLinks() {
  return screen.getAllByRole("link", { name: /^M2 合成客户/ });
}
function returnUrl(link: HTMLElement) {
  const detail = new URL(link.getAttribute("href")!, "https://example.test");
  return new URL(clientListReturnHref(detail.searchParams.get("returnTo")), detail.origin);
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("客户搜索草稿与详情返回（组件环境）", () => {
  it("选自然人、只输入搜索后直接进入详情，两个布局都携带当前输入并回第一页", () => {
    list({ search: "", type: "ALL" });
    fireEvent.click(screen.getByRole("tab", { name: "自然人" }));
    expect(mock.replace).toHaveBeenCalledWith("/clients?type=INDIVIDUAL");
    mock.replace.mockClear();
    const input = screen.getByRole("textbox", { name: "搜索客户" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "M2" } });
    const links = detailLinks();
    expect(links).toHaveLength(2);
    for (const link of links) {
      const url = returnUrl(link);
      expect(url.searchParams.get("search")).toBe("M2");
      expect(url.searchParams.get("type")).toBe("INDIVIDUAL");
      expect(url.searchParams.has("page")).toBe(false);
    }
    // Typing does not pretend the still-displayed server result has already been filtered.
    expect(screen.getByText("第 41–47 条，共 47 条")).toBeInTheDocument();
    fireEvent.blur(input, { relatedTarget: links[0] });
    expect(mock.replace).not.toHaveBeenCalled();
  });

  it("筛选没有变化时保留实际第三页，焦点移到详情不会重置列表页码", () => {
    list({ search: "M2", type: "INDIVIDUAL" });
    const input = screen.getByRole("textbox", { name: "搜索客户" });
    const link = detailLinks()[0];
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: link });
    expect(returnUrl(link).searchParams.get("page")).toBe("3");
    expect(returnUrl(link).searchParams.get("search")).toBe("M2");
    expect(mock.replace).not.toHaveBeenCalled();
  });

  it("清空已应用搜索后进入详情，不带旧搜索或旧页码", () => {
    list({ search: "M2", type: "INDIVIDUAL" });
    const input = screen.getByRole("textbox", { name: "搜索客户" });
    fireEvent.change(input, { target: { value: "" } });
    const url = returnUrl(detailLinks()[0]);
    expect(url.searchParams.get("type")).toBe("INDIVIDUAL");
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("普通失焦仍提交改变后的搜索并重置页码", () => {
    list({ search: "原搜索", type: "INDIVIDUAL" });
    const input = screen.getByRole("textbox", { name: "搜索客户" });
    fireEvent.change(input, { target: { value: "合成新搜索" } });
    fireEvent.blur(input);
    expect(mock.replace).toHaveBeenCalledOnce();
    const url = new URL(mock.replace.mock.calls[0][0], "https://example.test");
    expect(url.searchParams.get("search")).toBe("合成新搜索");
    expect(url.searchParams.get("type")).toBe("INDIVIDUAL");
    expect(url.searchParams.has("page")).toBe(false);
  });
});
