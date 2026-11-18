"use client";

import { Button, Input, Select, TextArea, Notification, Toast } from "@douyinfe/semi-ui";

import { DeadlineDueFields } from "@/components/matters/deadline-due-fields";
import { deadlineDueDraft, deadlineDueFromDraft } from "@/lib/deadline-due";

import { useId, useRef, useState, useTransition } from "react";
import { Loader2, Gavel, Clock, FileDigit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  backfillCaseNumberFromSms,
  generateHearingFromSms,
  generateDeadlineFromSms
} from "@/server/sms/actions";
import type { SmsRow, MatterOption, ParsedJson } from "./sms-types";
import { toDate } from "@/lib/sms-parser";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { procedureTypeLabel } from "@/lib/enums";
import { actionErrorMessage } from "@/lib/action-error";

// v0.51: 程序默认选中——优先取案号与短信解析案号一致的程序
function preferredProcedureId(
  procedures: NonNullable<SmsRow["matchedMatter"]>["procedures"],
  parsed: ParsedJson
) {
  const hit = procedures.find(
    (p) => p.caseNumber && parsed.caseNumbers.includes(p.caseNumber)
  );
  return hit?.id ?? procedures[0]?.id ?? "";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生成 Hearing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GenerateHearingDialog({
  open,
  onOpenChange,
  sms,
  matter
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sms: SmsRow;
  matter: NonNullable<SmsRow["matchedMatter"]>;
}) {
  const formId = useId();
  const parsed = sms.parsedJson as unknown as ParsedJson;
  const [procedureId, setProcedureId] = useState(preferredProcedureId(matter.procedures, parsed));
  const [title, setTitle] = useState(parsed.smsType === "HEARING_NOTICE" ? "开庭" : "庭审");
  const initDate = parsed.hearingDate ? toDate(parsed.hearingDate) : null;
  const [dateStr, setDateStr] = useState(
    initDate ? formatLocal(initDate) : ""
  );
  const [room, setRoom] = useState(parsed.courtRoom ?? "");
  const [judge, setJudge] = useState(parsed.judge ?? "");
  const [notes, setNotes] = useState(parsed.summary);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const submit = () => {
    if (!procedureId) {
      Notification.error({ title: "请选择程序", duration: 6 });
      return;
    }
    const d = dateStr ? parseLocalInput(dateStr) : null;
    if (!d) {
      Notification.error({ title: "请填写有效的开庭时间", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        await generateHearingFromSms({
          smsId: sms.id,
          procedureId,
          title: title.trim() || "庭审",
          startsAt: d,
          room: room.trim(),
          judge: judge.trim(),
          notes: notes.trim()
        });
        Toast.success("已生成开庭并标记此短信处理完成");
        onOpenChange(false);
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "失败", duration: 6 });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={event => { if (pickerOpen) event.preventDefault(); }} className="max-h-[88vh] w-[92vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-primary" />
            生成开庭 · {matter.internalCode} {matter.title}
          </DialogTitle>
        </DialogHeader>

        <fieldset disabled={pending} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label id={`${formId}-procedure-label`} className="text-[11px]">关联程序 *</label>
            <Select<string>
              aria-labelledby={`${formId}-procedure-label`}
              className="mt-2"
              style={{ width: "100%" }}
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setPickerOpen}
              optionList={matter.procedures.map((p) => ({
                value: p.id,
                label: `${p.customLabel ?? procedureTypeLabel[p.type]}${p.caseNumber ? ` · ${p.caseNumber}` : ""}`
              }))}
              value={procedureId}
              onChange={value => { if (typeof value === "string") setProcedureId(value); }}
            />
          </div>

          <div>
            <label htmlFor={`${formId}-title`} className="text-[11px]">标题 *</label>
            <Input
              id={`${formId}-title`} value={title}
              onChange={setTitle}
              placeholder="开庭 / 二审庭审 / 询问"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor={`${formId}-date`} className="text-[11px]">开庭时间 *</label>
            <Input
              type="datetime-local"
              id={`${formId}-date`} value={dateStr}
              onChange={setDateStr}
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor={`${formId}-room`} className="text-[11px]">法庭</label>
            <Input id={`${formId}-room`} value={room} onChange={setRoom} className="mt-1" />
          </div>

          <div>
            <label htmlFor={`${formId}-judge`} className="text-[11px]">承办法官</label>
            <Input id={`${formId}-judge`} value={judge} onChange={setJudge} className="mt-1" />
          </div>

          <div className="md:col-span-2">
            <label htmlFor={`${formId}-notes`} className="text-[11px]">备注</label>
            <TextArea
              id={`${formId}-notes`} value={notes}
              onChange={setNotes}
              rows={2}
              className="mt-1 text-[12px]"
            />
          </div>
        </fieldset>

        <DialogFooter>
          <Button theme="outline" type="tertiary" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            生成开庭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生成 Deadline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DEADLINE_CATEGORIES = [
  { value: "APPEAL", label: "上诉期" },
  { value: "EVIDENCE", label: "举证期" },
  { value: "RESPONSE", label: "答辩期" },
  { value: "PERFORMANCE", label: "履行期" },
  { value: "ENFORCEMENT", label: "执行期" },
  { value: "LIMITATION", label: "诉讼时效" },
  { value: "ARBITRATION_SET_ASIDE", label: "撤裁期" },
  { value: "CUSTOM", label: "其他" }
] as const;
type DeadlineCategory = (typeof DEADLINE_CATEGORIES)[number]["value"];

// v0.51: 重要事项分类 → 期限类别（importantItems 比 smsType 更细）
const ITEM_KIND_TO_CATEGORY: Partial<Record<string, DeadlineCategory>> = {
  EVIDENCE_DEADLINE: "EVIDENCE",
  FEE_DEADLINE: "PERFORMANCE",
  APPEAL: "APPEAL",
  PERFORMANCE: "PERFORMANCE",
  ENFORCEMENT: "ENFORCEMENT"
};

function firstDeadlineItem(parsed: ParsedJson) {
  return parsed.importantItems.find(
    (item) => item.category === "DEADLINE" && ITEM_KIND_TO_CATEGORY[item.kind]
  );
}

function pickDefaultDeadlineTitle(parsed: ParsedJson): { title: string; category: DeadlineCategory } {
  const item = firstDeadlineItem(parsed);
  if (item) {
    return { title: item.title, category: ITEM_KIND_TO_CATEGORY[item.kind] ?? "CUSTOM" };
  }
  if (parsed.appealDeadline) return { title: `上诉期 ${parsed.appealDeadline}`, category: "APPEAL" };
  if (parsed.smsType === "EVIDENCE_SUBMIT") return { title: "举证期限", category: "EVIDENCE" };
  if (parsed.smsType === "FEE_NOTICE") return { title: "诉讼费缴纳", category: "PERFORMANCE" };
  if (parsed.smsType === "JUDGMENT_NOTICE") return { title: "判决书生效 / 履行期", category: "PERFORMANCE" };
  return { title: parsed.summary.slice(0, 30) || "期限", category: "CUSTOM" };
}

function pickDefaultDueDate(parsed: ParsedJson): Date | null {
  // v0.51: 优先用重要事项自带的日期
  const item = firstDeadlineItem(parsed);
  if (item?.dateText) {
    const d = toDate(item.dateText);
    if (d) return d;
  }
  // 上诉期：默认从判决日 + N 日；若无判决日则空
  if (parsed.appealDeadline && parsed.judgmentDate) {
    const base = toDate(parsed.judgmentDate);
    const days = parseInt(parsed.appealDeadline);
    if (base && !isNaN(days)) {
      // 按毫秒加整天，避开浏览器本地时区的夏令时切换（setDate 会在切换日偏一小时）
      return new Date(base.getTime() + days * 86_400_000);
    }
  }
  // 其他：取 dates 中第一个日期
  for (const s of parsed.dates) {
    const d = toDate(s);
    if (d) return d;
  }
  return null;
}

export function GenerateDeadlineDialog({
  open,
  onOpenChange,
  sms,
  matter
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sms: SmsRow;
  matter: NonNullable<SmsRow["matchedMatter"]>;
}) {
  const formId = useId();
  const parsed = sms.parsedJson as unknown as ParsedJson;
  const defaults = pickDefaultDeadlineTitle(parsed);
  const initDue = pickDefaultDueDate(parsed);

  const [procedureId, setProcedureId] = useState(preferredProcedureId(matter.procedures, parsed));
  const [title, setTitle] = useState(defaults.title);
  const [category, setCategory] = useState<DeadlineCategory>(defaults.category);
  const [dueDraft, setDueDraft] = useState(() => ({ ...deadlineDueDraft(), date: initDue ? formatLocalDateOnly(initDue) : "" }));
  const [basis, setBasis] = useState(parsed.summary.slice(0, 100));
  const [remindDays, setRemindDays] = useState(3);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  const submit = () => {
    if (!procedureId) {
      Notification.error({ title: "请选择程序", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        await generateDeadlineFromSms({
          smsId: sms.id,
          procedureId,
          title: title.trim() || "期限",
          category,
          ...deadlineDueFromDraft(dueDraft),
          basis: basis.trim(),
          remindDays
        });
        Toast.success("已生成期限并标记此短信处理完成");
        onOpenChange(false);
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "失败", duration: 6 });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={event => { if (openSelect) event.preventDefault(); }} className="max-h-[88vh] w-[92vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            生成期限 · {matter.internalCode} {matter.title}
          </DialogTitle>
        </DialogHeader>

        <fieldset disabled={pending} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label id={`${formId}-procedure-label`} className="text-[11px]">关联程序 *</label>
            <Select<string>
              aria-labelledby={`${formId}-procedure-label`}
              className="mt-2"
              style={{ width: "100%" }}
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={visible => setOpenSelect(current => visible ? "procedure" : current === "procedure" ? null : current)}
              optionList={matter.procedures.map((p) => ({
                value: p.id,
                label: `${p.customLabel ?? procedureTypeLabel[p.type]}${p.caseNumber ? ` · ${p.caseNumber}` : ""}`
              }))}
              value={procedureId}
              onChange={value => { if (typeof value === "string") setProcedureId(value); }}
            />
          </div>

          <div className="md:col-span-2">
            <label id={`${formId}-category-label`} className="text-[11px]">期限类别 *</label>
            <Select<DeadlineCategory>
              aria-labelledby={`${formId}-category-label`}
              className="mt-2"
              style={{ width: "100%" }}
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={visible => setOpenSelect(current => visible ? "category" : current === "category" ? null : current)}
              optionList={DEADLINE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              value={category}
              onChange={(v) => setCategory(v as DeadlineCategory)}
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor={`${formId}-title`} className="text-[11px]">标题 *</label>
            <Input
              id={`${formId}-title`} value={title}
              onChange={setTitle}
              placeholder="上诉期 15 日 / 举证期限 30 日"
              className="mt-1"
            />
          </div>

          <DeadlineDueFields value={dueDraft} onChange={setDueDraft} disabled={pending} />

          <div>
            <label htmlFor={`${formId}-remind`} className="text-[11px]">提前提醒（天）</label>
            <Input
              type="number"
              min={1}
              max={30}
              id={`${formId}-remind`} value={remindDays}
              onChange={value => setRemindDays(Math.max(1, parseInt(value) || 3))}
              className="mt-1"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor={`${formId}-basis`} className="text-[11px]">期限依据</label>
            <TextArea
              id={`${formId}-basis`} value={basis}
              onChange={setBasis}
              rows={2}
              className="mt-1 text-[12px]"
            />
          </div>
        </fieldset>

        <DialogFooter>
          <Button theme="outline" type="tertiary" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            生成期限
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// v0.51: 案号回填
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function BackfillCaseNumberDialog({
  open,
  onOpenChange,
  sms,
  matter
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sms: SmsRow;
  matter: NonNullable<SmsRow["matchedMatter"]>;
}) {
  const formId = useId();
  const parsed = sms.parsedJson as unknown as ParsedJson;
  const usedNumbers = new Set(
    matter.procedures.map((p) => p.caseNumber).filter(Boolean) as string[]
  );
  const candidateNumbers = parsed.caseNumbers.filter((n) => !usedNumbers.has(n));
  const emptyProcedures = matter.procedures.filter((p) => !p.caseNumber);

  const [caseNumber, setCaseNumber] = useState(candidateNumbers[0] ?? "");
  const [procedureId, setProcedureId] = useState(emptyProcedures[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  const submit = () => {
    if (!caseNumber || !procedureId) {
      Notification.error({ title: "请选择案号和目标程序", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        await backfillCaseNumberFromSms({ smsId: sms.id, procedureId, caseNumber });
        Toast.success(`案号已回填：${caseNumber}`);
        onOpenChange(false);
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "回填失败", duration: 6 });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={event => { if (openSelect) event.preventDefault(); }} className="w-[92vw] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDigit className="h-4 w-4 text-primary" />
            案号回填 · {matter.internalCode}
          </DialogTitle>
        </DialogHeader>

        <fieldset disabled={pending} className="space-y-3">
          <div>
            <label id={`${formId}-number-label`} className="text-[11px]">短信解析出的案号 *</label>
            <Select<string>
              aria-labelledby={`${formId}-number-label`}
              className="mt-2"
              style={{ width: "100%" }}
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={visible => setOpenSelect(current => visible ? "number" : current === "number" ? null : current)}
              optionList={candidateNumbers.map((n) => ({ value: n, label: n }))}
              value={caseNumber}
              onChange={value => { if (typeof value === "string") setCaseNumber(value); }}
            />
          </div>
          <div>
            <label id={`${formId}-procedure-label`} className="text-[11px]">回填到程序（仅列出尚无案号的程序） *</label>
            <Select<string>
              aria-labelledby={`${formId}-procedure-label`}
              className="mt-2"
              style={{ width: "100%" }}
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={visible => setOpenSelect(current => visible ? "procedure" : current === "procedure" ? null : current)}
              optionList={emptyProcedures.map((p) => ({
                value: p.id,
                label: p.customLabel ?? procedureTypeLabel[p.type]
              }))}
              value={procedureId}
              onChange={value => { if (typeof value === "string") setProcedureId(value); }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            已有案号的程序不可覆盖；如需更正请到案件详情的程序信息中修改。
          </p>
        </fieldset>

        <DialogFooter>
          <Button theme="outline" type="tertiary" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending || !caseNumber || !procedureId}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            回填案号
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// datetime-local / date 输入框的值是上海墙钟时间：回填按上海时区取字段，
// 解析按 +08:00 固定偏移构造（上海无夏令时），与浏览器时区无关
function formatLocal(d: Date): string {
  return `${shDayKey(d)}T${shTime(d)}`;
}
function formatLocalDateOnly(d: Date): string {
  return shDayKey(d);
}
function parseLocalInput(value: string): Date | null {
  const d = new Date(value.length === 16 ? `${value}:00+08:00` : `${value}T12:00+08:00`);
  return isNaN(d.getTime()) ? null : d;
}

// 让 MatterCombobox 类型在该模块可见（重导以便 inbox-view 使用）
export type { MatterOption };
