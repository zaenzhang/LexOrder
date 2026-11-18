"use client";

import { Button, Input, TextArea, Toast } from "@douyinfe/semi-ui";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type RefObject } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { fromShanghaiInput, toShanghaiInput } from "@/lib/clients/relationship";
import type { PersonalFollowUp, PersonalFollowUpHistoryPage, PersonalFollowUpTarget } from "@/lib/clients/follow-ups";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { getPersonalFollowUp, getPersonalFollowUpRescheduleHistory, rescheduleClientFollowUp } from "@/server/clients/relationship-actions";

const displayTime = (value: string) => `${shDayKey(value)} ${shTime(value)}`;

/** A separate read boundary: expanding or paging this section never submits or resets its host editor. */
export function PersonalFollowUpRescheduleHistory({ target }: { target: PersonalFollowUpTarget }) {
  const identity = `${target.clientId}:${target.followUpId}`;
  const [expanded, setExpanded] = useState(false), [pending, setPending] = useState(false);
  const [data, setData] = useState<PersonalFollowUpHistoryPage | null>(null), [error, setError] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [page, setPage] = useState(0);
  const sequence = useRef(0), mounted = useRef(true), currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { sequence.current++; setExpanded(false); setPending(false); setData(null); setError(""); setCursors([undefined]); setPage(0); }, [identity]);
  async function load(nextPage: number, nextCursors = cursors) {
    const token = ++sequence.current;
    setPending(true); setError(""); setData(null); setPage(nextPage); setCursors(nextCursors);
    try {
      const value = await getPersonalFollowUpRescheduleHistory({ ...target, cursor: nextCursors[nextPage] });
      if (mounted.current && token === sequence.current && currentIdentity.current === identity) setData(value);
    } catch (cause) {
      if (mounted.current && token === sequence.current && currentIdentity.current === identity) setError(actionErrorMessage(cause) || "改期记录读取失败，请重试");
    } finally { if (mounted.current && token === sequence.current && currentIdentity.current === identity) setPending(false); }
  }
  return <section className="space-y-3 border-t pt-3" aria-label="跟进改期记录">
    <Button htmlType="button" type="tertiary" theme="borderless" aria-expanded={expanded} onClick={() => {
      if (expanded) { sequence.current++; setExpanded(false); setData(null); setError(""); setPending(false); }
      else { setExpanded(true); void load(0, [undefined]); }
    }}>改期记录</Button>
    {expanded && <div className="space-y-3">
      {pending && <p role="status" className="text-sm text-muted-foreground">正在读取改期记录…</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button htmlType="button" type="tertiary" theme="outline" onClick={() => void load(page)}>重试改期记录</Button></div>}
      {data && (data.items.length ? <ol className="space-y-3">{data.items.map(item => <li key={item.id} className="space-y-1 rounded-md border p-3 text-sm">
        <p><time dateTime={item.beforeDueAt}>{displayTime(item.beforeDueAt)}</time> → <time dateTime={item.afterDueAt}>{displayTime(item.afterDueAt)}</time></p>
        <p className="whitespace-pre-wrap break-words">{item.reason}</p>
        <p className="text-xs text-muted-foreground">{item.actorName ?? "未记录操作人"} · <time dateTime={item.at}>{displayTime(item.at)}</time>（北京时间）</p>
      </li>)}</ol> : <p className="text-sm text-muted-foreground">暂无改期记录。</p>)}
      {data && <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">改期记录第 {page + 1} 页</span><div className="flex gap-2">
        <Button htmlType="button" type="tertiary" theme="outline" disabled={pending || page === 0} onClick={() => void load(page - 1)}>上一页改期记录</Button>
        <Button htmlType="button" type="tertiary" theme="outline" disabled={pending || !data.nextCursor} onClick={() => void load(page + 1, [...cursors.slice(0, page + 1), data.nextCursor!])}>下一页改期记录</Button>
      </div></div>}
    </div>}
  </section>;
}

type Props = PersonalFollowUpTarget & {
  onClose(): void; onSaved(): void;
  trigger: RefObject<HTMLElement | null>; fallback: RefObject<HTMLElement | null>;
};
type Draft = { identity: string; dueAt: string; baselineMinute: string; reason: string; requestKey: string; initialized: boolean };

