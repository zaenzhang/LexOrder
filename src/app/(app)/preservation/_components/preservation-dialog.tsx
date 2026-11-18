"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useId, useRef, useState, useTransition } from "react";
import { Button, Input, Notification, Select, TextArea, Toast } from "@douyinfe/semi-ui";
import type { PreservationType, PropertyType } from "@prisma/client";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  createPreservationCase,
  updatePreservationCase,
  addTarget,
  addProperty,
  renewProperty,
} from "@/server/preservations/actions-v2";
import { PRES_TYPE_CN, PROPERTY_TYPE_CN, type PreservationCaseRow, type MatterOption, type UserOption } from "./preservation-types";
import {
  defaultDurationDays,
  defaultExpiryDate
} from "@/lib/preservation-defaults";
import { civilFromKey, civilKey, shTodayCivil } from "@/lib/ui/sh-time";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { formatDate } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";

/**
 * 起算日的统一口径（2026-09-20 第五轮审计时区修复）：
 * 输入框日期串转本地正午日历日（不落 UTC 午夜真瞬间），空值取上海今天——
 * 非中国时区浏览器上起算日不再偏一天，与服务端口径一致。
 */
function validatedCivil(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number(key.slice(0, 4)) < 1900 || Number(key.slice(0, 4)) > 2200) throw new Error("日期无效");
  const date = civilFromKey(key);
  if (civilKey(date) !== key) throw new Error("日期无效");
  return date;
}
function startCivil(startDate: string): Date {
  return startDate ? validatedCivil(startDate) : shTodayCivil();
}

const propertyOptions = Object.entries(PROPERTY_TYPE_CN).map(([value, label]) => ({ value: value as PropertyType, label }));

// ── Case Dialog (create + edit) ──

