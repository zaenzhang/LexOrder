"use client"

import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { ChevronRightIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export function ChronologyTrace({ label, icon, kind, title, summary, onClose, children, panelRef, matrixOnly }: {
  label: string; icon?: ReactNode; kind?: ReactNode; title: string; summary?: ReactNode; onClose?: () => void; children?: ReactNode; panelRef?: RefObject<HTMLDivElement | null>; matrixOnly?: boolean
}) {
  const internalPanel = useRef<HTMLDivElement>(null)
  const detail = panelRef ?? internalPanel
  useEffect(() => {
    const panel = detail.current
    if (!panel) return
    let pinned = false
    let frame = 0

    function measure() {
      frame = 0
      if (!panel || !pinned) return
      const bottomGap = parseFloat(getComputedStyle(document.documentElement).fontSize)
      // Before the card reaches its sticky position, the toolbar still takes up room above it.
      const available = window.innerHeight - Math.max(0, panel.getBoundingClientRect().top) - bottomGap
      const height = Math.max(bottomGap * 14, Math.floor(available)) + "px"
      if (panel.style.getPropertyValue("--chronology-detail-height") !== height) {
        panel.style.setProperty("--chronology-detail-height", height)
      }
    }

    function scheduleMeasure() {
      if (pinned && !frame) frame = requestAnimationFrame(measure)
    }

    const updateLayout = () => {
      pinned = getComputedStyle(panel).position === "sticky"
      scheduleMeasure()
    }

    updateLayout()
    window.addEventListener("scroll", scheduleMeasure, { passive: true })
    window.addEventListener("resize", updateLayout)
    const layout = new ResizeObserver(updateLayout)
    if (panel.parentElement) layout.observe(panel.parentElement)
    return () => {
      window.removeEventListener("scroll", scheduleMeasure)
      window.removeEventListener("resize", updateLayout)
      layout.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [detail])

  const heading = <h2 className="min-w-0 font-heading text-base font-semibold leading-snug [overflow-wrap:anywhere]">{title}</h2>

  // Keep the StackTrace header outside the scrolling details.
  return <Card ref={detail} role="region" aria-label={label} tabIndex={panelRef ? -1 : undefined} className={cn("min-w-0 gap-0 self-start py-0", matrixOnly
    ? "lg:sticky lg:top-16 lg:max-h-[var(--chronology-detail-height,calc(100dvh-5rem))]"
    : "scroll-mt-16 @min-[62rem]/chronology:sticky @min-[62rem]/chronology:top-16 @min-[62rem]/chronology:max-h-[var(--chronology-detail-height,calc(100dvh-5rem))]")}>
    <header className="grid shrink-0 gap-1.5 border-b px-3.5 py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        {kind ? <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-muted-foreground">
          {icon && <span className="grid size-4 shrink-0 place-items-center">{icon}</span>}
          {kind}
        </div> : heading}
        {onClose && <Button variant="ghost" size="icon-xs" className="-my-1 shrink-0" aria-label="收起事件详情" onClick={onClose}>
          <XIcon aria-hidden />
        </Button>}
      </div>
      {kind && heading}
      {summary}
    </header>
    {children && <ScrollArea data-slot="chronology-detail-body" className={cn(
      "grid min-h-0 grid-rows-[minmax(0,1fr)] [&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:min-h-0",
      matrixOnly
        ? "lg:[&>[data-slot=scroll-area-viewport]]:overflow-x-hidden! lg:[&>[data-slot=scroll-area-viewport][data-has-overflow-y]]:overscroll-y-contain max-lg:[&>[data-slot=scroll-area-viewport]]:overflow-visible!"
        : "@min-[62rem]/chronology:[&>[data-slot=scroll-area-viewport]]:overflow-x-hidden! @min-[62rem]/chronology:[&>[data-slot=scroll-area-viewport][data-has-overflow-y]]:overscroll-y-contain @max-[62rem]/chronology:[&>[data-slot=scroll-area-viewport]]:overflow-visible!"
    )}>
      {children}
    </ScrollArea>}
  </Card>
}

export function TraceGroup({ label, count, meta, actions, defaultOpen, open, onOpenChange, children }: {
  label: string; count?: number; meta?: string; actions?: ReactNode; defaultOpen?: boolean; open?: boolean
  onOpenChange?: (open: boolean) => void; children: ReactNode
}) {
  return <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className="border-t first:border-t-0">
    <div className="flex min-w-0 items-center">
      {/* The arrow shares the header icon column, as in the supplied folded StackTrace group. */}
      <CollapsibleTrigger aria-label={count === undefined ? meta && label + " · " + meta : label + " · " + count + " 项"}
        className="group flex min-h-9 min-w-0 flex-1 items-center gap-2.5 px-3.5 text-start text-sm font-semibold text-foreground transition-colors
        hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 motion-reduce:transition-none">
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
          <ChevronRightIcon aria-hidden className="size-3.5 transition-transform duration-150 ease-smooth-out group-data-panel-open:rotate-90 motion-reduce:transition-none" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count} 项</span>}
        {meta && <span className="truncate text-xs font-normal text-muted-foreground">{meta}</span>}
      </CollapsibleTrigger>
      {actions && <div className="flex shrink-0 items-center gap-1 pe-3.5">{actions}</div>}
    </div>
    <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-150 ease-smooth-out
      data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0 motion-reduce:transition-none">
      <div className="py-0.5">
        {children}
      </div>
    </CollapsibleContent>
  </Collapsible>
}

export const traceEntryClassName = "group flex w-full min-w-0 items-start gap-2.5 px-3.5 py-2 text-start"

export function TraceEntry({ icon, title, details }: { icon: ReactNode; title: string; details?: ReactNode }) {
  return <>
    <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground">{icon}</span>
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="break-words text-sm font-medium [overflow-wrap:anywhere]">{title}</span>
      {details && <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 break-words font-mono text-xs text-muted-foreground">{details}</span>}
    </span>
  </>
}
