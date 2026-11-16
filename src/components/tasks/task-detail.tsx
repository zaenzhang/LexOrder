"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormDialogContent, FormDialogBody } from "@/components/patterns/form-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { shDateFromKey, shDayKey, shTime } from "@/lib/ui/sh-time";
import { addTaskDependency, changeTask, changeTaskWait, endTaskWait, removeTaskDependency, startTaskWait } from "@/server/tasks/actions";
import { taskStateLabels, type MatterTasksView, type TaskDetail as Detail } from "@/server/tasks/contracts";

type Operation = "ACCEPT"|"DECLINE"|"PROPOSE"|"RESCHEDULE"|"COMPLETE"|"CANCEL"|"REOPEN"|"WAIT_START"|"WAIT_CHANGE"|"WAIT_END"|"DEPENDENCY_ADD"|"DEPENDENCY_REMOVE";
const labels: Record<Operation, string> = { ACCEPT: "承接待办", DECLINE: "退回交接", PROPOSE: "发起交接", RESCHEDULE: "调整安排日期", COMPLETE: "完成待办", CANCEL: "取消待办", REOPEN: "重新办理", WAIT_START: "记录外部等待", WAIT_CHANGE: "调整检查日", WAIT_END: "结束等待", DEPENDENCY_ADD: "添加前置待办", DEPENDENCY_REMOVE: "移除前置依赖" };

