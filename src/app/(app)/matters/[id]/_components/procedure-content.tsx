"use client";

import { DeadlineDueFields } from "@/components/matters/deadline-due-fields";
import { deadlineDueDraft, deadlineDueFromDraft, formatDeadlineDue, deadlineOverdue, deadlineRelative, type DeadlineDuePrecision } from "@/lib/deadline-due";

import { useId, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  AlertTriangle,
  Plus,
  Gavel,
  Check,
  Trash2,
  Loader2,
  StickyNote,
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  ScanLine,
  ScanText
} from "lucide-react";
import type {
  Deadline,
  Hearing,
  MatterStage,
  MatterProcedure,
  ProcedureMemo
} from "@prisma/client";
import {
  WorkspaceDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/patterns/workspace-dialog";
import { Select, Button, Input, Notification, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { deadlineCategoryLabel } from "@/lib/enums";
import { confirmDeadline, adjustDeadline } from "@/server/deadlines/confirm";
import { cn, daysUntil, formatDate } from "@/lib/utils";
import { procedureTypeLabel } from "@/lib/enums";
import {
  addDeadline,
  addHearing,
  toggleDeadlineCompleted,
  deleteDeadline,
  deleteHearing,
  addProcedureMemo,
  deleteProcedureMemo
} from "@/server/procedures/actions";
import type { DeadlineCreateInput } from "@/server/procedures/schemas";
import { createExpress, deleteExpress } from "@/server/express/actions";
import { parseExpressLabel } from "@/server/ai/parse-express";
import { parseSummons } from "@/server/ai/parse-summons";
import type { ExpressItem } from "./info-extras";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { shDayKey, shMonthDayTime, shTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type ProcedureWithChildren = MatterProcedure & {
  deadlines: Deadline[];
  hearings: Hearing[];
  stages: MatterStage[];
  memos: ProcedureMemo[];
};

// 聚合后带程序标签的行类型
type HearingRowItem = Hearing & { procLabel: string };
type DeadlineRowItem = Deadline & { procLabel: string };

type MemoRowItem = ProcedureMemo & { procLabel: string };
export type ImportantCategory = "hearing" | "deadline" | "express" | "memo";
type ImportantFilter = "all" | ImportantCategory;
type AllImportantItem =
  | { id: string; type: "hearing"; sortAt: Date; item: HearingRowItem }
  | { id: string; type: "deadline"; sortAt: Date; item: DeadlineRowItem }
  | { id: string; type: "express"; sortAt: Date; item: ExpressItem }
  | { id: string; type: "memo"; sortAt: Date; item: MemoRowItem };

const procLabelOf = (p: MatterProcedure) =>
  p.customLabel ?? procedureTypeLabel[p.type];

/**
 * v0.46：「重要事项」全案聚合（开庭安排 + 重要时限 + 快递记录 + 其他备忘）。
 */
export function ProcedureRemindersAndMemos({
  matterId,
  procedures,
  currentProcedureId,
  expresses,
  canManage,
  kinds
}: {
  matterId: string;
  procedures: ProcedureWithChildren[];
  currentProcedureId: string;
  expresses: ExpressItem[];
  canManage: boolean;
  /** 只展示部分类别（案卷工作台「办案进程」只放快递与备忘，期限与开庭在待办 / 经办记录） */
  kinds?: ImportantCategory[];
}) {
  const allow = (k: ImportantCategory) => !kinds || kinds.includes(k);
  const multiProc = procedures.length > 1;
  const procOptions = procedures.map((p) => ({ id: p.id, label: procLabelOf(p) }));

  const hearings: HearingRowItem[] = !allow("hearing") ? [] : procedures.flatMap((p) =>
    p.hearings.map((h) => ({ ...h, procLabel: procLabelOf(p) }))
  );
  const deadlines: DeadlineRowItem[] = !allow("deadline") ? [] : procedures.flatMap((p) =>
    p.deadlines.map((d) => ({ ...d, procLabel: procLabelOf(p) }))
  );
  const memos: MemoRowItem[] = !allow("memo") ? [] : procedures
    .flatMap((p) => p.memos.map((m) => ({ ...m, procLabel: procLabelOf(p) })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ImportantItemsCard
      matterId={matterId}
      deadlines={deadlines}
      hearings={hearings}
      expresses={allow("express") ? expresses : []}
      memos={memos}
      kinds={kinds}
      procedures={procOptions}
      defaultProcedureId={currentProcedureId}
      hearingCounts={Object.fromEntries(procedures.map((p) => [p.id, p.hearings.length]))}
      proceduresDetail={Object.fromEntries(
        procedures.map((p) => [
          p.id,
          { handlingAgency: p.handlingAgency, panel: p.panel, jurisdiction: p.jurisdiction }
        ])
      )}
      multiProc={multiProc}
      canManage={canManage}
    />
  );
}

// ============ 重要事项（四类统一展示）============

function ImportantItemsCard({
  matterId,
  deadlines,
  hearings,
  expresses,
  memos,
  procedures,
  defaultProcedureId,
  hearingCounts,
  proceduresDetail,
  multiProc,
  canManage,
  kinds
}: {
  kinds?: ImportantCategory[];
  matterId: string;
  deadlines: DeadlineRowItem[];
  hearings: HearingRowItem[];
  expresses: ExpressItem[];
  memos: MemoRowItem[];
  procedures: { id: string; label: string }[];
  defaultProcedureId: string;
  hearingCounts: Record<string, number>;
  proceduresDetail: Record<string, { handlingAgency?: string | null; panel?: string | null; jurisdiction?: string | null }>;
  multiProc: boolean;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ImportantFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<ImportantCategory>("hearing");
  const [adjusting, setAdjusting] = useState<DeadlineRowItem | null>(null);

  function handleToggle(id: string) {
    startTransition(async () => {
      try {
        await toggleDeadlineCompleted(id);
      } catch {
        Toast.error("操作失败");
      }
    });
  }

  async function handleDeleteDeadline(id: string) {
    if (!(await confirmDialog({ title: "删除这条期限？", description: "删除后不再提醒，操作记入审计。", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteDeadline(id);
        Toast.success("已删除");
      } catch {
        Toast.error("删除失败");
      }
    });
  }

  // v1.x P0-8: 待确认期限的确认（起算事实与规则结果就此固定）
  function handleConfirmDeadline(deadline: DeadlineRowItem) {
    startTransition(async () => {
      try {
        await confirmDeadline({ id: deadline.id, expectedUpdatedAt: deadline.updatedAt });
        Toast.success("期限已确认");
      } catch (err) {
        Notification.error({ title: "确认失败", content: actionErrorMessage(err) });
      }
    });
  }

  // v1.x P0-8: 人工调整到期日（写已调整 + 留痕；规则重算不再覆盖）
  function handleAdjustDeadline(d: DeadlineRowItem) {
    setAdjusting(d);
  }

  async function handleDeleteHearing(id: string) {
    if (!(await confirmDialog({ title: "删除这条开庭记录？", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteHearing(id);
        Toast.success("已删除");
      } catch {
        Toast.error("删除失败");
      }
    });
  }

  async function handleDeleteExpress(id: string) {
    if (!(await confirmDialog({ title: "删除这条快递记录？", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteExpress({ id });
        Toast.success("已删除");
      } catch {
        Toast.error("删除失败");
      }
    });
  }

  function handleDeleteMemo(id: string) {
    startTransition(async () => {
      try {
        await deleteProcedureMemo(id);
      } catch {
        Toast.error("删除失败");
      }
    });
  }

  const total = hearings.length + deadlines.length + expresses.length + memos.length;
  const allItems = buildAllImportantItems({ hearings, deadlines, expresses, memos });
  const filters: { value: ImportantFilter; label: string; count: number }[] = ([
    { value: "all", label: "全部", count: total },
    { value: "hearing", label: "开庭", count: hearings.length },
    { value: "deadline", label: "期限", count: deadlines.length },
    { value: "express", label: "快递", count: expresses.length },
    { value: "memo", label: "备忘", count: memos.length }
  ] as { value: ImportantFilter; label: string; count: number }[]).filter((f) => f.value === "all" || !kinds || kinds.includes(f.value as ImportantCategory));

  const currentCount = filters.find((f) => f.value === filter)?.count ?? 0;
  const currentLabel = filters.find((f) => f.value === filter)?.label ?? "重要事项";

  function openAddDialog() {
    setAddType(filter === "all" ? (kinds?.[0] ?? "hearing") : filter);
    setAddOpen(true);
  }

  return (
    <section className="flex max-h-[460px] min-h-[160px] flex-col card">
      <header className="panel-head shrink-0 flex-wrap">
        <span className="panel-title">
          <AlertTriangle className="ic" />
          {kinds ? kinds.map((k) => ({ hearing: "开庭", deadline: "期限", express: "快递", memo: "备忘" })[k]).join("与") : "期限、开庭与备忘"}
          <span className="mo-count">{total}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {/* 分类分段 */}
          <div className="segmented" role="tablist">
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn("seg", filter === f.value && "active")}
              >
                {f.label}
                <span className="count">{f.count}</span>
              </button>
            ))}
          </div>
          {canManage && (
            <button type="button" onClick={openAddDialog} className="btn btn-secondary btn-sm">
              <Plus />
              添加
            </button>
          )}
        </div>
      </header>

      {currentCount === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-6 text-center text-xs text-muted-foreground">
          暂无{currentLabel}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-4 py-2">
          {filter === "hearing" &&
            hearings.map((h) => (
              <HearingRow
                key={h.id}
                h={h}
                multiProc={multiProc}
                onDelete={() => handleDeleteHearing(h.id)}
                canManage={canManage}
              />
            ))}
          {filter === "all" &&
            allItems.map((entry) => (
              <AllImportantRow
                key={`${entry.type}-${entry.id}`}
                entry={entry}
                multiProc={multiProc}
                onToggle={
                  entry.type === "deadline"
                    ? () => handleToggle(entry.item.id)
                    : undefined
                }
                onConfirm={
                  entry.type === "deadline"
                    ? () => handleConfirmDeadline(entry.item)
                    : undefined
                }
                onAdjust={
                  entry.type === "deadline"
                    ? () => handleAdjustDeadline(entry.item)
                    : undefined
                }
                onDelete={() => {
                  if (entry.type === "hearing") handleDeleteHearing(entry.item.id);
                  if (entry.type === "deadline") handleDeleteDeadline(entry.item.id);
                  if (entry.type === "express") handleDeleteExpress(entry.item.id);
                  if (entry.type === "memo") handleDeleteMemo(entry.item.id);
                }}
                pending={isPending}
                canManage={canManage}
              />
            ))}
          {filter === "deadline" &&
            deadlines.map((d) => (
              <DeadlineRow
                key={d.id}
                d={d}
                multiProc={multiProc}
                onToggle={() => handleToggle(d.id)}
                onDelete={() => handleDeleteDeadline(d.id)}
                onConfirm={() => handleConfirmDeadline(d)}
                onAdjust={() => handleAdjustDeadline(d)}
                pending={isPending}
                canManage={canManage}
              />
            ))}
          {filter === "express" &&
            expresses.map((e) => (
              <ExpressRow
                key={e.id}
                item={e}
                onDelete={() => handleDeleteExpress(e.id)}
                canManage={canManage}
              />
            ))}
          {filter === "memo" &&
            memos.map((m) => (
              <MemoRow
                key={m.id}
                memo={m}
                multiProc={multiProc}
                onDelete={() => handleDeleteMemo(m.id)}
                canManage={canManage}
              />
            ))}
        </ul>
      )}

      {canManage && (
        <ImportantItemDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          matterId={matterId}
          defaultType={addType}
          procedures={procedures}
          defaultProcedureId={defaultProcedureId}
          hearingCounts={hearingCounts}
          proceduresDetail={proceduresDetail}
        />
      )}
      {adjusting ? <AdjustDeadlineDialog deadline={adjusting} onClose={() => setAdjusting(null)} /> : null}
    </section>
  );
}

/** v1.x P0-8: 人工调整到期日（写已调整 + 留痕；规则重算不再覆盖）——日期控件 + 必填原因 */
export function AdjustDeadlineDialog({ deadline, onClose }: { deadline: { id: string; title: string; dueAt: Date; duePrecision: DeadlineDuePrecision | null; updatedAt: Date }; onClose: () => void }) {
  const [dueDraft, setDueDraft] = useState(() => deadlineDueDraft(deadline));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!reason.trim()) return setError("请填写调整原因（将记入审计）");
    setError(null);
    startTransition(async () => {
      try {
        await adjustDeadline({ id: deadline.id, expectedUpdatedAt: deadline.updatedAt, ...deadlineDueFromDraft(dueDraft, deadline), reason: reason.trim() });
        Toast.success("期限已调整");
        onClose();
      } catch (err) {
        setError(err instanceof Error ? actionErrorMessage(err) : "调整失败");
      }
    });
  }

  return (
    <WorkspaceDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>调整到期日</DialogTitle>
          <DialogDescription>「{deadline.title}」原期限 {formatDeadlineDue(deadline.dueAt, deadline.duePrecision)}。人工调整后标记为「已调整」，规则重算不再覆盖。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <DeadlineDueFields value={dueDraft} onChange={setDueDraft} original={deadline} disabled={pending} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--semi-color-text-1)]">调整原因 *</label>
            <TextArea rows={3} disabled={pending} value={reason} maxLength={300} onChange={inputValue => setReason(inputValue)} placeholder="如：法院通知书载明举证期限延长至…" />
          </div>
          {error ? <div className="text-[12px] text-[var(--red)]">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose} disabled={pending} type="primary" theme="light">取消</Button>
          <Button onClick={submit} disabled={pending} theme="solid">保存调整</Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}

