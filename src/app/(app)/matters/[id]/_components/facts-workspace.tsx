"use client";

import { Tabs, Button } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import type { EvidenceItemRow } from "./evidence-panel";
import { EvidenceTimeline } from "./evidence-timeline";
import { updateDossierLocation } from "@/lib/matters/dossier-location";

export function FactsWorkspace({ matterId, items, error, canAdd, onAdd, onRetry, onOpenDocument, onDraftStateChange }: {
  matterId: string; items: EvidenceItemRow[]; error?: string | null; canAdd: boolean;
  onAdd(): void; onRetry(): void; onOpenDocument(id: string): void;
  onDraftStateChange?(dirty: boolean, busy: boolean): void;
}) {
  const params = useSearchParams();
  const pane = params.get("factsView") === "facts" ? "facts" : params.get("factsView") === "research" || params.get("research") || params.get("issue") ? "research" : "facts";
  const [visitedResearch, setVisitedResearch] = useState(pane === "research");
  useEffect(() => { if (pane === "research") setVisitedResearch(true); }, [pane]);
  const selectResearch = useCallback((id: string | null) => updateDossierLocation({ workPane: "facts", factsView: "research", research: id, issue: null }), []);
  const startResearch = useCallback((id: string) => updateDossierLocation({ factsView: "research", research: null, issue: id }), []);
  return <div role="group" aria-label="事实与研究分区"><Tabs activeKey={pane} onChange={value => updateDossierLocation({ factsView: value === "research" ? "research" : "facts" })} keepDOM lazyRender={false} tabPaneMotion={false} tabBarExtraContent={<span className="text-xs text-muted-foreground">本事项 · 全部程序</span>}>

    <Tabs.TabPane itemKey="facts" tab="事实与争点" className="space-y-4">
      {canAdd && <Button onClick={onAdd} theme="solid" size="small">添加事实或争点</Button>}
      {error ? <p role="alert" className="text-sm text-destructive">{error} <Button onClick={onRetry} type="primary" theme="borderless">重新加载</Button></p>
        : items.length ? <EvidenceTimeline items={items} onResearch={canAdd ? startResearch : undefined} />
          : <p role="status" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">尚未记录事实或争点，可从材料添加来源。</p>}
    </Tabs.TabPane>
    <Tabs.TabPane itemKey="research" tab="法律研究">
      {(pane === "research" || visitedResearch) && <ResearchWorkspace matterId={matterId} researchId={params.get("research")} issueId={params.get("issue")}
        onSelectResearch={selectResearch} onOpenDocument={onOpenDocument} onDraftStateChange={onDraftStateChange} />}
    </Tabs.TabPane>
  </Tabs></div>;
}
