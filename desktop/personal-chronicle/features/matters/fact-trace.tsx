"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Play, Plus, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { TimelineLevel, TimelineEventReference } from "../../../../src/lib/matters/timeline-levels"
import { TimelineGradeBadge, timelineLevelLabels } from "./timeline-grade"

import { FactTraceRange } from "./fact-trace-range"
import { moveTraceWindow, panTrace, traceCalendarTicks, visibleRange, zoomTrace, type TraceRange } from "./fact-trace-scale"

export type ProgramTrack = {
  id: string; title: string
  events: { id: string; kind: "程序节点" | "庭期" | "法律期限"; title: string; day: string; detail: string; event: TimelineEventReference; level?: TimelineLevel | null }[]
}
export type TimelineMarker = {
  id: string; title: string; day?: string; end?: string; detail: string; attention?: boolean; amountConflict?: boolean
  level?: TimelineLevel | null; reviewed?: boolean; disputed?: boolean; claim?: boolean; tone?: string
  dates?: string[]; planned?: boolean; dateShape?: "month" | "approximate"
}
export type Track = { id: string; title: string; tone?: string; events: TimelineMarker[] }
export type TraceReplay = {
  current: { title: string; date: string }; index: number; count: number; shown: ReadonlySet<string>
  step(delta: number): void; stop(): void
}
export type TimelineScope = { label: string; ids: string[] }
type WheelGesture = { kind: "pan"; fraction: number } | { kind: "zoom"; scale: number; anchor: number }

function markerLabel(event: TimelineMarker) {
  const dateLabel = event.dateShape === "month" && event.day ? event.day.slice(0, 7) : event.detail
  return event.title + " · " + dateLabel + (event.level ? " · " + timelineLevelLabels[event.level] : "") +
    (event.attention ? " · 材料日期记载不一" : "") + (event.amountConflict ? " · 材料金额记载不一" : "")
}

const gapPattern = "bg-[repeating-linear-gradient(135deg,transparent_0px,transparent_9px,var(--border)_10px,transparent_11px)] opacity-40"
const approximateShape = "rotate-45 rounded-[1px] border-dashed"

const elevatedPoint = "ring-1 ring-current ring-offset-1 ring-offset-card"

function KeyGradeMark({ className }: { className: string }) {
  return <Star aria-hidden data-slot="timeline-key-grade" className={cn(
    "pointer-events-none z-10 size-2.5 fill-current text-foreground", className)} />
}

function TimelineConflictDot() {
  return <span aria-hidden data-slot="timeline-conflict-dot" className="absolute -end-1 -top-1 size-1.5 rounded-full bg-warning" />
}

function TimelinePoint({ tone = "text-muted-foreground", reviewed, claim, dateShape, disputed, planned, level,
  attention, amountConflict, selected, transparent }: Pick<TimelineMarker,
    "tone" | "reviewed" | "claim" | "dateShape" | "disputed" | "planned" | "level" | "attention" | "amountConflict"
  > & { selected?: boolean; transparent?: boolean }) {
  return <span aria-hidden data-slot="timeline-point-symbol" className={cn("relative block size-2.5 rounded-full border border-current", tone,
    claim ? "bg-card" : reviewed ? "bg-current" : transparent ? "bg-transparent" : "bg-card",
    claim && "rounded-[1px]", (disputed || planned) && "border-dashed",
    dateShape === "approximate" && approximateShape,
    disputed && "after:absolute after:inset-x-0 after:top-1/2 after:rotate-[-35deg] after:border-t",
    (level === "IMPORTANT" || level === "KEY") && elevatedPoint,
    selected && "outline-1 outline-offset-3 outline-ring")}>
    {(attention || amountConflict) && <TimelineConflictDot />}
    {level === "KEY" && <KeyGradeMark className="absolute -bottom-1 -start-1.5" />}
  </span>
}

