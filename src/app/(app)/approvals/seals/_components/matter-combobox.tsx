"use client";

import { Select } from "@douyinfe/semi-ui";
import { useId, useRef } from "react";

export type MatterOption = { id: string; internalCode: string; title: string };

export function MatterCombobox({ matters, value, onChange, disabled, onDropdownVisibleChange, placeholder = "搜索案件编号 / 名称" }: {
  matters: MatterOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  onDropdownVisibleChange?: (open: boolean) => void;
  placeholder?: string;
}) {
  const labelId = useId();
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container}>
    <span id={labelId} className="sr-only">关联案件</span>
    <Select<string>
      aria-labelledby={labelId}
      value={value || undefined}
      onChange={next => onChange(typeof next === "string" ? next : "")}
      optionList={matters.map(matter => ({ value: matter.id, label: `${matter.internalCode} ${matter.title}` }))}
      filter
      showClear
      disabled={disabled}
      placeholder={placeholder}
      emptyContent="未找到匹配案件"
      style={{ width: "100%" }}
      motion={false}
      getPopupContainer={() => container.current!}
      onDropdownVisibleChange={onDropdownVisibleChange}
    />
  </div>;
}