export function PreservationCaseDialog({
  open,
  onOpenChange,
  editCase,
  matters,
  users,
  initialMatterId
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editCase?: PreservationCaseRow;
  matters: MatterOption[];
  users: UserOption[];
  initialMatterId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const submitting = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const selectOpen = useRef(false);
  const fieldId = useId();
  const isEdit = !!editCase;

  const [matterId, setMatterId] = useState(editCase?.matterId ?? initialMatterId ?? "");
  const [type, setType] = useState<PreservationType>(editCase?.type ?? "LITIGATION");
  const [court, setCourt] = useState(editCase?.court ?? "");
  const [rulingNumber, setRulingNumber] = useState(editCase?.rulingNumber ?? "");
  const [ownerId, setOwnerId] = useState(editCase?.ownerId ?? "");
  const [note, setNote] = useState(editCase?.note ?? "");
  // First target + property (create only)
  const [target, setTarget] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("BANK_DEPOSIT");
  const [propertyDetail, setPropertyDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  // F-2：到期日（法院文书载明）为第一事实、必填；期限天数按到期日折算派生
  const [expiryDate, setExpiryDate] = useState("");
  const selectedMatterId = matterId === "__none__" ? null : (matterId || null);
  const selectedOwnerId = ownerId === "__none__" ? null : (ownerId || null);
  const changes = {
    ...(editCase && selectedMatterId !== editCase.matterId ? { matterId: selectedMatterId } : {}),
    ...(editCase && selectedOwnerId !== editCase.ownerId ? { ownerId: selectedOwnerId } : {}),
    ...(editCase && type !== editCase.type ? { type } : {}),
    ...(editCase && court.trim() !== (editCase.court ?? "") ? { court } : {}),
    ...(editCase && rulingNumber.trim() !== (editCase.rulingNumber ?? "") ? { rulingNumber } : {}),
    ...(editCase && note.trim() !== (editCase.note ?? "") ? { note } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function handleOpenChange(nextOpen: boolean) {
    if (submitting.current || isPending) return;
    if (!nextOpen && isEdit && dirty && !await confirmDialog({
      title: "放弃本次修改？", description: "本次修改尚未保存。", confirmText: "放弃修改", danger: true,
    })) return;
    if (!submitting.current) onOpenChange(nextOpen);
  }

  function reset() {
    if (!isEdit) {
      setMatterId(initialMatterId ?? ""); setType("LITIGATION"); setCourt(""); setRulingNumber("");
      setOwnerId(""); setNote(""); setTarget(""); setPropertyType("BANK_DEPOSIT");
      setPropertyDetail(""); setAmount(""); setStartDate(""); setExpiryDate("");
    }
  }

  function handleSubmit() {
    if (submitting.current || isPending || (isEdit && !dirty)) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        if (editCase) {
          await updatePreservationCase({ id: editCase.id, expectedUpdatedAt: editCase.updatedAt, ...changes });
          Toast.success("已更新");
          onOpenChange(false);
          return;
        }
        if (target && !expiryDate) {
          Notification.error({ title: "请填写法院文书载明的到期日", duration: 6 });
          return;
        }
        const sd = startCivil(startDate);
        const f = expiryFacts(startDate, expiryDate, propertyType);
        // F-2：晚于法定上限须确认后保存（超出部分不受强制保护，民诉法解释第 485 条）
        if (target && f.overLimit) {
          const okToSave = await confirmDialog({
            title: "到期日晚于法定上限",
            description: `法定上限为 ${f.refKey}，录入为 ${expiryDate}。超出上限的部分不受强制保护。请核对法院协助执行通知书，确认按录入日期保存？`,
            confirmText: "按录入日期保存",
            danger: true
          });
          if (!okToSave) return;
        }
        const ed = target ? validatedCivil(expiryDate) : undefined;
        // 落库天数与到期日同源折算，两字段不再互相矛盾
        const dur = target ? (f.days ?? defaultDurationDays(sd, propertyType)) : undefined;

        await createPreservationCase({
          matterId: selectedMatterId,
          type,
          court, rulingNumber,
          ownerId: selectedOwnerId,
          note,
          remindDays: [30, 15, 7, 3, 1],
          firstTarget: target,
          firstPropertyType: target ? propertyType : undefined,
          firstPropertyDetail: propertyDetail,
          firstAmount: amount ? parseFloat(amount) : null,
          firstStartDate: target ? sd : undefined,
          firstDuration: target ? dur : undefined,
          firstExpiryDate: target ? ed : undefined,
        });
        Toast.success("保全已创建");
        reset();
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err), duration: 6 });
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent ref={dialog} className="max-w-lg" onEscapeKeyDown={event => { if (selectOpen.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑保全" : "新建保全"}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? "修改当前保全记录" : "填写保全信息"}</DialogDescription>
        </DialogHeader>
        <FormDialogBody>
        <fieldset disabled={isPending} className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="关联案件" id={`${fieldId}-matter`}>
              <Select<string> id={`${fieldId}-matter`} aria-labelledby={`${fieldId}-matter-label`}
                value={matterId || undefined} onChange={value => { if (typeof value === "string") setMatterId(value); }} disabled={isPending}
                placeholder="选择案件（诉前可空）" className="w-full" filter motion={false}
                getPopupContainer={() => dialog.current!} onDropdownVisibleChange={visible => { selectOpen.current = visible; }}>
                <Select.Option value="__none__">不关联</Select.Option>
                {editCase?.matter && !matters.some(m => m.id === editCase.matterId) && <Select.Option value={editCase.matter.id}>{editCase.matter.internalCode} {editCase.matter.title}</Select.Option>}
                {matters.map(m => <Select.Option key={m.id} value={m.id}>{m.internalCode} {m.title}</Select.Option>)}
              </Select>
            </Field>
            <Field label="保全类型" id={`${fieldId}-type`}>
              <Select<PreservationType> id={`${fieldId}-type`} aria-labelledby={`${fieldId}-type-label`}
                value={type} onChange={value => { if (typeof value === "string") setType(value); }} disabled={isPending}
                optionList={Object.entries(PRES_TYPE_CN).map(([value, label]) => ({ value: value as PreservationType, label }))}
                className="w-full" motion={false} getPopupContainer={() => dialog.current!}
                onDropdownVisibleChange={visible => { selectOpen.current = visible; }} />
            </Field>
            <Field label="保全法院" id={`${fieldId}-court`}><Input id={`${fieldId}-court`} value={court} onChange={setCourt} /></Field>
            <Field label="裁定书编号" id={`${fieldId}-ruling`}><Input id={`${fieldId}-ruling`} value={rulingNumber} onChange={setRulingNumber} /></Field>
            <Field label="跟进负责人" id={`${fieldId}-owner`}>
              <Select<string> id={`${fieldId}-owner`} aria-labelledby={`${fieldId}-owner-label`}
                value={ownerId || undefined} onChange={value => { if (typeof value === "string") setOwnerId(value); }} disabled={isPending}
                placeholder="选择负责人" className="w-full" filter motion={false}
                getPopupContainer={() => dialog.current!} onDropdownVisibleChange={visible => { selectOpen.current = visible; }}>
                <Select.Option value="__none__">不指定</Select.Option>
                {editCase?.ownerId && !users.some(u => u.id === editCase.ownerId) && <Select.Option value={editCase.ownerId}>{editCase.owner?.name ?? "当前负责人不可用，请重新选择"}</Select.Option>}
                {users.map(u => <Select.Option key={u.id} value={u.id}>{u.name}</Select.Option>)}
              </Select>
            </Field>
          </div>
          {!selectedMatterId && <p className="text-xs text-muted-foreground">不关联案件时须指定有效负责人，仅该负责人可查看此保全记录。</p>}
          <Field label="备注" id={`${fieldId}-note`}><TextArea id={`${fieldId}-note`} value={note} onChange={setNote} rows={2} /></Field>

          {/* First target + property (create only) */}
          {!isEdit && (
            <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">首个被保全人及财产（可后续添加更多）</p>
              <Field label="被保全人" id={`${fieldId}-target`}><Input id={`${fieldId}-target`} value={target} onChange={setTarget} /></Field>
              {target && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="财产类型" id={`${fieldId}-property`}>
                    <Select<PropertyType> id={`${fieldId}-property`} aria-labelledby={`${fieldId}-property-label`}
                      value={propertyType} onChange={value => { if (typeof value === "string") setPropertyType(value); }} disabled={isPending}
                      optionList={propertyOptions} className="w-full" motion={false} getPopupContainer={() => dialog.current!}
                      onDropdownVisibleChange={visible => { selectOpen.current = visible; }} />
                  </Field>
                  <Field label="保全金额" id={`${fieldId}-amount`}><Input id={`${fieldId}-amount`} type="number" value={amount} onChange={setAmount} placeholder="0.00" /></Field>
                  <Field label="财产详情" id={`${fieldId}-detail`}><Input id={`${fieldId}-detail`} value={propertyDetail} onChange={setPropertyDetail} placeholder="账号、地址或车牌" /></Field>
                  <Field label="生效日期" id={`${fieldId}-start`}><Input id={`${fieldId}-start`} type="date" value={startDate} onChange={setStartDate} /></Field>
                  <Field label="到期日（法院文书载明）" id={`${fieldId}-expiry`}><Input id={`${fieldId}-expiry`} type="date" value={expiryDate} onChange={setExpiryDate} aria-required={true} /></Field>
                  <div className="col-span-2"><ExpiryHint startDate={startDate} expiryDate={expiryDate} propertyType={propertyType} /></div>
                </div>
              )}
            </div>
          )}
        </fieldset>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="light" type="tertiary" onClick={() => handleOpenChange(false)} disabled={isPending}>取消</Button>
          <Button theme="solid" aria-busy={isPending} onClick={handleSubmit} disabled={isPending || (isEdit && !dirty) || (!selectedMatterId && !selectedOwnerId)}>
            {isEdit ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * F-2（2026-09-21 用户确认方向，第六轮体检）：到期日是法院文书画载的第一事实，
 * 必填录入；法定上限（民诉法解释第 485 条）推算值降级为校验参考——晚于上限须
 * 确认后保存（超出部分不受强制保护），短于上限仅提示（法院裁定更短常见）。
 */
function expiryFacts(startDate: string, expiryDate: string, propertyType: PropertyType) {
  const sd = startCivil(startDate);
  const ed = expiryDate ? validatedCivil(expiryDate) : null;
  const ref = defaultExpiryDate(sd, propertyType); // 法定上限推算
  const days = ed ? Math.round((ed.getTime() - sd.getTime()) / 86_400_000) : null;
  return {
    ref,
    refKey: civilKey(ref),
    days,
    overLimit: Boolean(ed && ed.getTime() > ref.getTime() + 86_400_000), // 晚于上限（留一天容差）
    underLimit: Boolean(ed && ed.getTime() < ref.getTime() - 86_400_000)
  };
}

function ExpiryHint({ startDate, expiryDate, propertyType }: { startDate: string; expiryDate: string; propertyType: PropertyType }) {
  let f: ReturnType<typeof expiryFacts>;
  try { f = expiryFacts(startDate, expiryDate, propertyType); }
  catch { return <p role="status" className="text-xs text-muted-foreground">日期尚未完整或无效，请核对后查看期限参考。</p>; }
  return (
    <div className="text-xs space-y-1" style={{ color: "var(--t-muted)" }}>
      <div>法定上限（民诉法解释第 485 条）：{f.refKey}{f.days != null ? ` · 按录入到期日折算 ${f.days} 天` : ""}</div>
      {f.overLimit ? (
        <div style={{ color: "var(--red)" }}>⚠ 录入的到期日晚于法定上限——超出部分不受强制保护，请核对法院协助执行通知书后确认保存。</div>
      ) : f.underLimit ? (
        <div style={{ color: "var(--amber)" }}>录入的到期日短于法定上限（法院裁定更短属常见，以文书为准）。</div>
      ) : null}
    </div>
  );
}

// ── Add Target ──

export function AddTargetDialog({ open, onOpenChange, caseId }: { open: boolean; onOpenChange: (o: boolean) => void; caseId: string }) {
  const [isPending, startTransition] = useTransition();
  const fieldId = useId();
  const [name, setName] = useState("");

  function handleSubmit() {
    if (isPending || !name.trim()) return;
    startTransition(async () => {
      try {
        await addTarget({ caseId, name });
        Toast.success("被保全人已添加");
        setName("");
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>添加被保全人</DialogTitle></DialogHeader>
        <FormDialogBody>
        <Field label="被保全人名称" id={fieldId}><Input id={fieldId} value={name} onChange={setName} aria-required={true} /></Field>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="light" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button theme="solid" aria-busy={isPending} onClick={handleSubmit} disabled={isPending || !name.trim()}>添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Property ──

export function AddPropertyDialog({ open, onOpenChange, targetId }: { open: boolean; onOpenChange: (o: boolean) => void; targetId: string }) {
  const [isPending, startTransition] = useTransition();
  const dialog = useRef<HTMLDivElement>(null);
  const selectOpen = useRef(false);
  const fieldId = useId();
  const [propertyType, setPropertyType] = useState<PropertyType>("BANK_DEPOSIT");
  const [propertyDetail, setPropertyDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  // F-2：到期日（法院文书载明）必填，天数按到期日折算派生
  const [expiryDate, setExpiryDate] = useState("");

  async function handleSubmit() {
    if (isPending) return;
    if (!expiryDate) {
      Notification.error({ title: "请填写法院文书载明的到期日", duration: 6 });
      return;
    }
    let sd: Date, ed: Date, f: ReturnType<typeof expiryFacts>;
    try { sd = startCivil(startDate); ed = validatedCivil(expiryDate); f = expiryFacts(startDate, expiryDate, propertyType); }
    catch { Notification.error({ title: "请填写有效的生效日期与到期日", duration: 6 }); return; }
    if (f.overLimit) {
      const okToSave = await confirmDialog({
        title: "到期日晚于法定上限",
        description: `法定上限为 ${f.refKey}，录入为 ${expiryDate}。超出上限的部分不受强制保护（民诉法解释第 485 条）。请核对法院协助执行通知书，确认按录入日期保存？`,
        confirmText: "按录入日期保存",
        danger: true
      });
      if (!okToSave) return;
    }
    const dur = f.days ?? defaultDurationDays(sd, propertyType);

    startTransition(async () => {
      try {
        await addProperty({
          targetId,
          propertyType,
          propertyDetail,
          amount: amount ? parseFloat(amount) : null,
          startDate: sd,
          duration: dur,
          expiryDate: ed,
        });
        Toast.success("财产已添加");
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "添加失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!isPending) onOpenChange(next); }}>
      <DialogContent ref={dialog} className="max-w-md" onEscapeKeyDown={event => { if (selectOpen.current) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>添加保全财产</DialogTitle><DialogDescription>登记财产及法院文书载明的期限。</DialogDescription></DialogHeader>
        <FormDialogBody>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="财产类型" id={`${fieldId}-property`}>
              <Select<PropertyType> id={`${fieldId}-property`} aria-labelledby={`${fieldId}-property-label`}
                value={propertyType} onChange={value => { if (typeof value === "string") setPropertyType(value); }} disabled={isPending}
                optionList={propertyOptions} className="w-full" motion={false} getPopupContainer={() => dialog.current!}
                onDropdownVisibleChange={visible => { selectOpen.current = visible; }} />
            </Field>
            <Field label="保全金额" id={`${fieldId}-amount`}><Input id={`${fieldId}-amount`} type="number" value={amount} onChange={setAmount} placeholder="0.00" /></Field>
            <Field label="财产详情" id={`${fieldId}-detail`}><Input id={`${fieldId}-detail`} value={propertyDetail} onChange={setPropertyDetail} placeholder="账号、地址或车牌" /></Field>
            <Field label="生效日期" id={`${fieldId}-start`}><Input id={`${fieldId}-start`} type="date" value={startDate} onChange={setStartDate} /></Field>
            <Field label="到期日（法院文书载明）" id={`${fieldId}-expiry`}><Input id={`${fieldId}-expiry`} type="date" value={expiryDate} onChange={setExpiryDate} aria-required={true} /></Field>
          </div>
          <ExpiryHint startDate={startDate} expiryDate={expiryDate} propertyType={propertyType} />
        </div>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="light" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button theme="solid" aria-busy={isPending} onClick={handleSubmit} disabled={isPending}>添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Renew Property ──

export function RenewPropertyDialog({ open, onOpenChange, property }: { open: boolean; onOpenChange: (o: boolean) => void; property: { id: string; expiryDate: Date } }) {
  const [isPending, startTransition] = useTransition();
  const [days, setDays] = useState("365");
  const [note, setNote] = useState("");

  const fieldId = useId();
  const duration = Number(days);
  const newExpiry = new Date(property.expiryDate.getTime() + duration * 86_400_000);
  const validDuration = Number.isInteger(duration) && duration > 0 && Number.isFinite(newExpiry.getTime());

  function handleSubmit() {
    if (!validDuration || isPending) return;
    startTransition(async () => {
      try {
        await renewProperty({ propertyId: property.id, newExpiryDate: newExpiry, renewalDuration: duration, note });
        Toast.success("续保成功");
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "续保失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>续保</DialogTitle></DialogHeader>
        <FormDialogBody>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">当前到期日：{formatDate(property.expiryDate)}</p>
          <Field label="续保天数" id={`${fieldId}-days`}>
            <Input id={`${fieldId}-days`} type="number" value={days} onChange={setDays} disabled={isPending}
              aria-required={true} aria-describedby={`${fieldId}-next-expiry`} validateStatus={validDuration ? "default" : "error"} />
            <p id={`${fieldId}-next-expiry`} className="text-xs text-muted-foreground">
              {validDuration ? `续保后到期日：${formatDate(newExpiry)}` : "请输入大于 0 的整数天数。"}
            </p>
          </Field>
          <Field label="备注" id={`${fieldId}-note`}><Input id={`${fieldId}-note`} value={note} onChange={setNote} disabled={isPending} /></Field>
        </div>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="light" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button theme="solid" aria-busy={isPending} disabled={isPending || !validDuration} onClick={handleSubmit}>确认续保</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared ──

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label id={`${id}-label`} htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
