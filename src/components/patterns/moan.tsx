/**
 * 墨案跨页面模式（docs/mockup/v4/design-system.css 的 React 形态）。
 * 只承载视觉结构，不含业务判断；色调由 `@/lib/ui/moan-tones` 映射后传入。
 */
import * as React from "react";
import Link from "next/link";
import { IconChevronLeft, IconFile } from "@douyinfe/semi-icons";
import { Avatar, Card, Empty, PageTitle, Tabs, Tag as SemiTag } from "./semi-surfaces";
import { cn } from "@/lib/utils";
import type { AvatarTone, MoanTone } from "@/lib/ui/moan-tones";

/* ---------------- 页头 ---------------- */
export function PageHeader({
  title,
  sub,
  actions,
  back,
  breadcrumb,
  className
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mo-back">
            <IconChevronLeft aria-hidden />
            {back.label}
          </Link>
        ) : null}
        {breadcrumb ? <div className="mb-2 flex items-center gap-2 text-xs text-[var(--semi-color-text-2)]">{breadcrumb}</div> : null}
        <PageTitle heading={1}>{title}</PageTitle>
        {sub ? <div className="mt-1 max-w-[760px] text-sm leading-relaxed text-[var(--semi-color-text-2)]">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------------- 面板 ---------------- */
export function Panel({
  title,
  icon: Icon,
  count,
  extra,
  footer,
  children,
  className,
  bodyClassName,
  flush,
  as: As = "section",
  id
}: {
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  count?: React.ReactNode;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 内容区不加内边距（列表/表格直接贴边） */
  flush?: boolean;
  as?: "section" | "div" | "aside";
  id?: string;
}) {
  return (
    <As id={id} className={className}>
      <Card
        title={title !== undefined || count !== undefined ? (
          <span className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
            <span className="min-w-0 truncate">{title}</span>
            {count != null ? <SemiTag color="grey">{count}</SemiTag> : null}
          </span>
        ) : undefined}
        headerExtraContent={extra}
        bodyStyle={flush ? { padding: 0 } : undefined}
        footer={footer}
      >
        {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
      </Card>
    </As>
  );
}

export function WorkspaceTabs<K extends string>({ items, value, onChange, className }: {
  items: { key: K; label: React.ReactNode; count?: number | null }[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <Tabs
      className={className}
      type="line"
      activeKey={value}
      onChange={key => onChange(key as K)}
      tabList={items.map(({ key, label, count }) => ({
        itemKey: key,
        tab: <span className="inline-flex items-center gap-1.5">{label}{typeof count === "number" && <SemiTag size="small" color="grey">{count}</SemiTag>}</span>,
      }))}
    />
  );
}

/** 风险阶梯：四格递增，level 0–4 */
export function RiskLadder({ level, tone, className, label }: { level: number; tone: MoanTone; className?: string; label?: string }) {
  const lt = tone === "red" || tone === "amber" || tone === "blue" || tone === "green" ? tone : "blue";
  return (
    <span role="img" aria-label={label ?? `风险等级 ${level}/4`} className={cn("ladder", `l-${lt}`, className)}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= level ? "on" : undefined} />
      ))}
    </span>
  );
}

/* ---------------- 头像 ---------------- */
export function InitialAvatar({ name, tone, size = 27, className }: { name?: string | null; tone: AvatarTone; size?: number; className?: string }) {
  const color = ({ teal: "cyan", navy: "blue", violet: "violet", amber: "amber", green: "green", slate: "grey" } as const)[tone];
  return (
    <Avatar color={color} size={size <= 22 ? "extra-extra-small" : "extra-small"} className={className} aria-hidden>
      {(name ?? "?").trim().charAt(0) || "?"}
    </Avatar>
  );
}

/* ---------------- 材料 ---------------- */
export function SourceChip({ kind, children }: { kind: "party" | "court" | "ai" | "self" | "team" | "plain"; children: React.ReactNode }) {
  const color = ({ party: "blue", court: "amber", ai: "violet", self: "teal", team: "teal", plain: "grey" } as const)[kind];
  return <SemiTag size="small" color={color}>{children}</SemiTag>;
}

export function DocIcon({ tone = "red" }: { tone?: "red" | "violet" | "blue" | "slate" }) {
  const color = { red: "var(--semi-color-danger)", violet: "var(--semi-color-secondary)", blue: "var(--semi-color-info)", slate: "var(--semi-color-text-2)" }[tone];
  return (
    <IconFile aria-hidden style={{ color }} />
  );
}

/* ---------------- 空态 ---------------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Empty
      className={cn(compact && "py-4", className)}
      image={Icon ? <Icon className="mx-auto h-6 w-6 text-[var(--semi-color-text-2)]" /> : undefined}
      title={title}
      description={description}
    >
      {action ? <div className="mt-3">{action}</div> : null}
    </Empty>
  );
}

/* ---------------- 字段 ---------------- */
export function FieldGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  return <dl className={cn("mo-field-grid", `mo-field-grid-${cols}`, className)}>{children}</dl>;
}

export function FieldItem({ label, children, wide, grow, mono }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; /** 同一行内占更大比例（内容通常较长的字段） */ grow?: boolean; mono?: boolean }) {
  return (
    <div className={cn("mo-field", wide && "mo-field-wide", grow && "mo-field-grow")}>
      <dt className="mo-field-k">{label}</dt>
      <dd className={cn("mo-field-v", mono && "mono")}>{children ?? <span className="t-faint">—</span>}</dd>
    </div>
  );
}

/* ---------------- 指标卡 ---------------- */
export function MetricCard({
  label,
  value,
  sub,
  trend,
  hot,
  children,
  className
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: { tone: "up" | "warn" | "down" | "info"; text: React.ReactNode } | null;
  hot?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--semi-color-text-2)]">{label}</span>
        {trend ? <SemiTag color={({ up: "green", warn: "amber", down: "red", info: "blue" } as const)[trend.tone]}>{trend.text}</SemiTag> : null}
      </div>
      <div className={cn("mt-2 text-xl font-semibold tabular-nums", hot && "text-[var(--semi-color-danger)]")}>{value}</div>
      {sub ? <div className={cn("mt-1 text-xs", hot ? "text-[var(--semi-color-danger)]" : "text-[var(--semi-color-text-2)]")}>{sub}</div> : null}
      {children}
    </Card>
  );
}
