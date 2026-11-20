import { expect, it } from "vitest"

import { moveTraceWindow, panTrace, traceTicks, visibleRange, zoomTrace, type TraceRange } from "./fact-trace-scale"

it("在指针下同一日期放大和缩小，抵达边界时保留在全案范围内", () => {
  const full: TraceRange = [100, 500]
  const zoomed = zoomTrace(full, undefined, 0.25, 0.8)!
  expect(zoomed).toEqual([340, 440])
  expect(zoomed[0] + 0.8 * (zoomed[1] - zoomed[0])).toBe(420)
  expect(zoomTrace(full, zoomed, 2, 0.8)).toEqual([260, 460])
  expect(zoomTrace(full, zoomed, 4, 0.8)).toBeUndefined()
  expect(zoomTrace(full, undefined, 0.0001, 0)).toEqual([100, 101])
  expect(zoomTrace(full, undefined, 0.0001, 1)).toEqual([499, 500])
})

it("平移保留缩放比例，跨出数据范围时夹到边缘", () => {
  const full: TraceRange = [0, 100]
  const zoomed: TraceRange = [30, 40]
  expect(panTrace(full, zoomed, 0.4)).toEqual([34, 44])
  expect(panTrace(full, zoomed, -10)).toEqual([0, 10])
  expect(panTrace(full, zoomed, 10)).toEqual([90, 100])
  expect(panTrace(full, undefined, 0.4)).toBeUndefined()
  expect(visibleRange([50, 100], zoomed)).toEqual([50, 100])
})

it("连续竖线按等天数布置，放大后逐日标记且窄屏刻度疏一些", () => {
  const full: TraceRange = [19225, 20120]
  const ticks = traceTicks(full, 650)
  expect(ticks.length).toBeGreaterThan(3)
  expect(new Set(ticks.slice(1).map((tick, index) => tick - ticks[index])).size).toBe(1)
  expect(traceTicks(full, 170).length).toBeLessThan(ticks.length)
  expect(traceTicks([19999.5, 20004.5], 650)).toEqual([20000, 20001, 20002, 20003, 20004])
  expect(traceTicks([20000, 20001], 150)).toEqual([20000, 20001])
  expect(traceTicks([Infinity, Infinity], 500)).toEqual([])
})

it("双手柄缩选、平移和反向框选保持日期窗有效", () => {
  expect(moveTraceWindow([0, 100], [0, 100], "select", -20, 49)).toEqual([29, 49])
  expect(moveTraceWindow([0, 100], [29, 49], "start", 50)).toEqual([48, 49])
  expect(moveTraceWindow([0, 100], [29, 49], "end", 5)).toEqual([29, 54])
  expect(moveTraceWindow([0, 100], [29, 49], "move", 100)).toEqual([80, 100])
  expect(moveTraceWindow([0, 100], [0, 49], "end", 100)).toBeUndefined()
})
