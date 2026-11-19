"use client"

import { TerminalSquareIcon, XIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function readDiagnostics() {
  const sidebar = document.querySelector<HTMLElement>('[data-sidebar="content"]')
  const main = document.scrollingElement
  const viewport = window.visualViewport

  return {
    host: "__TAURI_INTERNALS__" in window ? "Tauri WebView" : "浏览器",
    inner: window.innerWidth + " × " + window.innerHeight,
    outer: window.outerWidth + " × " + window.outerHeight,
    dpi: window.devicePixelRatio,
    viewportScale: viewport?.scale ?? 1,
    theme: document.documentElement.classList.contains("dark") ? "深色" : "浅色",
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "是" : "否",
    scroll: [main, sidebar].map(element => element ? {
      offset: Math.round(element.scrollTop), limit: element.scrollHeight - element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    } : null),
  }
}

function Fields({ items }: { items: [string, string | number][] }) {
  return <dl className="divide-y">{items.map(([label, value]) => (
    <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2">
      <dt className="text-muted-foreground">{label}</dt><dd className="break-words text-end">{value}</dd>
    </div>
  ))}</dl>
}

// Adapted from the tauri-ui development panel keyboard and diagnostics pattern.
export function DebugPanel() {
  const pathname = usePathname()
  const route = pathname.replace(/\bc[a-z0-9]{24,}\b/g, ":id")
  const [open, setOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<ReturnType<typeof readDiagnostics>>()
  const [errors, setErrors] = useState({ runtime: 0, promise: 0 })

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.key === "Escape" && open) {
        setOpen(false)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "d") return
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return
      event.preventDefault()
      setOpen(value => !value)
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [open])

  useEffect(() => {
    const runtime = () => setErrors(value => ({ ...value, runtime: value.runtime + 1 }))
    const promise = () => setErrors(value => ({ ...value, promise: value.promise + 1 }))
    window.addEventListener("error", runtime)
    window.addEventListener("unhandledrejection", promise)
    return () => {
      window.removeEventListener("error", runtime)
      window.removeEventListener("unhandledrejection", promise)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setDiagnostics(readDiagnostics())
      })
    }
    schedule()
    const layout = new ResizeObserver(schedule)
    layout.observe(document.body)
    const sidebar = document.querySelector('[data-sidebar="content"]')
    if (sidebar) layout.observe(sidebar)
    const theme = new MutationObserver(schedule)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    window.visualViewport?.addEventListener("resize", schedule)
    return () => {
      layout.disconnect()
      theme.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      window.visualViewport?.removeEventListener("resize", schedule)
    }
  }, [open, pathname])

  if (!open) return null

  return <aside aria-label="开发调试面板" className="fixed end-3 top-16 z-40 max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-auto overscroll-contain text-sm">
    <Card size="sm" className="gap-3 bg-popover shadow-lg">
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><TerminalSquareIcon className="size-4" />开发调试面板</CardTitle>
        <Button variant="ghost" size="icon-sm" aria-label="关闭调试面板" onClick={() => setOpen(false)}><XIcon /></Button>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList aria-label="调试分类"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="scroll">滚动</TabsTrigger><TabsTrigger value="errors">错误</TabsTrigger></TabsList>
          <TabsContent value="overview">
            {diagnostics && <Fields items={[
              ["运行环境", diagnostics.host], ["当前路由", route], ["页面尺寸", diagnostics.inner],
              ["窗口尺寸", diagnostics.outer], ["设备像素比", diagnostics.dpi], ["视口缩放", diagnostics.viewportScale],
              ["颜色主题", diagnostics.theme], ["减少动态效果", diagnostics.reducedMotion],
            ]} />}
          </TabsContent>
          <TabsContent value="scroll">
            {diagnostics && <Fields items={diagnostics.scroll.flatMap((row, index) => row ? [[
              index === 0 ? "正文" : "侧栏", row.offset + " / " + row.limit + " px (" + row.overflow + ")",
            ]] : [])} />}
          </TabsContent>
          <TabsContent value="errors"><Fields items={[["脚本错误", errors.runtime], ["未处理的拒绝", errors.promise]]} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </aside>
}
