"use client";

/** 页面筛选：业务值由调用方持有，清除与菜单内「全部」含义相同。 */
import { useRef, useState } from "react";
import { Button, ButtonGroup, Dropdown } from "@douyinfe/semi-ui";
import { ChevronDown, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "全部",
  clearable = true,
  icon
}: {
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
  /** 不可清空的筛选（如「范围」「排序」）始终显示当前值、不显示 × */
  clearable?: boolean;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const current = options.find((o) => o.value === value);
  const on = clearable && Boolean(current);

  function choose(next: string | undefined) {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>("[data-filter-trigger]")?.focus();
    onChange(next);
  }

  return (
    <span ref={rootRef} className="inline-flex">
      <ButtonGroup>
        <Dropdown
          trigger="click"
          position="bottomLeft"
          visible={open}
          onVisibleChange={setOpen}
          closeOnEsc
          motion={false}
          render={<Dropdown.Menu aria-label={`${label}筛选`} style={{ maxHeight: 320, minWidth: 160, overflowY: "auto" }}>
            {clearable ? <Dropdown.Item active={!current} onClick={() => choose(undefined)}>{allLabel}</Dropdown.Item> : null}
            {options.map((o) => <Dropdown.Item key={o.value} active={o.value === value} onClick={() => choose(o.value)}>{o.label}</Dropdown.Item>)}
          </Dropdown.Menu>}
        >
          <Button
            data-filter-trigger
            htmlType="button"
            type={on ? "primary" : "tertiary"}
            aria-label={current ? `${label} ${current.label}` : label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { if (open) setOpen(false); }}
            onKeyDown={event => {
              // Semi 已为 Enter 和空格触发 click，取消原生按钮的第二次激活。
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
              } else if (event.key === "ArrowDown" && !open) {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              {icon}
              {label}
              {current ? <span>{current.label}</span> : null}
              <ChevronDown size={14} aria-hidden />
            </span>
          </Button>
        </Dropdown>
        {on ? <Button htmlType="button" type="primary" aria-label={`清除${label}筛选`} icon={<X size={14} />} onClick={() => choose(undefined)} /> : null}
      </ButtonGroup>
    </span>
  );
}
