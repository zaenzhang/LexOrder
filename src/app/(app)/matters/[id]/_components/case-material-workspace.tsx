"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import type { CaseMaterialEntry } from "@/lib/matters/dossier-location";
import { getEvidenceItem } from "@/server/evidence/actions";
import { getCaseMaterialDetail, getEvidenceCreateOptions } from "@/server/evidence/workspace-actions";
import {
  EvidenceCreateContent, EvidenceDetailContent,
  type EvidenceEditorData, type EvidenceTaskState,
} from "./evidence-panel";
import { CaseMaterialDetail } from "./case-material-detail";

export type { CaseMaterialEntry } from "@/lib/matters/dossier-location";
type MaterialData = Awaited<ReturnType<typeof getCaseMaterialDetail>>;
type Loaded = { kind: "material"; data: MaterialData }
  | { kind: "evidence"; data: EvidenceEditorData }
  | { kind: "create"; documents: Awaited<ReturnType<typeof getEvidenceCreateOptions>> };
type Props = {
  matterId: string;
  entry: CaseMaterialEntry | null;
  onEntryChange: (entry: CaseMaterialEntry | null, mode?: "push" | "replace") => void;
};

function entryKey(entry: CaseMaterialEntry | null): string {
  if (!entry) return "closed";
  switch (entry.kind) {
    case "material": return `material:${entry.documentId}`;
    case "create": return `create:${entry.documentId ?? "none"}`;
    case "evidence": return `evidence:${entry.evidenceItemId}`;
    case "source": return `source:${entry.evidenceItemId}:${entry.revision ?? "current"}:${entry.sourceId}`;
  }
}
function evidenceId(entry: CaseMaterialEntry | null) {
  return entry?.kind === "evidence" || entry?.kind === "source" ? entry.evidenceItemId : null;
}

/** Keep one instance mounted. Only this matter's current task owns a detail surface and draft. */
export function CaseMaterialWorkspace(props: Props) {
  return <MaterialWorkspaceSession key={props.matterId} {...props} />;
}

