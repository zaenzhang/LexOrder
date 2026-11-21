import { Slider } from "@base-ui/react/slider"
import { useRef, type PointerEvent } from "react"
import { cn } from "@/lib/utils"
import { moveTraceWindow, type TraceRange } from "./fact-trace-scale"

const dateLabel = (day: number) => new Date(Math.round(day) * 86_400_000).toISOString().slice(0, 10)

export function FactTraceRange({ domain, range, days, onChange }: {
  domain: TraceRange; range: TraceRange; days: number[]; onChange(range?: TraceRange): void
}) {
  const drag = useRef<{ id: number; mode: "move" | "select"; pixel: number; moved: boolean; bounds: DOMRect; range: TraceRange } | null>(null)
  const length = domain[1] - domain[0]
  const x = (day: number) => (day - domain[0]) / length * 100
  const full = range[0] === domain[0] && range[1] === domain[1]
  const bucketCount = 36
  const counts = Array.from({ length: bucketCount }, () => 0)
  for (const day of days) counts[Math.min(bucketCount - 1, Math.max(0, Math.floor(x(day) / 100 * bucketCount)))]++
  const maxCount = Math.max(1, ...counts)
  const year = (day: number) => new Date(day * 86_400_000).getUTCFullYear()
  const firstYear = year(domain[0])
  const yearCount = year(domain[1]) - firstYear + 1
  const years = yearCount <= 24 ? Array.from({ length: yearCount }, (_, index) => firstYear + index) : []
  const yearStart = (value: number) => Date.UTC(value, 0, 1) / 86_400_000

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    const target = event.target as Element
    if (target.closest("[data-slot=timeline-range-thumb]")) return
    // The overview selects a new window on the track and pans an existing window from inside.
    const mode = !full && target.closest("[data-slot=timeline-range-window]") ? "move" : "select"
    drag.current = { id: event.pointerId, mode, pixel: event.clientX, moved: false,
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

  return <div className="min-w-0">
    <div aria-label="缩略时间带" className="relative h-8 touch-none select-none rounded-md bg-muted/65 ring-1 ring-inset ring-border/60"
      onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => onChange()}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 inset-y-1.5 grid items-end"
        style={{ gridTemplateColumns: `repeat(${bucketCount}, minmax(0, 1fr))` }}>
        {counts.map((count, index) => {
          if (!count) return null
          const day = domain[0] + length * (index + 0.5) / bucketCount
          const inRange = day >= range[0] && day <= range[1]
          return <span key={index}
            className={cn("mx-auto w-px rounded-full", inRange ? "bg-primary/75" : "bg-muted-foreground/45")}
            style={{ gridColumnStart: index + 1, height: 4 + 11 * count / maxCount }} />
        })}
      </div>
      <div data-slot="timeline-range-window"
        className={cn("absolute inset-y-0 rounded-md border border-primary/30 bg-primary/5",
          full ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
        style={{ left: x(range[0]) + "%", width: x(range[1]) - x(range[0]) + "%" }} />
      <Slider.Root min={domain[0]} max={domain[1]} value={range} minStepsBetweenValues={1}
        largeStep={Math.max(1, Math.floor(length / 20))} thumbCollisionBehavior="none"
        onValueChange={value => {
          if (!Array.isArray(value)) return
          const [start, end] = value
          onChange(start === domain[0] && end === domain[1] ? undefined : [start, end])
        }}
        className="pointer-events-none absolute inset-0">
        <Slider.Control className="absolute inset-0">
          {(["时间片开始", "时间片结束"] as const).map((label, index) => <Slider.Thumb key={label} index={index}
            data-slot="timeline-range-thumb" aria-label={label} getAriaValueText={(_, value) => dateLabel(value)}
            className="group/range-thumb pointer-events-auto grid h-4 w-2 cursor-ew-resize place-items-center rounded-sm border border-primary/45 bg-card after:absolute after:-inset-x-1 after:-inset-y-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <span aria-hidden className="h-1.5 w-px bg-muted-foreground" />
            <span aria-hidden
              className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-1.5 py-0.5 text-xs text-popover-foreground shadow-sm group-has-[:focus-visible]/range-thumb:visible group-[&[data-dragging]:focus-within]/range-thumb:visible">
              {dateLabel(range[index])}
            </span>
          </Slider.Thumb>)}
        </Slider.Control>
      </Slider.Root>
    </div>
    {years.length > 0 && <div className="relative mt-1 h-5 rounded-sm bg-muted/40">
      {years.map(value => {
        const start = Math.max(domain[0], yearStart(value))
        const end = Math.min(domain[1], yearStart(value + 1))
        return end > start && <button key={value} type="button" aria-label={"查看 " + value + " 年"}
          title={String(value)} onClick={() => onChange(start === domain[0] && end === domain[1] ? undefined : [start, end])}
          className="absolute truncate border-e border-border/50 px-0.5 text-center text-xs text-muted-foreground last:border-e-0 hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          style={{ left: x(start) + "%", width: x(end) - x(start) + "%" }}>{value}</button>
      })}
    </div>}
  </div>
}
