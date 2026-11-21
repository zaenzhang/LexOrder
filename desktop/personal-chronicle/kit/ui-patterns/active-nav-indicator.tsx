"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export function ActiveNavIndicator({
  activeKey,
  className,
  subMenuSelector,
}: {
  activeKey: string | null
  className: string
  subMenuSelector?: string
}) {
  const indicator = useRef<HTMLSpanElement>(null)
  const [rect, setRect] = useState<{
    x: number
    y: number
    width: number
    height: number
    scope: Element
    item: HTMLElement
    animate: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const container = indicator.current?.parentElement
    if (!container) return

    const measure = () => {
      const item = container.querySelector<HTMLElement>('[aria-current="page"]')
      const box = item?.getBoundingClientRect()
      if (!item || !box?.height) {
        setRect(null)
        return
      }

      const { left, top } = container.getBoundingClientRect()
      const scope = (subMenuSelector && item.closest(subMenuSelector)) || container
      const next = { x: box.left - left, y: box.top - top, width: box.width, height: box.height, scope, item }
      setRect(previous => {
        if (previous?.scope !== scope || previous.x !== next.x || previous.width !== next.width) {
          return { ...next, animate: false }
        }
        if (previous.item === item && previous.y === next.y && previous.height === next.height) return previous
        // An expanding or collapsing group can reflow the same selected row.
        return { ...next, animate: previous.item !== item }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeKey, subMenuSelector])

  return (
    <span
      ref={indicator}
      aria-hidden
      hidden={!rect}
      data-slot="active-nav-indicator"
      className={cn(
        "pointer-events-none absolute left-0 top-0",
        rect?.animate && "motion-safe:transition-[translate] motion-safe:duration-250 motion-safe:ease-smooth-out",
        className
      )}
      style={rect ? {
        translate: rect.x + "px " + rect.y + "px",
        width: rect.width,
        height: rect.height,
      } : undefined}
    />
  )
}
