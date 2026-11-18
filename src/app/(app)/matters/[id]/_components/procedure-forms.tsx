"use client";

import { DeadlineDueFields } from "@/components/matters/deadline-due-fields";
import { deadlineDueDraft, type DeadlineDueDraft } from "@/lib/deadline-due";

import { useId, useTransition, useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Select, Button, Input, InputNumber, Notification, TextArea, Toast } from "@douyinfe/semi-ui";
import { ExternalLink, Loader2, Scale, ScanText } from "lucide-react";
import type { MatterCategory, ProcedureType } from "@prisma/client";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import {
  WorkspaceDialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import {
  procedureCreateSchema,
  deadlineCreateSchema,
  hearingCreateSchema,
  type ProcedureCreateInput,
  type DeadlineCategory,
  type DeadlineCreateInput
} from "@/server/procedures/schemas";
import {
  addProcedure,
  addDeadline,
  addHearing
} from "@/server/procedures/actions";
import { parseSummons } from "@/server/ai/parse-summons";
import { listDeadlineRulesForProcedure } from "@/server/deadline-rules/actions";
import {
  buildDeadlineBasis,
  computeDeadlineDate,
  formatLocalDate,
  periodLabel,
  HOLIDAY_NOTE
} from "@/lib/deadline-rules";
import { procedureTypeLabel } from "@/lib/enums";
import type { z } from "zod";
import { actionErrorMessage } from "@/lib/action-error";

// 开庭表单的客户端形态：startsAt 走 datetime-local 字符串 state（上海时区解析），不进 zod
const hearingFormSchema = hearingCreateSchema.omit({ startsAt: true });
type HearingFormValues = z.infer<typeof hearingFormSchema>;
import { proceduresByCategory } from "@/lib/procedures-by-category";
import { shDayKey } from "@/lib/ui/sh-time";
import {
  agencyOptionsForProcedure,
  isAgencyAllowedForProcedure,
  isNationalAgency
} from "@/lib/china-regions";
import { JurisdictionSelect } from "@/app/(app)/intakes/_components/jurisdiction-select";
import { cn } from "@/lib/utils";

// ============ AddProcedureSheet ============

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

export function AddProcedureSheet({
  open,
  onOpenChange,
  matterId,
  category,
  nextOrder,
  colleagues,
  onCreated
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  category: MatterCategory;
  nextOrder: number;
  colleagues?: { id: string; name: string }[];
  onCreated?: (procedureId: string) => void;
}) {
  const selectLabelId = useId();
  const [isPending, startTransition] = useTransition();
  const procedureOptions = proceduresByCategory[category];

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    formState: { errors, isDirty }
  } = useForm<z.input<typeof procedureCreateSchema>, unknown, ProcedureCreateInput>({
    resolver: zodResolver(procedureCreateSchema),
    defaultValues: {
      matterId,
      type: procedureOptions[0],
      customLabel: "",
      engagement: "ENGAGED",
      caseNumber: "",
      handlingAgency: "",
      panel: "",
      handler: "",
      acceptedAt: undefined,
      jurisdiction: "",
      leadLawyerId: null,
      isExternalLead: false
    }
  });

  const procedureType = useWatch({ control, name: "type" });
  const leadLawyerId = useWatch({ control, name: "leadLawyerId" });
  const isExternalLead = useWatch({ control, name: "isExternalLead" });
  const jurisdiction = useWatch({ control, name: "jurisdiction" }) ?? "";
  const handlingAgency = useWatch({ control, name: "handlingAgency" }) ?? "";
  const agencyOpts = useMemo(
    () => agencyOptionsForProcedure(jurisdiction, procedureType),
    [jurisdiction, procedureType]
  );

  function handleProcedureTypeChange(p: ProcedureType) {
    setValue("type", p);
    // 机构可自由手输，只在新程序下不合法时清空（商事仲裁下选了法院）
    const cur = getValues("handlingAgency");
    if (cur && !isAgencyAllowedForProcedure(cur, p)) {
      setValue("handlingAgency", "");
    }
  }

  function handleJurisdictionChange(v: string) {
    setValue("jurisdiction", v);
    const cur = getValues("handlingAgency");
    if (isNationalAgency(cur)) {
      setValue("handlingAgency", "");
    } else if (cur && !agencyOptionsForProcedure(v, getValues("type")).includes(cur)) {
      setValue("handlingAgency", "");
    }
  }

  function handleHandlingAgencyChange(v: string) {
    setValue("handlingAgency", v);
    if (isNationalAgency(v)) {
      setValue("jurisdiction", "");
    }
  }

  async function closeProcedure() {
    if (isPending) return;
    if (isDirty && !await confirmDialog({ title: "放弃未保存的程序？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    reset(); onOpenChange(false);
  }

  function onSubmit(values: ProcedureCreateInput) {
    const location = window.location.pathname + window.location.search;
    startTransition(async () => {
      try {
        const created = await addProcedure(values);
        Toast.success(`程序已添加（${procedureTypeLabel[values.type]}）`);
        reset();
        onOpenChange(false);
        if (window.location.pathname + window.location.search === location) onCreated?.(created.id);
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={open => { if (!open) void closeProcedure(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>添加程序（第 {nextOrder} 个）</DialogTitle>
          <DialogDescription className="text-xs">
            填写程序基本信息和主办律师
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {/* 程序类型 */}
            <div className="space-y-2">
              <label className="text-xs">程序类型 *</label>
              <div className="flex flex-wrap gap-1.5">
                {procedureOptions.map((p) => (
                  <Button theme="outline" type="primary" size="small"
                    key={p}
                    htmlType="button"
                    onClick={() => handleProcedureTypeChange(p as ProcedureType)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      procedureType === p
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-input hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {procedureTypeLabel[p]}
                  </Button>
                ))}
              </div>
            </div>

            {/* 主办律师 */}
            {colleagues && colleagues.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs">主办律师</label>
                <div className="flex items-center gap-3">
                  <> <span className="sr-only" id={selectLabelId + "-1"}>{"选择主办律师"}</span><Select
                    value={isExternalLead ? "__external__" : (leadLawyerId ?? "__none__")}
                    onChange={v => { if (typeof v !== "string") return;
                      if (v === "__external__") {
                        setValue("isExternalLead", true);
                        setValue("leadLawyerId", null);
                      } else if (v === "__none__") {
                        setValue("isExternalLead", false);
                        setValue("leadLawyerId", null);
                      } else {
                        setValue("isExternalLead", false);
                        setValue("leadLawyerId", v);
                      }
                    }}
                    aria-labelledby={selectLabelId + "-1"}
                    placeholder="选择主办律师"
                    className="w-full"
                    motion={false}><Select.Option value="__none__">未指定</Select.Option>{colleagues.map((c) => (
                        <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
                      ))}<Select.Option value="__external__">非本所代理</Select.Option></Select></>
                  {isExternalLead && (
                    <span className="text-xs text-muted-foreground">此程序由外部律师代理</span>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="案号">
                <Controller control={control} name="caseNumber" render={({ field }) => <Input className="font-mono" placeholder="如 (2026)沪0105民初1288号" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
              <Field label="管辖地">
                <JurisdictionSelect
                  value={jurisdiction}
                  onChange={handleJurisdictionChange}
                />
              </Field>
              <Field label="办理机关">
                <> <span className="sr-only" id={selectLabelId + "-2"}>{"办理机关"}</span><Select
                  value={handlingAgency}
                  onChange={value => { if (typeof value === "string") handleHandlingAgencyChange(value); }}
                  disabled={agencyOpts.length === 0}
                  aria-labelledby={selectLabelId + "-2"}
                  placeholder="选择机构"
                  className="w-full"
                  motion={false}>{agencyOpts.map((a) => (
                      <Select.Option key={a} value={a}>{a}</Select.Option>
                    ))}</Select></>
              </Field>
              <Field label="主审 / 仲裁员">
                <Controller control={control} name="handler" render={({ field }) => <Input name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
              <Field label="庭别 / 合议庭">
                <Controller control={control} name="panel" render={({ field }) => <Input name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
              <Field
                label="立案 / 受理日期"
                error={errors.acceptedAt?.message as string | undefined}
              >
                <Controller control={control} name="acceptedAt" render={({ field }) => <Input type="date" onChange={inputValue => {
                    // 表单保存日期字符串，resolver 在提交时解析成 Date。
                    setValue("acceptedAt", inputValue || undefined, { shouldValidate: true });
                  }} name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} />} />
              </Field>
            </div>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              onClick={() => void closeProcedure()}
              disabled={isPending}
              htmlType="button"
              type="tertiary" theme="outline"
            >
              取消
            </Button>
            <Button disabled={isPending} className="gap-1.5" htmlType="submit" theme="solid">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              添加程序
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

// ============ AddDeadlineSheet ============

const deadlineCategoryLabel: Record<
  DeadlineCategory,
  string
> = {
  LIMITATION: "诉讼时效",
  EVIDENCE: "举证期限",
  APPEAL: "上诉期",
  PERFORMANCE: "履行期",
  RESPONSE: "答辩期",
  ENFORCEMENT: "执行申请",
  ARBITRATION_SET_ASIDE: "撤销仲裁期",
  PRESERVATION: "保全期限",
  CUSTOM: "其他"
};

// 工厂而非内联字面量：dueAt 须在每次打开/重置时取「现在」，常驻挂载的对话框跨天后仍会默认昨天
function deadlineDefaults(procedureId: string): z.input<typeof deadlineCreateSchema> {
  return {
    procedureId,
    title: "",
    category: "CUSTOM",
    // yyyy-MM-dd 字符串默认值：date input 不回显 Date 对象；空串会在 zod 校验报错并显示
    dueAt: shDayKey(new Date()),
    duePrecision: "DATE",
    basis: "",
    remindDays: 3
  };
}

export function AddDeadlineDialog({
  open,
  onOpenChange,
  procedures,
  defaultProcedureId
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** v0.45：提醒全案聚合，新增期限需明确所处程序 */
  procedures: { id: string; label: string }[];
  defaultProcedureId: string;
}) {
  const selectLabelId = useId();
  const [isPending, startTransition] = useTransition();
  const [dueDraft, setDueDraft] = useState<DeadlineDueDraft>(() => deadlineDueDraft());

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors }
  } = useForm<z.input<typeof deadlineCreateSchema>, unknown, DeadlineCreateInput>({
    resolver: zodResolver(deadlineCreateSchema),
    defaultValues: deadlineDefaults(defaultProcedureId)
  });
  const procedureId = useWatch({ control, name: "procedureId" });
  const category = useWatch({ control, name: "category" });

  // v0.49：法定期限规则（按当前程序类型 + 案件类别过滤，全部经元典核验）
  type RuleOption = Awaited<ReturnType<typeof listDeadlineRulesForProcedure>>[number];
  const [rules, setRules] = useState<RuleOption[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  // 起算日默认「上海的今天」；后续推算链（date 字符串 → 本地午夜载体 → 本地字段）在浏览器内自洽
  const [triggerDate, setTriggerDate] = useState(() => shDayKey(new Date()));
  const selectedRule = rules.find((r) => r.id === selectedRuleId) ?? null;
  const computedDue = (() => {
    if (!selectedRule || !triggerDate) return null;
    const trigger = new Date(`${triggerDate}T00:00:00`);
    if (Number.isNaN(trigger.getTime())) return null;
    return computeDeadlineDate(trigger, selectedRule.periodValue, selectedRule.periodUnit);
  })();

  useEffect(() => {
    if (!open || !procedureId) return;
    let cancelled = false;
    setRulesLoading(true);
    listDeadlineRulesForProcedure({ procedureId })
      .then((list) => {
        if (cancelled) return;
        setRules(list);
        setSelectedRuleId((cur) => (list.some((r) => r.id === cur) ? cur : ""));
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      })
      .finally(() => {
        if (!cancelled) setRulesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, procedureId]);

  function applyRule() {
    if (!selectedRule || !computedDue) return;
    const trigger = new Date(`${triggerDate}T00:00:00`);
    setValue("title", selectedRule.name, { shouldDirty: true });
    setValue("category", selectedRule.category, { shouldDirty: true });
    // v1.x P0-8: 规则生成的期限带来源——提交后以"待确认"落库，律师核对起算事实后确认
    setValue("sourceRuleId", selectedRule.id, { shouldDirty: true });
    // 起算日期继续交由既有规则核对；本次建议只确定日期，不推断准确时刻。
    setValue("sourceTriggerDate", triggerDate as unknown as Date, { shouldDirty: true });
    setValue("startFact", `${selectedRule.triggerLabel}（${formatLocalDate(trigger)}）`, {
      shouldDirty: true
    });
    // DATE 从明确日期键生成上海日界；用户随后可明确选择准确时刻。
    setDueDraft({ precision: "DATE", date: formatLocalDate(computedDue), time: "" });
    setValue("duePrecision", "DATE", { shouldDirty: true });
    setValue("dueAt", formatLocalDate(computedDue), {
      shouldDirty: true
    });
    setValue(
      "basis",
      buildDeadlineBasis({
        legalBasis: selectedRule.legalBasis,
        triggerLabel: selectedRule.triggerLabel,
        triggerDate: trigger,
        periodValue: selectedRule.periodValue,
        periodUnit: selectedRule.periodUnit
      }),
      { shouldDirty: true }
    );
    setValue("remindDays", selectedRule.remindDays, { shouldDirty: true });
    Notification.success({ title: "已按法定期限填入，可再人工调整", content: HOLIDAY_NOTE });
  }

  // 打开（变为 true）时重新生成默认值：defaultValues 只在首次渲染求值，跨天打开默认「到期日」会是昨天
  useEffect(() => {
    if (!open) return;
    reset(deadlineDefaults(defaultProcedureId));
    setDueDraft(deadlineDueDraft());
    // 起算日默认「上海的今天」同理，随打开刷新
    setTriggerDate(shDayKey(new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 程序仅在打开时初始化；选择规则不覆盖用户已选程序。
  useEffect(() => {
    if (open) {
      // 手动重新打开时清空上次的规则来源（未选规则=人工录入=已确认）
      if (!selectedRuleId) {
        setValue("sourceRuleId", "", { shouldDirty: false });
        setValue("startFact", "", { shouldDirty: false });
      }
    }
  }, [open, setValue, selectedRuleId]);

  function onSubmit(values: DeadlineCreateInput) {
    startTransition(async () => {
      try {
        await addDeadline(values);
        Toast.success("期限已添加");
        reset();
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={value => { if (!isPending) onOpenChange(value); }}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>添加期限</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <Field label="所处程序" required>
              <> <span className="sr-only" id={selectLabelId + "-3"}>{"所处程序"}</span><Select
                value={procedureId || undefined}
                onChange={v => { if (typeof v === "string") setValue("procedureId", v); }}
                aria-labelledby={selectLabelId + "-3"}
                placeholder="选择所处程序"
                className="w-full"
                motion={false}>{procedures.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.label}
                    </Select.Option>
                  ))}</Select></>
            </Field>

            {(rulesLoading || rules.length > 0) && (
              <section className="space-y-2.5 rounded-md border border-primary/25 bg-primary/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85">
                  <Scale className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                  按法定期限生成
                  {rulesLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                <div className="space-y-1.5">
                  <label id={selectLabelId + "-4"} className="text-xs text-muted-foreground">法定期限规则</label>
                  <Select value={selectedRuleId || undefined} onChange={value => { if (typeof value === "string") setSelectedRuleId(value); }} aria-labelledby={selectLabelId + "-4"} placeholder="选择适用的法定期限" className="w-full" motion={false}>{rules.map((rule) => (
                        <Select.Option key={rule.id} value={rule.id}>
                          {rule.name} · {periodLabel(rule.periodValue, rule.periodUnit)}
                        </Select.Option>
                      ))}</Select>
                </div>
                {selectedRule && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        {selectedRule.triggerLabel}
                      </label>
                      <Input
                        type="date"
                        value={triggerDate}
                        onChange={inputValue => setTriggerDate(inputValue)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1 text-[11px] leading-5 text-muted-foreground">
                      <p>
                        {selectedRule.legalBasis}
                        {selectedRule.legalBasisUrl && (
                          <a
                            href={selectedRule.legalBasisUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            查看法条
                          </a>
                        )}
                        {selectedRule.verifiedAt && (
                          <span className="ml-1.5 rounded bg-[var(--semi-color-success-light-default)] px-1.5 py-0.5 text-[10px] text-[var(--semi-color-success)]">
                            已核验 {shDayKey(selectedRule.verifiedAt)}
                          </span>
                        )}
                      </p>
                      {selectedRule.description && <p>{selectedRule.description}</p>}
                      {computedDue && (
                        <p className="font-medium text-foreground/85">
                          到期日：
                          <span className="font-mono tabular">
                            {formatLocalDate(computedDue)}
                          </span>
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            （{HOLIDAY_NOTE}）
                          </span>
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={applyRule}
                      disabled={!computedDue}
                      className="h-7 px-2.5 text-[11px]"
                      htmlType="button"
                      type="tertiary" theme="outline"
                      size="small"
                    >
                      填入下方表单
                    </Button>
                  </>
                )}
              </section>
            )}

            <Field label="期限名称" required error={errors.title?.message}>
              <Controller control={control} name="title" render={({ field }) => <Input placeholder="如：举证截止 / 上诉到期日" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="期限类型">
              <> <span className="sr-only" id={selectLabelId + "-5"}>{"期限类型"}</span><Select
                value={category}
                onChange={v => { if (typeof v === "string") setValue("category", v as DeadlineCreateInput["category"]); }}
                aria-labelledby={selectLabelId + "-5"}
                className="w-full"
                motion={false}>{Object.entries(deadlineCategoryLabel).map(([k, v]) => (
                    <Select.Option key={k} value={k}>
                      {v}
                    </Select.Option>
                  ))}</Select></>
            </Field>

            <div className="space-y-1.5"><DeadlineDueFields value={dueDraft} disabled={isPending} onChange={next => {
              setDueDraft(next);
              setValue("duePrecision", next.precision!, { shouldDirty: true });
              setValue("dueAt", next.precision === "DATE" ? next.date : `${next.date}T${next.time}:00+08:00`, { shouldDirty: true });
            }} />{errors.dueAt?.message && <p className="text-sm text-destructive">{errors.dueAt.message}</p>}</div>

            <Field label="计算依据">
              <Controller control={control} name="basis" render={({ field }) => <Input placeholder="如：判决书送达日 2026-05-01 + 15 日" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="提前提醒（天）" error={errors.remindDays?.message as string | undefined}>
              <Controller control={control} name="remindDays" render={({ field }) => (
                <InputNumber min={0} max={60} aria-label="提前提醒（天）" className="w-full" name={field.name}
                  forwardedRef={field.ref} value={typeof field.value === "number" && Number.isNaN(field.value) ? "" : typeof field.value === "number" || typeof field.value === "string" ? field.value : ""}
                  onBlur={field.onBlur} onChange={value => field.onChange(value === "" ? Number.NaN : Number(value))} />
              )} />
            </Field>
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
            <Button disabled={isPending} className="gap-1.5" htmlType="submit" theme="solid">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              添加期限
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

// ============ AddHearingDialog ============

export function AddHearingDialog({
  open,
  onOpenChange,
  procedures,
  defaultProcedureId,
  hearingCounts,
  proceduresDetail
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  procedures: { id: string; label: string }[];
  defaultProcedureId: string;
  hearingCounts?: Record<string, number>;
  /** 各程序附加信息（审理法院等），用于预填 */
  proceduresDetail?: Record<string, { handlingAgency?: string | null; panel?: string | null; jurisdiction?: string | null }>;
}) {
  const selectLabelId = useId();
  const [isPending, startTransition] = useTransition();
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors }
  } = useForm<z.input<typeof hearingFormSchema>, unknown, HearingFormValues>({
    // startsAt 由 datetime-local 字符串 state 承载（+08:00 解析），不经 zod 的本地时区 coerce
    resolver: zodResolver(hearingFormSchema),
    defaultValues: {
      procedureId: defaultProcedureId,
      title: "",
      endsAt: undefined,
      room: "",
      address: "",
      judge: "",
      contact: "",
      notes: ""
    }
  });
  const [startsAtInput, setStartsAtInput] = useState("");
  const [startsAtError, setStartsAtError] = useState("");

  const hearingProcedureId = useWatch({ control, name: "procedureId" });

  const autoTitle = useCallback((procId: string) => {
    const proc = procedures.find(p => p.id === procId);
    if (!proc) return;
    const count = (hearingCounts?.[procId] ?? 0) + 1;
    const numStr = CN_NUM[count] ?? String(count);
    setValue("title", `${proc.label}第${numStr}次开庭`);
  }, [hearingCounts, procedures, setValue]);

  // 打开时同步默认程序 + 自动生成主题
  useEffect(() => {
    if (!open) return;
    setValue("procedureId", defaultProcedureId);
    autoTitle(defaultProcedureId);
  }, [open, defaultProcedureId, setValue, autoTitle]);

  function handleSummonsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      try {
        const result = await parseSummons(fd);
        // 回填同样用 datetime-local 字符串：Date 对象不会被 input 回显，用户将无法核对
        if (result.hearingDate && result.hearingTime) {
          setStartsAtInput(`${result.hearingDate}T${result.hearingTime}`);
        } else if (result.hearingDate) {
          setStartsAtInput("");
          setStartsAtError(`已识别开庭日期 ${result.hearingDate}，具体时刻未识别，请手动填写`);
        }
        if (result.courtRoom) setValue("room", result.courtRoom);
        if (result.judge) setValue("judge", result.judge);
        if (result.caseNumber || result.parties) {
          const parts: string[] = [];
          if (result.caseNumber) parts.push(`案号：${result.caseNumber}`);
          if (result.parties?.length) parts.push(`当事人：${result.parties.join("、")}`);
          setValue("notes", parts.join("\n"));
        }
        Toast.success(result.pageLimit ? "已识别传票首页，请核对信息；其他页未处理" : "传票识别完成，请核对信息");
      } catch (err) {
        Notification.error({ title: "传票识别失败", content: err instanceof Error ? actionErrorMessage(err) : "请手动填写" });
      } finally {
        setOcrLoading(false);
        // reset file input so same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  function onSubmit(values: HearingFormValues) {
    // datetime-local 字符串按上海时区解释（境外浏览器不漂移）；为空时就地报错，不再静默
    if (!startsAtInput.trim()) {
      setStartsAtError("请填写开庭时间");
      return;
    }
    const parsed = new Date(`${startsAtInput}:00+08:00`);
    if (Number.isNaN(parsed.getTime())) {
      setStartsAtError("开庭时间格式不正确");
      return;
    }
    setStartsAtError("");
    startTransition(async () => {
      try {
        await addHearing({ ...values, startsAt: parsed });
        Toast.success("开庭已添加");
        reset();
        setStartsAtInput("");
        setStartsAtError("");
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>添加开庭</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {/* 上传传票 */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={handleSummonsUpload}
              />
              <Button
                className="gap-1.5"
                disabled={ocrLoading}
                onClick={() => fileInputRef.current?.click()}
                htmlType="button"
                type="tertiary" theme="outline"
                size="small"
              >
                {ocrLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanText className="h-3.5 w-3.5" />
                )}
                {ocrLoading ? "识别中…" : "上传传票识别"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                上传传票照片，AI 自动填充开庭信息
              </span>
            </div>

            <Field label="主题" required error={errors.title?.message}>
              <Controller control={control} name="title" render={({ field }) => <Input placeholder="如：第一次开庭" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            {/* 所处程序 + 审理法院 一行 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="所处程序" required>
                <> <span className="sr-only" id={selectLabelId + "-6"}>{"所处程序"}</span><Select
                  value={hearingProcedureId || undefined}
                  onChange={v => { if (typeof v !== "string") return;
                    setValue("procedureId", v);
                    autoTitle(v);
                  }}
                  aria-labelledby={selectLabelId + "-6"}
                  placeholder="选择程序"
                  className="w-full"
                  motion={false}>{procedures.map((p) => (
                      <Select.Option key={p.id} value={p.id}>
                        {p.label}
                      </Select.Option>
                    ))}</Select></>
              </Field>
              <Field label="审理法院">
                <Input
                  readOnly
                  value={proceduresDetail?.[hearingProcedureId]?.handlingAgency ?? "—"}
                  className="bg-muted/50 text-muted-foreground"
                />
              </Field>
            </div>

            {/* 开庭时间 + 法庭 一行 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="开庭时间" required error={startsAtError || undefined}>
                <Input
                  type="datetime-local"
                  value={startsAtInput}
                  onChange={inputValue => {
                    setStartsAtInput(inputValue);
                    if (startsAtError) setStartsAtError("");
                  }}
                />
              </Field>
              <Field label="法庭">
                <Controller control={control} name="room" render={({ field }) => <Input placeholder="如：第三法庭" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
            </div>

            {/* 主审/仲裁员 + 联系方式 一行 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="主审 / 仲裁员">
                <Controller control={control} name="judge" render={({ field }) => <Input name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
              <Field label="联系方式">
                <Controller control={control} name="contact" render={({ field }) => <Input placeholder="法官/书记员电话" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
            </div>

            <Field label="开庭地址">
              <Controller control={control} name="address" render={({ field }) => <Input placeholder="如：XX路XX号XX法院" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="备注">
              <Controller control={control} name="notes" render={({ field }) => <TextArea rows={4} name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>
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
            <Button disabled={isPending} className="gap-1.5" htmlType="submit" theme="solid">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              添加开庭
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

// ============ Shared Field ============

function Field({
  label,
  required,
  error,
  children
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
