"use client";

import { useId, useState, useEffect, useRef, useCallback, useTransition } from "react";
import { Select, Spin } from "@douyinfe/semi-ui";
import type { ClientType } from "@prisma/client";
export type ClientOption = { id: string; name: string; type: ClientType };
import { searchEnterpriseCandidates, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";

type YuandianCandidate = EnterpriseSearchItem;

export function ClientCombobox({
  clientId,
  clientName,
  clientType,
  options,
  onPickExisting,
  onTypeNew,
  onPickYuandian,
  onClear,
  triggerClassName,
  onDropdownVisibleChange
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
  onDropdownVisibleChange?: (open: boolean) => void;
}) {
  const labelId = useId();
  const selectRef = useRef<Select>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [yuandianResults, setYuandianResults] = useState<YuandianCandidate[]>([]);
  const [yuandianLoading, setYuandianLoading] = useState(false);
  const [yuandianConfigured, setYuandianConfigured] = useState(true);
  const [, startTransition] = useTransition();
  const searchVersionRef = useRef(0);

  const display = clientId
    ? options.find((o) => o.id === clientId)?.name ?? clientName ?? ""
    : clientName;

  const filtered = options
    .filter((o) => !query || o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20);

  const hasExactMatch = filtered.some(
    (o) => o.name.toLowerCase() === query.trim().toLowerCase()
  );

  const searchYuandian = useCallback((q: string, version: number) => {
    startTransition(async () => {
      try {
        const res = await searchEnterpriseCandidates(q);
        if (version !== searchVersionRef.current) return;
        setYuandianConfigured(res.configured);
        setYuandianResults(res.items);
      } catch {
        if (version !== searchVersionRef.current) return;
        setYuandianResults([]);
      } finally {
        if (version === searchVersionRef.current) {
          setYuandianLoading(false);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!open) {
      selectRef.current?.clearInput();
      setQuery("");
      setYuandianResults([]);
      setYuandianLoading(false);
      return;
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
      // bump version so in-flight response is ignored
      searchVersionRef.current = version + 1;
    };
  }, [query, clientType, open, yuandianConfigured, searchYuandian]);

  const selection = clientId ? `client:${clientId}` : clientName ? "new-client" : undefined;
  const selectedOutsideResults = selection && !filtered.some((client) => `client:${client.id}` === selection);

  return <><span id={labelId} className="sr-only">委托方客户</span><Select
    ref={selectRef}
    aria-labelledby={labelId}
    placeholder="搜索或直接输入名称"
    searchPlaceholder="输入姓名 / 公司名"
    className={triggerClassName}
    style={{ width: "100%" }}
    value={selection}
    renderSelectedItem={() => display}
    filter
    remote
    searchPosition="dropdown"
    onSearch={setQuery}
    innerTopSlot={yuandianLoading ? <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm"><Spin size="small" />正在查询企业信息</div> : undefined}
    emptyContent="开始输入以搜索 / 新建"
    showClear={Boolean(display)}
    onClear={onClear}
    onDropdownVisibleChange={(visible) => { setOpen(visible); onDropdownVisibleChange?.(visible); }}
    // 选中时固定当前查询/候选；收起后会清查询，不能在动画完成的 onChange 再读取。
    onSelect={(value) => {
      if (typeof value !== "string") return;
      if (value === "create-client") onTypeNew(query.trim());
      else if (value.startsWith("client:")) {
        const client = options.find((item) => `client:${item.id}` === value);
        if (client) onPickExisting(client.id, client.name);
      } else if (value.startsWith("enterprise:")) {
        const candidate = yuandianResults.find((item) => `enterprise:${item.id}` === value);
        if (candidate) onPickYuandian(candidate);
      }
    }}
  >
    {query.trim() && !hasExactMatch && <Select.OptGroup label="作为新客户使用">
      <Select.Option value="create-client" label={`新建 ${query.trim()} 为委托方`} />
    </Select.OptGroup>}
    {filtered.length > 0 && <Select.OptGroup label="已有客户">
      {filtered.map((client) => <Select.Option key={client.id} value={`client:${client.id}`} label={client.name} />)}
    </Select.OptGroup>}
    {yuandianConfigured && yuandianResults.length > 0 && <Select.OptGroup label="企业信息库（元典）">
      {yuandianResults.map((candidate) => <Select.Option key={candidate.id} value={`enterprise:${candidate.id}`} label={`${candidate.name}${candidate.creditCode ? ` · ${candidate.creditCode}` : ""}`} />)}
    </Select.OptGroup>}
    {selectedOutsideResults && <Select.OptGroup label="当前选择">
      <Select.Option value={selection} label={display} />
    </Select.OptGroup>}
  </Select></>;
}
