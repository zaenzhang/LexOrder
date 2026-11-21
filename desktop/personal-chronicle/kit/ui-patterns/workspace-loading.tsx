import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { PagePending } from "./page-loading"

export function InlineLoading({ label }: { label: string }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
    <LoadingText label={label} />
  </div>
}

function LoadingText({ label }: { label: string }) {
  return <>
    <Spinner role={undefined} aria-hidden className="motion-reduce:animate-none" />
    <span>{label}</span>
  </>
}

export function WorkspaceLoading({ label, split = false, timeline = false }: {
  label: string; split?: boolean; timeline?: boolean
}) {
  return <div role="status" className="grid gap-3">
    <PagePending />
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoadingText label={label} />
    </div>
    <div aria-hidden className={cn("grid min-w-0 gap-4", split && "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.48fr)]")}>
      <div className="grid gap-3">
        {timeline && <Skeleton className="h-48 rounded-xl motion-reduce:animate-none" />}
        <Skeleton className="h-48 rounded-xl motion-reduce:animate-none" />
      </div>
      {split && <Skeleton className="h-48 rounded-xl motion-reduce:animate-none" />}
    </div>
  </div>
}