export function ClientFollowUpRescheduleDialog({ clientId, followUpId, onClose, onSaved, trigger, fallback }: Props) {
  const identity = `${clientId}:${followUpId}:reschedule`;
  const [read, setRead] = useState<{ identity: string; value?: PersonalFollowUp; error?: string; revision: number } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({ identity, dueAt: "", baselineMinute: "", reason: "", requestKey: crypto.randomUUID(), initialized: false }));
  const [error, setError] = useState(""), [pending, start] = useTransition();
  const sequence = useRef(0), mounted = useRef(true), saving = useRef(false), closePending = useRef(false), editorContent = useRef<HTMLDivElement>(null);
  const currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  const current = read?.identity === identity ? read : null, value = current?.value;
  const activeDraft = draft.identity === identity ? draft : null;
  const mayEdit = Boolean(value?.canClose && value.status === "OPEN");
  const changedTime = Boolean(value && activeDraft && activeDraft.dueAt !== toShanghaiInput(value.dueAt));
  const dirty = Boolean(activeDraft?.reason || activeDraft?.initialized && activeDraft.dueAt !== activeDraft.baselineMinute);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const readTarget = useCallback(async (reconcile: boolean) => {
    const token = ++sequence.current;
    setRead(null); setError("");
    try {
      const target = await getPersonalFollowUp({ clientId, followUpId });
      if (!mounted.current || token !== sequence.current || currentIdentity.current !== identity) return;
      setRead({ identity, value: target, revision: token });
      setDraft(previous => previous.identity === identity && previous.initialized
        ? { ...previous, baselineMinute: toShanghaiInput(target.dueAt), requestKey: reconcile ? crypto.randomUUID() : previous.requestKey }
        : { identity, dueAt: toShanghaiInput(target.dueAt), baselineMinute: toShanghaiInput(target.dueAt), reason: "", requestKey: previous.identity === identity && !reconcile ? previous.requestKey : crypto.randomUUID(), initialized: true });
    } catch (cause) {
      if (mounted.current && token === sequence.current && currentIdentity.current === identity) setRead({ identity, revision: token, error: actionErrorMessage(cause) || "跟进读取失败，请重试" });
    }
  }, [clientId, followUpId, identity]);
  useEffect(() => { void readTarget(false); }, [readTarget]);

  async function requestClose() {
    if (pending || saving.current || closePending.current) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closePending.current = true;
    try {
      if (dirty && !await confirmDialog({ title: "放弃未保存的改期？", confirmText: "放弃更改", cancelText: "继续编辑", initialFocus: "cancel" })) {
        requestAnimationFrame(() => { if (mounted.current) (returnFocus?.isConnected ? returnFocus : editorContent.current)?.focus({ preventScroll: true }); });
        return;
      }
      if (mounted.current) onClose();
    } finally { closePending.current = false; }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayEdit || !value || !activeDraft || !changedTime || pending || saving.current) return;
    setError("");
    let dueAt: string;
    try { dueAt = fromShanghaiInput(activeDraft.dueAt); }
    catch (cause) { setError(actionErrorMessage(cause)); return; }
    const input = { clientId, followUpId, expectedUpdatedAt: value.updatedAt, dueAt, reason: activeDraft.reason, requestKey: activeDraft.requestKey };
    saving.current = true;
    start(async () => {
      try {
        await rescheduleClientFollowUp(input);
        if (!mounted.current || currentIdentity.current !== identity) return;
        Toast.success("跟进已改期，原因已保存"); onSaved();
      } catch (cause) { if (mounted.current && currentIdentity.current === identity) setError(actionErrorMessage(cause) || "保存失败，请重新核对或重试"); }
      finally { saving.current = false; }
    });
  }
  return <Dialog open onOpenChange={open => { if (!open) void requestClose(); }}>
    <DialogContent ref={editorContent} className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]" onCloseAutoFocus={event => {
      event.preventDefault();
      const origin = trigger.current;
      (origin?.isConnected && !origin.matches(":disabled") && !origin.closest('[hidden], [inert]') ? origin : fallback.current)?.focus({ preventScroll: true });
    }}>
      <DialogHeader><DialogTitle>{value && !mayEdit ? "查看跟进安排" : "改期跟进"}</DialogTitle><DialogDescription>{value ? `${value.client.name} · ${value.title}` : "核对当前跟进及本人办理资格"}</DialogDescription></DialogHeader>
      {!current && <p role="status">正在读取跟进…</p>}
      {current?.error && <p role="alert" className="text-sm text-destructive">{current.error}</p>}
      {value && <div className="space-y-1 text-sm text-muted-foreground"><p>负责人：{value.assigneeName}</p><p>当前安排：<time dateTime={value.dueAt}>{displayTime(value.dueAt)}</time>（北京时间）</p><p>状态：{value.status === "OPEN" ? "待跟进" : value.status === "COMPLETED" ? "已完成" : "已取消"}</p></div>}
      {value && !mayEdit && <p role="status">{value.status === "OPEN" ? "当前仅可查看此跟进，不能改期。" : "此跟进已结束，不能改期。"}</p>}
      {mayEdit && activeDraft && <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-1.5"><label htmlFor="crm-reschedule-due">新的跟进时间（北京时间）*</label><Input id="crm-reschedule-due" type="datetime-local" required value={activeDraft.dueAt} onChange={value => setDraft(previous => ({ ...previous, dueAt: value }))} /></div>
          <div className="space-y-1.5"><label htmlFor="crm-reschedule-reason">改期原因 *</label><TextArea id="crm-reschedule-reason" required maxLength={1000} rows={4} value={activeDraft.reason} onChange={value => setDraft(previous => ({ ...previous, reason: value }))} /></div>
        </fieldset>
        {!changedTime && <p className="text-xs text-muted-foreground">请选择与当前安排不同的跟进时间。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button htmlType="button" type="tertiary" theme="outline" disabled={pending} onClick={() => void requestClose()}>返回</Button><Button htmlType="submit" theme="solid" icon={<Check size={16} />} loading={pending} disabled={pending || !changedTime || !activeDraft.reason.trim()}>保存改期</Button></DialogFooter>
      </form>}
      <div className="flex flex-wrap gap-2"><Button htmlType="button" type="tertiary" theme="outline" disabled={pending || !current} onClick={() => void readTarget(true)}>重新读取并核对</Button>{!mayEdit && <Button htmlType="button" type="tertiary" theme="outline" disabled={pending} onClick={() => void requestClose()}>返回列表</Button>}</div>
      {value && <PersonalFollowUpRescheduleHistory key={`${identity}:${current.revision}:${value.updatedAt}`} target={{ clientId, followUpId }} />}
    </DialogContent>
  </Dialog>;
}
