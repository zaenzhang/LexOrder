"use client";

import { FocusButton } from "@/components/patterns/focus-button";
import { Button, Input, Popover } from "@douyinfe/semi-ui";
import { useState, useEffect, useMemo, useRef, useId, useTransition } from "react";
import { ChevronRight, ChevronsUpDown, Loader2 } from "lucide-react";
import type { MatterCategory, ProcedureType } from "@prisma/client";
import { getCauseById, searchCauses, type CauseSearchResult } from "@/server/causes/actions";
import { causeScopeForSelection } from "@/lib/cause-scope";
import { cn } from "@/lib/utils";

type Node = CauseSearchResult;
type CauseLookup =
  | { id: string; status: "found"; name: string }
  | { id: string; status: "missing" | "error" };

type Props = {
  value: string;
  onChange: (id: string, name: string) => void;
  category: MatterCategory;
  procedureType?: ProcedureType | null;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
};

/**
 * 案由级联选择器
 * - 一次性拉本 category 全部案由
 * - 去掉一级，从二级起级联：二级 / 三级 / 四级，渐进展开（选了上一级才出现下一列）
 * - 单击即选：有子级 → 展开下一列；无子级（叶子）→ 直接选中。两次点击可选到常见三级案由。
 * - 列宽收窄，弹层随列数增长，避免一打开就铺满整页
 * - 名称过长截断，hover 显示全名
 */
