import { lazy, Suspense } from "react"

const DemoChrome = lazy(async () => ({ default: (await import("./demo-chrome")).DemoChrome }))

export function DemoChromeLazy(props: React.ComponentProps<typeof DemoChrome>) {
  return <Suspense fallback={null}><DemoChrome {...props} /></Suspense>
}
