import { describe, expect, it } from "vitest";
import {
  matchesTaskProgressFilter, summarizeTaskProgress, taskHasNoKnownBlockers, taskProgressLabels,
  type TaskProgressSummary
} from "@/lib/tasks/workflow";

const now = new Date("2026-11-17T08:00:00.000Z");
const waiting = { waitingFor: "客户财务", expectedResult: "银行原始回单", nextCheckAt: now };
const source = () => ({
  matterId: "matter", stageMatterId: null as string | null,
  responsibility: { state: "OPEN" as const } as { state: "OPEN" } | null,
  waitings: [] as typeof waiting[],
  prerequisites: [] as { matterId: string; state: "DONE" | "CANCELLED" | "OPEN" | null }[]
});

describe("G02 任务推进摘要", () => {
  it("等待与未完成前置分别保留；取消仍阻塞，检查时点包含等于当前时刻", () => {
    const summary = summarizeTaskProgress({ ...source(), waitings: [waiting], prerequisites: [
      { matterId: "matter", state: "DONE" }, { matterId: "matter", state: "CANCELLED" }
    ] }, now);
    expect(summary).toEqual({ availability: "AVAILABLE", waiting, blockingPrerequisiteCount: 1, cancelledPrerequisiteCount: 1, checkDue: true });
    expect(matchesTaskProgressFilter(summary, "WAITING")).toBe(true);
    expect(matchesTaskProgressFilter(summary, "BLOCKED")).toBe(true);
    expect(matchesTaskProgressFilter(summary, "CHECK_DUE")).toBe(true);
    expect(taskHasNoKnownBlockers(summary)).toBe(false);
    expect(taskProgressLabels(summary)).toContain("前置未完成 1 项（含已取消 1 项）");
  });

  it("未来检查不混入待检查，后续筛选交互按原检查时点重新观察", () => {
    const summary = summarizeTaskProgress({ ...source(), waitings: [waiting] }, new Date(now.getTime() - 1));
    expect(matchesTaskProgressFilter(summary, "CHECK_DUE")).toBe(false);
    expect(matchesTaskProgressFilter(summary, "CHECK_DUE", now)).toBe(true);
    expect(taskProgressLabels(summary, now)).toContain("待检查");
    expect(summary.availability === "AVAILABLE" && summary.checkDue).toBe(false);
    expect(waiting.nextCheckAt).toEqual(now);
  });

  it.each([
    { responsibility: null },
    { stageMatterId: "another" },
    { prerequisites: [{ matterId: "another", state: "DONE" as const }] },
    { prerequisites: [{ matterId: "matter", state: null }] },
    { waitings: [waiting, { ...waiting, waitingFor: "不可选其中一件" }] }
  ])("不完整或异常关联只返回匿名待核对，不伪造可继续：%j", override => {
    const summary = summarizeTaskProgress({ ...source(), ...override }, now);
    expect(summary).toEqual({ availability: "REVIEW" });
    expect(taskHasNoKnownBlockers(summary)).toBe(false);
    expect(matchesTaskProgressFilter(summary, "UNBLOCKED")).toBe(false);
  });

  it("只有可读且没有已记录阻塞的任务进入无已知阻塞；未知仍留在全部事项", () => {
    const clear = summarizeTaskProgress({ ...source(), prerequisites: [{ matterId: "matter", state: "DONE" }] }, now);
    expect(taskHasNoKnownBlockers(clear)).toBe(true);
    expect(taskProgressLabels(clear)).toEqual(["无已知阻塞"]);
    const unavailable: TaskProgressSummary = { availability: "UNAVAILABLE" };
    expect(matchesTaskProgressFilter(unavailable, "ALL")).toBe(true);
    expect(matchesTaskProgressFilter(unavailable, "UNBLOCKED")).toBe(false);
    expect(taskProgressLabels(unavailable)).toEqual(["任务详情当前不可读取"]);
  });
});
