"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, MessageSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { actionErrorMessage } from "@/lib/action-error";
import { clientChannelLabels, fromShanghaiInput, toShanghaiInput, type ClientActivityInput, type ClientRelationshipView } from "@/lib/clients/relationship";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { recordClientActivity } from "@/server/clients/relationship-actions";

const when = (value: string) => `${shDayKey(value)} ${shTime(value)}`;
type Mode = { id?: string; title?: string; status: "COMPLETED" | "CANCELLED" };

export function ClientRelationshipPanel({ clientId, view }: { clientId: string; view: ClientRelationshipView | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>({ status: "COMPLETED" });
  const [requestKey, setRequestKey] = useState("");
  const [channel, setChannel] = useState<ClientActivityInput["channel"]>("PHONE");
  const [content, setContent] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const [error, setError] = useState("");

  function begin(nextMode: Mode) {
    setMode(nextMode);
    setRequestKey(crypto.randomUUID());
    setChannel(nextMode.status === "CANCELLED" ? "OTHER" : "PHONE");
    setContent("");
    setOccurredAt(toShanghaiInput(new Date()));
    setScheduleNext(false);
    setNextTitle("");
    setNextDueAt("");
    setError("");
    setOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    let input: ClientActivityInput;
    try {
      input = { clientId, requestKey, channel, content, occurredAt: fromShanghaiInput(occurredAt), followUpId: mode.id, closeStatus: mode.status,
        nextFollowUp: scheduleNext ? { title: nextTitle, dueAt: fromShanghaiInput(nextDueAt) } : undefined };
    } catch (err) {
      setError(actionErrorMessage(err));
      return;
    }
    start(async () => {
      try {
        await recordClientActivity(input);
        toast.success(mode.id ? mode.status === "CANCELLED" ? "跟进已取消，原因已保存" : "跟进结果已保存" : "沟通记录已保存");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err) || "保存失败，请重试");
      }
    });
  }

  const dialogTitle = mode.id ? mode.status === "CANCELLED" ? "取消跟进" : "录入跟进结果" : "记录沟通";

  return (
    <section className="card min-w-0 overflow-hidden" aria-labelledby="client-relationship-title">
      <div className="panel-head flex-wrap gap-2">
        <h2 id="client-relationship-title" className="panel-title"><MessageSquare className="ic" strokeWidth={1.8} />沟通与跟进</h2>
        {view?.canWrite ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => begin({ status: "COMPLETED" })}><Plus />记录沟通</button> : null}
      </div>
      {!view ? <div className="panel-body t-sm t-mute">沟通记录仅向客户经办人员及获授权的管理人员开放。</div> : (
        <div className="panel-body space-y-5">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4" />待跟进 <span className="badge b-white">{view.openCount}</span></h3>
            {view.followUps.length === 0 ? <p className="t-sm t-mute py-2">暂无待跟进。记录沟通时可安排下一次跟进。</p> : <ul className="space-y-2">
              {view.followUps.map(item => <li key={item.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-[var(--bd-hair)] p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--t-muted)]">
                    <time dateTime={item.dueAt}>{when(item.dueAt)}</time><span>· {item.assigneeName}</span>
                    {item.overdue ? <span className="badge b-amber">已逾期</span> : null}
                  </div>
                </div>
                {item.canClose ? <div className="flex flex-wrap gap-1">
                  <button type="button" className="btn btn-secondary btn-sm" aria-label={`录入结果：${item.title}`} onClick={() => begin({ id: item.id, title: item.title, status: "COMPLETED" })}><Check />录入结果</button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`取消跟进：${item.title}`} onClick={() => begin({ id: item.id, title: item.title, status: "CANCELLED" })}><X />取消</button>
                </div> : null}
              </li>)}
            </ul>}
            {view.openCount > view.followUps.length ? <p className="t-xs t-mute mt-2">当前显示最早到期的 {view.followUps.length} 项，共 {view.openCount} 项。</p> : null}
          </div>
          <div className="border-t border-[var(--bd-hair)] pt-4">
            <h3 className="mb-3 text-sm font-medium">沟通历史 <span className="t-xs t-mute">{view.activityCount} 条</span></h3>
            {view.activities.length === 0 ? <p className="t-sm t-mute">尚未记录沟通。</p> : <ol className="space-y-4">
              {view.activities.map(item => <li key={item.id} className="border-l-2 border-[var(--bd-hair)] pl-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--t-muted)]"><span className="badge b-white">{clientChannelLabels[item.channel]}</span><span>{item.authorName}</span><time dateTime={item.occurredAt}>{when(item.occurredAt)}</time></div>
                {item.closedTitle ? <p className="mb-1 text-xs font-medium text-[var(--teal-deep)]">{item.closedStatus === "CANCELLED" ? "已取消" : "已完成"}：{item.closedTitle}</p> : null}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
              </li>)}
            </ol>}
            {view.activityCount > view.activities.length ? <p className="t-xs t-mute mt-3">当前显示最近 {view.activities.length} 条记录。</p> : null}
          </div>
          <p className="t-xs t-mute">时间均为北京时间。到期状态在打开页面时更新。</p>
        </div>
      )}
      <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle><DialogDescription>{mode.title ? `当前事项：${mode.title}` : "保留本次沟通内容，并按需要安排下一次跟进。"}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={pending} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="crm-channel">沟通方式</Label><select id="crm-channel" value={channel} onChange={event => setChannel(event.target.value as ClientActivityInput["channel"])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{Object.entries(clientChannelLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
                <div className="space-y-1.5"><Label htmlFor="crm-occurred">发生时间（北京时间）</Label><Input id="crm-occurred" type="datetime-local" required value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="crm-content">{mode.status === "CANCELLED" ? "取消原因" : mode.id ? "跟进结果" : "沟通内容"} *</Label><Textarea id="crm-content" rows={5} required maxLength={8000} value={content} onChange={event => setContent(event.target.value)} placeholder="记录事实、客户需求与已约定事项" /></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={scheduleNext} onCheckedChange={value => setScheduleNext(value === true)} />安排下次跟进</label>
              {scheduleNext ? <div className="space-y-3 rounded-lg border border-[var(--bd-hair)] p-3">
                <div className="space-y-1.5"><Label htmlFor="crm-next-title">下次跟进事项 *</Label><Input id="crm-next-title" required maxLength={200} value={nextTitle} onChange={event => setNextTitle(event.target.value)} placeholder="例如：核对委托材料并确认办理方案" /></div>
                <div className="space-y-1.5"><Label htmlFor="crm-next-due">跟进时间（北京时间）*</Label><Input id="crm-next-due" type="datetime-local" required value={nextDueAt} onChange={event => setNextDueAt(event.target.value)} /></div>
                <p className="t-xs t-mute">此项由你负责，可在客户详情中录入结果。</p>
              </div> : null}
            </fieldset>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setOpen(false)}>返回</button><button type="submit" className="btn btn-primary" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Check />}保存{mode.status === "CANCELLED" ? "取消原因" : mode.id ? "结果" : "沟通"}</button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
