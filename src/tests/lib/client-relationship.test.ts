import { describe, expect, it } from "vitest";
import { fromShanghaiInput, toShanghaiInput, clientActivitySchema } from "@/lib/clients/relationship";
import { clientRelationshipFilter, canCloseClientFollowUp } from "@/server/clients/relationship-access";
import { clientVisibilityFilter } from "@/lib/permissions";

describe("客户沟通时间与范围", () => {
  it("上海午夜正确换算为前一天 UTC，拒绝不存在的日期", () => {
    expect(fromShanghaiInput("2026-11-16T00:15")).toBe("2026-11-15T16:15:00.000Z");
    expect(toShanghaiInput("2026-11-15T16:15:00Z")).toBe("2026-11-16T00:15");
    expect(() => fromShanghaiInput("2026-02-30T12:00")).toThrow();
  });
  it("负责人进入客户主档范围，但无授权的 CUSTOM 仍不可读", () => {
    expect(JSON.stringify(clientVisibilityFilter("lawyer", "LAWYER"))).toContain('"ownerUserId":"lawyer"');
    expect(clientVisibilityFilter("custom", "CUSTOM", [])).toEqual({ id: { in: [] } });
  });
  it("财务和管理读取范围不自动扩大沟通写权", () => {
    expect(clientRelationshipFilter({ id: "finance", role: "FINANCE" }, "read")).not.toEqual({});
    const manager = { id: "lawyer", role: "LAWYER", managerAuthorized: true };
    expect(clientRelationshipFilter(manager, "read")).toEqual({});
    expect(clientRelationshipFilter(manager, "write")).not.toEqual({});
    expect(canCloseClientFollowUp(manager, "another-lawyer")).toBe(false);
  });
  it("无结果不能完成或取消跟进", () => {
    expect(clientActivitySchema.safeParse({ clientId: "cmtestclient00000000000001", requestKey: "16a807a1-a8e1-4f96-a1f0-28e717be13c8", channel: "PHONE", content: " ", occurredAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });
});
