"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** 保留原生文件控件的选择、校验和表单语义，仅用中文替换可见提示。 */
export const FileInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ className, onChange, disabled, ...props }, forwardedRef) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    const descriptionId = React.useId()
    const [names, setNames] = React.useState<string[]>([])
    const summary = names.length ? names.join("、") : "未选择文件"

    React.useEffect(() => {
      const input = inputRef.current
      if (!input) return
      const form = input.form
      const cancel = () => setNames(Array.from(input.files ?? [], file => file.name))
      const reset = (event: Event) => {
        queueMicrotask(() => { if (!event.defaultPrevented) setNames([]) })
      }
      input.addEventListener("cancel", cancel)
      form?.addEventListener("reset", reset)
      return () => {
        input.removeEventListener("cancel", cancel)
        form?.removeEventListener("reset", reset)
      }
    }, [props.form])

    return (
      <span className={cn(
        "relative flex min-h-8 w-full min-w-0 items-center gap-3 rounded-[var(--semi-border-radius-small)] border border-[var(--semi-color-border)] bg-[var(--semi-color-fill-0)] px-3 py-1.5 text-sm focus-within:border-[var(--semi-color-primary)]",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}>
        <input
          {...props}
          type="file"
          disabled={disabled}
          title={props.title ?? summary}
          aria-describedby={[props["aria-describedby"], descriptionId].filter(Boolean).join(" ")}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          ref={node => {
            inputRef.current = node
            if (typeof forwardedRef === "function") forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          onChange={event => {
            onChange?.(event)
            setNames(Array.from(event.currentTarget.files ?? [], file => file.name))
          }}
        />
        <span aria-hidden="true" className="shrink-0 font-medium text-[var(--semi-color-text-0)]">选择文件</span>
        <span id={descriptionId} aria-hidden="true" className="truncate text-[var(--semi-color-text-2)]">{summary}</span>
      </span>
    )
  }
)
FileInput.displayName = "FileInput"
