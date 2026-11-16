"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import { EvidencePoints, type EvidenceItemRow } from "./evidence-panel";
import { EvidenceTimeline } from "./evidence-timeline";
import { replaceDossierLocation } from "./dossier-location";

export function FactsWorkspace({ matterId, items, error, canAdd, onAdd, onRetry, onOpenDocument, onDraftStateChange }: {
  matterId: string; items: EvidenceItemRow[]; error?: string | null; canAdd: boolean;
  onAdd(): void; onRetry(): void; onOpenDocument(id: string): void;
  onDraftStateChange?(dirty: boolean, busy: boolean): void;
}) {
  const params = useSearchParams();
  const pane = params.get("factsView") === "facts" ? "facts" : params.get("factsView") === "research" || params.get("research") || params.get("issue") ? "research" : "facts";
  const [visitedResearch, setVisitedResearch] = useState(pane === "research");
  useEffect(() => { if (pane === "research") setVisitedResearch(true); }, [pane]);
  const selectResearch = useCallback((id: string | null) => replaceDossierLocation({ workPane: "facts", factsView: "research", research: id, issue: null }), []);
  return <Tabs value={pane} onValueChange={value => replaceDossierLocation({ factsView: value === "research" ? "research" : "facts" })}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <TabsList aria-label="事实与研究分区"><TabsTrigger value="facts">事实与争点</TabsTrigger><TabsTrigger value="research">法律研究</TabsTrigger></TabsList>
      <span className="text-xs text-muted-foreground">本事项 · 全部程序</span>
    </div>
    <TabsContent value="facts" forceMount className="space-y-4 data-[state=inactive]:hidden">
      <div className="flex flex-wrap gap-2"><EvidenceTimeline items={items} />{canAdd && <Button size="sm" onClick={onAdd}>添加事实或争点</Button>}</div>
      {error ? <p role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={onRetry}>重新加载</Button></p>
        : items.length ? items.map(item => <section key={item.id} className="rounded-lg border bg-card p-4">
          <EvidencePoints items={[item]} showSource />
          {item.kind === "ISSUE" && !item.restricted && <Button className="mt-3" size="sm" variant="outline" onClick={() => replaceDossierLocation({ factsView: "research", research: null, issue: item.id })}>以此争点开始研究</Button>}
        </section>) : <p role="status" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">尚未记录事实或争点，可从材料添加来源。</p>}
    </TabsContent>
    <TabsContent value="research" forceMount className="data-[state=inactive]:hidden">
      {(pane === "research" || visitedResearch) && <ResearchWorkspace matterId={matterId} researchId={params.get("research")} issueId={params.get("issue")}
        onSelectResearch={selectResearch} onOpenDocument={onOpenDocument} onDraftStateChange={onDraftStateChange} />}
    </TabsContent>
  </Tabs>;
}