function TimelineRangeSymbol({ dateShape, planned, showStart, selected, conflict, level }: Pick<TimelineMarker, "dateShape" | "planned" | "level"> & {
  showStart?: boolean; selected?: boolean; conflict?: boolean
}) {
  const month = dateShape === "month"
  const startVisible = showStart && !month
  const elevated = level === "IMPORTANT" || level === "KEY"
  return <>
    <span aria-hidden data-slot="timeline-range-line" className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full",
      month ? "h-2 border border-current/60 bg-current/15" : planned ? "border-t-2 border-current/70" : "h-0.5 bg-current/75",
      elevated && (month ? "border-2" : planned ? "border-t-[3px]" : "h-1"),
      planned && "border-dashed", selected && "outline-1 outline-offset-3 outline-ring")} />
    {(startVisible || conflict) && <span aria-hidden data-slot={startVisible ? "timeline-range-start" : undefined} className={cn(
      "absolute start-0 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
      startVisible && "bg-current", startVisible && elevated && elevatedPoint,
      startVisible && dateShape === "approximate" && cn(approximateShape, "border border-current bg-card"))}>
      {conflict && <TimelineConflictDot />}
      {startVisible && level === "KEY" && <KeyGradeMark className="absolute -bottom-1 -start-1.5" />}
    </span>}
    {!startVisible && level === "KEY" && <KeyGradeMark className="absolute start-1/2 -top-1 -translate-x-1/2" />}
  </>
}

const legendGroups: { title: string; symbols: { label: string; icon: ReactNode }[] }[] = [
  { title: "核对与分歧", symbols: [
    { label: "待核对", icon: <TimelinePoint /> },
    { label: "已核对", icon: <TimelinePoint reviewed /> },
    { label: "当事人有争议", icon: <TimelinePoint disputed /> },
    { label: "材料记载不一", icon: <TimelinePoint attention /> },
  ] },
  { title: "日期表达", symbols: [
    { label: "大致日期", icon: <TimelinePoint dateShape="approximate" /> },
    { label: "仅到月", icon: <span className="relative w-full"><TimelineRangeSymbol dateShape="month" /></span> },
    { label: "起止", icon: <span className="relative ms-1 w-3.5"><TimelineRangeSymbol showStart /></span> },
  ] },
  { title: "事项性质", symbols: [
    { label: "约定", icon: <span className="flex items-center gap-1.5">
      <TimelinePoint planned />
      <span className="relative w-3"><TimelineRangeSymbol planned showStart /></span>
    </span> },
    { label: "主张", icon: <TimelinePoint claim /> },
  ] },
  { title: "事件等级", symbols: [
    { label: "一般", icon: <TimelinePoint level="NORMAL" /> },
    { label: "重要", icon: <TimelinePoint level="IMPORTANT" /> },
    { label: "关键", icon: <TimelinePoint level="KEY" /> },
  ] },
]

const commonLegend = legendGroups[0].symbols.filter(({ label }) => label === "待核对" || label === "材料记载不一")

function LegendSymbol({ label, icon }: { label: string; icon: ReactNode }) {
  return <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span aria-hidden className="grid h-4 min-w-4 shrink-0 place-items-center">{icon}</span>
    {label}
  </span>
}

const trackHeight = 40
const pointY = trackHeight / 2
const rangeSpacing = 17
const dayMs = 86_400_000
const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / dayMs
const dayKey = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10)

