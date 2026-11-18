"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button, Input, Notification, Popover, Toast } from "@douyinfe/semi-ui";
import { searchEnterpriseCandidates, getEnterpriseDetail, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";
import { actionErrorMessage } from "@/lib/action-error";

export type EnterprisePick = { name: string; creditCode: string; legalRep?: string | null; address?: string | null };

/**
 * 受控的单位名称输入：输入时防抖匹配元典企业，选中后回填名称、信用代码，
 * 再取详情补法定代表人与注册地址。未配置元典时静默，退化为普通输入框。
 */
export function EnterpriseNameInput({
  value,
  onChange,
  onPick,
  className,
  id,
  name,
  onBlur,
  inputRef,
  invalid,
  placeholder = "单位名称（输入自动匹配企业信息）"
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (pick: EnterprisePick) => void;
  className?: string;
  id?: string;
  name?: string;
  onBlur?: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [candidates, setCandidates] = useState<EnterpriseSearchItem[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [filling, startFill] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sequence = useRef(0);
  const visible = Boolean(candidates?.length);

  function dismiss() {
    if (timer.current) clearTimeout(timer.current);
    sequence.current += 1;
    setCandidates(null);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    sequence.current += 1;
  }, []);

  function schedule(value: string) {
    dismiss();
    const query = value.trim();
    if (query.length < 2) return;
    const request = sequence.current;
    timer.current = setTimeout(() => {
      startSearch(async () => {
        try {
          const result = await searchEnterpriseCandidates(query);
          if (sequence.current === request && result.configured) setCandidates(result.items);
        } catch {
          if (sequence.current === request) setCandidates(null);
        }
      });
    }, 400);
  }

  function pick(item: EnterpriseSearchItem) {
    dismiss();
    const request = sequence.current;
    input.current?.focus({ preventScroll: true });
    onPick({ name: item.name, creditCode: item.creditCode });
    startFill(async () => {
      try {
        const r = await getEnterpriseDetail(item.id);
        if (sequence.current === request && r.configured && r.info) {
          onPick({ name: item.name, creditCode: item.creditCode, legalRep: r.info.legalRep, address: r.info.address });
          Toast.success(`已回填：${item.name}`);
        }
      } catch (err) {
        if (sequence.current !== request) return;
        Notification.warning({ title: "法定代表人 / 地址自动填充失败，可手动补充", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <div ref={root} onKeyDown={event => {
      if (visible && event.key === "Escape") {
        event.stopPropagation();
        dismiss();
        input.current?.focus({ preventScroll: true });
      } else if (visible && event.key === "ArrowDown" && event.target === input.current) {
        event.preventDefault();
        document.getElementById(listId)?.querySelector("button")?.focus();
      }
    }}>
      <Popover
        trigger="custom"
        visible={visible}
        onClickOutSide={dismiss}
        getPopupContainer={() => root.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body}
        position="bottomLeft"
        guardFocus={false}
        motion={false}
        content={
          <ul id={listId} aria-label="匹配的企业" className="max-h-64 w-80 space-y-1 overflow-y-auto p-1">
            {candidates?.map(item => (
              <li key={item.id}>
                <Button
                  block
                  type="tertiary"
                  theme="borderless"
                  className="h-auto justify-start px-2 py-1.5 text-left"
                  onClick={() => pick(item)}
                >
                  <span className="flex flex-col items-start gap-1">
                    <span>{item.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{item.creditCode}</span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        }
      >
        <span>
          <Input
            ref={node => { input.current = node; inputRef?.(node); }}
            id={id}
            name={name}
            value={value}
            placeholder={placeholder}
            className={className}
            aria-expanded={visible}
            aria-controls={visible ? listId : undefined}
            aria-invalid={invalid || undefined}
            validateStatus={invalid ? "error" : "default"}
            onBlur={onBlur}
            onChange={next => { onChange(next); schedule(next); }}
            suffix={searching || filling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          />
        </span>
      </Popover>
    </div>
  );
}
