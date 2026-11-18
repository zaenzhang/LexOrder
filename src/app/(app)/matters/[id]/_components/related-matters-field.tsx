"use client";

import { FocusButton } from "@/components/patterns/focus-button";
import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPlus as Plus, IconClose as X, IconSearch as Search, IconLoading as Loader2 } from "@douyinfe/semi-icons";
import { Button, Input, Notification, Popover, RadioGroup, Toast } from "@douyinfe/semi-ui";
import {
  searchMattersForLink,
  addMatterLink,
  removeMatterLink
} from "@/server/matters/actions";
import { matterHref } from "@/lib/matters/route";
import { actionErrorMessage } from "@/lib/action-error";

type MatterRef = { id: string; internalCode: string | null; firmCaseNo?: string | null; title: string; relation?: string | null; status?: string };

const RELATION_OPTIONS = [
  { value: "RELATED_CASE", label: "一般关联" },
  { value: "REMAND", label: "发回重审" },
  { value: "DERIVED_ENFORCEMENT", label: "衍生执行" },
  { value: "RELATED_CONTRACT", label: "关联合同" },
  { value: "REFERENCE_ONLY", label: "仅供参考" }
] as const;
const RELATION_LABEL: Record<string, string> = Object.fromEntries(
  RELATION_OPTIONS.map(o => [o.value, o.label])
);

export function RelatedMattersField({
  matterId,
  related,
  canManage
}: {
  matterId: string;
  related: MatterRef[];
  canManage: boolean;
}) {
  const router = useRouter();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const resultsId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MatterRef[]>([]);
  const [searching, startSearch] = useTransition();
  const [pending, startMutate] = useTransition();
  const [relation, setRelation] = useState<string>("RELATED_CASE");

  function runSearch(q: string) {
    setQuery(q);
    startSearch(async () => {
      try {
        setResults(await searchMattersForLink(matterId, q));
      } catch {
        setResults([]);
      }
    });
  }

  function onOpenChange(o: boolean) {
    if (!canManage) return;
    setOpen(o);
    if (o) runSearch("");
  }

  function add(id: string) {
    if (!canManage) return;
    startMutate(async () => {
      try {
        await addMatterLink(matterId, id, relation as "RELATED_CASE");
        Toast.success("已关联");
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
        setQuery("");
        router.refresh();
      } catch (err) {
        Notification.error({ title: "关联失败", content: actionErrorMessage(err) });
      }
    });
  }

  function remove(id: string) {
    if (!canManage) return;
    startMutate(async () => {
      try {
        await removeMatterLink(matterId, id);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "解除失败", content: actionErrorMessage(err) });
      }
    });
  }

  const addButton = canManage ? (
    <span ref={root} className="inline-flex" onKeyDown={event => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    }}>
      <Popover
        trigger="custom"
        visible={open}
        onClickOutSide={() => setOpen(false)}
        getPopupContainer={() => root.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body}
        position="bottomLeft"
        motion={false}
        content={<div id={resultsId} className="w-80 space-y-2 p-2">
        <Input
          autoFocus
          aria-label="搜索关联案件"
          value={query}
          onChange={runSearch}
          placeholder="搜索案件名称 / 所内案号"
          prefix={<Search size="small" aria-hidden />}
        />
        <RadioGroup
          type="button"
          aria-label="关联方式"
          value={relation}
          onChange={event => setRelation(event.target.value)}
          options={[...RELATION_OPTIONS]}
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {searching ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 aria-hidden size="small" spin />
            </div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">无可关联的案件</p>
          ) : (
            results.map((m) => (
              <Button theme="outline" type="tertiary" size="small" contentClassName="flex w-full min-w-0 flex-col items-start gap-1 text-left"
                key={m.id}
                htmlType="button"
                onClick={() => add(m.id)}
                disabled={pending}
                className="flex w-full flex-col rounded-sm border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:border-input hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {m.firmCaseNo ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.firmCaseNo}
                  </span>
                ) : null}
                <span className="truncate">{m.title}</span>
              </Button>
            ))
          )}
        </div>
        </div>}
      >
        <FocusButton theme="borderless" type="tertiary" size="small"
          ref={trigger}
          htmlType="button"
          aria-label="关联案件"
          aria-expanded={open}
          aria-controls={open ? resultsId : undefined}
          onClick={() => onOpenChange(!open)}
        >
          <Plus size="small" aria-hidden />
        </FocusButton>
      </Popover>
    </span>
  ) : null;

  return (
    <div className="flex flex-col items-start gap-1">
      {related.map((m, index) => (
        <span
          key={m.id}
          className="group flex min-w-0 max-w-full items-center gap-1 text-xs"
        >
          <Link
            href={matterHref(m)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
            title={m.firmCaseNo ? `${m.firmCaseNo} ${m.title}` : m.title}
          >
            <span className="max-w-[260px] truncate">{m.title}</span>
          </Link>
          {m.relation && m.relation !== "RELATED_CASE" && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">
              {RELATION_LABEL[m.relation] ?? m.relation}
            </span>
          )}
          {canManage && m.status !== "ARCHIVED" && (
            <Button theme="borderless" type="danger" size="small"
              htmlType="button"
              onClick={() => remove(m.id)}
              disabled={pending}
              className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              title="解除关联"
            >
              <X aria-hidden size="small" />
            </Button>
          )}
          {index === related.length - 1 && addButton}
        </span>
      ))}

      {related.length === 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          暂无关联
          {addButton}
        </span>
      )}
    </div>
  );
}