export function FactTrace({ tracks, selectedId, onSelect, onScope, options, cutoff, display, directions, review, replay, startReplay, onNarrative }: {
  tracks: Track[]; selectedId?: string; onSelect(id: string): void; onScope(scope: TimelineScope): void
  options?: ReactNode; cutoff?: ReactNode; display?: ReactNode; review?: ReactNode
  directions?: { from: string; to: string; label: string; id: string }[]; replay?: TraceReplay; startReplay?(): void; onNarrative?(): void
}) {
  const plotCanvas = useRef<HTMLDivElement>(null)
  const plot = useRef<HTMLDivElement>(null)
  const [{ width, fontSize }, setRulerSize] = useState({ width: 500, fontSize: 12 })
  const [zoomWindow, setZoomWindow] = useState<TraceRange>()
  const [expanded, setExpanded] = useState<string>()
  useEffect(() => {
    const node = plot.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      setRulerSize({ width: entry.contentRect.width, fontSize: parseFloat(getComputedStyle(node).fontSize) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { domain, datedById, undated } = useMemo(() => {
    const events = [...new Map(tracks.flatMap(track => track.events.map(event => [event.id, event] as const))).values()]
    const dated = events.flatMap(event => {
      if (!event.day) return []
      const start = dayNumber(event.day)
      const alternatives = event.dates?.map(dayNumber) ?? []
      return [{ id: event.id, start, finish: event.end ? dayNumber(event.end) : start, alternatives }]
    })
    const first = dated.reduce((value, event) => Math.min(value, event.start, ...event.alternatives), Infinity)
    const last = dated.reduce((value, event) => Math.max(value, event.finish, ...event.alternatives), -Infinity)
    return {
      domain: [first, Math.max(first + 1, last)] as TraceRange,
      datedById: new Map(dated.map(event => [event.id, event])),
      undated: events.filter(event => !event.day),
    }
  }, [tracks])

  const range = visibleRange(domain, zoomWindow)
  const zoomed = range !== domain
  const [start, end] = range
  const canUseWheel = useEffectEvent((sideways: boolean, delta: number) => (
    sideways || delta > 0 ? zoomed : end - start > 1
  ))
  const ratio = (day: number) => Math.min(1, Math.max(0, (day - start) / (end - start)))
  const ticks = traceCalendarTicks(range, width).filter(tick => tick.day > start && tick.day < end)
  const dateLabel = (value: number) => {
    const label = dayKey(Math.floor(value))
    return width < fontSize * 14 ? label.slice(-5) : label
  }
  const boundaryLabels = datedById.size ? [dateLabel(start), dateLabel(end)] : undefined
  // Labels reserve space independently of the grid so hiding a label never alters the date scale.
  const numeralWidth = fontSize * 0.65
  const boundaryWidth = (boundaryLabels?.[0].length ?? 0) * numeralWidth

  useEffect(() => {
    const node = plotCanvas.current
    const ruler = plot.current
    if (!node || !ruler || !Number.isFinite(domain[0]) || domain[1] - domain[0] <= 1) return
    let frame = 0
    let gestures: WheelGesture[] = []

    const onWheel = (event: WheelEvent) => {
      if (!event.cancelable) return
      const bounds = ruler.getBoundingClientRect()
      if (!bounds.width || event.clientX < bounds.left || event.clientX > bounds.right) return
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1
      const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const delta = sideways ? (event.deltaX || event.deltaY) : event.deltaY
      if (!delta || !canUseWheel(sideways, delta)) return

      event.preventDefault()
      const distance = Math.max(-180, Math.min(180, delta * unit))
      gestures.push(sideways
        ? { kind: "pan", fraction: distance / bounds.width }
        : { kind: "zoom", scale: Math.exp(distance / 800), anchor: (event.clientX - bounds.left) / bounds.width })
      if (!frame) frame = requestAnimationFrame(() => {
        const input = gestures
        gestures = []
        frame = 0
        setZoomWindow(previous => input.reduce<TraceRange | undefined>((range, gesture) =>
          gesture.kind === "pan" ? panTrace(domain, range, gesture.fraction) : zoomTrace(domain, range, gesture.scale, gesture.anchor), previous))
        setExpanded(undefined)
      })
    }

    node.addEventListener("wheel", onWheel, { passive: false })
    ruler.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      node.removeEventListener("wheel", onWheel)
      ruler.removeEventListener("wheel", onWheel)
      cancelAnimationFrame(frame)
    }
  }, [domain])

  const selectedDay = selectedId ? datedById.get(selectedId)?.start : undefined
  const [domainStart, domainEnd] = domain
  const selectionKey = JSON.stringify([selectedId, selectedDay, domainStart, domainEnd])
  const [positionedSelection, setPositionedSelection] = useState(selectionKey)
  if (positionedSelection !== selectionKey) {
    setPositionedSelection(selectionKey)
    if (selectedDay !== undefined) {
      const active = visibleRange(domain, zoomWindow)
      if (selectedDay < active[0] || selectedDay > active[1]) {
        setZoomWindow(moveTraceWindow(domain, active, "move", selectedDay - (active[0] + active[1]) / 2))
      }
    }
  }

  const visibleTracks = tracks.filter(track => track.events.some(event => datedById.has(event.id)))
  const undatedFacts = undated.filter(event => !event.claim)
  const density = [...datedById].filter(([id]) => !replay || replay.shown.has(id)).map(([, event]) => event.start)
  const trackCharts = visibleTracks.map(track => {
    const ranges = track.events.flatMap(event => {
      const time = datedById.get(event.id)
      if (!time || time.finish <= time.start || time.start > end || time.finish < start ||
          (replay && !replay.shown.has(event.id) && !event.claim)) return []
      return [{ id: event.id, start: time.start, finish: time.finish }]
    }).sort((a, b) => a.start - b.start || a.finish - b.finish)
    const ends: number[] = []
    const rows = new Map<string, number>()
    for (const event of ranges) {
      const free = ends.findIndex(last => last < event.start)
      const row = free < 0 ? ends.length : free
      ends[row] = event.finish
      rows.set(event.id, row)
    }
    const baselineRanges = ranges.filter(range => rows.get(range.id) === 0)
    return { track, rows, baselineRanges, height: trackHeight + rangeSpacing * Math.max(0, ends.length - 1) }
  })
  const positions = new Map<string, { left: number; top: number }>()
  if (directions?.length) {
    let offset = 0
    for (const { track, rows, height } of trackCharts) {
      for (const event of track.events) {
        const time = datedById.get(event.id)
        if (!time || time.start > end || time.finish < start || positions.has(event.id) || (replay && !replay.shown.has(event.id))) continue
        const row = rows.get(event.id)
        positions.set(event.id, { left: width * (ratio(time.start) + ratio(time.finish)) / 2, top: offset + (row === undefined ? pointY : pointY + row * rangeSpacing) })
      }
      offset += height
    }
  }
  const eventDays = [...new Set(density)].sort((a, b) => a - b)
  const gaps = eventDays.flatMap((day, index) => eventDays[index + 1] - day > 62
    ? [[Math.max(start, day + 7), Math.min(end, eventDays[index + 1] - 7)]] : []).filter(([left, right]) => right > left)


  function zoom(scale: number) {
    const active = selectedId ? datedById.get(selectedId) : undefined
    const anchor = active && active.start >= start && active.start <= end ? ratio(active.start) : 0.5
    setExpanded(undefined)
    setZoomWindow(previous => zoomTrace(domain, previous, scale, anchor))
  }

  return <Card role="region" aria-label="时间轴事件" className="@container/trace min-w-0 gap-0 overflow-clip py-0">
    {replay ? <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/50 px-3 py-2.5 sm:px-4">
      <span role="status" className="text-xs tabular-nums text-muted-foreground">回放 {replay.index + 1} / {replay.count}</span>
      <span className="text-sm font-semibold tabular-nums">{replay.current.date}</span>
      <span className="min-w-24 flex-1 text-sm">{replay.current.title}</span>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={replay.index === 0} onClick={() => replay.step(-1)}><ChevronLeft data-icon="inline-start" />上一步</Button>
        <Button size="xs" disabled={replay.index + 1 === replay.count} onClick={() => replay.step(1)}>下一步<ChevronRight data-icon="inline-end" /></Button>
        <Button size="xs" variant="outline" onClick={replay.stop}>退出回放</Button>
      </div>
    </header> : <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-heading text-sm font-semibold">案件时间轴</h2>
        {cutoff}
      </div>
      {!!datedById.size && <div role="group" aria-label="时间范围" className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-xs tabular-nums text-muted-foreground">{dayKey(Math.floor(start))} 至 {dayKey(Math.ceil(end))}</span>
        <Button variant="outline" size="icon-xs" aria-label="缩小时间轴" disabled={!zoomed} onClick={() => zoom(1.6)}><Minus /></Button>
        <Button variant="outline" size="icon-xs" aria-label="放大时间轴" disabled={end - start <= 1} onClick={() => zoom(1 / 1.6)}><Plus /></Button>
        <Button variant="ghost" size="xs" disabled={!zoomed} onClick={() => { setZoomWindow(undefined); setExpanded(undefined) }}>全时段</Button>
      </div>}
      {(!!datedById.size || review) && <div className="ms-auto flex flex-wrap items-center justify-end gap-1.5">
        {!!datedById.size && <>
          {display}
          {startReplay && <Button variant="outline" size="xs" onClick={startReplay}><Play data-icon="inline-start" />回放</Button>}
        </>}
        {review}
      </div>}
    </header>}
    <div dir="ltr" className="text-xs [--track-label:6rem] [--track-inset:1.5rem] sm:[--track-label:8rem] sm:[--track-inset:1.75rem]">
      <div className="grid grid-cols-[var(--track-label)_minmax(0,1fr)] items-start bg-muted/15 py-2">
        <div className="px-2">{options}</div>
        {!!datedById.size && <div className="px-(--track-inset)">
          <FactTraceRange domain={domain} range={range} days={density} onChange={value => { setZoomWindow(value); setExpanded(undefined) }} />
        </div>}
      </div>
      <div className="sticky top-14 z-20 grid grid-cols-[var(--track-label)_minmax(0,1fr)] border-b bg-card">
        <div aria-hidden />
        <div className="px-(--track-inset)">
          <div ref={plot} className="relative h-8" role="group" aria-label="案件日期刻度"
            tabIndex={zoomed ? 0 : undefined} aria-keyshortcuts="ArrowLeft ArrowRight"
            onKeyDown={event => {
              if (!zoomed || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
              event.preventDefault()
              setExpanded(undefined)
              setZoomWindow(previous => panTrace(domain, previous, event.key === "ArrowLeft" ? -0.2 : 0.2))
            }}>
            {boundaryLabels ? <>
              <span data-slot="timeline-boundary-date" className="absolute start-0 top-2 whitespace-nowrap font-mono">{boundaryLabels[0]}</span>
              {ticks.map(tick => {
                const position = ratio(tick.day)
                const labelWidth = (tick.label.length + 1) * numeralWidth
                if (Math.min(position, 1 - position) * width < boundaryWidth + labelWidth / 2 + numeralWidth) return null
                return <span key={tick.day} className="absolute top-2 -translate-x-1/2 whitespace-nowrap font-mono text-muted-foreground"
                  style={{ left: position * 100 + "%" }}>{tick.label}</span>
              })}
              <span data-slot="timeline-boundary-date" className="absolute end-0 top-2 whitespace-nowrap font-mono">{boundaryLabels[1]}</span>
            </> : <span className="leading-8 text-muted-foreground">暂无已知日期</span>}
          </div>
        </div>
      </div>
      <div ref={plotCanvas} className="relative">
        <div aria-hidden data-slot="timeline-grid" className="pointer-events-none absolute inset-y-0 left-[calc(var(--track-label)+var(--track-inset))] right-(--track-inset)">
          {gaps.map(([left, right]) => <span key={left + "/" + right}
            data-slot="timeline-gap-pattern" className={cn("absolute inset-y-0", gapPattern)}
            style={{ left: ratio(left) * 100 + "%", width: (ratio(right) - ratio(left)) * 100 + "%" }} />)}
          {boundaryLabels && <span data-slot="timeline-boundary" className="absolute inset-y-0 left-0 border-s border-border" />}
          {ticks.map(tick => <span key={tick.day} className="absolute inset-y-0 border-s border-border/50" style={{ left: ratio(tick.day) * 100 + "%" }} />)}
          {boundaryLabels && <span data-slot="timeline-boundary" className="absolute inset-y-0 left-full border-s border-border" />}
        </div>
        {trackCharts.map(({ track, rows: rangeRows, baselineRanges, height }) => {
          const visible = track.events.flatMap(event => {
            const position = datedById.get(event.id)
            if (!position || (replay && !replay.shown.has(event.id) && !event.claim)) return []
            const first = Math.min(position.start, ...position.alternatives)
            const last = Math.max(position.finish, ...position.alternatives)
            if (first > end || last < start) return []
            const point = (ratio(first) + ratio(last)) / 2
            return [{ event, point }]
          }).sort((a, b) => a.point - b.point)
          const clusters: { point: number; tail: number; simple: boolean; events: TimelineMarker[] }[] = []
          for (const marker of visible) {
            const previous = clusters.at(-1)
            const simple = !marker.event.attention && !marker.event.amountConflict && !marker.event.end && !marker.event.claim
            if (simple && previous?.simple && (marker.point - previous.tail) * width < 18) {
              previous.tail = marker.point
              previous.events.push(marker.event)
            } else clusters.push({ point: marker.point, tail: marker.point, simple, events: [marker.event] })
          }
          return <div key={track.id} data-slot="timeline-track" className="relative grid grid-cols-[var(--track-label)_minmax(0,1fr)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border/60 last:after:hidden">
            <div className="flex h-10 min-w-0 items-center px-3 py-2">
              <button type="button" className="min-w-0 truncate rounded text-start font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                title={track.title} onClick={() => onScope({ label: track.title, ids: track.events.map(event => event.id) })}>
                <span aria-hidden className={cn("me-1.5 inline-block size-2 rounded-full", track.tone ?? "bg-primary")} />{track.title}
              </button>
            </div>
            <div className="flex min-w-0 items-center px-(--track-inset)">
              <div className="relative min-w-0 flex-1" style={{ height }}>
                {clusters.map(({ point: head, tail, events }, index) => {
                  const point = (head + tail) / 2
                  const [event] = events
                  const groupLevel = events.some(marker => marker.level === "KEY") ? "KEY"
                    : events.some(marker => marker.level === "IMPORTANT") ? "IMPORTANT" : undefined
                  const groupId = event.id
                  const selected = events.some(marker => marker.id === selectedId)
                  const datedEvent = datedById.get(event.id)!
                  const isRange = datedEvent.finish > datedEvent.start
                  const rangeTop = pointY + (rangeRows.get(event.id) ?? 0) * rangeSpacing
                  const rangeWidth = ratio(datedEvent.finish) - ratio(datedEvent.start)
                  const crossesRange = !isRange && baselineRanges.some(range => point >= ratio(range.start) && point <= ratio(range.finish))
                  const sharesRangeStart = baselineRanges.some(range => range.start === datedEvent.start)
                  const roomRight = ((clusters[index + 1]?.point ?? 1) - point) * width - 18
                  const roomLeft = (point - (clusters[index - 1]?.tail ?? 0)) * width - 18
                  const labelOnLeft = roomRight < 56 && roomLeft >= 56
                  const labelWidth = labelOnLeft ? roomLeft : roomRight
                  return <div className="contents" key={groupId}>
                    {events.length === 1 && isRange && <button type="button" data-slot="timeline-range-marker" aria-pressed={selected}
                      title={event.dateShape === "month" ? markerLabel(event) : markerLabel(event) + " · " + dayKey(datedEvent.start) + " 至 " + dayKey(datedEvent.finish)}
                      aria-label={markerLabel(event)}
                      className={cn("absolute z-10 h-3.5 -translate-y-1/2 rounded-full before:absolute before:inset-y-0 before:-inset-x-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-ring",
                        event.tone ?? track.tone ?? "text-primary", "!bg-transparent")}
                      style={{ top: rangeTop, left: ratio(datedEvent.start) * 100 + "%", width: rangeWidth * 100 + "%" }}
                      onClick={() => onSelect(event.id)}>
                      <TimelineRangeSymbol dateShape={event.dateShape} planned={event.planned} showStart={datedEvent.start >= start} selected={selected}
                        conflict={event.attention || event.amountConflict} level={event.level} />
                    </button>}
                    {events.length === 1 && datedEvent.alternatives.length > 1 && (() => {
                      const from = ratio(Math.min(...datedEvent.alternatives))
                      const to = ratio(Math.max(...datedEvent.alternatives))
                      return (to - from) * width >= 22 && <div aria-hidden className="absolute h-3.5 -translate-y-1/2 rounded-full bg-warning/20"
                        style={{ top: pointY, left: from * 100 + "%", width: (to - from) * 100 + "%" }}>
                        {datedEvent.alternatives.map(day => <span key={day} className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-warning bg-card"
                          style={{ left: ((ratio(day) - from) / (to - from)) * 100 + "%" }} />)}
                      </div>
                    })()}
                    <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                      style={{ top: pointY, left: point * 100 + "%" }}>
                      {events.length === 1 && isRange ? null : events.length === 1 ? <Button size="icon-xs" variant="ghost" aria-pressed={selected} aria-label={markerLabel(event)}
                        title={markerLabel(event)} className="size-6" onClick={() => onSelect(event.id)}>
                        <TimelinePoint {...event} tone={event.tone ?? track.tone ?? "text-primary"} selected={selected} transparent={sharesRangeStart} />
                      </Button> : <Popover open={expanded === groupId} onOpenChange={open => {
                        const days = events.map(marker => datedById.get(marker.id)!.start)
                        const low = Math.min(...days)
                        const high = Math.max(...days)
                        if (open && low < high && end - start > 2 * (high - low) + 4) {
                          const center = (low + high) / 2
                          const span = Math.max(4, 2 * (high - low))
                          setZoomWindow(moveTraceWindow(domain, range, "select", span, center - span / 2))
                          return
                        }
                        setExpanded(open ? groupId : undefined)
                        if (open && !replay) onScope({ label: track.title + " · " + events.length, ids: events.map(marker => marker.id) })
                      }}>
                        <PopoverTrigger render={<Button size="icon-xs" variant="ghost" className="size-6 rounded-full" />}
                          aria-label={track.title + " · " + events.length + " 项" + (groupLevel ? " · 含" + timelineLevelLabels[groupLevel] + "事件" : "")}>
                          <span aria-hidden data-level={groupLevel} className={cn("relative grid size-[18px] place-items-center rounded-full bg-primary text-[9px] leading-none font-medium text-primary-foreground tabular-nums",
                            events.length >= 100 && "text-[8px]",
                            groupLevel ? "ring-1 ring-primary ring-offset-1 ring-offset-card" : "ring-2 ring-card",
                            selected && "outline-1 outline-offset-3 outline-ring")}>
                            {events.length}
                            {groupLevel === "KEY" && <KeyGradeMark className="absolute -bottom-0.5 -start-1.5" />}
                          </span>
                        </PopoverTrigger>
                        <PopoverContent className="max-h-[min(24rem,60dvh)] overflow-y-auto" aria-label="同时间段事项">
                          {events.map(marker => <Button key={marker.id} size="sm" variant="ghost" className="h-auto min-w-0 justify-start whitespace-normal px-2 py-1.5 text-start"
                            aria-label={markerLabel(marker)} onClick={() => { onSelect(marker.id); setExpanded(undefined) }}>
                            <span><strong className="flex flex-wrap items-center gap-1.5 break-words font-medium">{marker.title}<TimelineGradeBadge level={marker.level} /></strong><span className="text-xs text-muted-foreground">{marker.detail}</span></span>
                          </Button>)}
                        </PopoverContent>
                      </Popover>}
                      {!isRange && labelWidth >= 56 && <span aria-hidden className={cn("pointer-events-none absolute truncate ps-1 text-xs",
                        crossesRange ? "top-0 -translate-y-1/3" : "top-1/2 -translate-y-1/2 bg-card",
                        labelOnLeft ? "end-full" : "start-full", groupLevel && events.length === 1 ? "font-semibold text-foreground" : "text-muted-foreground")}
                        style={{ width: Math.floor(labelWidth) }}>{events.length > 1 ? event.detail : event.title}</span>}
                    </div>
                  </div>
                })}
              </div>
            </div>
          </div>
        })}
        {!!directions?.length && <div className="pointer-events-none absolute inset-y-0 left-[calc(var(--track-label)+var(--track-inset))] right-(--track-inset)">
          {directions.map(link => {
            const from = positions.get(link.from)
            const to = positions.get(link.to)
            if (!from || !to) return null
            const x = to.left - from.left
            const y = to.top - from.top
            const length = Math.hypot(x, y)
            if (length < 20) return null
            const angle = Math.atan2(y, x)
            return <span key={link.id} role="img" aria-label={link.label}
              className="absolute origin-left border-t border-dashed border-muted-foreground/65"
              style={{ left: from.left + Math.cos(angle) * 8, top: from.top + Math.sin(angle) * 8,
                width: length - 16, transform: "rotate(" + angle + "rad)" }}>
              <span className="absolute end-0 top-0 size-1.5 -translate-y-1/2 rotate-45 border-e border-t border-muted-foreground" />
            </span>
          })}
        </div>}
      </div>
    </div>
    <Collapsible role="group" aria-label="时间轴图例" className="border-t px-3 py-1.5 text-xs text-muted-foreground sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="font-semibold text-foreground">图例</strong>
        {commonLegend.map(symbol => <LegendSymbol key={symbol.label} {...symbol} />)}
        {gaps.length > 0 && <LegendSymbol label="该段未见事件记载"
          icon={<span aria-hidden data-slot="timeline-gap-pattern" className={cn("h-3 w-4 rounded-xs border border-border", gapPattern)} />} />}
        <CollapsibleTrigger render={<Button size="xs" variant="ghost" className="group ms-auto" />}>
          完整图例
          <ChevronDown data-icon="inline-end" aria-hidden className="group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <dl className="grid min-w-0 gap-x-6 gap-y-1.5 border-t py-2 @min-[42rem]/trace:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
          {legendGroups.map(({ title, symbols }) => (
            <div className="grid min-w-0 grid-cols-[5em_minmax(0,1fr)] items-start gap-x-2.5" key={title}>
              <dt className="font-medium leading-4 whitespace-nowrap text-foreground">{title}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                {symbols.map(symbol => <LegendSymbol key={symbol.label} {...symbol} />)}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed px-3 py-2 text-xs sm:px-4">
      <strong aria-label={"无日期 " + undatedFacts.length}>无日期 {undatedFacts.length}</strong>
      {!!undatedFacts.length && onNarrative && <Button size="xs" variant="link" onClick={onNarrative}>在事实经过里看</Button>}
      {undated.map(event => <Button key={event.id} size="xs" variant="outline" aria-pressed={selectedId === event.id} onClick={() => onSelect(event.id)}>
        <TimelinePoint {...event} />
        {event.claim ? "主张：" : ""}{event.title}
      </Button>)}
    </div>
  </Card>
}
