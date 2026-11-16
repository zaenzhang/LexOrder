// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dependencyWouldCycle } from "@/server/tasks/dependency-guard";
import { taskDaySchema, taskCreateSchema, taskWaitEndSchema } from "@/server/tasks/contracts";
import { shDateFromKey, shDayKey } from "@/lib/ui/sh-time";

describe("同案待办的输入与依赖", () => {
  it("检查日严格使用有效日历日，不接受时刻或自动滚到下月", () => {
    expect(taskDaySchema.parse("2028-02-29")).toBe("2028-02-29");
    for (const value of ["2026-02-29", "2026-02-31", "2026-11-16T00:00:00Z", "2026-13-01", ""]) expect(taskDaySchema.safeParse(value).success).toBe(false);
    expect(shDateFromKey("2026-11-16").toISOString()).toBe("2026-11-15T16:00:00.000Z");
    expect(shDayKey(shDateFromKey("2026-11-16"))).toBe("2026-11-16");
  });
  it("新建需要稳定提交标识；结束等待不能省略实际结果", () => {
    expect(taskCreateSchema.safeParse({ matterId: "cm00000000000000000000001", title: "无阶段待办" }).success).toBe(false);
    expect(taskWaitEndSchema.safeParse({ matterId: "cm00000000000000000000001", taskId: "cm00000000000000000000002", id: "cm00000000000000000000003", revision: 1, result: " " }).success).toBe(false);
  });
  it("拒绝自身、直接、间接循环；既有分支不会误报", () => {
    const edges = [{ taskId: "B", prerequisiteTaskId: "A" }, { taskId: "C", prerequisiteTaskId: "B" }, { taskId: "D", prerequisiteTaskId: "B" }];
    expect(dependencyWouldCycle(edges, "A", "A")).toBe(true);
    expect(dependencyWouldCycle(edges, "A", "B")).toBe(true);
    expect(dependencyWouldCycle(edges, "A", "C")).toBe(true);
    expect(dependencyWouldCycle(edges, "D", "C")).toBe(false);
  });
});
