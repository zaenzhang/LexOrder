"use client";

/**
 * 期限规则库（墨案 12 效果图）：规则表 + 右栏推算示例。
 * 内置规则：编辑与启停；自定义规则：增删改。删除内置规则在服务端拒绝。
 * 推算示例用 lib/deadline-rules 的 computeDeadlineDate 与 lib/deadline-reminders 的
 * 真实提醒档位计算，不做节假日表（系统不内置，由人工核对顺延）。
 */
import { Button, Checkbox, Form, Input, Select, Switch, Toast } from "@douyinfe/semi-ui";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info, Pencil, Plus, Scale, Search, Trash2 } from "lucide-react";
import type { ProcedureType } from "@prisma/client";
import {
  createDeadlineRule, updateDeadlineRule, toggleDeadlineRule, deleteDeadlineRule
} from "@/server/deadline-rules/admin-actions";
import { computeDeadlineDate } from "@/lib/deadline-rules";
import { deadlineReminderOffsets } from "@/lib/deadline-reminders";
import { procedureTypeLabel } from "@/lib/enums";
import { FilterSelect } from "@/components/patterns/filter-select";
import { WorkspaceDialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/patterns/workspace-dialog";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { shMonthDay, shTodayCivil } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

export type AdminDeadlineRule = {
  id: string; code: string; name: string; description: string | null;
  triggerLabel: string; periodValue: number; periodUnit: "DAYS" | "MONTHS" | "YEARS";
  category: string; legalBasis: string; legalBasisUrl: string | null; verifiedAt: string | Date | null;
  remindDays: number; enabled: boolean; isBuiltIn: boolean;
  applicableProcedures?: ProcedureType[];
};

const CATEGORY_CN: Record<string, string> = {
  LIMITATION: "诉讼时效", EVIDENCE: "举证", APPEAL: "上诉", PERFORMANCE: "履行",
  RESPONSE: "答辩", ENFORCEMENT: "执行", ARBITRATION_SET_ASIDE: "撤裁", PRESERVATION: "保全", CUSTOM: "其他"
};
const UNIT_CN: Record<string, string> = { DAYS: "日", MONTHS: "个月", YEARS: "年" };

type RuleCategory = "LIMITATION" | "EVIDENCE" | "APPEAL" | "PERFORMANCE" | "RESPONSE" | "ENFORCEMENT" | "ARBITRATION_SET_ASIDE" | "PRESERVATION" | "CUSTOM";

type FormState = {
  name: string; triggerLabel: string; periodValue: string; periodUnit: "DAYS" | "MONTHS" | "YEARS";
  category: RuleCategory; legalBasis: string; legalBasisUrl: string;
  description: string; remindDays: string; enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "", triggerLabel: "", periodValue: "15", periodUnit: "DAYS", category: "CUSTOM",
  legalBasis: "", legalBasisUrl: "", description: "", remindDays: "7", enabled: true
};

const offsetLabel = (o: number) => (o === 0 ? "T-0" : o < 0 ? `T${o}` : `T+${o}`);
// 一律按上海时区格式化：服务端（可能是 UTC）与浏览器渲染必须一致，否则水合失败
const mmdd = (d: Date) => shMonthDay(d);

function procedureScope(rule: AdminDeadlineRule) {
  const list = rule.applicableProcedures ?? [];
  if (list.length === 0) return "全部程序";
  if (list.length <= 2) return list.map((p) => procedureTypeLabel[p]).join(" / ");
  return `${procedureTypeLabel[list[0]]} 等 ${list.length} 项`;
}

function OffsetChips({ remindDays }: { remindDays: number }) {
  return (
    <span className="inline-flex flex-wrap gap-1" style={{ maxWidth: 170 }}>
      {deadlineReminderOffsets(remindDays).map((o) => (
        <span key={o} className="offset-chip" style={o > 0 ? { background: "var(--red-bg)", color: "var(--red)" } : undefined}>
          {offsetLabel(o)}
        </span>
      ))}
    </span>
  );
}

export function DeadlineRulesCard({ rules, rail, headerActions }: { rules: AdminDeadlineRule[]; rail?: ReactNode; headerActions?: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(rules.find((r) => r.enabled)?.id ?? rules[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) =>
      (!category || r.category === category) &&
      (!q || [r.name, r.code, r.triggerLabel, r.legalBasis, procedureScope(r)].some((v) => v.toLowerCase().includes(q)))
    );
  }, [rules, search, category]);
  const selected = rules.find((r) => r.id === selectedId) ?? null;

  function openCreate() {
    setForm(EMPTY_FORM); setEditing({ id: null }); setError(null);
  }
  function openEdit(rule: AdminDeadlineRule) {
    setForm({
      name: rule.name, triggerLabel: rule.triggerLabel, periodValue: String(rule.periodValue),
      periodUnit: rule.periodUnit, category: rule.category as RuleCategory,
      legalBasis: rule.legalBasis, legalBasisUrl: rule.legalBasisUrl ?? "",
      description: rule.description ?? "", remindDays: String(rule.remindDays), enabled: rule.enabled
    });
    setEditing({ id: rule.id }); setError(null);
  }

  function submit() {
    setError(null);
    const payload = { ...form, periodValue: Number(form.periodValue), remindDays: Number(form.remindDays) };
    startTransition(async () => {
      try {
        if (editing?.id) await updateDeadlineRule({ id: editing.id, ...payload });
        else await createDeadlineRule(payload);
        setEditing(null);
        Toast.success("规则已保存");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? actionErrorMessage(e) : "保存失败");
      }
    });
  }

  function toggle(rule: AdminDeadlineRule, enabled: boolean) {
    startTransition(async () => {
      try {
        await toggleDeadlineRule({ id: rule.id, enabled });
        router.refresh();
      } catch (err) {
        Toast.error(err instanceof Error ? actionErrorMessage(err) : "操作失败");
      }
    });
  }

  async function remove(rule: AdminDeadlineRule) {
    if (!(await confirmDialog({ title: `删除规则「${rule.name}」？`, description: "已生成的期限不受影响。", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteDeadlineRule({ id: rule.id });
        router.refresh();
      } catch (err) {
        Toast.error(err instanceof Error ? actionErrorMessage(err) : "删除失败");
      }
    });
  }

  // 推算示例：以今天作为起算事件发生日
  const example = useMemo(() => {
    if (!selected) return null;
    const trigger = shTodayCivil(); // 起算日取上海当天，避免服务端 UTC 与客户端算出不同日期
    const due = computeDeadlineDate(trigger, selected.periodValue, selected.periodUnit);
    const offsets = deadlineReminderOffsets(selected.remindDays);
    return {
      trigger,
      due,
      tiers: offsets.map((o) => {
        const d = new Date(due);
        d.setDate(d.getDate() + o);
        return { offset: o, date: d };
      })
    };
  }, [selected]);

  return (
    <>
      <div className="page-head flex-wrap gap-3">
        <div>
          <div className="crumbs">设置 › 业务规则 › <b>期限规则库</b></div>
          <h1 className="ph-title">期限规则库</h1>
          <p className="ph-sub">法定期限由规则推算生成：起算事件 + 期限，并按统一档位阶梯预警。案件内人工修正过的期限保留修改人与来源，规则调整不回溯已生成的期限。</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {headerActions}
          <Button htmlType="button" theme="solid" size="small" onClick={openCreate} icon={<Plus size={16} aria-hidden />}>新建规则</Button>
        </div>
      </div>

      <div className="flow-strip">
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)" }}><Scale /></div>
          <div><div className="flow-t">① 起算事件发生</div><div className="flow-d">如：判决书送达之日、立案受理之日，由程序环节与材料识别记录</div></div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}><Info /></div>
          <div><div className="flow-t">② 规则推算期限</div><div className="flow-d">按日 / 月 / 年计算（期间开始日不计入），届满日遇法定休假日由人工核对顺延</div></div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><Search /></div>
          <div><div className="flow-t">③ 阶梯预警推送</div><div className="flow-d">T-3 / T-1 / T-0 / T+1 固定四档，另加规则建议提前档；逾期升级团队负责人</div></div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card" style={{ overflow: "hidden", minWidth: 0 }}>
          <div className="panel-head flex-wrap gap-2">
            <div className="panel-title">
              <Scale className="ic" strokeWidth={1.8} />
              规则列表 <span className="badge b-white" style={{ marginLeft: 2 }}>{rules.length}</span>
              <span className="t-xs t-mute" style={{ fontWeight: 400 }}>启用 {rules.filter((r) => r.enabled).length}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Input className="w-56" value={search} onChange={setSearch} placeholder="按规则名称、起算事件搜索" aria-label="搜索规则" prefix={<Search size={14} aria-hidden />} />
              <FilterSelect label="类别" value={category} options={Object.entries(CATEGORY_CN).map(([value, label]) => ({ value, label }))} onChange={setCategory} />
            </div>
          </div>
          <div className="mo-scroll-x">
            <table className="table rtable" style={{ minWidth: 760, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: "27%" }}>规则名称</th>
                  <th style={{ width: "14%" }}>适用程序</th>
                  <th style={{ width: "17%" }}>起算事件</th>
                  <th style={{ width: "10%" }}>期限</th>
                  <th style={{ width: "20%" }}>预警阶梯</th>
                  <th style={{ width: 96 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty mo-empty-compact"><div className="mo-empty-title">{rules.length ? "没有匹配的规则" : "暂无规则"}</div></div></td></tr>
                ) : filtered.map((rule) => (
                  <tr
                    key={rule.id}
                    className={cn("group cursor-pointer", !rule.enabled && "opacity-60")}
                    style={rule.id === selectedId ? { background: "var(--teal-soft)" } : undefined}
                    onClick={() => setSelectedId(rule.id)}
                    aria-selected={rule.id === selectedId}
                  >
                    <td>
                      <div className="rule-name">{rule.name}</div>
                      <div className="rule-meta truncate" title={`${rule.code} · ${rule.legalBasis}`}>
                        {rule.isBuiltIn ? "内置" : "自定义"} · {CATEGORY_CN[rule.category] ?? rule.category}
                        {rule.verifiedAt ? <span style={{ color: "var(--green)", fontWeight: 600 }}> · 法条已核验</span> : <span> · 法条未核验</span>}
                      </div>
                    </td>
                    <td><span className="badge b-white max-w-full truncate" title={procedureScope(rule)}>{procedureScope(rule)}</span></td>
                    <td className="t-sm">{rule.triggerLabel}</td>
                    <td>
                      <div className="num-md whitespace-nowrap">{rule.periodValue} {UNIT_CN[rule.periodUnit]}</div>
                      <span className="offset-chip" style={{ marginTop: 3, display: "inline-block" }}>{rule.periodUnit === "DAYS" ? "自然日" : "对应日"}</span>
                    </td>
                    <td><OffsetChips remindDays={rule.remindDays} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <Switch size="small" checked={rule.enabled} disabled={pending} onChange={value => toggle(rule, value)} aria-label={`启用期限规则：${rule.name}`} />
                        <Button htmlType="button" type="tertiary" theme="borderless" size="small" onClick={() => openEdit(rule)} aria-label={`编辑 ${rule.name}`} icon={<Pencil size={14} aria-hidden />} />
                        {!rule.isBuiltIn ? (
                          <Button htmlType="button" type="danger" theme="borderless" size="small" onClick={() => remove(rule)} aria-label={`删除 ${rule.name}`} icon={<Trash2 size={14} aria-hidden />} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">
            <span className="t-xs t-mute">规则变更记录审计；停用规则不影响已生成期限。内置规则只能编辑与启停（法条依据为核心价值），自定义规则可删除。</span>
          </div>
        </div>

        <div className="example" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="panel-head">
              <div className="panel-title truncate" style={{ fontSize: 13 }}>推算示例{selected ? ` · ${selected.name}` : ""}</div>
            </div>
            {selected && example ? (
              <>
                <div className="panel-body" style={{ padding: "6px 0 10px" }}>
                  <div className="ex-day">
                    <span className="ex-date">{mmdd(example.trigger)}</span><span className="ex-role">{selected.triggerLabel}（假设今天发生）</span>
                    <span className="badge b-white ex-tag">起算</span>
                  </div>
                  <div className="ex-day">
                    <span className="ex-date">+{selected.periodValue}{selected.periodUnit === "DAYS" ? "" : UNIT_CN[selected.periodUnit]}</span>
                    <span className="ex-role">{selected.periodUnit === "DAYS" ? "自然日计算 · 期间不含起算当日" : "取届满月对应日，无对应日取月末"}</span>
                    <span className="badge b-white ex-tag">计算</span>
                  </div>
                  <div className="ex-day">
                    <span className="ex-date">{mmdd(example.due)}</span><span className="ex-role">届满日（遇法定休假日需人工核对顺延）</span>
                    <span className="badge b-blue ex-tag">届满</span>
                  </div>
                  {example.tiers.map((t) => (
                    <div key={t.offset} className="ex-day" style={{ background: "#FBFDFC" }}>
                      <span className="ex-date" style={{ color: t.offset > 0 ? "var(--red)" : t.offset === 0 ? "var(--teal-deep)" : "var(--amber)" }}>{mmdd(t.date)}</span>
                      <span className="ex-role">{t.offset > 0 ? `${offsetLabel(t.offset)} 逾期升级（通知主办 + 团队负责人）` : t.offset === 0 ? "T-0 到期当日提醒" : `${offsetLabel(t.offset)} 预警`}</span>
                      {t.offset > 0 ? <span className="badge b-outline-red ex-tag">升级</span> : <span className="offset-chip ex-tag">通知</span>}
                    </div>
                  ))}
                </div>
                <div className="panel-foot" style={{ padding: "10px 14px" }}>
                  <div className="ex-note">
                    <Info />
                    <span>系统不内置节假日表（每年由国务院调整），届满日遇法定休假日请人工核对顺延。案件内人工修改过的期限会记录<b>修改人与时间</b>，规则调整不回溯。</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="panel-body t-xs t-mute">点击左侧规则查看推算示例</div>
            )}
          </div>
          {rail}
        </div>
      </div>

      <WorkspaceDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="mo-rules max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "编辑期限规则" : "新建期限规则"}</DialogTitle>
            <DialogDescription>保存后仅影响此后按规则生成的期限，已生成的期限不回溯。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Form.Label name="deadline-rule-name" required>规则名称</Form.Label>
              <Input id="deadline-rule-name" disabled={pending} value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} placeholder="如：民事上诉期" />
            </div>
            <div className="space-y-1.5">
              <Form.Label name="deadline-rule-event" required>起算事件</Form.Label>
              <Input id="deadline-rule-event" disabled={pending} value={form.triggerLabel} onChange={(value) => setForm((f) => ({ ...f, triggerLabel: value }))} placeholder="判决书送达之日" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Form.Label name="deadline-rule-period-value" required>期限值</Form.Label>
                <Input id="deadline-rule-period-value" disabled={pending} type="number" min={1} value={form.periodValue} onChange={(value) => setForm((f) => ({ ...f, periodValue: value }))} />
              </div>
              <div className="space-y-1.5">
                <Form.Label id="deadline-rule-period-unit-label">单位</Form.Label>
                <Select aria-labelledby="deadline-rule-period-unit-label" className="w-full" disabled={pending} value={form.periodUnit} onChange={(v) => setForm((f) => ({ ...f, periodUnit: v as FormState["periodUnit"] }))}>
                    <Select.Option value="DAYS">日</Select.Option>
                    <Select.Option value="MONTHS">个月</Select.Option>
                    <Select.Option value="YEARS">年</Select.Option>
                  </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Form.Label id="deadline-rule-category-label">类别</Form.Label>
              <Select aria-labelledby="deadline-rule-category-label" className="w-full" disabled={pending} value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v as RuleCategory }))}>
                  {Object.entries(CATEGORY_CN).map(([v, label]) => <Select.Option key={v} value={v}>{label}</Select.Option>)}
                </Select>
            </div>
            <div className="space-y-1.5">
              <Form.Label name="deadline-rule-remind">建议提前提醒（天）</Form.Label>
              <Input id="deadline-rule-remind" disabled={pending} type="number" min={0} max={60} value={form.remindDays} onChange={(value) => setForm((f) => ({ ...f, remindDays: value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Form.Label name="deadline-rule-basis" required>法条依据</Form.Label>
              <Input id="deadline-rule-basis" disabled={pending} value={form.legalBasis} onChange={(value) => setForm((f) => ({ ...f, legalBasis: value }))} placeholder="《中华人民共和国民事诉讼法(2023修正)》第一百七十一条" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Form.Label name="deadline-rule-url">法条链接</Form.Label>
              <Input id="deadline-rule-url" disabled={pending} value={form.legalBasisUrl} onChange={(value) => setForm((f) => ({ ...f, legalBasisUrl: value }))} placeholder="https://…" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Form.Label name="deadline-rule-description">说明</Form.Label>
              <Input id="deadline-rule-description" disabled={pending} value={form.description} onChange={(value) => setForm((f) => ({ ...f, description: value }))} />
            </div>
            <Checkbox className="col-span-2" checked={form.enabled} onChange={event => setForm((f) => ({ ...f, enabled: event.target.checked === true }))}>启用该规则
            </Checkbox>
            <div className="col-span-2 flex items-center gap-2 t-xs t-mute">预警档位<OffsetChips remindDays={Number(form.remindDays) || 0} /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button htmlType="button" theme="outline" disabled={pending} onClick={() => setEditing(null)}>取消</Button>
            <Button htmlType="button" theme="solid" loading={pending} disabled={pending} onClick={submit}>{editing?.id ? "保存" : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </WorkspaceDialog>
    </>
  );
}
