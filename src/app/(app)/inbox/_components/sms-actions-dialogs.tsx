"use client";

import { DeadlineDueFields } from "@/components/matters/deadline-due-fields";
import { deadlineDueDraft, deadlineDueFromDraft } from "@/lib/deadline-due";

import { useRef, useState, useTransition } from "react";
import { Loader2, Gavel, Clock, FileDigit } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button, Input, Select, TextArea } from "@douyinfe/semi-ui";
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
      toast.error("请选择程序");
      return;
    }
    const d = dateStr ? parseLocalInput(dateStr) : null;
    if (!d) {
      toast.error("请填写有效的开庭时间");
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
        toast.success("已生成开庭并标记此短信处理完成");
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={(event) => { if (pickerOpen) event.preventDefault(); }} className="max-h-[88vh] w-[92vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-primary" />
            生成开庭 · {matter.internalCode} {matter.title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <div id={"sms-0-select-1-label-" + sms.id} className="text-[11px]">关联程序 *</div>
            <Select aria-labelledby={"sms-0-select-1-label-" + sms.id}
              className="mt-2 w-full"
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setPickerOpen}
              optionList={matter.procedures.map((p) => ({
                value: p.id,
                label: `${p.customLabel ?? procedureTypeLabel[p.type]}${p.caseNumber ? ` · ${p.caseNumber}` : ""}`
              }))}
              value={procedureId}
              onChange={(value) => setProcedureId(value as string)}
            />
          </div>

          <div>
            <div className="text-[11px]">标题 *</div>
            <Input disabled={pending} aria-label="标题"
              value={title}
              onChange={setTitle}
              placeholder="开庭 / 二审庭审 / 询问"
              className="mt-1"
            />
          </div>

          <div>
            <div className="text-[11px]">开庭时间 *</div>
            <Input disabled={pending} aria-label="开庭时间"
              type="datetime-local"
              value={dateStr}
              onChange={setDateStr}
              className="mt-1"
            />
          </div>

          <div>
            <div className="text-[11px]">法庭</div>
            <Input disabled={pending} aria-label="法庭" value={room} onChange={setRoom} className="mt-1" />
          </div>

          <div>
            <div className="text-[11px]">承办法官</div>
            <Input disabled={pending} aria-label="承办法官" value={judge} onChange={setJudge} className="mt-1" />
          </div>

          <div className="md:col-span-2">
            <div className="text-[11px]">备注</div>
            <TextArea disabled={pending} aria-label="备注"
              value={notes}
              onChange={setNotes}
              rows={2}
              className="mt-1 text-[12px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button theme="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button theme="solid" onClick={submit} disabled={pending}>
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
  const [procedurePickerOpen, setProcedurePickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const submit = () => {
    if (!procedureId) {
      toast.error("请选择程序");
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
        toast.success("已生成期限并标记此短信处理完成");
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={(event) => { if (procedurePickerOpen || categoryPickerOpen) event.preventDefault(); }} className="max-h-[88vh] w-[92vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            生成期限 · {matter.internalCode} {matter.title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <div id={"sms-1-select-1-label-" + sms.id} className="text-[11px]">关联程序 *</div>
            <Select aria-labelledby={"sms-1-select-1-label-" + sms.id}
              className="mt-2 w-full"
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setProcedurePickerOpen}
              optionList={matter.procedures.map((p) => ({
                value: p.id,
                label: `${p.customLabel ?? procedureTypeLabel[p.type]}${p.caseNumber ? ` · ${p.caseNumber}` : ""}`
              }))}
              value={procedureId}
              onChange={(value) => setProcedureId(value as string)}
            />
          </div>

          <div className="md:col-span-2">
            <div id={"sms-1-select-2-label-" + sms.id} className="text-[11px]">期限类别 *</div>
            <Select aria-labelledby={"sms-1-select-2-label-" + sms.id}
              className="mt-2 w-full"
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setCategoryPickerOpen}
              optionList={DEADLINE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              value={category}
              onChange={(v) => setCategory(v as DeadlineCategory)}
            />
          </div>

          <div className="md:col-span-2">
            <div className="text-[11px]">标题 *</div>
            <Input disabled={pending} aria-label="标题"
              value={title}
              onChange={setTitle}
              placeholder="上诉期 15 日 / 举证期限 30 日"
              className="mt-1"
            />
          </div>

          <DeadlineDueFields value={dueDraft} onChange={setDueDraft} disabled={pending} />

          <div>
            <div className="text-[11px]">提前提醒（天）</div>
            <Input disabled={pending} aria-label="提前提醒（天）"
              type="number"
              min={1}
              max={30}
              value={remindDays}
              onChange={(value) => setRemindDays(Math.max(1, parseInt(value) || 3))}
              className="mt-1"
            />
          </div>

          <div className="md:col-span-2">
            <div className="text-[11px]">期限依据</div>
            <TextArea disabled={pending} aria-label="期限依据"
              value={basis}
              onChange={setBasis}
              rows={2}
              className="mt-1 text-[12px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button theme="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button theme="solid" onClick={submit} disabled={pending}>
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
  const [numberPickerOpen, setNumberPickerOpen] = useState(false);
  const [procedurePickerOpen, setProcedurePickerOpen] = useState(false);

  const submit = () => {
    if (!caseNumber || !procedureId) {
      toast.error("请选择案号和目标程序");
      return;
    }
    startTransition(async () => {
      try {
        await backfillCaseNumberFromSms({ smsId: sms.id, procedureId, caseNumber });
        toast.success(`案号已回填：${caseNumber}`);
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "回填失败");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent ref={dialogRef} onEscapeKeyDown={(event) => { if (numberPickerOpen || procedurePickerOpen) event.preventDefault(); }} className="w-[92vw] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDigit className="h-4 w-4 text-primary" />
            案号回填 · {matter.internalCode}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div id={"sms-2-select-1-label-" + sms.id} className="text-[11px]">短信解析出的案号 *</div>
            <Select aria-labelledby={"sms-2-select-1-label-" + sms.id}
              className="mt-2 w-full"
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setNumberPickerOpen}
              optionList={candidateNumbers.map((n) => ({ value: n, label: n }))}
              value={caseNumber}
              onChange={(value) => setCaseNumber(value as string)}
            />
          </div>
          <div>
            <div id={"sms-2-select-2-label-" + sms.id} className="text-[11px]">回填到程序（仅列出尚无案号的程序） *</div>
            <Select aria-labelledby={"sms-2-select-2-label-" + sms.id}
              className="mt-2 w-full"
              disabled={pending}
              motion={false}
              getPopupContainer={() => dialogRef.current!}
              onDropdownVisibleChange={setProcedurePickerOpen}
              optionList={emptyProcedures.map((p) => ({
                value: p.id,
                label: p.customLabel ?? procedureTypeLabel[p.type]
              }))}
              value={procedureId}
              onChange={(value) => setProcedureId(value as string)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            已有案号的程序不可覆盖；如需更正请到案件详情的程序信息中修改。
          </p>
        </div>

        <DialogFooter>
          <Button theme="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button theme="solid" onClick={submit} disabled={pending || !caseNumber || !procedureId}>
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
