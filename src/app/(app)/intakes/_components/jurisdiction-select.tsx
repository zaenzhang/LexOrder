"use client";

import { useId, useRef, useState } from "react";
import { Button, Select } from "@douyinfe/semi-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";
import { provinces, citiesOf, areasOf, joinJurisdiction, parseJurisdiction } from "@/lib/china-regions";

/** 省 / 市 / 区县级联。仅更新用户明确选择的路径，不补造区县。 */
export function JurisdictionSelect({ value, onChange, triggerClassName, onDropdownVisibleChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  triggerClassName?: string;
  onDropdownVisibleChange?: (visible: boolean) => void;
  disabled?: boolean;
}) {
  const { province, city, area } = parseJurisdiction(value);
  const cities = province ? citiesOf(province) : [];
  const areas = province && city ? areasOf(province, city) : [];
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState<string | null>(null);
  const labelId = useId();
  const track = (field: string, visible: boolean) => setSelectOpen(current => visible ? field : current === field ? null : current);

  return <Popover open={open} onOpenChange={visible => { setOpen(visible); onDropdownVisibleChange?.(visible); }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} className={cn("flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm", triggerClassName)}>
        <MapPin size={16} />
        <span className="min-w-0 flex-1 truncate text-left">{value ? value.replace(/\//g, " / ") : "选择管辖地"}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent ref={fieldsRef} portalled={false} align="start" className="space-y-3 p-3" style={{ width: 280 }}
      onEscapeKeyDown={event => { if (selectOpen) event.preventDefault(); }}>
        <div className="space-y-1">
          <label id={`${labelId}-province`}>省 / 直辖市</label>
          <Select<string> style={{ width: "100%" }} value={province || undefined} placeholder="选择省 / 直辖市" disabled={disabled}
            aria-labelledby={`${labelId}-province`} optionList={provinces.map(value => ({ value, label: value }))}
            filter motion={false} getPopupContainer={() => fieldsRef.current!} onDropdownVisibleChange={visible => track("province", visible)}
            onChange={value => { if (typeof value === "string") onChange(joinJurisdiction(value)); }} />
        </div>
        <div className="space-y-1">
          <label id={`${labelId}-city`}>市</label>
          <Select<string> style={{ width: "100%" }} value={city || undefined} placeholder={province ? "选择市" : "请先选省"} disabled={disabled || !province}
            aria-labelledby={`${labelId}-city`} optionList={cities.map(value => ({ value, label: value }))}
            filter motion={false} getPopupContainer={() => fieldsRef.current!} onDropdownVisibleChange={visible => track("city", visible)}
            onChange={value => { if (typeof value === "string") onChange(joinJurisdiction(province, value)); }} />
        </div>
        <div className="space-y-1">
          <label id={`${labelId}-area`}>区 / 县（可选）</label>
          <Select<string> style={{ width: "100%" }} value={area || undefined} placeholder={city ? "选择区 / 县" : "请先选市"} disabled={disabled || !city || areas.length === 0}
            aria-labelledby={`${labelId}-area`} optionList={areas.map(value => ({ value, label: value }))}
            filter motion={false} getPopupContainer={() => fieldsRef.current!} onDropdownVisibleChange={visible => track("area", visible)}
            onChange={value => { if (typeof value === "string") onChange(joinJurisdiction(province, city, value)); }} />
        </div>
        {value && <Button htmlType="button" theme="borderless" block disabled={disabled} onClick={() => onChange("")}>清空</Button>}
    </PopoverContent>
  </Popover>;
}