function buildAllImportantItems({
  hearings,
  deadlines,
  expresses,
  memos
}: {
  hearings: HearingRowItem[];
  deadlines: DeadlineRowItem[];
  expresses: ExpressItem[];
  memos: MemoRowItem[];
}) {
  const now = Date.now();
  const items: AllImportantItem[] = [
    ...deadlines.map((item) => ({
      id: item.id,
      type: "deadline" as const,
      sortAt: item.dueAt,
      item
    })),
    ...hearings.map((item) => ({
      id: item.id,
      type: "hearing" as const,
      sortAt: item.startsAt,
      item
    })),
    ...expresses.map((item) => ({
      id: item.id,
      type: "express" as const,
      sortAt: item.lastUpdateAt ?? item.createdAt,
      item
    })),
    ...memos.map((item) => ({
      id: item.id,
      type: "memo" as const,
      sortAt: item.createdAt,
      item
    }))
  ];

  return items.sort((a, b) => {
    const aTime = new Date(a.sortAt).getTime();
    const bTime = new Date(b.sortAt).getTime();
    const aUpcoming =
      (a.type === "deadline" && !a.item.completed) ||
      (a.type === "hearing" && aTime >= now);
    const bUpcoming =
      (b.type === "deadline" && !b.item.completed) ||
      (b.type === "hearing" && bTime >= now);

    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    if (aUpcoming && bUpcoming) return aTime - bTime;
    return bTime - aTime;
  });
}

