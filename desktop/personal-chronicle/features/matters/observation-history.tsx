"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import type { EvidenceNote } from "./case-chronology"
import { ObservationValues, type FactObservation } from "./fact-observation"
import { FixedSourcePreview, type FixedSource } from "./fixed-source-preview"
import { evidenceEndpoint, readPersonal, workspaceEndpoint } from "./personal-client"

type Page = {
  items: {
    revision: number; restricted: boolean; editedByName: string | null
    observations: FactObservation[]; sources: EvidenceNote["sources"]
  }[]
  nextBeforeRevision: number | null
}
type Location = { revision: number; sourceId: string; observationId: string }

export function ObservationHistory({ matterId, item }: { matterId: string; item: EvidenceNote }) {
  const [open, setOpen] = useState(false)
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button size="sm" variant="outline" />}>记载历史</SheetTrigger>
    {open && <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
      <SheetHeader className="shrink-0 border-b pe-12"><SheetTitle>记载历史</SheetTitle>
        <SheetDescription>{item.title} · 当前要点 V{item.revision}</SheetDescription>
      </SheetHeader>
      <HistoryPages matterId={matterId} evidenceItemId={item.id} itemRevision={item.revision} />
    </SheetContent>}
  </Sheet>
}

function HistoryPages({ matterId, evidenceItemId, itemRevision }: {
  matterId: string; evidenceItemId: string; itemRevision: number
}) {
  const [pages, setPages] = useState<number[]>([])
  const [expanded, setExpanded] = useState<number>()
  const [original, setOriginal] = useState<Location>()
  const cursor = pages.at(-1)
  const query = useQuery({
    queryKey: ["chronicle", "observation-history", matterId, evidenceItemId, itemRevision, cursor], retry: false,
    queryFn: ({ signal }) => readPersonal<Page>(workspaceEndpoint + "?" + new URLSearchParams({
      matter: matterId, section: "evidence-items", history: evidenceItemId, ...(cursor && { before: String(cursor) }),
    }), { signal }),
  })
  const preview = useQuery({
    queryKey: ["chronicle", "observation-original", matterId, evidenceItemId, original?.revision, original?.sourceId],
    enabled: Boolean(original), retry: false,
    queryFn: ({ signal }) => readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ action: "open-evidence-source", matterId, evidenceItemId, revision: original?.revision, sourceId: original?.sourceId }),
    }),
  })

  return <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
    {query.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{query.error.message}</span><Button size="sm" variant="outline" onClick={() => void query.refetch()}>重试</Button>
    </div> : query.isPending ? <InlineLoading label="正在读取历史记载…" />
      : query.data.items.length ? query.data.items.map(row =>
        <div key={row.revision} className="rounded-md border">
          <Button size="sm" variant="ghost" className="w-full justify-start" aria-expanded={expanded === row.revision}
            onClick={() => { setExpanded(expanded === row.revision ? undefined : row.revision); setOriginal(undefined) }}>
            要点 V{row.revision}{row.editedByName && " · " + row.editedByName}
          </Button>
          {expanded === row.revision && <div className="grid gap-2 px-3 pb-3 text-xs">
            {row.restricted ? <p>此历史版本的部分出处不可读。</p> : !row.observations.length ? <p>此版本没有结构化记载。</p>
              : row.observations.map(observation => {
                const source = row.sources.find(candidate => candidate.id === observation.sourceId)
                const showing = original?.revision === row.revision && original.observationId === observation.id
                return <div key={observation.id} className="grid gap-1 rounded-md bg-muted/50 p-2">
                  <p className="break-words text-muted-foreground">{source?.documentName} · V{source?.documentVersion} · {source?.locationLabel} · 记载 V{observation.revision}</p>
                  <ObservationValues detailed observation={observation} />
                  <Button size="xs" variant="link" className="w-fit px-0" aria-expanded={showing}
                    onClick={() => setOriginal(showing ? undefined : { revision: row.revision, sourceId: observation.sourceId, observationId: observation.id })}>
                    {showing ? "收起当时出处" : "查看当时出处"}
                  </Button>
                  {showing && (preview.error ? <p role="alert">{preview.error.message}</p>
                    : preview.data?.status === "AVAILABLE" ? <FixedSourcePreview source={preview.data} inlineExcerpt />
                      : preview.data ? <p role="alert">此历史出处当前不可读。</p> : <InlineLoading label="正在读取当时出处…" />)}
                </div>
              })}
          </div>}
        </div>) : <p className="text-sm">暂无历史记载。</p>}
    {(cursor || query.data?.nextBeforeRevision) && <nav aria-label="记载历史分页" className="flex justify-between">
      <Button size="sm" variant="outline" disabled={!cursor || query.isPending} onClick={() => {
        setPages(current => current.slice(0, -1)); setExpanded(undefined); setOriginal(undefined)
      }}>上一页</Button>
      <Button size="sm" variant="outline" disabled={!query.data?.nextBeforeRevision} onClick={() => {
        setPages(current => [...current, query.data!.nextBeforeRevision!]); setExpanded(undefined); setOriginal(undefined)
      }}>下一页</Button>
    </nav>}
  </div>
}
