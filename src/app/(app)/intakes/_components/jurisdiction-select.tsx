"use client";

import { Cascader } from "@douyinfe/semi-ui";
import { provinces, citiesOf, areasOf } from "@/lib/china-regions";

const regions = provinces.map((province) => ({
  label: province,
  value: province,
  children: citiesOf(province).map((city) => ({
    label: city,
    value: city,
    children: areasOf(province, city).map((area) => ({ label: area, value: area }))
  }))
}));

/** 保留省/市/区县路径合同；选到省或市即可提交，不强制补县区。 */
export function JurisdictionSelect({ value, onChange, triggerClassName, onDropdownVisibleChange }: {
  value: string;
  onChange: (value: string) => void;
  triggerClassName?: string;
  onDropdownVisibleChange?: (open: boolean) => void;
}) {
  return <Cascader
    aria-label="管辖地"
    placeholder="选择管辖地"
    className={triggerClassName}
    style={{ width: "100%" }}
    treeData={regions}
    value={value ? value.split("/") : []}
    onChange={(path) => onChange((path as string[]).join("/"))}
    changeOnSelect
    showClear
    onDropdownVisibleChange={onDropdownVisibleChange}
  />;
}
