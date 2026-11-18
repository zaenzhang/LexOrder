import { describe, expect, it } from "vitest";
import { clientHistoryHref, clientHistoryReturnHref, clientListHref, clientListReturnHref } from "@/lib/clients/navigation";
import { personalFollowUpHref, personalFollowUpLocation } from "@/lib/clients/follow-ups";

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

describe("本人跟进定位与客户档案返回", () => {
  it("返回白名单只保留队列筛选与有效页码", () => {
    const href = personalFollowUpHref({ filter: "overdue", page: 3 });
    expect(clientListReturnHref(href)).toBe(href);
    expect(clientListReturnHref("/clients/follow-ups?filter=all&page=1")).toBe("/clients/follow-ups");
    for (const invalid of [
      "/clients/follow-ups?followUp=cmtestfollowup000000000001&client=cmtestclient00000000000001",
      "/clients/follow-ups?filter=today&next=%2Ffinance", "/clients/follow-ups?filter=today&filter=overdue",
      "/clients/follow-ups?page=02", "/clients/follow-ups?page=2&page=3", "/clients/follow-ups?filter=unknown",
      "/clients/follow-ups#target", "https://outside.example/clients/follow-ups?filter=today"
    ]) expect(clientListReturnHref(invalid)).toBe("/clients");
  });
  it("精确 ID 必须成对有效，坏位置不能回退成另一条目标", () => {
    const target = { followUpId: "cmtestfollowup000000000001", clientId: "cmtestclient00000000000001" };
    const url = new URL(personalFollowUpHref({ filter: "today", page: 2 }, target), "https://example.test");
    expect(personalFollowUpLocation(Object.fromEntries(url.searchParams))).toEqual({ query: { filter: "today", page: 2 }, target, mode: "result", error: "" });
    for (const invalid of [{ followUp: target.followUpId }, { followUp: [target.followUpId, target.followUpId], client: target.clientId }, { followUp: "wrong", client: target.clientId }]) {
      expect(personalFollowUpLocation(invalid)).toMatchObject({ target: null, error: "跟进位置无效，请从列表重新打开" });
    }
    expect(personalFollowUpLocation({ page: "1e2" }).query).toBeNull();
  });
  it("改期只有完整客户和跟进身份可携带模式，重复、未知及缺目标模式整体验证失败", () => {
    const target = { followUpId: "cmtestfollowup000000000001", clientId: "cmtestclient00000000000001" };
    const url = new URL(personalFollowUpHref({ filter: "overdue", page: 3 }, target, "reschedule"), "https://example.test");
    expect(personalFollowUpLocation(Object.fromEntries(url.searchParams))).toEqual({ query: { filter: "overdue", page: 3 }, target, mode: "reschedule", error: "" });
    for (const mode of ["result", "cancel", "unknown", "", ["reschedule", "reschedule"]]) {
      expect(personalFollowUpLocation({ followUp: target.followUpId, client: target.clientId, mode })).toMatchObject({ target: null, error: "跟进位置无效，请从列表重新打开" });
    }
    expect(personalFollowUpLocation({ mode: "reschedule" }).error).toBeTruthy();
    expect(personalFollowUpLocation({ followUp: target.followUpId, mode: "reschedule" }).target).toBeNull();
    expect(clientListReturnHref(url.pathname + url.search)).toBe("/clients");
    expect(clientListReturnHref("/clients/follow-ups?filter=today&mode=reschedule")).toBe("/clients");
    expect(personalFollowUpHref({ filter: "overdue", page: 3 }, undefined, "reschedule")).toBe("/clients/follow-ups?filter=overdue&page=3");
  });
});

describe("具体指示返回客户历史", () => {
  const clientId = "cmtestclient00000000000001", rowId = "CONTEXT:cmtestrecord00000000000001";
  it("只转运原页游标与确切行，同时保留独立客户列表返回位置", () => {
    const list = clientListHref({ search: "合成 & 客户", type: "COMPANY", page: 3 });
    const filters = { from: "2026-07-01", to: "2026-07-02", source: "CONTEXT" as const, matterId: "cmtestmatter00000000000001" };
    const href = clientHistoryHref(clientId, { cursor: "opaque_cursor-2", rowId, returnTo: list, filters });
    const parsed = new URL(href, "https://example.test");
    expect(parsed.searchParams.get("historyCursor")).toBe("opaque_cursor-2");
    expect(parsed.searchParams.get("rowId")).toBe(rowId);
    expect(parsed.searchParams.get("returnTo")).toBe(list);
    expect(parsed.searchParams.get("historyFrom")).toBe(filters.from);
    expect(parsed.searchParams.get("historyTo")).toBe(filters.to);
    expect(parsed.searchParams.get("historySource")).toBe(filters.source);
    expect(parsed.searchParams.get("historyMatterId")).toBe(filters.matterId);
    expect(clientHistoryReturnHref(href)).toBe(href);
  });
  it.each([
    "https://outside.example/clients/cmtestclient00000000000001?tab=history",
    "/clients/../finance?tab=history", "/clients/cmtestclient00000000000001?tab=profile",
    "/clients/cmtestclient00000000000001?tab=history&historyCursor=",
    "/clients/cmtestclient00000000000001?tab=history&historyCursor=a&historyCursor=b",
    "/clients/cmtestclient00000000000001?tab=history&rowId=OTHER:cmtestrecord00000000000001",
    "/clients/cmtestclient00000000000001?tab=history&rowId=CONTEXT:invalid",
    "/clients/cmtestclient00000000000001?tab=history&next=%2Ffinance",
    "/clients/cmtestclient00000000000001?tab=history&historyFrom=2026-02-29",
    "/clients/cmtestclient00000000000001?tab=history&historyFrom=2026-07-03&historyTo=2026-07-02",
    "/clients/cmtestclient00000000000001?tab=history&historySource=ALL",
    "/clients/cmtestclient00000000000001?tab=history&historyMatterId=bad",
    "/clients/cmtestclient00000000000001?tab=history&historySource=NOTE&historySource=CONTEXT",
    "/clients/cmtestclient00000000000001?tab=history&historyFrom=2026-07-01&historyFrom=2026-07-02",
    "/clients/cmtestclient00000000000001?tab=history#outside",
  ])("错误返回位置整体拒绝，不丢弃坏游标后伪造首屏：%s", value => {
    expect(clientHistoryReturnHref(value)).toBeNull();
  });
});
