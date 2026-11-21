"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

const PageLoadingContext = createContext<(() => () => void) | null>(null)

export function PageLoadingProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [pending, setPending] = useState(0)
  const [visible, setVisible] = useState(false)
  const register = useCallback(() => {
    setPending(count => count + 1)
    return () => setPending(count => count - 1)
  }, [])
  const busy = enabled && pending > 0

  if (!busy && visible) setVisible(false)

  useEffect(() => {
    if (!busy) return
    const timer = window.setTimeout(() => setVisible(true), 500)
    return () => window.clearTimeout(timer)
  }, [busy])

  return <PageLoadingContext.Provider value={register}>
    {children}
    {busy && !visible && <div role="status" data-slot="page-loading-indicator"
      className="pointer-events-none fixed inset-x-0 top-0 z-[65] h-0.5 bg-primary/75 motion-safe:animate-pulse">
      <span className="sr-only">正在加载页面…</span>
    </div>}
    {busy && visible && <Dialog open disablePointerDismissal onOpenChange={(open, details) => { if (!open) details.cancel() }}>
      <DialogContent showCloseButton={false} data-slot="page-loading-mask"
        overlayClassName="z-[70] bg-black/20 supports-backdrop-filter:backdrop-blur-none motion-reduce:data-open:animate-none"
        className="z-[71] w-max max-w-[calc(100%-2rem)] grid-flow-col items-center gap-3 px-5 py-3 shadow-lg motion-reduce:data-open:animate-none">
        <Spinner role={undefined} aria-hidden className="size-4 text-primary motion-reduce:animate-none" />
        <DialogTitle className="text-sm">正在加载页面…</DialogTitle>
      </DialogContent>
    </Dialog>}
  </PageLoadingContext.Provider>
}

export function usePageLoading(pending: boolean) {
  const register = useContext(PageLoadingContext)
  useLayoutEffect(() => pending ? register?.() : undefined, [pending, register])
}

export function PagePending({ active = true }: { active?: boolean }) {
  usePageLoading(active)
  return null
}
