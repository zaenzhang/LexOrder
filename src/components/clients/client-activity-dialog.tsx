"use client";

import { Button, Checkbox, Input, Select, TextArea, Toast } from "@douyinfe/semi-ui";

import { useEffect, useRef, useState, useTransition, type FormEvent, type RefObject } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { clientChannelLabels, fromShanghaiInput, toShanghaiInput, type ClientActivityInput } from "@/lib/clients/relationship";
import type { PersonalFollowUp } from "@/lib/clients/follow-ups";
import { getPersonalFollowUp, recordClientActivity } from "@/server/clients/relationship-actions";
import { PersonalFollowUpRescheduleHistory } from "./client-follow-up-reschedule-dialog";

export type ClientActivityMode = { id?: string; title?: string; status: "COMPLETED" | "CANCELLED" };
type Props = {
  clientId: string; mode: ClientActivityMode; verifyPersonalTarget?: boolean;
  onClose(): void; onSaved(): void;
  trigger: RefObject<HTMLElement | null>; fallback: RefObject<HTMLElement | null>;
};

/** One editor for the original client workflow and the exact personal queue target. */
export function ClientActivityDialog({ clientId, mode, verifyPersonalTarget = false, onClose, onSaved, trigger, fallback }: Props) {
  const [pending, start] = useTransition();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [initialOccurredAt] = useState(() => toShanghaiInput(new Date()));
  const [channel, setChannel] = useState<ClientActivityInput["channel"]>(mode.status === "CANCELLED" ? "OTHER" : "PHONE");
  const [content, setContent] = useState("");
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [scheduleNext, setScheduleNext] = useState(false), [nextTitle, setNextTitle] = useState(""), [nextDueAt, setNextDueAt] = useState("");
  const [error, setError] = useState("");
  const [channelOpen, setChannelOpen] = useState(false);
  const [read, setRead] = useState<{ identity: string; value?: PersonalFollowUp; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const editorContent = useRef<HTMLDivElement>(null), closePending = useRef(false), saving = useRef(false), mounted = useRef(true);
  const identity = `${clientId}:${mode.id ?? ""}:result`;
  const current = read?.identity === identity ? read : null;
  const mayEdit = !verifyPersonalTarget || Boolean(current?.value?.canClose);
  const dirty = Boolean(content || scheduleNext || nextTitle || nextDueAt || occurredAt !== initialOccurredAt || channel !== (mode.status === "CANCELLED" ? "OTHER" : "PHONE"));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!verifyPersonalTarget || !mode.id) return;
    let active = true;
    setRead(null);
    void getPersonalFollowUp({ clientId, followUpId: mode.id })
      .then(value => { if (active) setRead({ identity, value }); })
      .catch(cause => { if (active) setRead({ identity, error: actionErrorMessage(cause) }); });
    return () => { active = false; };
  }, [verifyPersonalTarget, clientId, mode.id, identity, attempt]);

  async function requestClose() {
    if (pending || saving.current || closePending.current) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closePending.current = true;
    try {
      if (dirty && !await confirmDialog({ title: "放弃未保存的沟通记录？", confirmText: "放弃更改", cancelText: "继续编辑", initialFocus: "cancel" })) {
        requestAnimationFrame(() => { if (mounted.current) (returnFocus?.isConnected ? returnFocus : editorContent.current)?.focus({ preventScroll: true }); });
        return;
      }
      if (mounted.current) onClose();
    } finally { closePending.current = false; }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayEdit || saving.current) return;
    setError("");
    let input: ClientActivityInput;
    try {
      input = { clientId, requestKey, channel, content, occurredAt: fromShanghaiInput(occurredAt), followUpId: mode.id, closeStatus: mode.status,
        nextFollowUp: scheduleNext ? { title: nextTitle, dueAt: fromShanghaiInput(nextDueAt) } : undefined };
    } catch (cause) { setError(actionErrorMessage(cause)); return; }
    saving.current = true;
    start(async () => {
      try {
        await recordClientActivity(input);
        if (!mounted.current) return;
        Toast.success(mode.id ? mode.status === "CANCELLED" ? "跟进已取消，原因已保存" : "跟进结果已保存" : "沟通记录已保存");
        onSaved();
      } catch (cause) { if (mounted.current) setError(actionErrorMessage(cause) || "保存失败，请重试"); }
      finally { saving.current = false; }
    });
  }
  const title = verifyPersonalTarget && current?.value && !mayEdit ? "查看跟进" : mode.id ? mode.status === "CANCELLED" ? "取消跟进" : "录入跟进结果" : "记录沟通";
  const followUpTitle = verifyPersonalTarget ? current?.value?.title : mode.title;
  return <Dialog open onOpenChange={value => { if (!value) void requestClose(); }}>
    <DialogContent ref={editorContent} onEscapeKeyDown={event => { if (channelOpen) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]" onCloseAutoFocus={event => {
      event.preventDefault();
      const origin = trigger.current;
      const target = origin?.isConnected && !origin.matches(":disabled") && !origin.closest('[hidden], [inert]') ? origin : fallback.current;
      target?.focus({ preventScroll: true });
    }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{followUpTitle ? `${current?.value ? `${current.value.client.name} · ` : ""}${followUpTitle}` : verifyPersonalTarget ? "核对当前跟进及办理资格" : "保留本次沟通内容，并按需要安排下一次跟进。"}</DialogDescription></DialogHeader>
      {current?.value && <p className="text-sm text-muted-foreground"><time dateTime={current.value.dueAt}>{shDayKey(current.value.dueAt)} {shTime(current.value.dueAt)}（北京时间）</time> · {current.value.status === "OPEN" ? "待跟进" : current.value.status === "COMPLETED" ? "已完成" : "已取消"}</p>}
      {verifyPersonalTarget && !current && <p role="status">正在读取跟进…</p>}
      {current?.error && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{current.error}</p><Button htmlType="button" type="tertiary" theme="outline" onClick={() => setAttempt(value => value + 1)}>重新读取跟进</Button></div>}
      {current?.value && !mayEdit && <p role="status">{current.value.status === "COMPLETED" ? "此跟进已完成。" : current.value.status === "CANCELLED" ? "此跟进已取消。" : "当前仅可查看此跟进，不能录入结果。"}</p>}
      {mayEdit ? <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><label id="crm-channel-label" htmlFor="crm-channel">沟通方式</label><Select onDropdownVisibleChange={setChannelOpen} id="crm-channel" aria-labelledby="crm-channel-label" value={channel} onChange={value => setChannel(value as ClientActivityInput["channel"])} disabled={pending} style={{ width: "100%" }} motion={false} getPopupContainer={() => editorContent.current!} optionList={Object.entries(clientChannelLabels).map(([value, label]) => ({ value, label }))} /></div>
            <div className="space-y-1.5"><label htmlFor="crm-occurred">发生时间（北京时间）</label><Input id="crm-occurred" type="datetime-local" required value={occurredAt} onChange={value => setOccurredAt(value)} /></div>
          </div>
          <div className="space-y-1.5"><label htmlFor="crm-content">{mode.status === "CANCELLED" ? "取消原因" : mode.id ? "跟进结果" : "沟通内容"} *</label><TextArea id="crm-content" rows={5} required maxLength={8000} value={content} onChange={value => setContent(value)} placeholder="记录事实、客户需求与已约定事项" /></div>
          <Checkbox checked={scheduleNext} disabled={pending} onChange={event => setScheduleNext(event.target.checked === true)}>安排下次跟进</Checkbox>
          {scheduleNext && <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5"><label htmlFor="crm-next-title">下次跟进事项 *</label><Input id="crm-next-title" required maxLength={200} value={nextTitle} onChange={value => setNextTitle(value)} /></div>
            <div className="space-y-1.5"><label htmlFor="crm-next-due">跟进时间（北京时间）*</label><Input id="crm-next-due" type="datetime-local" required value={nextDueAt} onChange={value => setNextDueAt(value)} /></div>
            <p className="text-xs text-muted-foreground">此项由你负责，可在客户详情中录入结果。</p>
          </div>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button htmlType="button" type="tertiary" theme="outline" disabled={pending} onClick={() => void requestClose()}>返回</Button><Button htmlType="submit" theme="solid" icon={<Check size={16} />} loading={pending} disabled={pending}>保存{mode.status === "CANCELLED" ? "取消原因" : mode.id ? "结果" : "沟通"}</Button></DialogFooter>
      </form> : <DialogFooter><Button htmlType="button" type="tertiary" theme="outline" onClick={() => void requestClose()}>返回列表</Button></DialogFooter>}
      {verifyPersonalTarget && mode.id && current?.value && <PersonalFollowUpRescheduleHistory key={`${identity}:${attempt}:${current.value.updatedAt}`} target={{ clientId, followUpId: mode.id }} />}
    </DialogContent>
  </Dialog>;
}
