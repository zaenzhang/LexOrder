"use client";

import { Button, Modal } from "@douyinfe/semi-ui";
import { IconClose as X } from "@douyinfe/semi-icons";
import {
  cloneElement, createContext, useContext, useEffect, useId, useRef, useSyncExternalStore,
  type HTMLAttributes, type MouseEvent, type ReactElement, type ReactNode, type Ref,
} from "react";
import { cn } from "@/lib/utils";
import styles from "./workspace-dialog.module.css";

const WorkspaceDialogContext = createContext<{
  open: boolean;
  change: (open: boolean) => void;
  dismissOnBackdrop: boolean;
  titleId: string;
  descriptionId: string;
} | null>(null);

export function WorkspaceDialog({ open, onOpenChange, dismissOnBackdrop = false, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <WorkspaceDialogContext.Provider value={{ open, change: onOpenChange, dismissOnBackdrop, titleId: `${id}-title`, descriptionId: `${id}-description` }}>
      {children}
    </WorkspaceDialogContext.Provider>
  );
}

function useWorkspaceDialog() {
  const dialog = useContext(WorkspaceDialogContext);
  if (!dialog) throw new Error("WorkspaceDialog is required");
  return dialog;
}

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

type FocusHandler = (event: Event) => void;

type DialogContentProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  onOpenAutoFocus?: FocusHandler;
  onCloseAutoFocus?: FocusHandler;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  showClose?: boolean;
};

function DialogFocus({ onOpen, onClose }: { onOpen: FocusHandler; onClose: FocusHandler }) {
  const handlers = useRef({ onOpen, onClose });
  const openingCycle = useRef<symbol>(undefined);
  useEffect(() => { handlers.current = { onOpen, onClose }; }, [onOpen, onClose]);
  useEffect(() => {
    const cycle = Symbol();
    openingCycle.current = cycle;
    const opening = new Event("dialog-open-focus", { cancelable: true });
    handlers.current.onOpen(opening);
    return () => {
      const closing = new Event("dialog-close-focus", { cancelable: true });
      const restore = handlers.current.onClose;
      // Semi releases its focus trap before an explicit return target is focused.
      queueMicrotask(() => { if (openingCycle.current === cycle) restore(closing); });
    };
  }, []);
  return null;
}

type SurfaceProps = DialogContentProps & { edge?: "left" | "right" };

function tabBoundary(dialog: HTMLElement, backwards: boolean) {
  // Tabs and conditional form sections stay mounted but their hidden fields cannot receive focus.
  const visible = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], iframe, summary, [tabindex], [contenteditable=true]"))
    .filter(control => control.tabIndex >= 0 && !control.matches(":disabled") &&
      !control.closest('[hidden], [inert], [aria-hidden="true"]') && control.getClientRects().length > 0);
  return { boundary: backwards ? visible[0] : visible.at(-1), next: backwards ? visible.at(-1) : visible[0] };
}

function DialogSurface({
  children, className, ref, edge, showClose = true, onOpenAutoFocus, onCloseAutoFocus,
  onEscapeKeyDown, onKeyDown, onKeyDownCapture, inert, "aria-hidden": ariaHidden, ...props
}: SurfaceProps) {
  const { open, change, dismissOnBackdrop, titleId, descriptionId } = useWorkspaceDialog();
  // Semi portals contain client-only DOM. A deep link may start with an open editor.
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const surface = useRef<HTMLDivElement>(null);
  const guardedEscape = useRef<KeyboardEvent | null>(null);

  const attachSurface = (element: HTMLDivElement | null) => {
    surface.current = element;
    if (typeof ref === "function") return ref(element);
    if (ref) ref.current = element;
  };

  const containsEvent = (target: EventTarget) =>
    target instanceof Element && target.closest('[role="dialog"]') === surface.current;

  const requestCancel = (event: KeyboardEvent | MouseEvent) => {
    if ("key" in event) {
      if (event.defaultPrevented || event.isComposing || event === guardedEscape.current) return;
      onEscapeKeyDown?.(event);
    }
    if (!event.defaultPrevented) change(false);
  };

  return (
    <Modal
      visible={open && hydrated}
      centered
      width="100%"
      className={cn(styles.modal, edge === "left" && styles.left, edge === "right" && styles.right)}
      modalContentClass={styles.surface}
      header={null}
      footer={null}
      closable={false}
      maskClosable={dismissOnBackdrop}
      preventScroll
      motion={false}
      onCancel={requestCancel}
      modalRender={node => {
        const modal = node as ReactElement<HTMLAttributes<HTMLDivElement> & { ref: Ref<HTMLDivElement> }>;
        return cloneElement(modal, {
          tabIndex: -1,
          inert,
          "aria-hidden": ariaHidden,
          "aria-labelledby": props["aria-labelledby"] ?? titleId,
          "aria-describedby": "aria-describedby" in props ? props["aria-describedby"] : descriptionId,
          id: props.id,
          onKeyDownCapture: event => {
            onKeyDownCapture?.(event);
            if (!containsEvent(event.target)) return;
            if (event.key === "Escape") {
              const trigger = (event.target as Element).closest('[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]');
              guardedEscape.current = trigger ? event.nativeEvent : null;
            }
            if (event.key === "Tab" && !event.defaultPrevented) {
              const dialog = event.currentTarget;
              const { boundary, next } = tabBoundary(dialog, event.shiftKey);
              if (!next || event.target === dialog || event.target === boundary) {
                event.preventDefault();
                event.stopPropagation();
                (next ?? dialog).focus({ preventScroll: true });
              }
            }
          },
          onKeyDown: event => {
            onKeyDown?.(event);
            if (event.key !== "Escape" || !containsEvent(event.target)) return;
            event.stopPropagation();
            requestCancel(event.nativeEvent);
          },
          ref: element => {
            const modalRef = modal.props.ref;
            if (typeof modalRef === "function") modalRef(element);
            else if (modalRef) modalRef.current = element;
            attachSurface(element);
          },
        });
      }}
      bodyStyle={{ display: "contents" }}
    >
      <div {...props} id={undefined} className={cn(
        "relative min-w-0",
        edge
          ? "flex h-dvh w-[min(100vw,420px)] flex-col gap-4 overflow-y-auto p-6"
          : "grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg gap-4 overflow-y-auto p-6",
        className
      )}>
        <DialogFocus onOpen={event => {
          onOpenAutoFocus?.(event);
          const dialog = surface.current;
          if (!event.defaultPrevented && dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
        }} onClose={event => onCloseAutoFocus?.(event)} />
        {children}
        {showClose ? <Button
          icon={<X size="default" aria-hidden />}
          aria-label="关闭"
          type="tertiary"
          theme="borderless"
          size="small"
          className={styles.close}
          onClick={() => change(false)}
        /> : null}
      </div>
    </Modal>
  );
}

export function DialogContent(props: DialogContentProps) {
  return <DialogSurface {...props} />;
}

export function DrawerContent({ side = "right", ...props }: DialogContentProps & { side?: "left" | "right" }) {
  return <DialogSurface {...props} edge={side} />;
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <header data-slot="dialog-header" className={cn("shrink-0 space-y-1.5 pr-8", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <footer data-slot="dialog-footer" className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement> & { ref?: Ref<HTMLHeadingElement> }) {
  const { titleId } = useWorkspaceDialog();
  return <h2 id={titleId} className={cn(styles.title, className)} {...props} />;
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { descriptionId } = useWorkspaceDialog();
  return <div id={descriptionId} className={cn(styles.description, className)} {...props} />;
}
