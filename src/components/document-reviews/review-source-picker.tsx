"use client";

import { Select, Button, Input } from "@douyinfe/semi-ui";
import { useEffect, useId, useRef, useState } from "react";
import { getDocumentReviewSourcePage } from "@/server/document-reviews/actions";
import type { ReviewDocumentOption } from "@/server/document-reviews/contracts";

type Props = {
  documentId: string; initialOptions: ReviewDocumentOption[]; initialNextCursor: string | null;
  value: string; disabled: boolean; onChange: (value: string) => void;
  onSelectedDocument: (document: ReviewDocumentOption | null) => void;
};

/** Looking up source options never changes the review draft or its save identity. */
export function ReviewSourcePicker({ documentId, initialOptions, initialNextCursor, value, disabled, onChange, onSelectedDocument }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [options, setOptions] = useState(initialOptions);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [selected, setSelected] = useState<ReviewDocumentOption | null>(() => initialOptions.find(option => option.id === value) ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const retry = useRef<{ query: string; cursor?: string }>({ query: "" });
  useEffect(() => () => { sequence.current += 1; }, []);

  async function readPage(searchQuery: string, cursor?: string, append = false) {
    if (disabled) return;
    const request = ++sequence.current;
    retry.current = { query: searchQuery, cursor };
    setLoading(true); setFailed(false); setAppliedQuery(searchQuery);
    if (!append) { setOptions([]); setNextCursor(null); }
    try {
      const page = await getDocumentReviewSourcePage({ documentId, query: searchQuery,
        ...(cursor ? { cursor } : {}), ...(value !== "none" ? { selectedId: value } : {}) });
      if (request !== sequence.current) return;
      const unavailableId = page.selected && !page.selected.document ? page.selected.id : null;
      setOptions(current => (append ? [...new Map([...current, ...page.items].map(option => [option.id, option])).values()] : page.items)
        .filter(option => option.id !== unavailableId));
      setNextCursor(page.nextCursor);
      setSelected(page.selected?.document ?? null);
    } catch {
      if (request !== sequence.current) return;
      // A failed current read cannot leave previously readable names available.
      setOptions([]); setSelected(null); setNextCursor(null); setFailed(true);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }

  const choices = [...new Map([...(selected ? [selected] : []), ...options].map(option => [option.id, option])).values()];
  const selectedReadable = value === "none" || choices.some(option => option.id === value);
  const selectedDocument = choices.find(option => option.id === value) ?? null;
  useEffect(() => { onSelectedDocument(selectedDocument); }, [onSelectedDocument, selectedDocument]);
  return <div className="flex flex-col gap-2">
    <label id={`${id}-choice` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">关联依据材料（可选）</label>
    <Select
      value={value}
      disabled={disabled || loading}
      onChange={next => { if (typeof next !== "string") return;
      setSelected(choices.find(option => option.id === next) ?? null); onChange(next);
    }}
      id={`${id}-choice`}
      aria-labelledby={`${id}-choice` + "-label"}
      className="w-full"
      motion={false}><Select.Option value="none">不关联材料</Select.Option>
        {!selectedReadable && <Select.Option value={value} disabled>所选材料待重新核对</Select.Option>}
        {choices.map(option => <Select.Option key={option.id} value={option.id}>{option.name} · 第 {option.version} 版</Select.Option>)}</Select>
    <div className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5"><label htmlFor={`${id}-query`} className="text-sm font-medium text-[var(--semi-color-text-1)]">按材料名称查找</label>
        <Input
          id={`${id}-query`}
          value={query}
          maxLength={200}
          disabled={disabled}
          onChange={inputValue => setQuery(inputValue)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void readPage(query.trim()); } }} />
      </div>
      <Button disabled={disabled} onClick={() => void readPage(query.trim())} htmlType="button" type="tertiary" theme="outline">查找材料</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted-foreground">正在查找依据材料…</p>}
    {failed ? <div role="alert" className="flex items-center justify-between gap-2 text-sm">
      <span>依据材料读取失败，所选版本和问题内容已保留。</span>
      <Button disabled={disabled || loading} onClick={() => void readPage(retry.current.query, retry.current.cursor)} htmlType="button" type="tertiary" theme="outline" size="small">重试依据查找</Button>
    </div> : <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>本次查找已显示 {options.length} 份材料</span>
      {nextCursor && <Button
        disabled={disabled || loading || query.trim() !== appliedQuery}
        onClick={() => void readPage(appliedQuery, nextCursor, true)}
        htmlType="button"
        type="tertiary" theme="outline"
        size="small">继续查找依据</Button>}
    </div>}
    {!selectedReadable && <p className="text-sm text-muted-foreground">所选版本尚未重新核实；可重新查找，或明确取消关联。</p>}
  </div>;
}