function MaterialWorkspaceSession({ matterId, entry, onEntryChange }: Props) {
  const [current, setCurrent] = useState(entry);
  const currentRef = useRef(entry);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [parentDocumentId, setParentDocumentId] = useState(entry?.kind === "create" ? entry.documentId : null);
  const taskRef = useRef<EvidenceTaskState>({ dirty: false, busy: false });
  const confirming = useRef(false);
  const alive = useRef(true);
  const [savedId, setSavedId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const returnItem = useRef<string | null>(null);
  const notifyEntry = useRef(onEntryChange);
  const requestedEntry = useRef(entry);
  const requestedKey = entryKey(entry);
  const currentKey = entryKey(current);
  const selectedEvidenceId = evidenceId(current);
  const selectedDocumentId = current?.kind === "material" || current?.kind === "create" ? current.documentId : null;
  const dataKind = current?.kind === "source" ? "evidence" : current?.kind ?? null;
  useEffect(() => { notifyEntry.current = onEntryChange; requestedEntry.current = entry; }, [onEntryChange, entry]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const onStateChange = useCallback((next: EvidenceTaskState) => { taskRef.current = next; }, []);

  const navigate = useCallback(async (next: CaseMaterialEntry | null, keepParent = false, external = false, mode: "push" | "replace" = "push") => {
    const previous = currentRef.current;
    if (entryKey(previous) === entryKey(next)) return;
    const sameEvidence = evidenceId(previous) !== null && evidenceId(previous) === evidenceId(next);
    if (taskRef.current.busy || confirming.current) {
      if (external) notifyEntry.current(previous, "replace");
      return;
    }
    if (!sameEvidence && taskRef.current.dirty) {
      confirming.current = true;
      const discard = await confirmDialog({ title: "放弃未保存的修改？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" });
      confirming.current = false;
      if (!alive.current) return;
      if (!discard) { if (external) notifyEntry.current(previous, "replace"); return; }
      // A second URL change must not make the first confirmation choose a different object.
      if (external && entryKey(requestedEntry.current) !== entryKey(next)) { notifyEntry.current(previous, "replace"); return; }
    }
    if (!keepParent && !sameEvidence) setParentDocumentId(next?.kind === "create" ? next.documentId : null);
    if (!sameEvidence) { onStateChange({ dirty: false, busy: false }); setLoaded(null); setError(""); }
    currentRef.current = next; setCurrent(next);
    if (!external) notifyEntry.current(next, mode);
  }, [onStateChange]);

  useEffect(() => {
    if (requestedKey !== entryKey(currentRef.current)) void navigate(entry, false, true);
  }, [requestedKey, entry, navigate]);

  useEffect(() => {
    if (!dataKind) return;
    let cancelled = false;
    setLoaded(null); setError("");
    async function load() {
      try {
        let result: Loaded;
        if (dataKind === "material" && selectedDocumentId) {
          result = { kind: "material", data: await getCaseMaterialDetail({ matterId, documentId: selectedDocumentId }) };
        } else if (dataKind === "create") {
          const documents = await getEvidenceCreateOptions(matterId);
          if (selectedDocumentId && !documents.some(document => document.id === selectedDocumentId)) throw new Error("来源材料当前不可用，请返回材料列表核对。");
          result = { kind: "create", documents };
        } else if (selectedEvidenceId) {
          const data = await getEvidenceItem(selectedEvidenceId);
          if (data.item.matterId !== matterId) throw new Error("该要点不属于当前案件。");
          result = { kind: "evidence", data };
        } else return;
        if (!cancelled) setLoaded(result);
      } catch (failure) { if (!cancelled) setError(actionErrorMessage(failure)); }
    }
    void load();
    return () => { cancelled = true; };
  }, [dataKind, selectedDocumentId, selectedEvidenceId, matterId, retry]);

  useEffect(() => {
    if (!loaded) return;
    const button = loaded.kind === "material" && returnItem.current
      ? Array.from(content.current?.querySelectorAll<HTMLButtonElement>("button[data-evidence-id]") ?? []).find(candidate => candidate.dataset.evidenceId === returnItem.current)
      : null;
    (button ?? content.current?.querySelector<HTMLHeadingElement>("h2"))?.focus({ preventScroll: true });
    if (loaded.kind === "material") returnItem.current = null;
  }, [loaded]);

  function openFromMaterial(next: CaseMaterialEntry) {
    if (current?.kind === "material") setParentDocumentId(current.documentId);
    if (next.kind === "evidence" || next.kind === "source") returnItem.current = next.evidenceItemId;
    void navigate(next, true);
  }
  function back() { void navigate(parentDocumentId ? { kind: "material", documentId: parentDocumentId } : null); }
  function created(id: string) {
    setSavedId(id);
    returnItem.current = id;
    void navigate({ kind: "evidence", evidenceItemId: id }, true, false, "replace");
  }
  const backLabel = parentDocumentId ? "返回材料" : "返回列表";
  return <Dialog open={current !== null} onOpenChange={open => { if (!open) void navigate(null); }}>
    <DialogContent ref={content} className="max-w-4xl"
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}
      onEscapeKeyDown={event => { if (taskRef.current.busy || confirming.current) event.preventDefault(); }}
      onInteractOutside={event => { if (taskRef.current.busy || confirming.current) event.preventDefault(); }}>
      {!loaded ? <>
        <DialogHeader><DialogTitle tabIndex={-1}>{current?.kind === "material" ? "材料详情" : current?.kind === "create" ? "添加证据要点" : "证据要点"}</DialogTitle>
          <DialogDescription>{error ? "读取失败" : "正在读取…"}</DialogDescription></DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{savedId && current?.kind === "evidence" && current.evidenceItemId === savedId ? "要点已保存，详情暂时读取失败。" : ""}{error}</AlertDescription></Alert> : <p role="status" className="text-sm text-muted-foreground">正在读取…</p>}
        <DialogFooter><Button variant="outline" onClick={back}>{backLabel}</Button>{error ? <Button onClick={() => setRetry(value => value + 1)}>重新读取</Button> : null}</DialogFooter>
      </> : null}
      {loaded?.kind === "material" ? <CaseMaterialDetail key={loaded.data.document.id} data={loaded.data} onBack={() => void navigate(null)}
        onStateChange={onStateChange} onSaved={() => setRetry(value => value + 1)}
        onDocumentChange={(documentId, mode) => void navigate({ kind: "material", documentId }, false, false, mode)}
        onCreate={() => openFromMaterial({ kind: "create", documentId: loaded.data.document.id })}
        onOpenItem={evidenceItemId => openFromMaterial({ kind: "evidence", evidenceItemId })}
        onOpenSource={source => openFromMaterial({ kind: "source", ...source })} /> : null}
      {loaded?.kind === "evidence" ? <EvidenceDetailContent key={loaded.data.item.id} initial={loaded.data}
        source={current?.kind === "source" ? current : null}
        onOpenSource={source => void navigate({ kind: "source", ...source }, true)}
        onReturnFromSource={() => void navigate({ kind: "evidence", evidenceItemId: loaded.data.item.id }, true)}
        onStateChange={onStateChange} onBack={back} backLabel={backLabel} /> : null}
      {loaded?.kind === "create" && current?.kind === "create" ? <EvidenceCreateContent key={currentKey} matterId={matterId}
        documents={loaded.documents} defaultDocumentId={current.documentId} onStateChange={onStateChange} onCreated={created} onBack={back} backLabel={backLabel} /> : null}
    </DialogContent>
  </Dialog>;
}
