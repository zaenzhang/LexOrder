"use client"

import * as React from "react"
import { Button, Typography } from "@douyinfe/semi-ui"
import { IconUpload } from "@douyinfe/semi-icons"

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
        "relative flex min-w-0 items-center gap-2 rounded-[var(--semi-border-radius-small)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--semi-color-focus-border)]",
        className
      )}>
        <input
          {...props}
          type="file"
          disabled={disabled}
          title={props.title ?? summary}
          aria-describedby={[props["aria-describedby"], descriptionId].filter(Boolean).join(" ")}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
        <Button icon={<IconUpload aria-hidden />} theme="outline" type="tertiary" disabled={disabled} tabIndex={-1} aria-hidden className="shrink-0">选择文件</Button>
        <Typography.Text id={descriptionId} type="secondary" size="small" className="truncate">{summary}</Typography.Text>
      </span>
    )
  }
)
FileInput.displayName = "FileInput"
