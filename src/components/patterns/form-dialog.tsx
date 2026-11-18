"use client";

import { type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import { DialogContent } from "@/components/patterns/workspace-dialog";
import { Form } from "@douyinfe/semi-ui";
import { cn } from "@/lib/utils";
import styles from "./form-dialog.module.css";

/** 标题和操作留在窗口内，长表单只滚动正文；不改变表单提交关系。 */
export function FormDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent className={cn("flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0", styles.frame, className)} {...props} />;
}

export function FormDialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(styles.body, className)} {...props} />;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className={styles.section}><header><h3>{title}</h3>{description && <p>{description}</p>}</header><div>{children}</div></section>;
}


/** Shared labels and validation for forms that keep their own form state. */
export function FormField({ id, labelId, label, required, error, hint, className, children }: {
  id?: string;
  labelId?: string;
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const resolvedLabelId = labelId ?? (id ? `${id}-label` : undefined);
  return <div className={cn(styles.field, className)}>
    <Form.Label name={id} id={resolvedLabelId} text={label} required={required} />
    {children}
    <Form.ErrorMessage error={error} helpText={error ? undefined : hint}
      errorMessageId={id ? `${id}-error` : undefined} helpTextId={id ? `${id}-hint` : undefined} />
  </div>;
}