function AllImportantRow({
  entry,
  multiProc,
  onToggle,
  onDelete,
  onConfirm,
  onAdjust,
  pending,
  canManage
}: {
  entry: AllImportantItem;
  multiProc: boolean;
  onToggle?: () => void;
  onDelete: () => void;
  onConfirm?: () => void;
  onAdjust?: () => void;
  pending: boolean;
  canManage: boolean;
}) {
  if (entry.type === "hearing") {
    return (
      <HearingRow
        h={entry.item}
        multiProc={multiProc}
        onDelete={onDelete}
        canManage={canManage}
      />
    );
  }
  if (entry.type === "deadline") {
    return (
      <DeadlineRow
        d={entry.item}
        multiProc={multiProc}
        onToggle={onToggle ?? (() => {})}
        onDelete={onDelete}
        onConfirm={onConfirm ?? (() => {})}
        onAdjust={onAdjust ?? (() => {})}
        pending={pending}
        canManage={canManage}
      />
    );
  }
  if (entry.type === "express") {
    return (
      <ExpressRow
        item={entry.item}
        onDelete={onDelete}
        canManage={canManage}
      />
    );
  }
  return (
    <MemoRow
      memo={entry.item}
      multiProc={multiProc}
      onDelete={onDelete}
      canManage={canManage}
    />
  );
}