export function CauseCombobox({
  value,
  onChange,
  category,
  procedureType,
  disabled,
  placeholder = "点击选择",
  triggerClassName
}: Props) {
  const popupId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [isPending, startTransition] = useTransition();
  const [lookup, setLookup] = useState<CauseLookup | null>(null);
  const listedName = allNodes.find((node) => node.id === value)?.name;
  const currentLookup = lookup?.id === value ? lookup : null;
  const displayName = listedName ?? (currentLookup?.status === "found" ? currentLookup.name : null);
  const displayText = !value ? placeholder : displayName ?? (
    currentLookup?.status === "missing" ? "未找到已选案由"
      : currentLookup?.status === "error" ? "案由名称加载失败"
        : "案由名称加载中…"
  );

  const [pickedL2, setPickedL2] = useState<string | null>(null);
  const [pickedL3, setPickedL3] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState<string>("");

  const causeScopeKey = useMemo(() => {
    const scope = causeScopeForSelection(category, procedureType);
    return [
      scope.dbCategory,
      scope.includeCodePrefixes?.join(",") ?? "*",
      scope.excludeCodePrefixes.join(",")
    ].join("|");
  }, [category, procedureType]);
  const previousCauseScopeKey = useRef(causeScopeKey);

  // 打开时拉全量
  function handleOpen(o: boolean) {
    setOpen(o);
    if (o && allNodes.length === 0) {
      startTransition(async () => {
        const data = await searchCauses({ category, procedureType, limit: 2000 });
        setAllNodes(data);
      });
    }
    if (o) {
      // 重置 picked 状态（避免上次残留）
      setPickedL2(null);
      setPickedL3(null);
      setSearchInput("");
    }
  }

  // 仅在案由可选范围真正变化时重置。
  // 一审切二审等审级调整共用同一案由范围，不应误清空用户已经选好的案由。
  useEffect(() => {
    if (previousCauseScopeKey.current === causeScopeKey) return;
    previousCauseScopeKey.current = causeScopeKey;
    setAllNodes([]);
    if (value) {
      onChange("", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [causeScopeKey]);

  // 已有 ID 按需读取名称，打开选择器之前不加载整个案由库。
  useEffect(() => {
    if (!value || listedName) return;
    let active = true;
    void getCauseById(value).then((cause) => {
      if (active) setLookup(cause
        ? { id: value, status: "found", name: cause.name }
        : { id: value, status: "missing" });
    }).catch(() => {
      if (active) setLookup({ id: value, status: "error" });
    });
    return () => { active = false; };
  }, [value, listedName]);

  // 去掉一级：二级直接平铺为第一列
  const l2Nodes = useMemo(() => allNodes.filter((n) => n.level === 2), [allNodes]);
  const l3Nodes = useMemo(
    () => (pickedL2 ? allNodes.filter((n) => n.level === 3 && n.parentId === pickedL2) : []),
    [allNodes, pickedL2]
  );
  const l4Nodes = useMemo(
    () => (pickedL3 ? allNodes.filter((n) => n.level === 4 && n.parentId === pickedL3) : []),
    [allNodes, pickedL3]
  );

  // 搜索过滤（跨级模糊）
  const searchMatched = useMemo(() => {
    const q = searchInput.trim();
    if (!q) return null;
    const lower = q.toLowerCase();
    return allNodes
      .filter((n) => n.level >= 3 && n.name.toLowerCase().includes(lower))
      .slice(0, 60);
  }, [allNodes, searchInput]);

  const parents = useMemo(() => new Set(allNodes.map(node => node.parentId)), [allNodes]);
  const hasChildren = (node: Node) => parents.has(node.id);

  function closeToTrigger() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  // 选用一个案由：任意层级都可直接选中。
  // 有子级 → 选中并展开下一列（可继续下钻，也可就此停下）；叶子 → 选中并关闭。
  function selectNode(node: Node, level: number) {
    onChange(node.id, node.name);
    if (hasChildren(node)) {
      if (level === 2) {
        setPickedL2(node.id);
        setPickedL3(null);
      } else if (level === 3) {
        setPickedL3(node.id);
      }
    } else {
      closeToTrigger();
    }
  }

  // 搜索结果直接选中并关闭
  function pickNode(node: Node) {
    onChange(node.id, node.name);
    closeToTrigger();
  }

  return (
    <div ref={root} onKeyDown={event => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        closeToTrigger();
      }
    }}>
      <Popover
        trigger="custom"
        visible={open}
        onClickOutSide={() => setOpen(false)}
        getPopupContainer={() => root.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body}
        position="bottomLeft"
        motion={false}
        rePosKey={String(pickedL2) + String(pickedL3)}
        content={<div id={popupId} role="dialog" aria-label="选择案由" className="w-auto max-w-[92vw]">
        {/* 搜索栏 */}
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            aria-label="搜索案由"
            placeholder="搜索案由，或下方逐级浏览"
            value={searchInput}
            onChange={setSearchInput}
            showClear
            className="w-64"
          />
        </div>

        {isPending ? (
          <div className="flex w-[240px] items-center justify-center py-10 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="ml-2">加载案由库...</span>
          </div>
        ) : searchMatched ? (
          // 搜索模式：扁平结果带路径
          <div className="max-h-[360px] w-[320px] overflow-y-auto p-1">
            {searchMatched.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">未找到匹配</p>
            ) : (
              searchMatched.map((n) => (
                <Button theme="borderless" type="tertiary" size="small" contentClassName="flex w-full min-w-0 items-center justify-between gap-2"
                  key={n.id}
                  htmlType="button"
                  onClick={() => pickNode(n)}
                  title={n.name}
                  className="flex min-h-8 w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="truncate">{n.name}</span>
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">
                    {n.l2Name ?? ""}
                  </span>
                </Button>
              ))
            )}
          </div>
        ) : (
          // 级联模式：渐进展开（选了上一级才出现下一列）
          // 单击任意层级即选中；有子级则同时展开下一列，可继续下钻或就此停下
          <div className="flex divide-x divide-border">
            <Column
              title="二级"
              items={l2Nodes}
              activeId={pickedL2}
              hasChildren={hasChildren}
              onPick={(n) => selectNode(n, 2)}
            />
            {pickedL2 && (
              <Column
                title="三级"
                items={l3Nodes}
                activeId={pickedL3}
                empty="该二级下无三级"
                hasChildren={hasChildren}
                onPick={(n) => selectNode(n, 3)}
              />
            )}
            {pickedL3 && l4Nodes.length > 0 && (
              <Column
                title="四级"
                items={l4Nodes}
                activeId={null}
                hasChildren={() => false}
                onPick={(n) => selectNode(n, 4)}
              />
            )}
          </div>
        )}
        </div>}
      >
        <FocusButton theme="borderless" type="tertiary" size="small"
          ref={trigger}
          htmlType="button"
          disabled={disabled}
          aria-expanded={open}
          role="combobox"
          aria-label="案由"
          aria-controls={popupId}
          aria-haspopup="dialog"
          className={cn("flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--semi-color-border)] bg-[var(--semi-color-fill-0)] px-3 text-left text-sm hover:bg-[var(--semi-color-fill-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--semi-color-primary)] disabled:opacity-50", triggerClassName)}
          onClick={() => handleOpen(!open)}
          onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); handleOpen(true); } }}
        >
          <span className={cn("truncate", !(value && displayName) && "text-muted-foreground")}>{displayText}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </FocusButton>
      </Popover>
    </div>
  );
}

function Column({
  title,
  items,
  activeId,
  empty = "—",
  hasChildren,
  onPick
}: {
  title: string;
  items: Node[];
  activeId: string | null;
  empty?: string;
  hasChildren: (n: Node) => boolean;
  onPick: (n: Node) => void;
}) {
  return (
    <div className="flex max-h-[360px] w-[176px] flex-col">
      <div className="border-b border-border bg-muted/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground/60">{empty}</p>
        ) : (
          items.map((n) => {
            const branching = hasChildren(n);
            const isActive = activeId === n.id;
            return (
              <Button theme="borderless" type="primary" size="small" contentClassName="flex w-full min-w-0 items-center justify-between gap-2"
                key={n.id}
                htmlType="button"
                onClick={() => onPick(n)}
                title={n.name}
                className={cn(
                  "flex min-h-8 w-full items-center justify-between gap-1 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors",
                  isActive ? "bg-accent text-primary" : "hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="truncate">{n.name}</span>
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 text-muted-foreground/50",
                    isActive && "text-primary",
                    !branching && "invisible"
                  )}
                />
              </Button>
            );
          })
        )}
      </div>
    </div>
  );
}
