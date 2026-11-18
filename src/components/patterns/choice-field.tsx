"use client";

import { RadioGroup, Select } from "@douyinfe/semi-ui";
import { useId } from "react";

/** 常用少量选项直接可见，长选项列表使用下拉。 */
export type ChoiceOption<V extends string> = { value: V; label: string };

export function ChoiceField<V extends string>({
  options,
  value,
  onChange,
  placeholder = "请选择",
  threshold = 5,
  disabled,
  invalid,
  className,
  ariaLabel
}: {
  options: ChoiceOption<V>[];
  value: V | undefined | null;
  onChange: (value: V) => void;
  placeholder?: string;
  threshold?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const accessibleLabelId = useId();
  if (options.length <= threshold) {
    return <RadioGroup
      type="button"
      options={options}
      value={value ?? ""}
      onChange={event => onChange(event.target.value as V)}
      disabled={disabled}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      className={className}
    />;
  }
  return <>
    {ariaLabel ? <span hidden id={accessibleLabelId}>{ariaLabel}</span> : null}
    <Select
      optionList={options}
      value={value ?? undefined}
      onChange={next => onChange(next as V)}
      placeholder={placeholder}
      disabled={disabled}
      validateStatus={invalid ? "error" : "default"}
      aria-labelledby={ariaLabel ? accessibleLabelId : undefined}
      className={className}
      motion={false}
      showTick={false}
      style={{ width: "100%" }}
      />
  </>;
}