// 程序标签小徽章（仅多程序时显示，标明该条属于哪个程序）
function ProcTag({ label }: { label: string }) {
  return (
    <Tag
      className="shrink-0 border-border bg-muted/40 px-1 text-[9px] font-normal text-muted-foreground"
      color="grey"
      type="ghost"
    >
      {label}
    </Tag>
  );
}

function DeadlineRow({
  d,
  multiProc,
  onToggle,
  onDelete,
  onConfirm,
  onAdjust,
  pending,
  canManage
}: {
  d: DeadlineRowItem;
  multiProc: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  onAdjust: () => void;
  pending: boolean;
  canManage: boolean;
}) {
  const days = daysUntil(d.dueAt);
  const isOverdue = !d.completed && deadlineOverdue(d.dueAt, d.duePrecision);
  const isWarn = !d.completed && days <= d.remindDays && days >= 0;
  return (
    <li
      className={cn(
        "group flex items-center gap-3 py-2 text-xs transition-colors",
        d.completed && "opacity-50"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={pending || !canManage}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          d.completed
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-primary"
        )}
        aria-label={d.completed ? "标记未完成" : "标记完成"}
      >
        {d.completed && <Check className="h-2.5 w-2.5" />}
      </button>

      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[12.5px] font-medium",
              d.completed && "line-through text-muted-foreground"
            )}
          >
            {d.title}
          </span>
          <Tag className="h-5 shrink-0 px-1.5 text-[9px]" color="grey" type="ghost">
            {deadlineCategoryLabel[d.category]}
          </Tag>
          {d.confirmStatus === "PENDING" && (
            <Tag className="h-5 shrink-0 bg-[var(--amber-bg)] px-1.5 text-[9px] text-[var(--amber)] hover:bg-[var(--amber-bg)]" color="teal">
              待确认
            </Tag>
          )}
          {d.confirmStatus === "ADJUSTED" && (
            <Tag className="h-5 shrink-0 border-[var(--blue-line)] px-1.5 text-[9px] text-[var(--blue)]" color="grey" type="ghost">
              已调整
            </Tag>
          )}
          {multiProc && <ProcTag label={d.procLabel} />}
        </div>
        {d.startFact && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">起算：{d.startFact}</div>
        )}
        {d.basis && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{d.basis}</div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 text-right">
        <div className="font-mono text-xs tabular">
          {d.completed ? (
            "已完成"
          ) : isOverdue ? (
            <span className="text-destructive">{deadlineRelative(d.dueAt, d.duePrecision)}</span>
          ) : days === 0 ? (
            <span className="text-[var(--amber)]">今天</span>
          ) : isWarn ? (
            <span className="text-[var(--amber)]">{days}d</span>
          ) : (
            <span>{days}d</span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground tabular">
          {formatDeadlineDue(d.dueAt, d.duePrecision)}
        </div>
      </div>

      {canManage && !d.completed && (
        <div className="flex shrink-0 items-center gap-1">
          {d.confirmStatus === "PENDING" && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="rounded border border-[var(--amber-line)] px-1.5 py-0.5 text-[10px] text-[var(--amber)] hover:bg-[var(--amber-bg)]"
              title="核对起算事实后确认该期限"
            >
              确认
            </button>
          )}
          <button
            type="button"
            onClick={onAdjust}
            disabled={pending}
            className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
            title="调整到期日（记录原因，规则重算不再覆盖）"
          >
            调整
          </button>
        </div>
      )}

      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </li>
  );
}

function HearingRow({
  h,
  multiProc,
  onDelete,
  canManage
}: {
  h: HearingRowItem;
  multiProc: boolean;
  onDelete: () => void;
  canManage: boolean;
}) {
  const upcoming = new Date(h.startsAt) > new Date();
  return (
    <li className="group flex items-center gap-3 py-2 text-xs">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Calendar className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">{h.title}</span>
          {multiProc && <ProcTag label={h.procLabel} />}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {h.room || h.address || h.judge
            ? [h.room, h.address, h.judge].filter(Boolean).join(" · ")
            : "未填写法庭信息"}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <Tag className="h-5 px-1.5 text-[9px]" color="grey" type="ghost">
          {upcoming ? "未召开" : "已召开"}
        </Tag>
        <span className="font-mono text-[10px] tabular text-muted-foreground">
          {shMonthDayTime(h.startsAt)}
        </span>
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </li>
  );
}

