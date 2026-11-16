import { describe, expect, it } from "vitest";
import { clientListHref, clientListReturnHref } from "@/lib/clients/navigation";

describe("客户列表返回参数", () => {
  it("保留中文及特殊字符搜索、客户类型和页码", () => {
    const search = "张三 公司 & 合同?#+";
    const href = clientListHref({ search, type: "COMPANY", page: 3 });
    const parsed = new URL(href, "https://example.test");
    expect(parsed.pathname).toBe("/clients");
    expect(parsed.searchParams.get("search")).toBe(search);
    expect(parsed.searchParams.get("type")).toBe("COMPANY");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(clientListReturnHref(href)).toBe(href);
  });

  it("默认筛选与第一页不制造多余参数", () => {
    expect(clientListHref({ search: "", type: "ALL", page: 1 })).toBe("/clients");
    expect(clientListReturnHref("/clients?search=&page=1")).toBe("/clients");
  });

  it.each([
    undefined,
    ["/clients?page=2", "/clients?page=3"],
    "https://outside.example/clients?page=2",
    "//outside.example/clients?page=2",
    "javascript:alert(1)",
    "/clients/../finance",
    "/clients/",
    "/clients%2f..%2ffinance",
    "/clients\\outside.example",
    "/clients?next=https%3A%2F%2Foutside.example",
    "/clients?search=合同#outside",
    "/clients?type=UNKNOWN",
    "/clients?type=COMPANY&type=INDIVIDUAL",
    "/clients?search=甲&search=乙"
  ])("外部、未知或重复参数回到默认列表：%s", value => {
    expect(clientListReturnHref(value)).toBe("/clients");
  });

  it.each(["", "0", "-1", "1.5", "1e2", "+2", "02", "NaN", "Infinity", "9007199254740992", "2&page=3", "2&%70age=3"])("非法或重复 page 回到默认列表：%s", page => {
    expect(clientListReturnHref(`/clients?search=合同&page=${page}`)).toBe("/clients");
  });
});
