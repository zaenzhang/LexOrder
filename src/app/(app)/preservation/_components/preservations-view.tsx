"use client";

import { useId, useState, useMemo, useTransition } from "react";
import { Shield, Search, ChevronDown, ChevronRight, Pencil, Trash2, UserPlus, Landmark } from "lucide-react";
import { Button, Input, Notification, RadioGroup, Tag, Toast } from "@douyinfe/semi-ui";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { deletePreservationCase } from "@/server/preservations/actions-v2";
import {
  PreservationCaseDialog,
  AddTargetDialog,
  AddPropertyDialog,
  RenewPropertyDialog
} from "./preservation-dialog";
import {
  PRES_TYPE_CN,
  PROPERTY_TYPE_CN,
  PRES_STATUS_CN,
  classifyExpiry,
  type PreservationCaseRow,
  type MatterOption,
  type UserOption
} from "./preservation-types";
import { PageHeader } from "@/components/patterns/moan";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useTopbarAction } from "@/components/layout/topbar-action";

const statusTagColors = { ACTIVE: "green", RENEWED: "blue", EXPIRED: "red", LIFTED: "grey" } as const;

const STATUS_FILTERS = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "生效中" },
  { value: "RENEWED", label: "已续保" },
  { value: "EXPIRED", label: "已到期" },
  { value: "LIFTED", label: "已解除" }
];

export function PreservationsView({
  items,
  matters,
  users
}: {
  items: PreservationCaseRow[];
  matters: MatterOption[];
  users: UserOption[];
}) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allProperties = useMemo(
    () => items.flatMap((c) => c.targets.flatMap((t) => t.properties)),
    [items]
  );
  const activeCount = allProperties.filter((p) => p.status === "ACTIVE" || p.status === "RENEWED").length;
  const totalAmount = allProperties.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const expiring30 = allProperties.filter((p) => {
    if (p.status !== "ACTIVE" && p.status !== "RENEWED") return false;
    const days = Math.ceil((p.expiryDate.getTime() - Date.now()) / 86400000);
    return days <= 30;
  }).length;
  const expiredCount = allProperties.filter((p) => p.status === "EXPIRED").length;

  const filtered = useMemo(() => {
    let list = items;
    if (statusFilter !== "ALL") {
      list = list.filter((c) => {
        const ps = c.targets.flatMap((t) => t.properties);
        if (statusFilter === "ACTIVE") return ps.some((p) => p.status === "ACTIVE");
        if (statusFilter === "RENEWED") return ps.some((p) => p.status === "RENEWED");
        if (statusFilter === "EXPIRED") return ps.some((p) => p.status === "EXPIRED");
        if (statusFilter === "LIFTED") return c.status === "LIFTED";
        return true;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.court?.toLowerCase().includes(q) ||
          c.rulingNumber?.toLowerCase().includes(q) ||
          c.targets.some((t) => t.name.toLowerCase().includes(q)) ||
          c.matter?.title?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, statusFilter, search]);

  useTopbarAction({ label: "新建保全", onClick: () => setCreateOpen(true) }, []);

  return (
    <div className="space-y-5">
      <PageHeader className="!mb-0" title="财产保全" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="生效保全" value={activeCount} />
        <KpiCard label="累计保全金额" value={formatCurrency(totalAmount)} />
        <KpiCard label="30天内到期" value={expiring30} tone="warn" />
        <KpiCard label="已过期未处理" value={expiredCount} tone="danger" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={setSearch} prefix={<Search size={16} />} showClear
          placeholder="被保全人 / 案件 / 法院" aria-label="搜索保全记录" className="max-w-xs flex-1" />
        <RadioGroup aria-label="保全状态" type="button" value={statusFilter} options={STATUS_FILTERS}
          onChange={event => setStatusFilter(String(event.target.value))} />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <Shield className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{search ? `没有匹配「${search}」的保全记录` : "还没有保全记录"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((cs) => (
            <CaseCard key={cs.id} caseData={cs} expanded={expandedId === cs.id} onToggle={() => setExpandedId(expandedId === cs.id ? null : cs.id)} matters={matters} users={users} />
          ))}
        </div>
      )}

      <PreservationCaseDialog open={createOpen} onOpenChange={setCreateOpen} matters={matters} users={users} />
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "danger" }) {
  return (
    <div className="ll-surface p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular", tone === "danger" && "text-destructive", tone === "warn" && "text-[var(--amber)]")}>{value}</div>
    </div>
  );
}

