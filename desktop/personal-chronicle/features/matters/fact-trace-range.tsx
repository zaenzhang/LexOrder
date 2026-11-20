import { useRef, type KeyboardEvent, type PointerEvent } from "react"
import { cn } from "@/lib/utils"
import { moveTraceWindow, type TraceRange } from "./fact-trace-scale"

type DragMode = "select" | "move" | "start" | "end"

export function FactTraceRange({ domain, range, days, onChange }: {
  domain: TraceRange; range: TraceRange; days: number[]; onChange(range?: TraceRange): void
}) {
  const drag = useRef<{ id: number; mode: DragMode; pixel: number; moved: boolean; bounds: DOMRect; range: TraceRange } | null>(null)
  const length = domain[1] - domain[0]
  const x = (day: number) => (day - domain[0]) / length * 100
  const full = range[0] === domain[0] && range[1] === domain[1]
  const counts = Array.from({ length: 36 }, () => 0)
  for (const day of days) counts[Math.min(35, Math.max(0, Math.floor(x(day) * 0.36)))]++
  const maxCount = Math.max(1, ...counts)
  const year = (day: number) => new Date(day * 86_400_000).getUTCFullYear()
  const firstYear = year(domain[0])
  const yearCount = year(domain[1]) - firstYear + 1
  const years = yearCount <= 24 ? Array.from({ length: yearCount }, (_, index) => firstYear + index) : []
  const yearStart = (value: number) => Date.UTC(value, 0, 1) / 86_400_000

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    const mode = (event.target as HTMLElement).closest<HTMLElement>("[data-drag]")?.dataset.drag as DragMode | undefined
    drag.current = { id: event.pointerId, mode: mode === "move" && full ? "select" : mode ?? "select", pixel: event.clientX, moved: false,
      bounds: event.currentTarget.getBoundingClientRect(), range }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const shift = event.clientX - current.pixel
    if (current.mode === "select" && Math.abs(shift) < 4) return
    current.moved = true
    const anchor = domain[0] + length * (current.pixel - current.bounds.left) / current.bounds.width
    onChange(moveTraceWindow(domain, current.range, current.mode, shift * length / current.bounds.width, anchor))
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || event.pointerId !== current.id) return
    drag.current = null
    if (event.type === "pointerup" && current.mode === "select" && !current.moved && !full) {
      const center = domain[0] + length * (current.pixel - current.bounds.left) / current.bounds.width
      onChange(moveTraceWindow(domain, current.range, "move", center - (current.range[0] + current.range[1]) / 2))
    }
  }

  function handleKey(event: KeyboardEvent<HTMLSpanElement>, mode: "start" | "end") {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? Math.max(1, Math.floor(length / 20)) : 1
    onChange(moveTraceWindow(domain, range, mode, event.key === "ArrowLeft" ? -step : step))
  }

  return <div className="min-w-0">
    <div aria-label="缩略时间带" className="relative h-8 touch-none select-none rounded-md bg-muted"
      onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => onChange()}>
      <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(36,minmax(0,1fr))] items-end">
        {counts.map((count, index) => <span key={index} className="mx-px rounded-t-sm bg-muted-foreground/45"
          style={{ height: count ? 4 + 18 * count / maxCount : 0 }} />)}
      </div>
      <div data-drag="move" className="absolute inset-y-0 cursor-grab rounded-md border border-ring bg-primary/10 active:cursor-grabbing"
        style={{ left: x(range[0]) + "%", width: x(range[1]) - x(range[0]) + "%" }}>
        {(["start", "end"] as const).map((mode, index) => <span key={mode} role="slider" tabIndex={0} data-drag={mode}
          aria-label={index ? "时间片结束" : "时间片开始"} aria-valuemin={Math.floor(domain[0])}
          aria-valuemax={Math.ceil(domain[1])} aria-valuenow={Math.round(range[index])}
          aria-valuetext={new Date(range[index] * 86_400_000).toISOString().slice(0, 10)}
          onKeyDown={event => handleKey(event, mode)}
          className={cn("absolute top-1/2 grid h-5 w-2.5 -translate-y-1/2 cursor-ew-resize place-items-center rounded border border-ring bg-card focus-visible:outline-2 focus-visible:outline-ring",
            index ? "-end-1" : "-start-1")}>
          <span aria-hidden className="h-2 w-0.5 border-x border-muted-foreground" />
        </span>)}
      </div>
    </div>
    {years.length > 0 && <div className="relative mt-1 h-5">
      {years.map(value => {
        const start = Math.max(domain[0], yearStart(value))
        const end = Math.min(domain[1], yearStart(value + 1))
        return end > start && <button key={value} type="button" aria-label={"查看 " + value + " 年"}
          title={String(value)} onClick={() => onChange(start === domain[0] && end === domain[1] ? undefined : [start, end])}
          className="absolute truncate border-e border-background bg-muted px-0.5 text-center text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          style={{ left: x(start) + "%", width: x(end) - x(start) + "%" }}>{value}</button>
      })}
    </div>}
  </div>
}
