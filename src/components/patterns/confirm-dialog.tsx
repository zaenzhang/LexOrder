"use client";

/**
 * 全局确认 / 输入弹窗（替代浏览器原生 confirm / prompt）。
 * 用法：`if (!(await confirmDialog({ title, description, danger: true }))) return;`
 *      `const note = await promptDialog({ title, label, required: false });`（取消返回 null）
 * <ConfirmHost /> 挂在 Providers 中，全站唯一实例；模块级队列保证同一时刻只显示一个。
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button, TextArea, Typography } from "@douyinfe/semi-ui";
import { WorkspaceDialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";

type BaseOptions = {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Explicit initial focus for this request; omitted keeps the existing behavior. */
  initialFocus?: "confirm" | "cancel";
  /** 危险操作：确认按钮用红色 */
  danger?: boolean;
};
export type ConfirmOptions = BaseOptions;
export type PromptOptions = BaseOptions & { label?: string; placeholder?: string; defaultValue?: string; required?: boolean; maxLength?: number };

type RequestInput =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };
type Request = RequestInput & { returnFocus: HTMLElement | null };

let current: Request | null = null;
const queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(input: RequestInput) {
  // 同一批排队请求返回最初入口，不记录即将卸载的确认按钮。
  const returnFocus = current ? current.returnFocus : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const req: Request = { ...input, returnFocus };
  if (current) queue.push(req);
  else current = req;
  emit();
}
function settle() {
  current = queue.shift() ?? null;
  emit();
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", opts, resolve }));
}

export function confirmDiscardChanges(): Promise<boolean> {
  return confirmDialog({
    title: "放弃未保存的修改？",
    confirmText: "放弃修改",
    cancelText: "继续编辑",
    initialFocus: "cancel",
  });
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ kind: "prompt", opts, resolve }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current, () => null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInitial = useCallback((request: Request) => {
    if (request.kind === "prompt" && !request.opts.initialFocus) inputRef.current?.focus();
    else contentRef.current?.querySelector<HTMLButtonElement>(`[data-confirm-action="${request.opts.initialFocus ?? "confirm"}"]`)?.focus();
  }, []);

  useEffect(() => {
    if (req?.kind === "prompt") {
      setValue(req.opts.defaultValue ?? "");
      setTouched(false);
    }
  }, [req]);

  useEffect(() => {
    // 排队请求复用窗口，按每项真实类型重新落焦。
    if (req) focusInitial(req);
  }, [req, focusInitial]);

  if (!req) return null;
  const { opts } = req;
  const promptReq = req.kind === "prompt" ? req : null;
  const invalid = Boolean(promptReq?.opts.required && !value.trim());

  function close(ok: boolean) {
    if (!req || current !== req) return;
    if (req.kind === "confirm") req.resolve(ok);
    else {
      if (ok && invalid) {
        setTouched(true);
        inputRef.current?.focus();
        return;
      }
      req.resolve(ok ? value.trim() : null);
    }
    settle();
  }

  return (
    <WorkspaceDialog open onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent ref={contentRef} className="max-w-md" onOpenAutoFocus={(e) => {
        e.preventDefault();
        focusInitial(req);
      }} onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (!current && req.returnFocus?.isConnected) req.returnFocus.focus();
      }}>
        <DialogHeader className={promptReq ? undefined : "border-b-0 pb-0"}>
          <DialogTitle>{opts.title}</DialogTitle>
          {opts.description ? <DialogDescription className="whitespace-pre-line">{opts.description}</DialogDescription> : null}
        </DialogHeader>
        {promptReq ? (
          <div className="space-y-1.5">
            {promptReq.opts.label ? (
              <label htmlFor={fieldId} className="text-sm font-medium">
                {promptReq.opts.label}
                {promptReq.opts.required ? <Typography.Text type="danger" aria-hidden> *</Typography.Text> : null}
              </label>
            ) : null}
            <TextArea
              id={fieldId}
              ref={inputRef}
              rows={3}
              value={value}
              maxLength={promptReq.opts.maxLength ?? 500}
              placeholder={promptReq.opts.placeholder}
              aria-label={promptReq.opts.label ? undefined : opts.title}
              aria-required={promptReq.opts.required}
              aria-invalid={touched && invalid}
              aria-describedby={touched && invalid ? `${fieldId}-error` : undefined}
              validateStatus={touched && invalid ? "error" : "default"}
              onChange={setValue}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  close(true);
                }
              }}
            />
            {touched && invalid ? <div id={`${fieldId}-error`} role="alert"><Typography.Text type="danger">请填写{promptReq.opts.label ?? "内容"}</Typography.Text></div> : null}
          </div>
        ) : null}
        <DialogFooter className={promptReq ? undefined : "border-t-0 pt-1"}>
          <Button data-confirm-action="cancel" htmlType="button" type="tertiary" onClick={() => close(false)}>{opts.cancelText ?? "取消"}</Button>
          <Button data-confirm-action="confirm" htmlType="button" type={opts.danger ? "danger" : "primary"} theme="solid" onClick={() => close(true)}>
            {opts.confirmText ?? "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
