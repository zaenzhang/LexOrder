"use client";

import { useState, useEffect, useRef, useCallback, useTransition, useId } from "react";
import { Select, Spin } from "@douyinfe/semi-ui";
import type { ClientType } from "@prisma/client";
import { searchEnterpriseCandidates, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";

export type ClientOption = { id: string; name: string; type: ClientType };
type YuandianCandidate = EnterpriseSearchItem;

export function ClientCombobox({
  clientId, clientName, clientType, options, onPickExisting, onTypeNew, onPickYuandian,
  onClear, triggerClassName, onDropdownVisibleChange, disabled = false
}: {
  clientId: string;
  clientName: string;
  clientType: string;
  options: ClientOption[];
  onPickExisting: (id: string, name: string) => void;
  onTypeNew: (name: string) => void;
  onPickYuandian: (candidate: YuandianCandidate) => void;
  onClear: () => void;
  triggerClassName?: string;
  onDropdownVisibleChange?: (visible: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<Select<string>>(null);
  const labelId = useId();
  const [yuandianResults, setYuandianResults] = useState<YuandianCandidate[]>([]);
  const [yuandianLoading, setYuandianLoading] = useState(false);
  const [yuandianConfigured, setYuandianConfigured] = useState(true);
  const [, startTransition] = useTransition();
  const searchVersionRef = useRef(0);

  const display = clientId ? options.find(option => option.id === clientId)?.name ?? clientName : clientName;
  const filtered = options.filter(option => !query || option.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  const hasExactMatch = filtered.some(option => option.name.toLowerCase() === query.trim().toLowerCase());

  const searchYuandian = useCallback((q: string, version: number) => {
    startTransition(async () => {
      try {
        const result = await searchEnterpriseCandidates(q);
        if (version !== searchVersionRef.current) return;
        setYuandianConfigured(result.configured);
        setYuandianResults(result.items);
      } catch {
        if (version !== searchVersionRef.current) return;
        setYuandianResults([]);
      } finally {
        if (version === searchVersionRef.current) setYuandianLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) {
      selectRef.current?.clearInput();
      setQuery("");
      setYuandianResults([]);
      setYuandianLoading(false);
    }
  }, [open]);

  useEffect(() => {
    const isCompany = clientType === "COMPANY" || clientType === "ORGANIZATION";
    if (!isCompany || !open || query.trim().length < 2 || !yuandianConfigured) {
      setYuandianResults([]);
      setYuandianLoading(false);
      return;
    }
    setYuandianLoading(true);
    const version = ++searchVersionRef.current;
    const timer = setTimeout(() => searchYuandian(query.trim(), version), 300);
    return () => {
      clearTimeout(timer);
      searchVersionRef.current = version + 1;
    };
  }, [query, clientType, open, yuandianConfigured, searchYuandian]);

  const selectedValue = clientId ? `existing:${clientId}` : clientName ? `new:${clientName}` : undefined;
  const choiceOptions = [
    ...(query.trim() && !hasExactMatch ? [{ value: `new:${query.trim()}`, label: `新建 ${query.trim()} 为委托方` }] : []),
    ...filtered.map(option => ({ value: `existing:${option.id}`, label: option.name })),
    ...yuandianResults.map(candidate => ({ value: `enterprise:${candidate.id}`, label: `${candidate.name}${candidate.creditCode ? ` · ${candidate.creditCode}` : ""}（企业信息库）` })),
    ...(!query && selectedValue ? [{ value: "clear", label: "清除选择" }] : []),
  ];
  if (!query && selectedValue && !choiceOptions.some(option => option.value === selectedValue)) {
    choiceOptions.unshift({ value: selectedValue, label: display });
  }

  return <div ref={containerRef} className="min-w-0 w-full">
    <span id={labelId} className="sr-only">委托方客户</span>
    <Select<string>
      ref={selectRef}
      aria-labelledby={labelId} style={{ width: "100%" }} className={triggerClassName}
      value={selectedValue} optionList={choiceOptions} placeholder="搜索或直接输入名称" disabled={disabled}
      searchPlaceholder="输入姓名 / 公司名" searchPosition="dropdown" filter remote
      innerTopSlot={yuandianLoading ? <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm"><Spin size="small" />正在查询企业信息</div> : undefined}
      motion={false} getPopupContainer={() => containerRef.current!}
      onSearch={setQuery}
      renderSelectedItem={() => display}
      emptyContent={query ? "没有匹配客户" : "开始输入以搜索 / 新建"}
      onDropdownVisibleChange={visible => { setOpen(visible); onDropdownVisibleChange?.(visible); }}
      // onSelect runs before closing clears the current enterprise candidates.
      onSelect={value => {
        if (typeof value !== "string") return;
        if (value === "clear") {
          onClear();
        } else if (value.startsWith("existing:")) {
          const option = options.find(item => item.id === value.slice(9));
          if (option) onPickExisting(option.id, option.name);
        } else if (value.startsWith("enterprise:")) {
          const candidate = yuandianResults.find(item => item.id === value.slice(11));
          if (candidate) onPickYuandian(candidate);
        } else if (value.startsWith("new:")) {
          onTypeNew(value.slice(4));
        }
      }}
    />
  </div>;
}
