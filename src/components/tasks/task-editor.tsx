"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/action-error";
import { shDateFromKey } from "@/lib/ui/sh-time";
import { createTask, updateTask } from "@/server/tasks/actions";
import { taskCreateSchema, taskUpdateSchema, type MatterTasksView, type TaskDetail } from "@/server/tasks/contracts";

export function TaskEditor({ matterId, record, options, onSaved, onCancel, onDraftStateChange }: {
  matterId: string; record: TaskDetail|null; options: MatterTasksView;
  onSaved(id: string): void; onCancel(): void; onDraftStateChange(dirty: boolean, busy: boolean): void;
}) {
  const [title, setTitle] = useState(record?.title ?? ""), [description, setDescription] = useState(record?.description ?? "");
  const [priority, setPriority] = useState(String(record?.priority ?? 0)), [stageId, setStageId] = useState(record?.stageId ?? "none");
  const [assigneeId, setAssigneeId] = useState("default"), [dueDate, setDueDate] = useState(""), [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false), [error, setError] = useState("");
  const [busy, startTransition] = useTransition(), running = useRef(false), requestKey = useRef(crypto.randomUUID());
  useEffect(() => { onDraftStateChange(dirty, busy); }, [dirty, busy, onDraftStateChange]);
  function save() {
    if (running.current) return;
    const fields = { matterId, title, description, priority: Number(priority), stageId: stageId === "none" ? "" : stageId };
    let dueAt: Date|undefined;
    try { dueAt = dueDate ? shDateFromKey(dueDate) : undefined; } catch { setError("请填写有效安排完成日"); return; }
    const create = { ...fields, requestKey: requestKey.current, assigneeId: assigneeId === "default" ? "" : assigneeId,
      ...(dueAt ? { dueAt } : {}) };
    const update = { ...fields, id: record?.id ?? "", expectedRevision: record?.revision ?? 0, reason };
    const checked = record ? taskUpdateSchema.safeParse(update) : taskCreateSchema.safeParse(create);
    if (!checked.success) { setError(checked.error.issues[0]?.message ?? "请核对输入"); return; }
    running.current = true; setError("");
    startTransition(async () => {
      try {
        const result = record ? await updateTask(update) : await createTask(create);
        setDirty(false); onDraftStateChange(false, false); onSaved(result.id);
      } catch (error) { setError(actionErrorMessage(error) || "保存失败，请保留输入重试"); }
      finally { running.current = false; }
    });
  }
  const change = (set: (value: string) => void) => (value: string) => { set(value); setDirty(true); };
  return <form className="space-y-4" aria-label={record ? "修改待办" : "新建待办"} onSubmit={event => { event.preventDefault(); save(); }}>
    <h3 className="font-medium">{record ? "修改待办" : "新建待办"}</h3>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <fieldset disabled={busy} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="task-title">待办标题</Label><Input id="task-title" value={title} maxLength={200} onChange={event => change(setTitle)(event.target.value)} required autoFocus /></div>
      <div className="space-y-2"><Label htmlFor="task-description">办理内容</Label><Textarea id="task-description" value={description} maxLength={2000} rows={4} onChange={event => change(setDescription)(event.target.value)} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label htmlFor="task-stage">所属阶段</Label><Select value={stageId} onValueChange={change(setStageId)} disabled={busy}><SelectTrigger id="task-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">全案待办（不绑定阶段）</SelectItem>{options.stages.map(stage => <SelectItem key={stage.id} value={stage.id}>{stage.procedureLabel} · {stage.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="task-priority">优先级</Label><Select value={priority} onValueChange={change(setPriority)} disabled={busy}><SelectTrigger id="task-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">普通</SelectItem><SelectItem value="1">高</SelectItem><SelectItem value="2">紧急</SelectItem></SelectContent></Select></div>
      </div>
      {!record ? <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label htmlFor="task-assignee">责任人</Label><Select value={assigneeId} onValueChange={change(setAssigneeId)} disabled={busy}><SelectTrigger id="task-assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">案件主办</SelectItem>{options.people.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="task-due">安排完成日（可选）</Label><Input id="task-due" type="date" value={dueDate} onChange={event => change(setDueDate)(event.target.value)} /></div>
      </div> : <div className="space-y-2"><Label htmlFor="task-edit-reason">修改原因</Label><Textarea id="task-edit-reason" value={reason} maxLength={1000} onChange={event => change(setReason)(event.target.value)} required /></div>}
    </fieldset>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消编辑</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存待办"}</Button></div>
  </form>;
}