function ExpressRow({
  item,
  onDelete,
  canManage
}: {
  item: ExpressItem;
  onDelete: () => void;
  canManage: boolean;
}) {
  const isOutbound = item.direction === "OUTBOUND";
  return (
    <li className="group flex items-center gap-3 py-2 text-xs">
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          isOutbound
            ? "bg-[var(--amber-bg)] text-[var(--amber)]"
            : "bg-[var(--green-bg)] text-[var(--green)]"
        )}
      >
        {isOutbound ? (
          <ArrowUpFromLine className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">{item.purpose}</span>
          <Tag className="h-5 shrink-0 px-1.5 text-[9px]" color="grey" type="ghost">
            {isOutbound ? "寄出" : "收件"}
          </Tag>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] tabular text-muted-foreground">
          {item.companyCode ?? "待识别"} · {item.trackingNo}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <div className="max-w-[96px] truncate text-[11px] text-foreground/80">
          {item.lastState ?? "待跟踪"}
        </div>
        <div className="font-mono text-[10px] tabular text-muted-foreground">
          {item.lastUpdateAt
            ? formatDate(new Date(item.lastUpdateAt))
            : formatDate(new Date(item.createdAt))}
        </div>
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </li>
  );
}

function MemoRow({
  memo,
  multiProc,
  onDelete,
  canManage
}: {
  memo: MemoRowItem;
  multiProc: boolean;
  onDelete: () => void;
  canManage: boolean;
}) {
  return (
    <li className="group flex items-start gap-3 py-2 text-xs">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <StickyNote className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
          {memo.content}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {multiProc && <ProcTag label={memo.procLabel} />}
          <span className="font-mono tabular">
            {formatDate(new Date(memo.createdAt))}
          </span>
        </div>
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </li>
  );
}

// ============ 统一添加重要事项 ============

const importantTypeMeta: Record<ImportantCategory, { label: string; icon: React.ElementType }> = {
  hearing: { label: "开庭", icon: Gavel },
  deadline: { label: "期限", icon: AlertTriangle },
  express: { label: "快递", icon: Package },
  memo: { label: "备忘", icon: StickyNote }
};

const CN_NUM: Record<number, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "七",
  8: "八",
  9: "九",
  10: "十"
};

/** 输入框值是上海墙钟；默认「现在的上海日期/时刻」，解析统一按 +08:00 固定偏移 */
function toDateTimeInput(date = new Date()) {
  return `${shDayKey(date)}T${shTime(date)}`;
}

