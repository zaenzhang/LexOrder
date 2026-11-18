"use client";

import { Button, Tag } from "@douyinfe/semi-ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";
import { contextKindLabels, type ContextHistoryView } from "@/lib/matters/context";
import type { ContextInputChoice, ContextInputSelection, ContextInputSummary } from "@/lib/matters/context-inputs";
import { getMatterContextHistory, getMatterContextInputChoice, getMatterContextInputOptions } from "@/server/matters/context-actions";
import { shDayKey, shTime } from "@/lib/ui/sh-time";

const confirmation = (value: string | null) => value ? `已核对 · ${shDayKey(value)} ${shTime(value)}` : "尚未核对";

export function ContextInputsSummary({ summary, matterId }: { summary?: ContextInputSummary; matterId?: string }) {
  if (!summary) return null;
  return <section aria-label="采用的目标与指示" className="space-y-2 text-sm">
    <h3 className="font-medium">采用的目标与客户指示</h3>
    {!summary.inputs.length && !summary.unavailable && <p className="text-xs text-muted-foreground">未记录采用关系，尚未检查。</p>}
    {summary.unavailable && <p className="text-sm text-muted-foreground">部分采用记录当前不可读取。</p>}
    {summary.inputs.map(row => <details key={row.selection.recordId} className="rounded-md border p-3">
      <summary className="cursor-pointer">{contextKindLabels[row.kind]} · 第 {row.version} 版
        {row.historical && <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">采用历史版</span>}
        {row.changed && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">采用后发生变化，待核对</span>}</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{row.content}</p>
      <p className="mt-2 text-xs text-muted-foreground">来源：{row.sourceDescription}</p>
      <p className="mt-1 text-xs text-muted-foreground">采用时：{confirmation(row.adoptedConfirmedAt)}</p>
      {matterId && <Link className="mt-2 inline-block text-xs text-primary" target="_blank" rel="noopener noreferrer"
        href={`/matters/${encodeURIComponent(matterId)}?view=archive&contextRecord=${encodeURIComponent(row.selection.recordId)}`}>查看这版记录</Link>}
    </details>)}
  </section>;
}

type Props = { matterId: string; value: ContextInputSelection[]; onChange(value: ContextInputSelection[]): void;
  initial?: ContextInputSummary; disabled?: boolean };
export function ContextInputPicker(props: Props) { return <Picker key={props.matterId} {...props} />; }

function Picker({ matterId, value, onChange, initial, disabled = false }: Props) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [page, setPage] = useState<Awaited<ReturnType<typeof getMatterContextInputOptions>> | null>(null);
  const [history, setHistory] = useState<{ base: ContextInputChoice; data: ContextHistoryView } | null>(null);
  const [preview, setPreview] = useState<ContextInputChoice | null>(null);
  const [known, setKnown] = useState<ContextInputChoice[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const serial = useRef(0), live = useRef(true), retry = useRef<(() => void) | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  function remember(rows: ContextInputChoice[]) { setKnown(previous => [...new Map([...previous, ...rows].map(row => [row.selection.recordId, row])).values()]); }
  async function run(operation: (current: () => boolean) => Promise<void>) {
    const token = ++serial.current; setPending(true); setError(""); setOpen(true);
    retry.current = () => { void run(operation); };
    try { await operation(() => live.current && token === serial.current); }
    catch (cause) { if (live.current && token === serial.current) {
      setError(actionErrorMessage(cause) || "读取失败，请重试");
      setUnavailable(previous => [...new Set([...previous, ...value.map(row => row.recordId)])]);
    } }
    finally { if (live.current && token === serial.current) setPending(false); }
  }
  function list(cursor?: string) {
    setPage(null); setHistory(null); setPreview(null);
    void run(async current => { const result = await getMatterContextInputOptions(matterId, cursor); if (current()) { setPage(result); remember(result.choices); } });
  }
  function versions(base: ContextInputChoice, before?: number) {
    setPage(null); setHistory(null); setPreview(null);
    void run(async current => { const data = await getMatterContextHistory(matterId, base.selection.recordId, before); if (current()) setHistory({ base, data }); });
  }
  function reread(recordId: string) {
    setPage(null); setHistory(null); setPreview(null);
    setUnavailable(previous => [...new Set([...previous, recordId])]);
    void run(async current => { const result = await getMatterContextInputChoice(matterId, recordId); if (current()) {
      remember([result]); setPreview(result); setUnavailable(previous => previous.filter(id => id !== recordId));
    } });
  }
  function choose(row: ContextInputChoice) {
    if (disabled || pending || (!value.some(item => item.recordId === row.selection.recordId) && value.length >= 20)) return;
    remember([row]);
    setUnavailable(previous => previous.filter(id => id !== row.selection.recordId));
    onChange([...value.filter(item => item.recordId !== row.selection.recordId), row.selection].sort((a, b) => a.recordId.localeCompare(b.recordId)));
  }
  function choice(row: ContextInputChoice, withHistory = false) {
    return <div key={row.selection.recordId} className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">{contextKindLabels[row.kind]} · 第 {row.version} 版{row.historical ? " · 历史版" : ""}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{row.content}</p>
      <p className="text-xs text-muted-foreground">来源：{row.sourceDescription} · {confirmation(row.selection.expectedConfirmedAt)}</p>
      <div className="flex flex-wrap gap-2"><Button
        disabled={disabled || pending || (value.length >= 20 && !value.some(item => item.recordId === row.selection.recordId))}
        onClick={() => choose(row)}
        htmlType="button"
        type="tertiary" theme="outline"
        size="small">采用所显示的这版</Button>
        {withHistory && <Button disabled={disabled || pending} onClick={() => versions(row)} htmlType="button" type="tertiary" theme="borderless" size="small">查看历史版本</Button>}</div>
    </div>;
  }
  return <fieldset className="space-y-3 rounded-md border p-3" disabled={disabled}>
    <legend className="px-1 text-sm font-medium">采用目标与客户指示（可选）</legend>
    {!value.length && <p className="text-xs text-muted-foreground">未选择，尚未检查。</p>}
    {initial?.unavailable && <p className="text-sm text-muted-foreground">原稿存在当前不可读取的采用记录，请核对权限。</p>}
    {value.map(selection => {
      const row = unavailable.includes(selection.recordId) ? undefined
        : known.find(item => item.selection.recordId === selection.recordId) ?? initial?.inputs.find(item => item.selection.recordId === selection.recordId);
      const changed = row && (row.selection.expectedCurrentRecordId !== selection.expectedCurrentRecordId || row.selection.expectedConfirmedAt !== selection.expectedConfirmedAt);
      return <div key={selection.recordId} className="space-y-2 rounded-md bg-muted/40 p-3">
        <div className="text-sm">{row ? `${contextKindLabels[row.kind]} · 第 ${row.version} 版` : "已选固定记录"}
          {selection.recordId !== selection.expectedCurrentRecordId && <Tag className="ml-2" color="grey" type="ghost">采用历史版</Tag>}
          {changed && <Tag className="ml-2" color="grey">已有变化，请重新核对</Tag>}</div>
        {row && <details><summary className="cursor-pointer text-xs">查看选中内容</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.content}</p></details>}
        {unavailable.includes(selection.recordId) && <p className="text-xs text-muted-foreground">这版记录读取未完成或当前不可读取，固定选择已保留。</p>}
        <p className="text-xs text-muted-foreground">所见确认：{confirmation(selection.expectedConfirmedAt)}</p>
        <div className="flex gap-2"><Button disabled={disabled || pending} onClick={() => reread(selection.recordId)} htmlType="button" type="tertiary" theme="borderless" size="small">重新读取这版</Button>
          <Button disabled={disabled || pending} onClick={() => onChange(value.filter(item => item.recordId !== selection.recordId))} htmlType="button" type="tertiary" theme="borderless" size="small">移除采用</Button></div>
      </div>;
    })}
    <div className="flex gap-2"><Button disabled={disabled || pending} onClick={() => list()} htmlType="button" type="tertiary" theme="outline" size="small">选择目标或指示</Button>
      {open && <Button disabled={disabled} onClick={() => { serial.current++; setOpen(false); setPending(false); }} htmlType="button" type="tertiary" theme="borderless" size="small">收起选择</Button>}</div>
    {open && <div className="max-h-80 space-y-3 overflow-y-auto">
      {pending && <p role="status" className="text-sm">正在读取目标与指示…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error} <Button onClick={() => retry.current?.()} htmlType="button" type="primary" theme="borderless" size="small">重试读取</Button></p>}
      {preview && choice(preview)}
      {page && <>{page.choices.map(row => choice(row, true))}{!page.choices.length && <p className="text-sm text-muted-foreground">本页没有可读取的目标或指示。</p>}
        {page.nextCursor && <Button disabled={pending} onClick={() => list(page.nextCursor!)} htmlType="button" type="tertiary" theme="outline" size="small">继续查看</Button>}</>}
      {history && <>{history.data.records.filter(row => row.readable && row.content && (row.kind === "GOAL" || row.kind === "INSTRUCTION")).map(row => choice({
        selection: { recordId: row.id, expectedConfirmedAt: row.confirmedAt, expectedCurrentRecordId: history.base.selection.expectedCurrentRecordId },
        kind: row.kind as "GOAL" | "INSTRUCTION", version: row.version, content: row.content!, sourceDescription: row.sourceDescription ?? "",
        historical: row.id !== history.base.selection.expectedCurrentRecordId,
      }))}{history.data.nextBeforeVersion && <Button disabled={pending} onClick={() => versions(history.base, history.data.nextBeforeVersion!)} htmlType="button" type="tertiary" theme="outline" size="small">更早版本</Button>}</>}
    </div>}
  </fieldset>;
}
