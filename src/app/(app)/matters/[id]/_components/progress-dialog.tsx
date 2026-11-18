"use client";

import { ChoiceField } from "@/components/patterns/choice-field";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, Button, Input, TextArea, Toast } from "@douyinfe/semi-ui";
import { Loader2 } from "lucide-react";
import { createNote, updateNote, type NoteCreateInput } from "@/server/notes/actions";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { JUDGMENT_NOTE_TAG, stageNoteTag, type WorkflowNote } from "./procedure-workflow-panel";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type Mode = "record" | "judgment";
const CHANNELS = [
  { value: "COURT", label: "法院沟通/送达" },
  { value: "PHONE", label: "电话" },
  { value: "WECHAT", label: "微信" },
  { value: "EMAIL", label: "邮件" },
  { value: "MEETING", label: "面谈/会见" },
  { value: "OTHER", label: "其他" }
] as const;
const shInput = (value: Date) => `${shDayKey(value)}T${shTime(value)}`;

/** Each opening mounts a fresh form. A server refresh must not replace the observed edit snapshot. */
export function ProgressDialog({ open, onOpenChange, matterId, initialMode = "record", initialStage, stageNames, note, canWrite = true }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  initialMode?: Mode;
  initialStage?: string;
  stageNames: string[];
  note?: WorkflowNote;
  canWrite?: boolean;
}) {
  const selectLabelId = useId();
  const router = useRouter();
  const fieldId = useId();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const confirmingClose = useRef(false);
  const [returnTarget] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [original] = useState(() => note ? { ...note, tags: [...note.tags], occurredAt: new Date(note.occurredAt), updatedAt: new Date(note.updatedAt) } : null);
  const [baseline] = useState(() => ({
    mode: (original ? original.tags.includes(JUDGMENT_NOTE_TAG) ? "judgment" : "record" : initialMode) as Mode,
    channel: (original?.channel ?? "COURT") as NoteCreateInput["channel"],
    withWhom: original?.withWhom ?? "",
    occurredAt: shInput(original?.occurredAt ?? new Date()),
    content: original?.content ?? "",
    stage: original ? original.tags.find(tag => tag.startsWith("环节:"))?.slice(3) ?? "" : initialStage ?? ""
  }));
  const [mode, setMode] = useState(baseline.mode);
  const [channel, setChannel] = useState(baseline.channel);
  const [withWhom, setWithWhom] = useState(baseline.withWhom);
  const [occurredAt, setOccurredAt] = useState(baseline.occurredAt);
  const [content, setContent] = useState(baseline.content);
  const [stage, setStage] = useState(baseline.stage);
  const [error, setError] = useState("");
  const dirty = mode !== baseline.mode || channel !== baseline.channel || withWhom !== baseline.withWhom
    || occurredAt !== baseline.occurredAt || content !== baseline.content || stage !== baseline.stage;
  const availableStages = [...new Set([...stageNames, ...(baseline.stage ? [baseline.stage] : [])])];

  async function close() {
    if (busy.current || pending || confirmingClose.current) return;
    confirmingClose.current = true;
    try {
      if (dirty && !await confirmDialog({ title: "放弃未保存的记录？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
      onOpenChange(false);
    } finally { confirmingClose.current = false; }
  }

  function submit() {
    if (busy.current || !canWrite) return;
    if (!content.trim()) { setError(mode === "judgment" ? "请填写研判内容" : "请填写记录内容"); return; }
    const time = original && occurredAt === baseline.occurredAt ? original.occurredAt : new Date(`${occurredAt}:00+08:00`);
    if (!Number.isFinite(time.getTime())) { setError("请填写有效的发生时间"); return; }
    // Only the displayed stage tag is managed here; preserve all other original tags.
    let tags: string[];
    if (original) {
      const managedTagIndex = original.tags.findIndex(tag => tag.startsWith("环节:"));
      tags = stage === baseline.stage ? [...original.tags]
        : [...original.tags.filter((_, index) => index !== managedTagIndex), ...(stage ? [stageNoteTag(stage)] : [])];
    } else tags = [...(mode === "judgment" ? [JUDGMENT_NOTE_TAG] : []), ...(stage ? [stageNoteTag(stage)] : [])];
    const input: NoteCreateInput = { matterId, channel: !original && mode === "judgment" ? "OTHER" : channel,
      withWhom: !original && mode === "judgment" ? "" : withWhom, occurredAt: time, content: content.trim(), tags };
    busy.current = true;
    setError("");
    startTransition(async () => {
      try {
        if (original) await updateNote({ ...input, id: original.id, expectedUpdatedAt: original.updatedAt });
        else await createNote(input);
        Toast.success(original ? "记录已更新" : mode === "judgment" ? "研判已保存" : "记录已保存");
        onOpenChange(false);
        router.refresh();
      } catch (cause) {
        setError(actionErrorMessage(cause));
      } finally { busy.current = false; }
    });
  }

  return <Dialog open={open} onOpenChange={next => { if (!next) void close(); }}>
    <FormDialogContent className="sm:max-w-[560px]" onCloseAutoFocus={event => {
      event.preventDefault();
      const target = returnTarget?.isConnected && !returnTarget.closest("[hidden]") ? returnTarget : document.querySelector<HTMLElement>('[aria-label="记录"]');
      if (target?.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
    }}>
      <DialogHeader>
        <DialogTitle>{original ? "编辑" : "记录办案进展 · "}{mode === "judgment" ? "研判" : "沟通"}</DialogTitle>
        <DialogDescription>{mode === "judgment" ? "记录判断与分析，保存后写入审计。" : "记录已发生的沟通、送达、会见等事实。"}</DialogDescription>
      </DialogHeader>
      <FormDialogBody>
        {!canWrite ? <p role="alert" className="mb-3 text-sm text-destructive">当前已无此案件的记录写入资格，输入仍保留。</p> : null}
        <fieldset disabled={pending || !canWrite} className="space-y-3.5">
          {!original ? <ChoiceField ariaLabel="记录方式" options={[{ value: "record", label: "沟通" }, { value: "judgment", label: "研判" }]} value={mode} onChange={setMode} /> : null}
          {mode === "record" ? <>
            <div className="space-y-1.5"><label className="text-sm font-medium text-[var(--semi-color-text-1)]">类型</label><ChoiceField options={CHANNELS.map(item => ({ ...item }))} value={channel} onChange={setChannel} ariaLabel="沟通类型" threshold={6} /></div>
            <div className="space-y-1.5"><label htmlFor={`${fieldId}-with`} className="text-sm font-medium text-[var(--semi-color-text-1)]">对象</label><Input id={`${fieldId}-with`} value={withWhom} onChange={inputValue => setWithWhom(inputValue)} placeholder="如：长宁法院 · 书记员" maxLength={80} /></div>
          </> : null}
          <div className="space-y-1.5"><label htmlFor={`${fieldId}-time`} className="text-sm font-medium text-[var(--semi-color-text-1)]">发生时间</label><Input id={`${fieldId}-time`} type="datetime-local" value={occurredAt} onChange={inputValue => setOccurredAt(inputValue)} /></div>
          {availableStages.length > 0 ? <div className="space-y-1.5">
            <label id={selectLabelId + "-1"} className="text-sm font-medium text-[var(--semi-color-text-1)]">环节标签（可选）</label>
            <Select value={stage || "__none__"} onChange={value => { if (typeof value === "string") setStage(value === "__none__" ? "" : value); }} disabled={pending || !canWrite} aria-labelledby={selectLabelId + "-1"} className="w-full" motion={false}><Select.Option value="__none__">不标注环节</Select.Option>{availableStages.map(name => <Select.Option key={name} value={name}>{name}</Select.Option>)}</Select>
          </div> : null}
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-content`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{mode === "judgment" ? "研判内容" : "记录内容"}</label>
            <TextArea
              id={`${fieldId}-content`}
              rows={mode === "judgment" ? 7 : 4}
              value={content}
              onChange={inputValue => setContent(inputValue)}
              maxLength={5000}
              placeholder={mode === "judgment" ? "如：争议焦点与举证思路" : "如：签收法院送达材料 2 份"} />
          </div>
        </fieldset>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">保存失败：{error}</p> : null}
      </FormDialogBody>
      <DialogFooter>
        <Button onClick={() => void close()} disabled={pending} htmlType="button" type="tertiary" theme="outline">取消</Button>
        <Button onClick={submit} disabled={pending || !canWrite} htmlType="button" theme="solid">{pending ? <Loader2 className="animate-spin" /> : null}保存</Button>
      </DialogFooter>
    </FormDialogContent>
  </Dialog>;
}