export function TaskDetail({ matterId, record, options, onEdit, onOpenTask, onChanged, onDraftStateChange }: {
  matterId: string; record: Detail; options: MatterTasksView; onEdit(): void; onOpenTask(id: string): void;
  onChanged(): void; onDraftStateChange(dirty: boolean, busy: boolean): void;
}) {
  const [operation, setOperation] = useState<Operation|null>(null), [reason, setReason] = useState("");
  const [party, setParty] = useState(""), [expected, setExpected] = useState(""), [date, setDate] = useState("");
  const [selectedId, setSelectedId] = useState(""), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  const [busy, startTransition] = useTransition(), running = useRef(false), requestKey = useRef(crypto.randomUUID());
  const activeWait = record.waits.find(wait => !wait.endedAt);
  const canEdit = record.canWrite && record.state === "OPEN";
  useEffect(() => { onDraftStateChange(Boolean(operation && dirty), busy); }, [operation, dirty, busy, onDraftStateChange]);
  function open(action: Operation, id = "") {
    setOperation(action); setReason(""); setParty(""); setExpected(""); setSelectedId(id); setError(""); setDirty(false);
    setDate(action === "WAIT_CHANGE" ? activeWait?.nextCheckDate ?? "" : action === "RESCHEDULE" && record.dueAt ? shDayKey(record.dueAt) : "");
    requestKey.current = crypto.randomUUID();
  }
  async function close() {
    if (running.current) return;
    if (dirty && !await confirmDialog({ title: "放弃未保存的处理记录？", confirmText: "放弃记录", cancelText: "继续填写", initialFocus: "cancel" })) return;
    setOperation(null); setDirty(false);
  }
  function submit() {
    if (!operation || running.current) return;
    if (operation !== "ACCEPT" && !reason.trim()) { setError("请填写原因或处理结果"); return; }
    if (["RESCHEDULE", "WAIT_START", "WAIT_CHANGE"].includes(operation)) {
      try { shDateFromKey(date); } catch { setError("请填写有效日期"); return; }
    }
    if (["PROPOSE", "DEPENDENCY_ADD"].includes(operation) && !selectedId) { setError("请明确选择关联对象"); return; }
    if (operation === "WAIT_START" && (!party.trim() || !expected.trim())) { setError("请填写等待对象及预期结果"); return; }
    running.current = true; setError("");
    startTransition(async () => {
      try {
        const base = { matterId, taskId: record.id };
        if (operation === "WAIT_START") await startTaskWait({ ...base, expectedRevision: record.revision, requestKey: requestKey.current,
          externalParty: party, expectedResult: expected, reason, nextCheckDate: date });
        else if (operation === "WAIT_CHANGE" && activeWait) await changeTaskWait({ ...base, id: activeWait.id, revision: activeWait.revision, nextCheckDate: date, reason });
        else if (operation === "WAIT_END" && activeWait) await endTaskWait({ ...base, id: activeWait.id, revision: activeWait.revision, result: reason });
        else if (operation === "DEPENDENCY_ADD") await addTaskDependency({ ...base, expectedRevision: record.revision, prerequisiteTaskId: selectedId, reason });
        else if (operation === "DEPENDENCY_REMOVE") await removeTaskDependency({ ...base, expectedRevision: record.revision, id: selectedId, reason });
        else if (["ACCEPT", "DECLINE", "PROPOSE", "RESCHEDULE", "COMPLETE", "CANCEL", "REOPEN"].includes(operation)) await changeTask({ ...base,
          revision: record.revision, action: operation as "ACCEPT"|"DECLINE"|"PROPOSE"|"RESCHEDULE"|"COMPLETE"|"CANCEL"|"REOPEN", reason,
          ...(operation === "PROPOSE" ? { assigneeId: selectedId } : {}), ...(operation === "RESCHEDULE" ? { dueAt: shDateFromKey(date) } : {}) });
        else throw new Error("等待记录已变化，请关闭后刷新");
        setOperation(null); setDirty(false); onDraftStateChange(false, false); onChanged();
      } catch (error) { setError(actionErrorMessage(error) || "处理失败，请保留输入重试"); }
      finally { running.current = false; }
    });
  }
  const change = (set: (value: string) => void) => (value: string) => { set(value); setDirty(true); };
  const candidateTasks = options.tasks.filter(task => task.id !== record.id && !record.prerequisites.some(edge => edge.taskId === task.id));
  return <div className="space-y-5" aria-label="待办详情">
    <header className="space-y-3"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold break-words">{record.title}</h3><Badge variant="outline">{taskStateLabels[record.state]}</Badge></div>
      <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1"><span>责任人：{record.assigneeName}{!record.assigneeActive ? "（已停用）" : record.acceptedAt ? "（已承接）" : "（待承接）"}</span><span>安排完成：{record.dueAt ? `${shDayKey(record.dueAt)} ${shTime(record.dueAt)}` : "未安排"}</span><span>{record.stageName ?? "全案待办"}</span></div>
      {record.proposedAssigneeName ? <p className="text-sm">待 {record.proposedAssigneeName} 接收交接；当前责任人仍为 {record.assigneeName}。</p> : null}
      <p className="text-sm whitespace-pre-wrap break-words">{record.description || "未填写办理内容"}</p>
      {record.state !== "OPEN" && record.reason ? <p className="text-sm">处理结果：{record.reason}</p> : null}
      <div className="flex flex-wrap gap-2">
        {record.canAccept ? <Button size="sm" variant="outline" onClick={() => open("ACCEPT")}>承接待办</Button> : null}
        {record.canDecline ? <Button size="sm" variant="outline" onClick={() => open("DECLINE")}>退回交接</Button> : null}
        {canEdit ? <><Button size="sm" variant="outline" onClick={onEdit}>修改内容</Button><Button size="sm" variant="outline" onClick={() => open("RESCHEDULE")}>调整日期</Button><Button size="sm" variant="outline" onClick={() => open("PROPOSE")}>交接</Button><Button size="sm" onClick={() => open("COMPLETE")} disabled={Boolean(activeWait) || record.blockers > 0}>完成待办</Button></> : null}
        {record.canCancel && record.state === "OPEN" ? <Button size="sm" variant="ghost" disabled={Boolean(activeWait)} onClick={() => open("CANCEL")}>取消待办</Button> : null}
        {record.canWrite && record.state !== "OPEN" ? <Button size="sm" variant="outline" onClick={() => open("REOPEN")}>重新办理</Button> : null}
      </div>
    </header>
    <section className="space-y-3 border-t pt-4" aria-label="外部等待"><div className="flex items-center justify-between gap-3"><h4 className="font-medium text-sm">外部等待</h4>{canEdit && !activeWait ? <Button size="sm" variant="outline" onClick={() => open("WAIT_START")}>记录等待</Button> : null}</div>
      {record.waits.length ? record.waits.map(wait => <div key={wait.id} className="rounded-md border p-3 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span className="font-medium">{wait.externalParty}</span><Badge variant="outline">{wait.endedAt ? "已结束" : "等待中"}</Badge></div>
        <p className="whitespace-pre-wrap break-words">预期结果：{wait.expectedResult}</p><p className="text-muted-foreground whitespace-pre-wrap break-words">{wait.reason}</p>
        <p className="text-xs text-muted-foreground">{shDayKey(wait.startedAt)} {shTime(wait.startedAt)} · {wait.createdByName} 开始等待</p>
        <p>下次检查：{wait.nextCheckDate}{!wait.endedAt && wait.nextCheckDate < shDayKey(new Date()) ? " · 已过检查日" : ""}</p>
        {wait.endedAt ? <><p className="whitespace-pre-wrap break-words">取得结果：{wait.result}</p><p className="text-xs text-muted-foreground">{wait.endedByName} · {shDayKey(wait.endedAt)} 结束</p></> : <div className="flex gap-2">{canEdit ? <Button size="sm" variant="outline" onClick={() => open("WAIT_CHANGE")}>调整检查日</Button> : null}{record.canCancel ? <Button size="sm" variant="outline" onClick={() => open("WAIT_END")}>结束等待</Button> : null}</div>}
      </div>) : <p className="text-sm text-muted-foreground">暂无外部等待</p>}
    </section>
    <section className="space-y-3 border-t pt-4" aria-label="前置待办"><div className="flex items-center justify-between gap-3"><h4 className="font-medium text-sm">前置待办</h4>{canEdit ? <Button size="sm" variant="outline" onClick={() => open("DEPENDENCY_ADD")}>添加前置</Button> : null}</div>
      {record.prerequisites.length ? record.prerequisites.map(edge => <div key={edge.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onOpenTask(edge.taskId)}>{edge.title}</Button><p className="text-xs text-muted-foreground">{taskStateLabels[edge.state]} · {edge.satisfied ? "已满足" : "阻塞当前待办"}</p></div>{canEdit ? <Button size="sm" variant="ghost" onClick={() => open("DEPENDENCY_REMOVE", edge.id)}>移除依赖</Button> : null}</div>) : <p className="text-sm text-muted-foreground">没有前置依赖</p>}
    </section>
    {record.dependents.length ? <section className="space-y-2 border-t pt-4"><h4 className="text-sm font-medium">依赖本项的待办</h4>{record.dependents.map(edge => <div key={edge.id} className="flex justify-between gap-3 text-sm"><Button variant="link" className="h-auto whitespace-normal p-0" onClick={() => onOpenTask(edge.taskId)}>{edge.title}</Button><span>{taskStateLabels[edge.state]}</span></div>)}</section> : null}
    <Dialog open={Boolean(operation)} onOpenChange={open => { if (!open) void close(); }}><FormDialogContent className="max-w-lg"><DialogHeader><DialogTitle>{operation ? labels[operation] : "处理待办"}</DialogTitle><DialogDescription>{record.title}</DialogDescription></DialogHeader><FormDialogBody>
      <form id="task-operation-form" className="space-y-4" onSubmit={event => { event.preventDefault(); submit(); }}>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <fieldset disabled={busy} className="space-y-4">
          {operation === "WAIT_START" ? <><div className="space-y-2"><Label htmlFor="wait-party">等待对象</Label><Input id="wait-party" value={party} maxLength={200} onChange={event => change(setParty)(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="wait-result">预期结果</Label><Textarea id="wait-result" value={expected} maxLength={1000} onChange={event => change(setExpected)(event.target.value)} required /></div></> : null}
          {operation && ["WAIT_START", "WAIT_CHANGE", "RESCHEDULE"].includes(operation) ? <div className="space-y-2"><Label htmlFor="operation-date">{operation === "RESCHEDULE" ? "新的安排完成日" : "下次检查日"}</Label><Input id="operation-date" type="date" value={date} onChange={event => change(setDate)(event.target.value)} required /></div> : null}
          {operation === "PROPOSE" || operation === "DEPENDENCY_ADD" ? <div className="space-y-2"><Label htmlFor="operation-object">{operation === "PROPOSE" ? "接收人" : "前置待办"}</Label><Select value={selectedId} onValueChange={change(setSelectedId)} disabled={busy}><SelectTrigger id="operation-object"><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent>{operation === "PROPOSE" ? options.people.filter(person => person.id !== record.assigneeId).map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>) : candidateTasks.map(task => <SelectItem key={task.id} value={task.id}>{task.title} · {taskStateLabels[task.state]}</SelectItem>)}</SelectContent></Select></div> : null}
          {operation === "ACCEPT" ? <p className="text-sm">确认承接此项待办及当前安排。</p> : <div className="space-y-2"><Label htmlFor="operation-reason">{operation === "WAIT_END" || operation === "COMPLETE" ? "处理结果" : "原因"}</Label><Textarea id="operation-reason" value={reason} maxLength={1000} rows={4} onChange={event => change(setReason)(event.target.value)} required /></div>}
          {operation === "WAIT_START" || operation === "WAIT_CHANGE" ? <p className="text-xs text-muted-foreground">检查日用于跟进等待；当前安排和已确认期限继续保留。</p> : null}
          {operation === "DEPENDENCY_REMOVE" ? <p className="text-xs text-muted-foreground">移除后，此前置将不再阻塞当前待办。</p> : null}
        </fieldset>
      </form>
    </FormDialogBody><DialogFooter><Button variant="outline" disabled={busy} onClick={() => void close()}>取消</Button><Button type="submit" form="task-operation-form" disabled={busy}>{busy ? "保存中…" : operation ? labels[operation] : "保存"}</Button></DialogFooter></FormDialogContent></Dialog>
  </div>;
}
