"use client";

import { Select, Button, Input } from "@douyinfe/semi-ui";
import { useEffect, useId, useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";
import { listMaterialSources } from "@/server/documents/processing-actions";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";

type Position = Awaited<ReturnType<typeof listMaterialSources>>["items"][number];
export type MaterialSourceLocation = { page: string; position: Position | null };
export type MaterialSourceLocationLoader = typeof listMaterialSources;

/** Each source entry mounts a picker for its exact document and supplies its own authorized loader when needed. */
export function MaterialSourceLocationPicker({ matterId, document, value, onChange, disabled, loadSources = listMaterialSources }: {
  matterId: string; document: EvidenceDocumentOption; value: MaterialSourceLocation;
  onChange(value: MaterialSourceLocation): void; disabled: boolean; loadSources?: MaterialSourceLocationLoader;
}) {
  const selectLabelId = useId();
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
      const result = await loadSources({ matterId, documentIds: [document.id], limit: 20,
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
      <label htmlFor={`${id}-page`} className="text-sm font-medium text-[var(--semi-color-text-1)]">页码（可选，共 {document.pageCount} 页）</label>
      <Input
        id={`${id}-page`}
        type="number"
        min={1}
        max={document.pageCount}
        value={value.page}
        onChange={inputValue => onChange({ page: inputValue, position: null })}
        disabled={disabled} />
    </div> : null}
    <Button disabled={disabled || loading || choices !== null || !document.hasIdentity} onClick={() => void load()} htmlType="button" type="tertiary" theme="borderless" size="small">
      {loading ? "正在读取原文位置…" : error ? "重新读取原文位置" : "读取可引用的原文位置"}
    </Button>
    {choices !== null ? <div className="space-y-2">
      <> <span className="sr-only" id={selectLabelId + "-1"}>{"原文位置"}</span><Select
        value={value.position ? `${value.position.runId}:${value.position.anchorId}` : "original"}
        onChange={key => { if (typeof key !== "string") return;
        onChange({ page: "", position: choices.find(choice => `${choice.runId}:${choice.anchorId}` === key) ?? null });
      }}
        disabled={disabled || loading}
        aria-labelledby={selectLabelId + "-1"}
        className="w-full"
        motion={false}><Select.Option value="original">引用原件</Select.Option>{choices.map(choice => <Select.Option key={`${choice.runId}:${choice.anchorId}`} value={`${choice.runId}:${choice.anchorId}`}>{choice.locationLabel} · {choice.excerpt.slice(0, 55)}</Select.Option>)}</Select></>
      {!choices.length ? <p className="text-xs text-muted-foreground">暂无可引用的已处理位置，可以引用原件。</p> : null}
      {nextOffset !== null ? <Button disabled={disabled || loading} onClick={() => void load(true)} htmlType="button" type="tertiary" theme="borderless" size="small">更多位置</Button> : null}
    </div> : null}
    {!error && value.position ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{value.position.locationLabel} · {value.position.excerpt}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">原文位置读取失败：{error}</p> : null}
  </div>;
}
