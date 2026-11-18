"use client";

import { Button, Input, Popover, Select } from "@douyinfe/semi-ui";

import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { clientHistoryFiltersSchema, historySourceLabels, type ClientHistoryFilters as Filters, type ClientHistoryMatter, type HistorySource } from "@/lib/clients/history";
import { getClientHistoryMatterPage } from "@/server/clients/history-actions";
import { ClientPagination, useClientPagination } from "./client-pagination";

export function ClientHistoryFilters({ clientId, filters, selectedMatter, loading, failed, onChange }: {
  clientId: string; filters: Filters; selectedMatter: ClientHistoryMatter | null;
  loading: boolean; failed: boolean; onChange: (filters: Filters) => void;
}) {
  const id = useId();
  const [dateOpen, setDateOpen] = useState(false);
  const datePopover = useRef<Popover>(null);
  const [from, setFrom] = useState(filters.from ?? ""), [to, setTo] = useState(filters.to ?? ""), [dateError, setDateError] = useState("");
  const dateLabel = filters.from || filters.to ? `${filters.from ?? "不限"} 至 ${filters.to ?? "不限"}` : "日期";
  const matterLabel = !filters.matterId ? "全部事项" : selectedMatter?.id === filters.matterId ? selectedMatter.title
    : loading ? "所选事项（读取中）" : failed ? "所选事项（读取失败）" : "所选事项（名称不可读）";
  function closeDates() {
    datePopover.current?.focusTrigger();
    setDateOpen(false);
  }
  function applyDates() {
    const result = clientHistoryFiltersSchema.safeParse({ ...filters, from: from || undefined, to: to || undefined });
    if (!result.success) { setDateError(result.error.issues[0]?.message ?? "日期无效"); return; }
    closeDates(); onChange(result.data);
  }
  return <div className="flex flex-wrap items-center gap-2" aria-label="客户动态筛选">
    <Popover ref={datePopover} trigger="click" position="bottomLeft" visible={dateOpen} motion={false}
      closeOnEsc guardFocus returnFocusOnClose onVisibleChange={open => {
        if (open) { setFrom(filters.from ?? ""); setTo(filters.to ?? ""); setDateError(""); }
        setDateOpen(open);
      }} content={<div className="w-80 space-y-3 p-3">
        <div className="space-y-1.5"><label htmlFor={`${id}-from`}>开始日期</label><Input id={`${id}-from`} type="date" value={from} onChange={value => setFrom(value)} /></div>
        <div className="space-y-1.5"><label htmlFor={`${id}-to`}>结束日期</label><Input id={`${id}-to`} type="date" value={to} onChange={value => setTo(value)} /></div>
        {dateError ? <p role="alert" className="text-sm text-destructive">{dateError}</p> : null}
        <div className="flex items-center gap-2"><Button theme="solid" htmlType="button" size="small" onClick={applyDates}>应用日期</Button>
          <Button htmlType="button" theme="borderless" size="small" onClick={() => { closeDates(); onChange({ ...filters, from: undefined, to: undefined }); }}>清除日期</Button></div>
      </div>}>
      <Button htmlType="button" theme="outline" size="small" aria-label={`筛选动态日期：${dateLabel}`}>
        {dateLabel}<ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
      </Button>
    </Popover>
    <span id={`${id}-source-label`} className="sr-only">动态类型</span>
    <Select aria-labelledby={`${id}-source-label`} size="small" motion={false} className="min-w-32" value={filters.source ?? "ALL"}
      onChange={value => onChange({ ...filters, source: value === "ALL" ? undefined : value as HistorySource })}
      optionList={[{ value: "ALL", label: "全部类型" }, ...Object.entries(historySourceLabels).map(([value, label]) => ({ value, label }))]} />
    <HistoryMatterFilter key={clientId} clientId={clientId} selectedId={filters.matterId} label={matterLabel}
      onSelect={matterId => onChange({ ...filters, matterId })} />
    {filters.matterId ? <Button htmlType="button" theme="borderless" size="small" onClick={() => onChange({ ...filters, matterId: undefined })}>清除事项</Button> : null}
    {filters.from || filters.to || filters.source || filters.matterId ? <Button htmlType="button" theme="borderless" size="small" onClick={() => onChange({})}>清除筛选</Button> : null}
  </div>;
}

function HistoryMatterFilter({ clientId, selectedId, label, onSelect }: {
  clientId: string; selectedId?: string; label: string; onSelect: (matterId?: string) => void;
}) {
  const labelId = useId();
  const picker = useRef<Select<string>>(null);
  const controls = useClientPagination(clientId, null, getClientHistoryMatterPage);
  return <>
    <span id={labelId} className="sr-only">筛选动态事项：{label}</span>
    <Select<string> ref={picker} aria-labelledby={labelId} size="small" motion={false}
      className="min-w-32 max-w-sm" dropdownStyle={{ width: 384 }} dropdownMatchSelectWidth={false}
      value={selectedId ?? "ALL"} renderSelectedItem={() => label}
      onDropdownVisibleChange={visible => { if (visible) controls.goTo(null); }}
      onChange={value => {
        if (value === "ALL") onSelect();
        else if (typeof value === "string" && controls.page?.items.some(matter => matter.id === value)) onSelect(value);
      }}
      optionList={[
        { value: "ALL", label: "全部事项" },
        ...(controls.page?.items ?? []).map(matter => ({ value: matter.id, label: <span className="min-w-0">
          <span className="block whitespace-normal break-words">{matter.title}</span>
          {matter.internalCode ? <span className="text-xs text-muted-foreground">{matter.internalCode}</span> : null}
        </span> }))
      ]}
      innerBottomSlot={<div className="px-3 pb-3" aria-busy={controls.pending} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); picker.current?.close(); picker.current?.focus(); }
      }}>
        {controls.page?.items.length === 0 ? <p role="status" className="py-3 text-sm text-muted-foreground">
          {controls.page.nextCursor ? "本页没有可选事项，可继续查看。" : "暂无可选事项。"}</p> : null}
        <ClientPagination controls={controls} label="动态事项" />
      </div>}
    />
  </>;
}
