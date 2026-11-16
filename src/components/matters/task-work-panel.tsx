"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import type { TaskWorkflowWorkspace } from "@/lib/tasks/workflow";
import { formatDateTime } from "@/lib/utils";
import { createTask } from "@/server/tasks/actions";
import { getTaskWorkspace } from "@/server/tasks/workflow-actions";
import { TaskDetailDialog, taskStateLabels } from "./task-detail-dialog";

type TaskWorkPanelProps = {
  matterId: string;
  canWrite?: boolean;
  createRequest?: number;
  createStage?: { id: string; name: string } | null;
  defaultStage?: { id: string; name: string } | null;
  scopeStageIds?: string[] | null;
  unassignedOnly?: boolean;
  refreshRequest?: number;
  selectedTaskId?: string | null;
  onTaskSelect?: (taskId: string | null, mode?: "push" | "replace") => void;
  onTaskCreated?: (taskId: string) => void;
};

/** 全案待办的 Task 入口；不从程序环节投影任务，也不生成平行任务状态。 */
export function TaskWorkPanel({ matterId, canWrite = true, createRequest = 0, createStage = null, defaultStage = null, scopeStageIds = null, unassignedOnly = false, refreshRequest = 0, selectedTaskId, onTaskSelect, onTaskCreated }: TaskWorkPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<TaskWorkflowWorkspace | null>(null);
  const [error, setError] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [dueWaitingOnly, setDueWaitingOnly] = useState(false);
  const [observedAt, setObservedAt] = useState(0);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [creatingStage, setCreatingStage] = useState<{ id: string; name: string } | null>(null);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  const handledCreateRequest = useRef(0);
  const creatingLocation = useRef("");
  const taskHeading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const taskButtons = useRef(new Map<string, HTMLButtonElement>());
  const openedTaskId = useRef<string | null>(null);
  const taskId = selectedTaskId === undefined ? localTaskId : selectedTaskId;
  const waitingIsDue = (task: TaskWorkflowWorkspace["tasks"][number]) => task.responsibility.state === "OPEN" && Boolean(task.activeWaiting && new Date(task.activeWaiting.nextCheckAt).getTime() <= observedAt);
  const inScope = (task: { stageId?: string | null }) => (!unassignedOnly || !task.stageId) && (scopeStageIds === null || Boolean(task.stageId && scopeStageIds.includes(task.stageId)));
  const scopedTasks = data?.tasks.filter(task => inScope(task) && (!dueWaitingOnly || waitingIsDue(task))) ?? [];
  const scopedUntracked = dueWaitingOnly ? [] : data?.untrackedTasks.filter(inScope) ?? [];

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    getTaskWorkspace({ matterId, includeClosed }).then(result => {
      if (!cancelled) { setData(result); setObservedAt(Date.now()); }
    }).catch(cause => {
      if (!cancelled) setError(actionErrorMessage(cause) || "任务读取失败，请重试");
    });
    return () => { cancelled = true; };
  }, [matterId, includeClosed, reload, refreshRequest]);

  useEffect(() => {
    if (createRequest > 0 && createRequest !== handledCreateRequest.current && canWrite && data?.canWrite) {
      handledCreateRequest.current = createRequest;
      creatingLocation.current = window.location.href;
      setCreatingStage(createStage);
      setCreating(true);
    }
  }, [createRequest, createStage, canWrite, data]);

  function selectTask(id: string | null, mode: "push" | "replace" = "push") {
    if (selectedTaskId === undefined) setLocalTaskId(id);
    onTaskSelect?.(id, mode);
  }

  function taskCreated(id: string) {
    openedTaskId.current = id;
    setCreating(false);
    setReload(value => value + 1);
    if (window.location.href === creatingLocation.current) {
      if (selectedTaskId === undefined) setLocalTaskId(id);
      if (onTaskCreated) onTaskCreated(id);
      else onTaskSelect?.(id);
    }
    router.refresh();
  }

  function returnTaskFocus(id: string) {
    const target = openedTaskId.current === id ? taskButtons.current.get(id) : null;
    openedTaskId.current = null;
    const visibleTarget = target?.isConnected && !target.closest("[hidden]") ? target : taskHeading.current;
    if (visibleTarget?.isConnected && !visibleTarget.closest("[hidden]")) visibleTarget.focus({ preventScroll: true });
  }

  function returnCreateFocus() {
    const target = createButton.current ?? taskHeading.current;
    if (target?.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  }

  return <section className="space-y-3" aria-label="事项任务">
    <div className="flex items-center justify-between gap-3">
      <h3 ref={taskHeading} tabIndex={-1} className="text-sm font-semibold">任务</h3>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={dueWaitingOnly} onCheckedChange={value => { setObservedAt(Date.now()); setDueWaitingOnly(value === true); }} />
          仅看待检查
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={includeClosed} onCheckedChange={value => setIncludeClosed(value === true)} />
          显示已办结和已取消
        </label>
        {canWrite && data?.canWrite && <Button ref={createButton} size="sm" onClick={() => { creatingLocation.current = window.location.href; setCreatingStage(defaultStage); setCreating(true); }}><Plus />新建任务</Button>}
      </div>
    </div>
    {error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span>{error}</span><Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>重试</Button>
    </div> : !data ? <p role="status" className="py-4 text-sm text-muted-foreground">正在读取任务…</p> : scopedTasks.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{dueWaitingOnly ? "当前范围没有到期的等待检查。" : scopedUntracked.length ? "没有责任记录完整的任务。" : includeClosed ? "当前范围还没有任务。" : "当前范围没有办理中的任务。"}</p> : <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/40 text-muted-foreground"><tr>
          <th className="px-3 py-2 font-medium">任务</th>
          <th className="px-3 py-2 font-medium">内部责任人</th>
          <th className="px-3 py-2 font-medium">任务截止</th>
          <th className="px-3 py-2 font-medium">外部等待</th>
        </tr></thead>
        <tbody className="divide-y">{scopedTasks.map(task => <tr key={task.id}>
          <td className="max-w-md px-3 py-3 align-top">
            <div className="flex items-start gap-2">
              <Button ref={node => { if (node) taskButtons.current.set(task.id, node); else taskButtons.current.delete(task.id); }} variant="link" className="h-auto min-w-0 whitespace-normal py-0 text-left" onClick={() => { openedTaskId.current = task.id; selectTask(task.id); }}>{task.title}</Button>
              <Badge variant={task.responsibility.state === "DONE" ? "green" : "secondary"}>{taskStateLabels[task.responsibility.state]}</Badge>
              {task.priority === 2 && <Badge variant="red">紧急</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{task.stageId ? [task.procedureTitle, task.stageName].filter(Boolean).join(" · ") : "事项级"}</p>
          </td>
          <td className="px-3 py-3 align-top"><span>{task.responsibility.name}</span>{!task.responsibility.active && <p className="mt-1 text-xs text-destructive">待交接</p>}</td>
          <td className="whitespace-nowrap px-3 py-3 align-top">{task.dueAt ? formatDateTime(task.dueAt) : "未安排"}</td>
          <td className="max-w-xs px-3 py-3 align-top">{task.activeWaiting ? <><p className="break-words">{task.activeWaiting.waitingFor}</p><p className="mt-1 text-xs text-muted-foreground">检查：{formatDateTime(task.activeWaiting.nextCheckAt)}</p>{waitingIsDue(task) && <Badge variant="outline" className="mt-1">待检查</Badge>}</> : <span className="text-muted-foreground">—</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {data && scopedUntracked.length > 0 && <div role="alert" className="rounded-lg border p-3 text-sm">
      <p>以下既有任务缺少责任记录，暂不能在任务工作区办理；请联系管理员核实责任、截止日期和提醒。原任务字段仅供核对：</p>
      <ul className="mt-2 list-disc pl-5">{scopedUntracked.map(task => <li key={task.id}>{task.title} · {task.completed ? "原记录已标完成" : "原记录未标完成"} · 截止：{task.dueAt ? formatDateTime(task.dueAt) : "未安排"} · 原负责人：{task.assigneeName ?? "未记录或不可用"}{task.procedureTitle ? ` · ${task.procedureTitle}` : ""}{task.stageName ? ` · ${task.stageName}` : ""}</li>)}</ul>
    </div>}
    {creating && data && <CreateTaskDialog matterId={matterId} data={data} stage={creatingStage} onClose={() => setCreating(false)} onCreated={taskCreated} onReturnFocus={returnCreateFocus} />}
    <TaskDetailDialog taskId={taskId} expectedMatterId={matterId} open={Boolean(taskId)} onOpenChange={open => { if (!open) selectTask(null); }} onTaskChangeRejected={id => selectTask(id, "replace")} onChanged={() => setReload(value => value + 1)} onReturnFocus={returnTaskFocus} />
  </section>;
}

function CreateTaskDialog({ matterId, data, stage, onClose, onCreated, onReturnFocus }: { matterId: string; data: TaskWorkflowWorkspace; stage: { id: string; name: string } | null; onClose: () => void; onCreated: (id: string) => void; onReturnFocus: () => void }) {
  const initialPerson = data.people.some(person => person.id === data.currentUserId) ? data.currentUserId : "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(initialPerson);
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const created = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const dirty = Boolean(title || description || dueAt || priority !== "0" || assigneeId !== initialPerson);

  async function close() {
    if (busy) return;
    if (dirty && !await confirmDialog({ title: "放弃未保存的任务？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim() || !assigneeId) { setError("请填写任务名称并选择内部责任人"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await createTask({ matterId, requestKey: requestKey.current, title: title.trim(), description: description.trim(), assigneeId, priority: Number(priority), dueAt: dueAt ? new Date(`${dueAt}:00+08:00`) : undefined, ...(stage ? { stageId: stage.id } : {}) });
      created.current = true;
      toast.success("任务已创建");
      onCreated(result.id);
    } catch (cause) {
      setError(actionErrorMessage(cause) || "任务未保存，请重试");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
    <FormDialogContent onCloseAutoFocus={event => { event.preventDefault(); if (!created.current) onReturnFocus(); }}>
      <DialogHeader><DialogTitle>{stage ? "新建环节任务" : "新建事项级任务"}</DialogTitle><DialogDescription>{stage ? `关联环节：${stage.name}` : "不关联程序或环节"}</DialogDescription></DialogHeader>
      <FormDialogBody>
        <form id="create-matter-task" onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="task-create-title">任务名称</Label><Input id="task-create-title" autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="task-create-description">办理说明</Label><Textarea id="task-create-description" maxLength={2000} rows={3} value={description} onChange={event => setDescription(event.target.value)} disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="task-create-assignee">内部责任人</Label><Select value={assigneeId} onValueChange={setAssigneeId} disabled={busy}><SelectTrigger id="task-create-assignee"><SelectValue placeholder="选择责任人" /></SelectTrigger><SelectContent>{data.people.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="task-create-due">任务截止（北京时间，选填）</Label><Input id="task-create-due" type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="task-create-priority">优先级</Label><Select value={priority} onValueChange={setPriority} disabled={busy}><SelectTrigger id="task-create-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">普通</SelectItem><SelectItem value="1">较高</SelectItem><SelectItem value="2">紧急</SelectItem></SelectContent></Select></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </FormDialogBody>
      <DialogFooter><Button variant="outline" onClick={() => void close()} disabled={busy}>取消</Button><Button type="submit" form="create-matter-task" disabled={busy}>{busy ? "正在保存…" : "创建任务"}</Button></DialogFooter>
    </FormDialogContent>
  </Dialog>;
}
