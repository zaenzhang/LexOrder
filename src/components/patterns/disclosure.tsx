"use client";

import { Collapsible } from "@douyinfe/semi-ui";
import { IconChevronDown, IconChevronUp } from "@douyinfe/semi-icons";
import { useId, useState, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { FocusButton } from "./focus-button";

export function Disclosure({ heading, headingRef, defaultOpen, onOpenChange, className, children }: {
  heading: ReactNode;
  headingRef?: Ref<HTMLButtonElement>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const contentId = useId();

  return (
    <div className={cn("border-b border-[var(--semi-color-border)]", className)}>
      <FocusButton
        ref={headingRef}
        block
        theme="borderless"
        type="tertiary"
        aria-expanded={open}
        aria-controls={contentId}
        icon={open ? <IconChevronUp aria-hidden /> : <IconChevronDown aria-hidden />}
        iconPosition="right"
        className="min-w-0"
        style={{ height: "auto", minHeight: 40, justifyContent: "space-between", paddingBlock: 8 }}
        contentClassName="min-w-0 whitespace-normal break-words text-left"
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
      >
        {heading}
      </FocusButton>
      <Collapsible isOpen={open} keepDOM motion={false}>
        <div id={contentId} aria-hidden={!open} inert={!open} className="min-w-0 px-3 pb-3">
          {children}
        </div>
      </Collapsible>
    </div>
  );
}
