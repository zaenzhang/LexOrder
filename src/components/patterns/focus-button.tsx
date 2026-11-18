"use client";

import { Button } from "@douyinfe/semi-ui";
import type { ComponentProps, Ref } from "react";

/** Dialog and list workflows can return focus to the actual button rendered by Semi. */
export function FocusButton({ ref, children, ...props }: ComponentProps<typeof Button> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button {...props}>
      <span hidden ref={element => {
        const button = element?.closest("button") ?? null;
        if (typeof ref === "function") return ref(button);
        if (ref) ref.current = button;
      }} />
      {children}
    </Button>
  );
}
