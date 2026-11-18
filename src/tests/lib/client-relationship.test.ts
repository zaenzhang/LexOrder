import { describe, expect, it } from "vitest";
import { fromShanghaiInput, toShanghaiInput, clientActivitySchema } from "@/lib/clients/relationship";
import { clientRelationshipFilter, canCloseClientFollowUp } from "@/server/clients/relationship-access";
import { clientVisibilityFilter } from "@/lib/permissions";
import { clientFollowUpRescheduleSchema } from "@/lib/clients/follow-ups";

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
  it("改期仅接受完整毫秒基线和带时区时间，原因规范化且拒绝扩大的写入字段", () => {
    const input = { clientId: "cmtestclient00000000000001", followUpId: "cmtestfollowup000000000001", requestKey: "16a807a1-a8e1-4f96-a1f0-28e717be13c8", expectedUpdatedAt: "2026-11-18T10:00:00.007+08:00", dueAt: "2027-01-03T10:01:02.003+08:00", reason: "  合成约定变更  " };
    expect(clientFollowUpRescheduleSchema.parse(input)).toMatchObject({ expectedUpdatedAt: "2026-11-18T02:00:00.007Z", dueAt: "2027-01-03T02:01:02.003Z", reason: "合成约定变更" });
    for (const extra of [{ assigneeId: input.clientId }, { status: "CANCELLED" }, { title: "其他事项" }, { sourceActivityId: input.followUpId }]) expect(clientFollowUpRescheduleSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    for (const invalid of [{ reason: " " }, { reason: "字".repeat(1001) }, { dueAt: "2027-01-03T10:00" }, { dueAt: "1899-12-31T00:00:00Z" }, { dueAt: "2201-01-01T00:00:00Z" }, { expectedUpdatedAt: "2026-11-18" }, { requestKey: "arbitrary" }, { followUpId: "missing" }]) expect(clientFollowUpRescheduleSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
  });
});
