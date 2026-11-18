"use client";

import { useId, useRef } from "react";
import { Select } from "@douyinfe/semi-ui";
import { cn } from "@/lib/utils";
import { provinces, citiesOf, areasOf, joinJurisdiction, parseJurisdiction } from "@/lib/china-regions";

const emptyPath = "__none__";
const provinceOptions = provinces.map(value => ({ value, label: value }));

/** 管辖地允许只确定到省或市，各层都可用键盘选择。 */
export function JurisdictionSelect({ value, onChange, triggerClassName, onDropdownVisibleChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  triggerClassName?: string;
  onDropdownVisibleChange?: (visible: boolean) => void;
  disabled?: boolean;
}) {
  const { province, city, area } = parseJurisdiction(value);
  const fields = useRef<HTMLDivElement>(null);
  const activeField = useRef<string | null>(null);
  const labelId = useId();

  const areas = areasOf(province, city);
  const options = [
    {
      name: "province",
      label: "省 / 直辖市",
      value: province,
      disabled,
      placeholder: "选择省 / 直辖市",
      options: [{ value: emptyPath, label: "清空管辖地" }, ...provinceOptions],
      select: (next: string) => joinJurisdiction(next)
    },
    {
      name: "city",
      label: "市",
      value: city,
      disabled: disabled || !province,
      placeholder: province ? "选择市" : "先选省",
      options: [
        { value: emptyPath, label: "只选到省" },
        ...citiesOf(province).map(value => ({ value, label: value }))
      ],
      select: (next: string) => joinJurisdiction(province, next)
    },
    {
      name: "area",
      label: "区 / 县（可选）",
      value: area,
      disabled: disabled || !city || areas.length === 0,
      placeholder: city ? "选择区 / 县" : "先选市",
      options: [
        { value: emptyPath, label: "只选到市" },
        ...areas.map(value => ({ value, label: value }))
      ],
      select: (next: string) => joinJurisdiction(province, city, next)
    }
  ];

  return (
    <div ref={fields} role="group" aria-label="管辖地" className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
      {options.map(field => (
        <div key={field.name} className="min-w-0 space-y-1">
          <span className="block text-xs text-[var(--semi-color-text-2)]" id={`${labelId}-${field.name}`}>{field.label}</span>
          <Select<string>
            className={cn("w-full", triggerClassName)}
            aria-labelledby={`${labelId}-${field.name}`}
            value={field.value || undefined}
            placeholder={field.placeholder}
            disabled={field.disabled}
            optionList={field.options}
            filter
            motion={false}
            getPopupContainer={() => fields.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body}
            onDropdownVisibleChange={visible => {
              if (visible) {
                activeField.current = field.name;
                onDropdownVisibleChange?.(true);
              } else if (activeField.current === field.name) {
                activeField.current = null;
                onDropdownVisibleChange?.(false);
              }
            }}
            onChange={value => { if (typeof value === "string") onChange(field.select(value === emptyPath ? "" : value)); }}
          />
        </div>
      ))}
    </div>
  );
}
