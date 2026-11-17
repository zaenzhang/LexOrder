"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { clientHistoryFiltersSchema, historySourceLabels, type ClientHistoryFilters as Filters, type ClientHistoryMatter, type HistorySource } from "@/lib/clients/history";
import { getClientHistoryMatterPage } from "@/server/clients/history-actions";
import { ClientPagination, useClientPagination } from "./client-pagination";

export function ClientHistoryFilters({ clientId, filters, selectedMatter, loading, failed, onChange }: {
  clientId: string; filters: Filters; selectedMatter: ClientHistoryMatter | null;
  loading: boolean; failed: boolean; onChange: (filters: Filters) => void;
}) {
  const id = useId();
  const [dateOpen, setDateOpen] = useState(false), [matterOpen, setMatterOpen] = useState(false);
  const [from, setFrom] = useState(filters.from ?? ""), [to, setTo] = useState(filters.to ?? ""), [dateError, setDateError] = useState("");
  const dateLabel = filters.from || filters.to ? `${filters.from ?? "不限"} 至 ${filters.to ?? "不限"}` : "日期";
  const matterLabel = !filters.matterId ? "全部事项" : selectedMatter?.id === filters.matterId ? selectedMatter.title
    : loading ? "所选事项（读取中）" : failed ? "所选事项（读取失败）" : "所选事项（名称不可读）";
  function applyDates() {
    const result = clientHistoryFiltersSchema.safeParse({ ...filters, from: from || undefined, to: to || undefined });
    if (!result.success) { setDateError(result.error.issues[0]?.message ?? "日期无效"); return; }
    setDateOpen(false); onChange(result.data);
  }
  return <div className="flex flex-wrap items-center gap-2" aria-label="客户动态筛选">
    <Popover open={dateOpen} onOpenChange={open => {
      if (open) { setFrom(filters.from ?? ""); setTo(filters.to ?? ""); setDateError(""); }
      setDateOpen(open);
    }}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={`筛选动态日期：${dateLabel}`}>
        {dateLabel}<ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden /></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="space-y-1.5"><Label htmlFor={`${id}-from`}>开始日期</Label><Input id={`${id}-from`} type="date" value={from} onChange={event => setFrom(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-to`}>结束日期</Label><Input id={`${id}-to`} type="date" value={to} onChange={event => setTo(event.target.value)} /></div>
        {dateError ? <p role="alert" className="text-sm text-destructive">{dateError}</p> : null}
        <div className="flex items-center gap-2"><Button type="button" size="sm" onClick={applyDates}>应用日期</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setDateOpen(false); onChange({ ...filters, from: undefined, to: undefined }); }}>清除日期</Button></div>
      </PopoverContent>
    </Popover>
    <Select value={filters.source ?? "ALL"} onValueChange={value => onChange({ ...filters, source: value === "ALL" ? undefined : value as HistorySource })}>
      <SelectTrigger aria-label="动态类型" className="h-8 w-auto min-w-32 gap-2 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="ALL">全部类型</SelectItem>
        {Object.entries(historySourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
    <Popover open={matterOpen} onOpenChange={setMatterOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="max-w-sm" aria-label={`筛选动态事项：${matterLabel}`}>
        <span className="truncate">{matterLabel}</span><ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden /></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-2">
        {matterOpen ? <HistoryMatterChoices key={clientId} clientId={clientId} selectedId={filters.matterId} onSelect={matterId => {
          setMatterOpen(false); onChange({ ...filters, matterId });
        }} /> : null}
      </PopoverContent>
    </Popover>
    {filters.matterId ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...filters, matterId: undefined })}>清除事项</Button> : null}
    {filters.from || filters.to || filters.source || filters.matterId ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>清除筛选</Button> : null}
  </div>;
}

function HistoryMatterChoices({ clientId, selectedId, onSelect }: { clientId: string; selectedId?: string; onSelect: (matterId?: string) => void }) {
  const controls = useClientPagination(clientId, null, getClientHistoryMatterPage);
  const { goTo } = controls;
  useEffect(() => { goTo(null); }, [goTo]);
  return <div aria-busy={controls.pending}>
    <Command shouldFilter={false} tabIndex={0} label="选择动态事项">
      <CommandList><CommandGroup>
        <CommandItem value="ALL" onSelect={() => onSelect()}>全部事项</CommandItem>
        {controls.page?.items.map(matter => <CommandItem key={matter.id} value={matter.id} onSelect={() => onSelect(matter.id)}>
          <span className="min-w-0"><span className="block break-words">{matter.title}{selectedId === matter.id ? "（已选）" : ""}</span>
            {matter.internalCode ? <span className="text-xs text-muted-foreground">{matter.internalCode}</span> : null}</span>
        </CommandItem>)}
      </CommandGroup></CommandList>
    </Command>
    {controls.page?.items.length === 0 ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
      {controls.page.nextCursor ? "本页没有可选事项，可继续查看。" : "暂无可选事项。"}</p> : null}
    <ClientPagination controls={controls} label="动态事项" />
  </div>;
}