export function ImportantItemDialog({
  open,
  onOpenChange,
  matterId,
  defaultType,
  procedures,
  defaultProcedureId,
  hearingCounts,
  proceduresDetail,
  types = ["hearing", "deadline", "express"]
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  defaultType: ImportantCategory;
  /** 可选分类；默认不含「备忘」（2026-09-15 起备忘不再新增，等同无截止日的任务） */
  types?: ImportantCategory[];
  procedures: { id: string; label: string }[];
  defaultProcedureId: string;
  hearingCounts: Record<string, number>;
  proceduresDetail: Record<string, { handlingAgency?: string | null; panel?: string | null; jurisdiction?: string | null }>;
}) {
  const selectLabelId = useId();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [summonsPending, startSummons] = useTransition();
  const [expressOcrPending, startExpressOcr] = useTransition();
  const summonsRef = useRef<HTMLInputElement>(null);
  const expressRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ImportantCategory>(defaultType);
  const [hearingProcedureId, setHearingProcedureId] = useState(defaultProcedureId);
  const [hearingTitle, setHearingTitle] = useState("");
  const [hearingStartsAt, setHearingStartsAt] = useState(toDateTimeInput());
  const [hearingRoom, setHearingRoom] = useState("");
  const [hearingAddress, setHearingAddress] = useState("");
  const [hearingJudge, setHearingJudge] = useState("");
  const [hearingContact, setHearingContact] = useState("");
  const [hearingNotes, setHearingNotes] = useState("");

  const [deadlineProcedureId, setDeadlineProcedureId] = useState(defaultProcedureId);
  const [deadlineTitle, setDeadlineTitle] = useState("");
  const [deadlineCategory, setDeadlineCategory] =
    useState<DeadlineCreateInput["category"]>("CUSTOM");
  const [deadlineDue, setDeadlineDue] = useState(() => deadlineDueDraft());
  const [deadlineBasis, setDeadlineBasis] = useState("");
  const [deadlineRemindDays, setDeadlineRemindDays] = useState(3);

  const [trackingNo, setTrackingNo] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [purpose, setPurpose] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  const [memoProcedureId, setMemoProcedureId] = useState(defaultProcedureId);
  const [memoContent, setMemoContent] = useState("");

  useEffect(() => {
    if (!open) return;
    const procId = defaultProcedureId || procedures[0]?.id || "";
    const proc = procedures.find((p) => p.id === procId);
    const count = (hearingCounts[procId] ?? 0) + 1;
    const numStr = CN_NUM[count] ?? String(count);
    setType(defaultType);
    setHearingProcedureId(procId);
    setHearingTitle(proc ? `${proc.label}第${numStr}次开庭` : "");
    setHearingStartsAt(toDateTimeInput());
    setHearingRoom("");
    setHearingAddress("");
    setHearingJudge("");
    setHearingContact("");
    setHearingNotes("");
    setDeadlineProcedureId(procId);
    setDeadlineTitle("");
    setDeadlineCategory("CUSTOM");
    setDeadlineDue(deadlineDueDraft());
    setDeadlineBasis("");
    setDeadlineRemindDays(3);
    setTrackingNo("");
    setCompanyCode("");
    setDirection("OUTBOUND");
    setPurpose("");
    setRecipient("");
    setRecipientPhone("");
    setMemoProcedureId(procId);
    setMemoContent("");
    if (summonsRef.current) summonsRef.current.value = "";
    if (expressRef.current) expressRef.current.value = "";
  }, [open, defaultType, defaultProcedureId, procedures, hearingCounts]);

  function autoHearingTitle(procId: string) {
    const proc = procedures.find((p) => p.id === procId);
    if (!proc) return;
    const count = (hearingCounts[procId] ?? 0) + 1;
    const numStr = CN_NUM[count] ?? String(count);
    setHearingTitle(`${proc.label}第${numStr}次开庭`);
  }

  function handleSummonsUpload(file: File) {
    startSummons(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const result = await parseSummons(fd);
        if (result.hearingDate && result.hearingTime) {
          setHearingStartsAt(`${result.hearingDate}T${result.hearingTime}`);
        } else if (result.hearingDate) {
          setHearingStartsAt("");
          Toast.warning(`已识别开庭日期 ${result.hearingDate}，具体时刻未识别，请手动填写`);
        }
        if (result.courtRoom) setHearingRoom(result.courtRoom);
        if (result.judge) setHearingJudge(result.judge);
        if (result.caseNumber || result.parties) {
          const parts: string[] = [];
          if (result.caseNumber) parts.push(`案号：${result.caseNumber}`);
          if (result.parties?.length) parts.push(`当事人：${result.parties.join("、")}`);
          setHearingNotes(parts.join("\n"));
        }
        Toast.success(result.pageLimit ? "已识别传票首页，请核对信息；其他页未处理" : "传票识别完成，请核对信息");
      } catch (err) {
        Notification.error({ title: "传票识别失败", content: err instanceof Error ? actionErrorMessage(err) : "请手动填写" });
      } finally {
        if (summonsRef.current) summonsRef.current.value = "";
      }
    });
  }

  function handleExpressOcr(file: File) {
    startExpressOcr(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const result = await parseExpressLabel(fd);
        if (result.trackingNo) {
          setTrackingNo(result.trackingNo);
          Toast.success(`已识别单号：${result.trackingNo}`);
        } else {
          Toast.warning("未识别到单号，请手动输入");
        }
        if (result.companyCode) setCompanyCode(result.companyCode);
      } catch (err) {
        Notification.error({ title: "识别失败", content: actionErrorMessage(err) });
      } finally {
        if (expressRef.current) expressRef.current.value = "";
      }
    });
  }

  function submitHearing() {
    if (!hearingProcedureId) {
      Toast.error("请先选择所处程序");
      return;
    }
    if (!hearingTitle.trim()) {
      Toast.error("请填写开庭主题");
      return;
    }
    const startsAt = new Date(`${hearingStartsAt}:00+08:00`);
    if (Number.isNaN(startsAt.getTime())) {
      Toast.error("请填写有效开庭时间");
      return;
    }
    startTransition(async () => {
      try {
        await addHearing({
          procedureId: hearingProcedureId,
          title: hearingTitle.trim(),
          startsAt,
          endsAt: undefined,
          room: hearingRoom.trim(),
          address: hearingAddress.trim(),
          judge: hearingJudge.trim(),
          contact: hearingContact.trim(),
          notes: hearingNotes.trim()
        });
        Toast.success("开庭安排已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  function submitDeadline() {
    if (!deadlineProcedureId) {
      Toast.error("请先选择所处程序");
      return;
    }
    if (!deadlineTitle.trim()) {
      Toast.error("请填写期限名称");
      return;
    }
    startTransition(async () => {
      try {
        await addDeadline({
          procedureId: deadlineProcedureId,
          title: deadlineTitle.trim(),
          category: deadlineCategory,
          ...deadlineDueFromDraft(deadlineDue),
          basis: deadlineBasis.trim(),
          remindDays: deadlineRemindDays
        });
        Toast.success("期限已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  function submitExpress() {
    if (!trackingNo.trim()) {
      Toast.error("请填写或识别快递单号");
      return;
    }
    if (!purpose.trim()) {
      Toast.error("请填写快递用途");
      return;
    }
    startTransition(async () => {
      try {
        await createExpress({
          trackingNo: trackingNo.trim(),
          companyCode: companyCode.trim(),
          direction,
          matterId,
          purpose: purpose.trim(),
          recipient: recipient.trim(),
          recipientPhone: recipientPhone.trim()
        });
        Toast.success("快递记录已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  function submitMemo() {
    if (!memoProcedureId) {
      Toast.error("请先选择所处程序");
      return;
    }
    if (!memoContent.trim()) {
      Toast.error("请填写备忘内容");
      return;
    }
    startTransition(async () => {
      try {
        await addProcedureMemo({
          procedureId: memoProcedureId,
          content: memoContent.trim()
        });
        Toast.success("其他备忘已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (type === "hearing") submitHearing();
    if (type === "deadline") submitDeadline();
    if (type === "express") submitExpress();
    if (type === "memo") submitMemo();
  }

  const needsProcedure = type !== "express";
  const procedureMissing = needsProcedure && procedures.length === 0;
  const submitLabel = `添加${importantTypeMeta[type].label}`;

  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{types.includes("express") && types.length === 1 ? "添加记录 · 快递" : "添加事项"}</DialogTitle>
          <DialogDescription className="text-xs">
            {types.includes("express") && types.length === 1 ? "填写快递单号与用途，物流状态由接口更新" : "选择分类后填写信息；开庭与期限同时进入日程与提醒"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6 py-3">
            <div className={cn("grid gap-2", types.length > 2 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
              {types.map((key) => {
                const Icon = importantTypeMeta[key].icon;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setType(key)}
                    className={cn(
                      "flex h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                      type === key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {importantTypeMeta[key].label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {procedureMissing && (
              <div className="rounded-md border border-[var(--amber-line)] bg-[var(--amber-bg)] px-3 py-2 text-xs text-[var(--amber)]">
                请先添加案件程序后，再录入开庭安排、重要时限或其他备忘。
              </div>
            )}

            {type === "hearing" && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    ref={summonsRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleSummonsUpload(file);
                    }}
                  />
                  <Button
                    className="gap-1.5"
                    disabled={summonsPending || procedureMissing}
                    onClick={() => summonsRef.current?.click()}
                    htmlType="button"
                    type="tertiary" theme="outline"
                    size="small"
                  >
                    {summonsPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ScanText className="h-3.5 w-3.5" />
                    )}
                    {summonsPending ? "识别中…" : "上传传票识别"}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    上传传票照片，自动填充开庭信息
                  </span>
                </div>
                <ImportantField label="主题" required>
                  <Input
                    value={hearingTitle}
                    onChange={inputValue => setHearingTitle(inputValue)}
                    placeholder="如：第一次开庭"
                    disabled={procedureMissing}
                  />
                </ImportantField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ImportantField label="所处程序" required>
                    <ProcedureSelect
                      value={hearingProcedureId}
                      procedures={procedures}
                      disabled={procedureMissing}
                      onChange={(value) => {
                        setHearingProcedureId(value);
                        autoHearingTitle(value);
                      }}
                    />
                  </ImportantField>
                  <ImportantField label="审理法院">
                    <Input
                      readOnly
                      value={proceduresDetail[hearingProcedureId]?.handlingAgency ?? "—"}
                      className="bg-muted/50 text-muted-foreground"
                    />
                  </ImportantField>
                  <ImportantField label="开庭时间" required>
                    <Input
                      type="datetime-local"
                      value={hearingStartsAt}
                      onChange={inputValue => setHearingStartsAt(inputValue)}
                      disabled={procedureMissing}
                    />
                  </ImportantField>
                  <ImportantField label="法庭">
                    <Input
                      value={hearingRoom}
                      onChange={inputValue => setHearingRoom(inputValue)}
                      placeholder="如：第三法庭"
                      disabled={procedureMissing}
                    />
                  </ImportantField>
                  <ImportantField label="主审 / 仲裁员">
                    <Input
                      value={hearingJudge}
                      onChange={inputValue => setHearingJudge(inputValue)}
                      disabled={procedureMissing}
                    />
                  </ImportantField>
                  <ImportantField label="联系方式">
                    <Input
                      value={hearingContact}
                      onChange={inputValue => setHearingContact(inputValue)}
                      placeholder="法官/书记员电话"
                      disabled={procedureMissing}
                    />
                  </ImportantField>
                </div>
                <ImportantField label="开庭地址">
                  <Input
                    value={hearingAddress}
                    onChange={inputValue => setHearingAddress(inputValue)}
                    placeholder="如：XX路XX号XX法院"
                    disabled={procedureMissing}
                  />
                </ImportantField>
                <ImportantField label="备注">
                  <TextArea
                    rows={4}
                    value={hearingNotes}
                    onChange={inputValue => setHearingNotes(inputValue)}
                    disabled={procedureMissing}
                  />
                </ImportantField>
              </>
            )}

            {type === "deadline" && (
              <>
                <ImportantField label="所处程序" required>
                  <ProcedureSelect
                    value={deadlineProcedureId}
                    procedures={procedures}
                    disabled={procedureMissing}
                    onChange={setDeadlineProcedureId}
                  />
                </ImportantField>
                <ImportantField label="期限名称" required>
                  <Input
                    value={deadlineTitle}
                    onChange={inputValue => setDeadlineTitle(inputValue)}
                    placeholder="如：举证截止 / 上诉到期日"
                    disabled={procedureMissing}
                  />
                </ImportantField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ImportantField label="期限类型">
                    <> <span className="sr-only" id={selectLabelId + "-1"}>期限类型</span><Select
                      value={deadlineCategory}
                      onChange={value => { if (typeof value === "string") setDeadlineCategory(value as DeadlineCreateInput["category"]); }}
                      disabled={procedureMissing}
                      aria-labelledby={selectLabelId + "-1"}
                      className="w-full"
                      motion={false}>{Object.entries(deadlineCategoryLabel).map(([key, label]) => (
                          <Select.Option key={key} value={key}>
                            {label}
                          </Select.Option>
                        ))}</Select></>
                  </ImportantField>
                  <DeadlineDueFields value={deadlineDue} onChange={setDeadlineDue} disabled={procedureMissing || isPending} />
                </div>
                <ImportantField label="计算依据">
                  <Input
                    value={deadlineBasis}
                    onChange={inputValue => setDeadlineBasis(inputValue)}
                    placeholder="如：判决书送达日 2026-05-01 + 15 日"
                    disabled={procedureMissing}
                  />
                </ImportantField>
                <ImportantField label="提前提醒（天）">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    className="font-mono tabular"
                    value={deadlineRemindDays}
                    onChange={inputValue => setDeadlineRemindDays(Number(inputValue))}
                    disabled={procedureMissing}
                  />
                </ImportantField>
              </>
            )}

            {type === "express" && (
              <>
                <ImportantField label="单号" required>
                  <div className="flex gap-1">
                    <Input
                      value={trackingNo}
                      onChange={inputValue => setTrackingNo(inputValue)}
                      placeholder="可手动输入或上传图片识别"
                      className="font-mono"
                    />
                    <input
                      ref={expressRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleExpressOcr(file);
                      }}
                    />
                    <Button
                      onClick={() => expressRef.current?.click()}
                      disabled={expressOcrPending}
                      className="h-9 shrink-0 gap-1"
                      htmlType="button"
                      type="tertiary" theme="outline"
                      size="small"
                    >
                      {expressOcrPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ScanLine className="h-3 w-3" />
                      )}
                      识别
                    </Button>
                  </div>
                </ImportantField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ImportantField label="快递公司">
                    <Input
                      value={companyCode}
                      onChange={inputValue => setCompanyCode(inputValue)}
                      placeholder="留空则自动识别"
                    />
                  </ImportantField>
                  <ImportantField label="方向">
                    <> <span className="sr-only" id={selectLabelId + "-2"}>收寄方向</span><Select
                      value={direction}
                      onChange={value => { if (typeof value === "string") setDirection(value as "OUTBOUND" | "INBOUND"); }}
                      aria-labelledby={selectLabelId + "-2"}
                      className="w-full"
                      motion={false}><Select.Option value="OUTBOUND">寄出（我方→外）</Select.Option><Select.Option value="INBOUND">收件（外→我方）</Select.Option></Select></>
                  </ImportantField>
                </div>
                <ImportantField label="用途" required>
                  <Input
                    value={purpose}
                    onChange={inputValue => setPurpose(inputValue)}
                    placeholder="如：起诉状寄朝阳法院"
                  />
                </ImportantField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ImportantField label="收件人 / 单位">
                    <Input value={recipient} onChange={inputValue => setRecipient(inputValue)} />
                  </ImportantField>
                  <ImportantField label="收件电话">
                    <Input
                      value={recipientPhone}
                      onChange={inputValue => setRecipientPhone(inputValue)}
                      className="font-mono"
                    />
                  </ImportantField>
                </div>
              </>
            )}

            {type === "memo" && (
              <>
                <ImportantField label="所处程序" required>
                  <ProcedureSelect
                    value={memoProcedureId}
                    procedures={procedures}
                    disabled={procedureMissing}
                    onChange={setMemoProcedureId}
                  />
                </ImportantField>
                <ImportantField label="备忘内容" required>
                  <TextArea
                    rows={6}
                    value={memoContent}
                    onChange={inputValue => setMemoContent(inputValue)}
                    placeholder="输入备忘内容..."
                    disabled={procedureMissing}
                  />
                </ImportantField>
              </>
            )}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              htmlType="button"
              type="tertiary" theme="outline"
            >
              取消
            </Button>
            <Button
              disabled={isPending || summonsPending || expressOcrPending || procedureMissing}
              className="gap-1.5"
              htmlType="submit"
              theme="solid"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

function ProcedureSelect({
  value,
  procedures,
  disabled,
  onChange
}: {
  value: string;
  procedures: { id: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selectLabelId = useId();
  return (
    <> <span className="sr-only" id={selectLabelId + "-3"}>{"选择所处程序"}</span><Select value={value || undefined} onChange={value => { if (typeof value === "string") onChange(value); }} disabled={disabled} aria-labelledby={selectLabelId + "-3"} placeholder="选择所处程序" className="w-full" motion={false}>{procedures.map((p) => (
          <Select.Option key={p.id} value={p.id}>
            {p.label}
          </Select.Option>
        ))}</Select></>
  );
}

function ImportantField({
  label,
  required,
  children
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
