export type TraceRange = [number, number]

const daySteps = [1, 2, 3, 5, 7, 14, 28, 60, 90, 180, 365]

export function visibleRange(full: TraceRange, zoomed?: TraceRange): TraceRange {
  return zoomed && zoomed[0] >= full[0] && zoomed[1] <= full[1] ? zoomed : full
}

function slideRange(full: TraceRange, start: number, length: number): TraceRange {
  const left = Math.max(full[0], Math.min(start, full[1] - length))
  return [left, Math.min(full[1], left + length)]
}

export function zoomTrace(full: TraceRange, zoomed: TraceRange | undefined, scale: number, anchor: number): TraceRange | undefined {
  const [left, right] = visibleRange(full, zoomed)
  const span = right - left
  const length = Math.max(1, span * scale)
  if (length >= full[1] - full[0]) return undefined
  return slideRange(full, left + (span - length) * anchor, length)
}

export function panTrace(full: TraceRange, zoomed: TraceRange | undefined, fraction: number): TraceRange | undefined {
  if (!zoomed) return undefined
  const [left, right] = visibleRange(full, zoomed)
  const span = right - left
  return span < full[1] - full[0] ? slideRange(full, left + span * fraction, span) : undefined
}

export function traceTicks([left, right]: TraceRange, plotWidth: number): number[] {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return []
  const target = (right - left) / Math.max(1, plotWidth / 100)
  const step = daySteps.find(value => value >= target) ?? Math.ceil(target / 365) * 365
  const first = Math.ceil(left / step) * step
  return Array.from({ length: Math.max(0, Math.floor((right - first) / step) + 1) }, (_, index) => first + index * step)
}

export function moveTraceWindow(full: TraceRange, current: TraceRange, mode: "select" | "move", shift: number, anchor = 0): TraceRange | undefined {
  const minimum = Math.min(1, full[1] - full[0])
  const clip = (day: number) => Math.min(full[1], Math.max(full[0], day))
  const [left, right] = current
  let range: TraceRange
  if (mode === "move") range = slideRange(full, left + shift, right - left)
  else {
    const start = Math.min(clip(anchor), clip(anchor + shift))
    const end = Math.max(clip(anchor), clip(anchor + shift))
    range = slideRange(full, start, Math.max(minimum, end - start))
  }
  return range[0] === full[0] && range[1] === full[1] ? undefined : range
}

export function traceCalendarTicks(range: TraceRange, width: number) {
  const [left, right] = range
  if (!Number.isFinite(left) || !Number.isFinite(right)) return []
  const days = (right - left) / Math.max(1, width / 82)
  const dayMs = 86_400_000
  if (days < 23) return traceTicks(range, width).map(day => {
    const date = new Date(day * dayMs)
    return { day, label: (date.getUTCMonth() + 1) + "/" + date.getUTCDate() }
  })
  const step = days < 45 ? 1 : days < 107 ? 3 : days < 210 ? 6 : Math.ceil(days / 365) * 12
  const start = new Date(left * dayMs)
  const end = new Date(right * dayMs)
  const first = start.getUTCFullYear() * 12 + start.getUTCMonth()
  const last = end.getUTCFullYear() * 12 + end.getUTCMonth()
  const result: { day: number; label: string }[] = []
  for (let index = Math.ceil(first / step) * step; index <= last; index += step) {
    const year = Math.floor(index / 12)
    const month = index % 12
    const date = new Date(0)
    date.setUTCFullYear(year, month, 1)
    const day = date.getTime() / dayMs
    if (day <= left || day >= right) continue
    const label = step >= 12 ? String(year) : step === 3 ? (month === 0 ? year + " " : "") + "Q" + (month / 3 + 1)
      : (month === 0 ? year + " · " : "") + (month + 1) + "月"
    result.push({ day, label })
  }
  return result
}
