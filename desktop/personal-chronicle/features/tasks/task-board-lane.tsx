import { PlusIcon, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function TaskBoardLane({ label, count, icon: Icon, tone, className, children, onAdd, addLabel }: {
  label: string; count: number; icon: LucideIcon; tone?: string; className?: string
  children: ReactNode; onAdd?: () => void; addLabel?: string
}) {
  return <section aria-label={label} className={cn("flex min-w-0 flex-col gap-2 rounded-2xl bg-muted/50 p-2 transition-colors duration-150 dark:bg-muted/30", className)}>
    <header className="flex items-center gap-2 px-1.5 pt-1">
      <Icon aria-hidden className={cn("size-4 shrink-0", tone)} />
      <h3 className="text-sm font-medium">{label}</h3>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
      {onAdd && <Button variant="ghost" size="icon-xs" className="ms-auto text-muted-foreground" aria-label={addLabel}
        onClick={onAdd}><PlusIcon /></Button>}
    </header>
    {children}
  </section>
}
