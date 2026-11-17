"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/action-error";
import { listMaterialSources } from "@/server/documents/processing-actions";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";

type Position = Awaited<ReturnType<typeof listMaterialSources>>["items"][number];
export type MaterialSourceLocation = { page: string; position: Position | null };

/** Shared only by fact and research source entry; each selected document mounts its own picker. */
export function MaterialSourceLocationPicker({ matterId, document, value, onChange, disabled }: {
  matterId: string; document: EvidenceDocumentOption; value: MaterialSourceLocation;
  onChange(value: MaterialSourceLocation): void; disabled: boolean;
}) {
  const id = useId();
  const active = useRef(false);
  const sequence = useRef(0);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [choices, setChoices] = useState<Position[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    sequence.current++;
    return () => { active.current = false; };
  }, [matterId, document.id]);

  async function load(more = false) {
    if (disabled || loadingRef.current || !document.hasIdentity) return;
    const request = ++sequence.current;
    loadingRef.current = true; setLoading(true); setError("");
    try {
      const result = await listMaterialSources({ matterId, documentIds: [document.id], limit: 20,
        ...(more && nextOffset !== null ? { offset: nextOffset } : {}) });
      if (!active.current || sequence.current !== request) return;
      setChoices(previous => more ? [...(previous ?? []), ...result.items] : result.items);
      setNextOffset(result.nextOffset);
    } catch (cause) {
      if (!active.current || sequence.current !== request) return;
      setChoices(null); setNextOffset(null); setError(actionErrorMessage(cause));
    } finally {
      if (active.current && sequence.current === request) { loadingRef.current = false; setLoading(false); }
    }
  }

  return <div className="space-y-2">
    {document.isPdf && document.pageCount && !value.position ? <div className="space-y-1">
      <Label htmlFor={`${id}-page`}>页码（可选，共 {document.pageCount} 页）</Label>
      <Input id={`${id}-page`} type="number" min={1} max={document.pageCount} value={value.page}
        onChange={event => onChange({ page: event.target.value, position: null })} disabled={disabled} />
    </div> : null}
    <Button type="button" size="sm" variant="ghost" disabled={disabled || loading || choices !== null || !document.hasIdentity} onClick={() => void load()}>
      {loading ? "正在读取原文位置…" : error ? "重新读取原文位置" : "读取可引用的原文位置"}
    </Button>
    {choices !== null ? <div className="space-y-2">
      <Select value={value.position ? `${value.position.runId}:${value.position.anchorId}` : "original"} onValueChange={key => {
        onChange({ page: "", position: choices.find(choice => `${choice.runId}:${choice.anchorId}` === key) ?? null });
      }} disabled={disabled || loading}>
        <SelectTrigger aria-label="原文位置"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="original">引用原件</SelectItem>{choices.map(choice => <SelectItem key={`${choice.runId}:${choice.anchorId}`} value={`${choice.runId}:${choice.anchorId}`}>{choice.locationLabel} · {choice.excerpt.slice(0, 55)}</SelectItem>)}</SelectContent>
      </Select>
      {!choices.length ? <p className="text-xs text-muted-foreground">暂无可引用的已处理位置，可以引用原件。</p> : null}
      {nextOffset !== null ? <Button type="button" size="sm" variant="ghost" disabled={disabled || loading} onClick={() => void load(true)}>更多位置</Button> : null}
    </div> : null}
    {!error && value.position ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{value.position.locationLabel} · {value.position.excerpt}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">原文位置读取失败：{error}</p> : null}
  </div>;
}