function CaseCard({ caseData: cs, expanded, onToggle, matters, users }: { caseData: PreservationCaseRow; expanded: boolean; onToggle: () => void; matters: MatterOption[]; users: UserOption[] }) {
  const [, startTransition] = useTransition();
  const detailsId = useId();
  const [addTargetOpen, setAddTargetOpen] = useState(false);
  const [addPropOpen, setAddPropOpen] = useState<string | null>(null);
  const [renewPropOpen, setRenewPropOpen] = useState<string | null>(null);
  const [editingCase, setEditingCase] = useState<PreservationCaseRow | null>(null);

  const allProps = cs.targets.flatMap((t) => t.properties);
  const worstExpiry = allProps.length ? Math.min(...allProps.map((p) => Math.ceil((p.expiryDate.getTime() - Date.now()) / 86400000))) : null;
  const expiryInfo = worstExpiry !== null ? classifyExpiry(worstExpiry) : null;

  return (
    <div className="ll-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <Shield className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{cs.matter ? cs.matter.title : "未关联案件"}</span>
              <Tag color="blue">{PRES_TYPE_CN[cs.type]}</Tag>
              {expiryInfo && <span className={cn("shrink-0 text-[10px] font-medium", expiryInfo.tone === "danger" ? "text-destructive" : expiryInfo.tone === "warn" ? "text-[var(--amber)]" : "text-muted-foreground")}>{expiryInfo.label}</span>}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {cs.court && <span>{cs.court}</span>}{cs.rulingNumber && <span> · {cs.rulingNumber}</span>}{" · "}{cs.targets.length} 个被保全人 · {allProps.length} 项财产
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button theme="borderless" type="tertiary" icon={<Pencil size={16} />} aria-label="编辑保全" onClick={() => setEditingCase(cs)} />
          <Button theme="borderless" type="danger" icon={<Trash2 size={16} />} aria-label="删除保全" onClick={async () => {
            if (!await confirmDialog({ title: "删除此保全案件？", description: "将同时删除其下的被保全人、财产与续保记录。", confirmText: "删除", danger: true })) return;
            startTransition(async () => {
              try { await deletePreservationCase({ id: cs.id }); Toast.success("已删除"); }
              catch { Notification.error({ title: "删除失败", duration: 6 }); }
            });
          }} />
        </div>
      </div>

      {expanded && (
        <div id={detailsId} className="border-t border-border px-4 py-3 space-y-4">
          {cs.targets.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">还没有被保全人</p>
          ) : cs.targets.map((target) => (
            <div key={target.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{target.name}</span>
                <Button theme="borderless" size="small" onClick={() => setAddPropOpen(target.id)} className="ml-auto">添加财产</Button>
              </div>
              {target.properties.length === 0 ? (
                <p className="pl-6 text-xs text-muted-foreground">暂无财产记录</p>
              ) : (
                <div className="pl-6 space-y-1.5">
                  {target.properties.map((prop) => {
                    const days = Math.ceil((prop.expiryDate.getTime() - Date.now()) / 86400000);
                    const exp = classifyExpiry(days);
                    return (
                      <div key={prop.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                        <Landmark className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-medium">{PROPERTY_TYPE_CN[prop.propertyType]}</span>
                        {prop.amount && <span className="text-[11px] text-muted-foreground">{formatCurrency(Number(prop.amount))}</span>}
                        {prop.propertyDetail && <span className="truncate text-[10px] text-muted-foreground">({prop.propertyDetail})</span>}
                        <span className={cn("ml-auto shrink-0 text-[10px] font-medium", exp.tone === "danger" ? "text-destructive" : exp.tone === "warn" ? "text-[var(--amber)]" : "text-muted-foreground")}>{exp.label}</span>
                        <Tag color={statusTagColors[prop.status]}>{PRES_STATUS_CN[prop.status]}</Tag>
                        {(prop.status === "ACTIVE" || prop.status === "RENEWED") && (
                          <>
                            <Button theme="borderless" size="small" onClick={() => setRenewPropOpen(prop.id)}>续保</Button>
                            <Button theme="borderless" type="tertiary" size="small" onClick={() => { startTransition(async () => { try { const { liftProperty } = await import("@/server/preservations/actions-v2"); await liftProperty(prop.id); Toast.success("已解除"); } catch { Notification.error({ title: "操作失败", duration: 6 }); } }); }} >解除</Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <Button size="small" theme="light" icon={<UserPlus size={14} />} onClick={() => setAddTargetOpen(true)}>添加被保全人</Button>
        </div>
      )}

      {editingCase && <PreservationCaseDialog open onOpenChange={open => { if (!open) setEditingCase(null); }} editCase={editingCase} matters={matters} users={users} />}
      <AddTargetDialog open={addTargetOpen} onOpenChange={setAddTargetOpen} caseId={cs.id} />
      {addPropOpen && <AddPropertyDialog open={!!addPropOpen} onOpenChange={(o) => { if (!o) setAddPropOpen(null); }} targetId={addPropOpen} />}
      {renewPropOpen && (() => { const prop = allProps.find((p) => p.id === renewPropOpen); return prop ? <RenewPropertyDialog open={!!renewPropOpen} onOpenChange={(o) => { if (!o) setRenewPropOpen(null); }} property={prop} /> : null; })()}
    </div>
  );
}
