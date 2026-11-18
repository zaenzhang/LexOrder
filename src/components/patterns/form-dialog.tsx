"use client";

import { type ComponentProps, type HTMLAttributes, type ReactNode } from "react";
import { DialogContent } from "@/components/patterns/workspace-dialog";
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
