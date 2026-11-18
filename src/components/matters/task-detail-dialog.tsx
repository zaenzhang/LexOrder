"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Tabs, Select, Button, Checkbox, Input, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { WorkspaceDialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { confirmDialog, confirmDiscardChanges } from "@/components/patterns/confirm-dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import type { TaskWorkflowDetail, TaskWorkflowItem, TaskWorkState } from "@/lib/tasks/workflow";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { formatDateTime } from "@/lib/utils";
import { changeWork } from "@/server/reminders/work-actions";
import { updateTask } from "@/server/tasks/actions";
import { finishTaskWaiting, getTaskWorkflow, getTaskWorkspace, rescheduleTaskWaiting, saveTaskDependencies, startTaskWaiting } from "@/server/tasks/workflow-actions";

export const taskStateLabels: Record<TaskWorkState, string> = { OPEN: "办理中", DONE: "已办结", CANCELLED: "已取消" };
const priorityLabels = ["普通", "较高", "紧急"];
const workLabels = { PROPOSE: "交接责任", RESCHEDULE: "调整任务截止", COMPLETE: "办结任务", CANCEL: "取消任务", REOPEN: "重新办理", DECLINE: "退回交接" };
type WorkAction = keyof typeof workLabels;
type BasicsDraft = { revision: number; title: string; description: string; priority: string };
type WorkDraft = { revision: number; action: WorkAction; reason: string; assigneeId: string; dueAt: string };
type WaitingDraft = { revision: number; waitingId: string; waitingFor: string; expectedResult: string; reason: string; nextCheckAt: string };
type WaitingEdit = { revision: number; waitingId: string; mode: "finish" | "reschedule"; result: string; nextCheckAt: string; reason: string };
type TaskDetailDialogProps = { taskId: string | null; expectedMatterId?: string; open: boolean; onOpenChange: (open: boolean) => void; onTaskChangeRejected?: (taskId: string) => void; onChanged?: (returnTaskId?: string) => void; onReturnFocus?: (taskId: string) => void };
type OpenTask = { id: string; expectedMatterId?: string };
type TaskDetailHandle = { canLeave: () => Promise<boolean> };

const dateInput = (value: Date | null) => value ? `${shDayKey(value)}T${shTime(value)}` : "";
const asShanghaiDate = (value: string) => new Date(`${value}:00+08:00`);
const prerequisiteLabel = (state: TaskWorkState) => state === "CANCELLED" ? "已取消 · 仍阻塞" : taskStateLabels[state];

export function TaskDetailDialog({ taskId, expectedMatterId, open, onOpenChange, onTaskChangeRejected, onChanged, onReturnFocus }: TaskDetailDialogProps) {
  const [activeTask, setActiveTask] = useState<OpenTask | null>(() => open && taskId ? { id: taskId, expectedMatterId } : null);
  const activeTaskRef = useRef(activeTask);
  const approvedClose = useRef<OpenTask | null>(null);
  const detailRef = useRef<TaskDetailHandle>(null);
  const navigationRejected = useRef(onTaskChangeRejected);
  const requestedKey = `${open ? taskId : ""}:${expectedMatterId ?? ""}`;
  const lastRequestedKey = useRef(requestedKey);

  useEffect(() => { navigationRejected.current = onTaskChangeRejected; }, [onTaskChangeRejected]);

  // 同案 query 历史先询问当前编辑表面；拒绝时由调用方 replace 回真实打开的 Task。
  useEffect(() => {
    if (lastRequestedKey.current === requestedKey) return;
    lastRequestedKey.current = requestedKey;
    const previous = activeTaskRef.current;
    const next = open && taskId ? { id: taskId, expectedMatterId } : null;
    if (previous?.id === next?.id && previous?.expectedMatterId === next?.expectedMatterId) return;
    const closingFromDialog = !next && approvedClose.current === previous;
    approvedClose.current = null;
    let cancelled = false;
    void (async () => {
      const allowed = closingFromDialog || !previous || await detailRef.current?.canLeave();
      if (cancelled) return;
      if (allowed) {
        activeTaskRef.current = next;
        setActiveTask(next);
      } else if (previous) {
        navigationRejected.current?.(previous.id);
      }
    })();
    return () => { cancelled = true; };
  }, [requestedKey, open, taskId, expectedMatterId]);

  async function close() {
    const current = activeTaskRef.current;
    if (!current || approvedClose.current === current || !await detailRef.current?.canLeave()) return;
    if (activeTaskRef.current !== current || approvedClose.current === current) return;
    approvedClose.current = current;
    onOpenChange(false);
  }

  return activeTask ? <TaskDetail key={`${activeTask.expectedMatterId ?? ""}:${activeTask.id}`} ref={detailRef} taskId={activeTask.id} expectedMatterId={activeTask.expectedMatterId} onClose={() => void close()} onChanged={onChanged} onReturnFocus={() => {
    // 换到另一任务时旧 WorkspaceDialog 也会卸载，不得把焦点从新详情抢回列表。
    if (!activeTaskRef.current) onReturnFocus?.(activeTask.id);
  }} /> : null;
}

const TaskDetail = forwardRef<TaskDetailHandle, { taskId: string; expectedMatterId?: string; onClose: () => void; onChanged?: (returnTaskId?: string) => void; onReturnFocus: () => void }>(function TaskDetail({ taskId, expectedMatterId, onClose, onChanged, onReturnFocus }, ref) {
  const router = useRouter();
  const fieldId = useId();
  const request = useRef(0);
  const saving = useRef(false);
  const leaveConfirmation = useRef<Promise<boolean> | null>(null);
  const [data, setData] = useState<TaskWorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const [basics, setBasics] = useState<BasicsDraft | null>(null);
  const [work, setWork] = useState<WorkDraft | null>(null);
  const [waiting, setWaiting] = useState<WaitingDraft | null>(null);
  const [waitingEdit, setWaitingEdit] = useState<WaitingEdit | null>(null);
  const [editingDependencies, setEditingDependencies] = useState(false);
  const [dependencyIds, setDependencyIds] = useState<string[] | null>(null);
  const [dependencyReason, setDependencyReason] = useState("");
  const [dependencyRevision, setDependencyRevision] = useState(0);
  const [candidates, setCandidates] = useState<TaskWorkflowItem[] | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [candidateReload, setCandidateReload] = useState(0);
  const [candidateQuery, setCandidateQuery] = useState("");
  const task = data?.task;
  const activeWaiting = task?.activeWaiting;
  const savedDependencyIds = task?.prerequisites.map(item => item.id) ?? [];
  const selectedIds = dependencyIds ?? savedDependencyIds;
  const dependenciesChanged = selectedIds.length !== savedDependencyIds.length || selectedIds.some(id => !savedDependencyIds.includes(id));
  const basicsDirty = Boolean(basics && (basics.title !== task?.title || basics.description !== (task?.description ?? "") || basics.priority !== String(task?.priority)));
  const workDirty = Boolean(work && (work.reason || work.assigneeId || work.action === "RESCHEDULE" && work.dueAt !== dateInput(task?.dueAt ?? null)));
  const waitingDirty = Boolean(waiting && (waiting.waitingFor || waiting.expectedResult || waiting.reason || waiting.nextCheckAt));
  const waitingEditDirty = Boolean(waitingEdit && (waitingEdit.result || waitingEdit.reason || waitingEdit.nextCheckAt !== dateInput(activeWaiting?.nextCheckAt ?? null)));
  const dirty = basicsDirty || workDirty || waitingDirty || waitingEditDirty || dependenciesChanged || Boolean(dependencyReason);

  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await getTaskWorkflow(taskId, expectedMatterId);
      if (request.current === currentRequest) setData(result);
    } catch (cause) {
      if (request.current === currentRequest) {
        setData(null);
        setLoadError(actionErrorMessage(cause) || "任务读取失败，请重试");
      }
    } finally {
      if (request.current === currentRequest) setLoading(false);
    }
  }, [taskId, expectedMatterId]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!editingDependencies || !task?.matterId) return;
    let cancelled = false;
    setCandidates(null);
    setCandidateError("");
    getTaskWorkspace({ matterId: task.matterId, includeClosed: true }).then(result => {
      if (!cancelled) setCandidates(result.tasks.filter(candidate => candidate.id !== taskId));
    }).catch(cause => {
      if (!cancelled) setCandidateError(actionErrorMessage(cause) || "前置任务读取失败，请重试");
    });
    return () => { cancelled = true; };
  }, [editingDependencies, task?.matterId, taskId, candidateReload]);

  async function discard(hasChanges: boolean) {
    return !hasChanges || await confirmDiscardChanges();
  }

  useImperativeHandle(ref, () => ({ canLeave: async () => {
    if (busy) return false;
    if (!dirty) return true;
    if (!leaveConfirmation.current) leaveConfirmation.current = discard(true).finally(() => { leaveConfirmation.current = null; });
    return leaveConfirmation.current;
  } }), [busy, dirty]);

  async function save(action: (revision: number) => Promise<unknown>, saved: () => void, message: string, expectedRevision = task?.responsibility.revision, returnTaskId?: string) {
    if (saving.current || loading || !task || expectedRevision === undefined) return;
    saving.current = true;
    setBusy(true);
    setSaveError("");
    try {
      if (expectedRevision !== task.responsibility.revision && !await confirmDialog({
        title: "任务已有更新，请核对当前记录",
        description: <span className="block max-h-64 space-y-3 overflow-y-auto text-sm">
          <span className="block">确认后，将按当前状态提交本表单保留的输入。</span>
          <span className="block whitespace-pre-wrap break-words"><strong className="block">当前内容</strong>{task.title}{task.description ? `\n${task.description}` : ""}</span>
          <span className="block"><strong className="block">责任与状态</strong>{task.responsibility.name} · {taskStateLabels[task.responsibility.state]} · {priorityLabels[task.priority]}</span>
          <span className="block"><strong className="block">任务截止</strong>{task.dueAt ? formatDateTime(task.dueAt) : "未安排"}</span>
          <span className="block"><strong className="block">当前外部等待</strong>{activeWaiting ? `${activeWaiting.waitingFor} · ${activeWaiting.expectedResult}` : "无"}</span>
          <span className="block"><strong className="block">当前前置任务</strong>{task.prerequisites.length ? task.prerequisites.map(item => `${item.title}（${prerequisiteLabel(item.state)}）`).join("、") : "无"}</span>
        </span>,
        confirmText: "按当前状态保存输入", cancelText: "继续核对", initialFocus: "cancel"
      })) return;
      await action(task.responsibility.revision);
      saved();
      Toast.success(message);
      onChanged?.(returnTaskId);
      router.refresh();
      await load();
    } catch (cause) {
      setSaveError(actionErrorMessage(cause) || "未能保存，请重试");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function openWork(action: WorkAction) {
    if (!task) return;
    setWork({ revision: task.responsibility.revision, action, reason: "", assigneeId: "", dueAt: dateInput(task.dueAt) });
    setSaveError("");
  }

  async function saveBasics(event: FormEvent) {
    event.preventDefault();
    if (!task || !basics) return;
    if (!basics.title.trim()) { setSaveError("请填写任务名称"); return; }
    await save(revision => updateTask({ id: task.id, matterId: task.matterId, revision, title: basics.title.trim(), description: basics.description.trim(), priority: Number(basics.priority), assigneeId: task.responsibility.assigneeId, stageId: task.stageId ?? undefined, dueAt: task.dueAt ?? undefined }), () => setBasics(null), "任务内容已保存", basics.revision);
  }

  async function saveWork(event: FormEvent) {
    event.preventDefault();
    if (!task || !work) return;
    if (!work.reason.trim()) { setSaveError("请填写处理结果或原因"); return; }
    if (work.action === "PROPOSE" && !work.assigneeId) { setSaveError("请选择接收人"); return; }
    await save(revision => changeWork({ id: task.responsibility.id, revision, action: work.action, reason: work.reason.trim(), assigneeId: work.action === "PROPOSE" ? work.assigneeId : undefined, dueAt: work.action === "RESCHEDULE" ? asShanghaiDate(work.dueAt) : undefined }), () => setWork(null), "处理结果已保存", work.revision, work.action === "COMPLETE" ? task.id : undefined);
  }

  async function saveWaiting(event: FormEvent) {
    event.preventDefault();
    if (!task || !waiting) return;
    if (!waiting.waitingFor.trim() || !waiting.expectedResult.trim() || !waiting.nextCheckAt) { setSaveError("请填写等待对象、待收成果和检查时间"); return; }
    await save(revision => startTaskWaiting({ taskId, revision, waitingId: waiting.waitingId, waitingFor: waiting.waitingFor.trim(), expectedResult: waiting.expectedResult.trim(), reason: waiting.reason.trim(), nextCheckAt: asShanghaiDate(waiting.nextCheckAt) }), () => setWaiting(null), "已登记等待", waiting.revision);
  }

  async function saveWaitingEdit(event: FormEvent) {
    event.preventDefault();
    if (!task || !waitingEdit) return;
    if (waitingEdit.waitingId !== activeWaiting?.id) { setSaveError("原等待已结束或发生变化，请核对等待记录；本次输入仍保留"); return; }
    const input = { taskId, waitingId: waitingEdit.waitingId };
    if (waitingEdit.mode === "finish") {
      if (!waitingEdit.result.trim()) { setSaveError("请记录实际结果或结束原因"); return; }
      await save(revision => finishTaskWaiting({ ...input, revision, result: waitingEdit.result.trim() }), () => setWaitingEdit(null), "等待已结束，任务继续办理", waitingEdit.revision);
    } else {
      if (!waitingEdit.nextCheckAt || !waitingEdit.reason.trim()) { setSaveError("请填写检查时间和调整原因"); return; }
      await save(revision => rescheduleTaskWaiting({ ...input, revision, nextCheckAt: asShanghaiDate(waitingEdit.nextCheckAt), reason: waitingEdit.reason.trim() }), () => setWaitingEdit(null), "等待检查时间已调整", waitingEdit.revision);
    }
  }

  async function saveDependencies(event: FormEvent) {
    event.preventDefault();
    if (!task || !candidates) return;
    if (!dependencyReason.trim()) { setSaveError("请填写前置任务的变更原因"); return; }
    await save(revision => saveTaskDependencies({ taskId, revision, prerequisiteIds: selectedIds, reason: dependencyReason.trim() }), () => { setDependencyIds(null); setDependencyReason(""); setEditingDependencies(false); }, "前置任务已保存", dependencyRevision);
  }

  const editable = Boolean(data?.canWrite && task?.responsibility.state === "OPEN");
  const blockingTasks = task?.prerequisites.filter(item => item.state !== "DONE") ?? [];
  const history = task?.waitings.filter(item => item.endedAt) ?? [];
  const disabled = busy || loading;

  return <WorkspaceDialog dismissOnBackdrop open onOpenChange={open => { if (!open) onClose(); }}>
    <FormDialogContent className="max-w-3xl" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <DialogHeader>
        <div className="flex items-start gap-3"><DialogTitle className="min-w-0 flex-1">{task?.title ?? "任务详情"}</DialogTitle>{task && <Tag color={task.responsibility.state === "DONE" ? "green" : "grey"}>{taskStateLabels[task.responsibility.state]}</Tag>}</div>
        <DialogDescription>{task?.stageId ? [task.procedureTitle, task.stageName].filter(Boolean).join(" · ") : "事项级任务"}</DialogDescription>
      </DialogHeader>
      <FormDialogBody>
        {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取任务…</p> : loadError || !data || !task ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{loadError || "无法读取此任务"}</p><Button onClick={() => void load()} type="tertiary" theme="outline" size="small">重试读取</Button></div> : <>
          {saveError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm"><span className="text-destructive">{saveError}</span><Button disabled={disabled} onClick={() => { void load(); setCandidateReload(value => value + 1); }} type="tertiary" theme="outline" size="small">重新核对状态</Button></div>}
          {!data.canWrite && <p className="text-sm text-muted-foreground">当前仅可查看此任务。</p>}
          <div role="group" aria-label="任务详情分区"><Tabs activeKey={tab} onChange={setTab} tabPaneMotion={false}>

            <Tabs.TabPane itemKey="overview" tab="概况" className="space-y-5">
              {basics && editable ? <form onSubmit={saveBasics} className="space-y-4">
                <div className="space-y-2"><label htmlFor={`${fieldId}-title`} className="text-sm font-medium text-[var(--semi-color-text-1)]">任务名称</label><Input id={`${fieldId}-title`} required maxLength={200} value={basics.title} onChange={inputValue => setBasics({ ...basics, title: inputValue })} disabled={disabled} /></div>
                <div className="space-y-2"><label htmlFor={`${fieldId}-description`} className="text-sm font-medium text-[var(--semi-color-text-1)]">办理说明</label><TextArea id={`${fieldId}-description`} maxLength={2000} rows={4} value={basics.description} onChange={inputValue => setBasics({ ...basics, description: inputValue })} disabled={disabled} /></div>
                <div className="space-y-2"><label id={`${fieldId}-priority` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">优先级</label><Select value={basics.priority} onChange={priority => { if (typeof priority === "string") setBasics({ ...basics, priority }); }} disabled={disabled} id={`${fieldId}-priority`} aria-labelledby={`${fieldId}-priority` + "-label"} className="w-40" motion={false}>{priorityLabels.map((label, index) => <Select.Option key={label} value={String(index)}>{label}</Select.Option>)}</Select></div>
                <div className="flex gap-2"><Button disabled={disabled || !basicsDirty} htmlType="submit" theme="solid">保存内容</Button><Button disabled={disabled} onClick={async () => { if (await discard(basicsDirty)) setBasics(null); }} htmlType="button" type="tertiary" theme="outline">取消编辑</Button></div>
              </form> : <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div><dt className="text-muted-foreground">内部责任人</dt><dd className="mt-1">{task.responsibility.name}{!task.responsibility.active ? <span className="ml-2 text-destructive">账号或岗位已停用，待交接</span> : !task.responsibility.acceptedAt ? <span className="ml-2 text-muted-foreground">尚未承接</span> : null}</dd></div>
                  <div><dt className="text-muted-foreground">任务截止</dt><dd className="mt-1">{task.dueAt ? formatDateTime(task.dueAt) : "未安排"}</dd></div>
                  <div><dt className="text-muted-foreground">优先级</dt><dd className="mt-1">{priorityLabels[task.priority]}</dd></div>
                  <div><dt className="text-muted-foreground">创建时间</dt><dd className="mt-1">{formatDateTime(task.createdAt)}</dd></div>
                  {task.description && <div className="col-span-2"><dt className="text-muted-foreground">办理说明</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{task.description}</dd></div>}
                </dl>
                {task.responsibility.proposedName && <p className="text-sm">待交给 {task.responsibility.proposedName}，承接前仍由 {task.responsibility.name} 负责。</p>}
                {task.responsibility.reason && <div className="border-l-2 pl-3 text-sm"><p className="text-muted-foreground">最近处理记录</p><p className="mt-1 whitespace-pre-wrap break-words">{task.responsibility.reason}</p></div>}
              </>}
              {editable && !basics && !work && <>
                {(activeWaiting || blockingTasks.length > 0) && <div className="flex flex-wrap items-center gap-3 text-sm">
                  {activeWaiting && <Button onClick={() => setTab("waiting")} type="primary" theme="borderless">办结前先结束外部等待</Button>}
                  {blockingTasks.length > 0 && <Button onClick={() => setTab("dependencies")} type="primary" theme="borderless">{blockingTasks.length} 项前置尚未办结</Button>}
                </div>}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={disabled || Boolean(activeWaiting) || blockingTasks.length > 0} onClick={() => openWork("COMPLETE")} theme="solid">办结任务</Button>
                  {(task.responsibility.proposedAssigneeId === data.currentUserId || (!task.responsibility.proposedAssigneeId && task.responsibility.assigneeId === data.currentUserId && !task.responsibility.acceptedAt)) && <Button disabled={disabled} onClick={() => void save(() => changeWork({ id: task.responsibility.id, revision: task.responsibility.revision, action: "ACCEPT" }), () => {}, "已确认承接")} type="tertiary" theme="outline">确认承接</Button>}
                  <Button disabled={disabled} onClick={() => { setBasics({ revision: task.responsibility.revision, title: task.title, description: task.description ?? "", priority: String(task.priority) }); setSaveError(""); }} type="tertiary" theme="outline">编辑内容</Button>
                  <Button disabled={disabled} onClick={() => openWork("RESCHEDULE")} type="tertiary" theme="outline">调整截止</Button>
                  <Button disabled={disabled} onClick={() => openWork("PROPOSE")} type="tertiary" theme="outline">交接责任</Button>
                  {task.responsibility.proposedAssigneeId === data.currentUserId && <Button disabled={disabled} onClick={() => openWork("DECLINE")} type="tertiary" theme="outline">退回交接</Button>}
                  <Button disabled={disabled} onClick={() => openWork("CANCEL")} type="tertiary" theme="borderless">取消任务</Button>
                </div>
              </>}
              {data.canWrite && task.responsibility.state !== "OPEN" && !work && <Button disabled={disabled} onClick={() => openWork("REOPEN")} type="tertiary" theme="outline">重新办理</Button>}
              {work && data.canWrite && <form onSubmit={saveWork} className="space-y-4 rounded-lg border p-4">
                <h3 className="text-sm font-semibold">{workLabels[work.action]}</h3>
                {work.action === "CANCEL" && activeWaiting && <p className="text-sm text-muted-foreground">同时结束当前外部等待，并以本次取消原因留痕。</p>}
                {work.action === "PROPOSE" && <div className="space-y-2"><label id={`${fieldId}-person` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">接收人</label><Select value={work.assigneeId} onChange={assigneeId => { if (typeof assigneeId === "string") setWork({ ...work, assigneeId }); }} disabled={disabled} id={`${fieldId}-person`} aria-labelledby={`${fieldId}-person` + "-label"} placeholder="选择接收人" className="w-full" motion={false}>{data.people.filter(person => person.id !== task.responsibility.assigneeId).map(person => <Select.Option key={person.id} value={person.id}>{person.name}</Select.Option>)}</Select></div>}
                {work.action === "RESCHEDULE" && <div className="space-y-2"><label htmlFor={`${fieldId}-due`} className="text-sm font-medium text-[var(--semi-color-text-1)]">任务截止（北京时间）</label><Input id={`${fieldId}-due`} required type="datetime-local" value={work.dueAt} onChange={inputValue => setWork({ ...work, dueAt: inputValue })} disabled={disabled} /></div>}
                <div className="space-y-2"><label htmlFor={`${fieldId}-work-reason`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{work.action === "COMPLETE" ? "处置结果" : "变更原因及通知情况"}</label><TextArea id={`${fieldId}-work-reason`} required maxLength={1000} rows={3} value={work.reason} onChange={inputValue => setWork({ ...work, reason: inputValue })} disabled={disabled} /></div>
                <div className="flex gap-2"><Button disabled={disabled} htmlType="submit" type={work.action === "CANCEL" ? "danger" : "primary"} theme={work.action === "CANCEL" ? "outline" : "solid"}>确认{workLabels[work.action]}</Button><Button disabled={disabled} onClick={async () => { if (await discard(workDirty)) setWork(null); }} htmlType="button" type="tertiary" theme="outline">取消操作</Button></div>
              </form>}
            </Tabs.TabPane>
            <Tabs.TabPane itemKey="waiting" tab="外部等待" className="space-y-5">
              {activeWaiting ? <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div><dt className="text-muted-foreground">等待对象</dt><dd className="mt-1 break-words">{activeWaiting.waitingFor}</dd></div>
                  <div><dt className="text-muted-foreground">内部责任人</dt><dd className="mt-1">{task.responsibility.name}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">待收成果</dt><dd className="mt-1 whitespace-pre-wrap break-words">{activeWaiting.expectedResult}</dd></div>
                  {activeWaiting.reason && <div className="col-span-2"><dt className="text-muted-foreground">等待原因</dt><dd className="mt-1 whitespace-pre-wrap break-words">{activeWaiting.reason}</dd></div>}
                  <div><dt className="text-muted-foreground">开始等待</dt><dd className="mt-1">{formatDateTime(activeWaiting.startedAt)}</dd></div>
                  <div><dt className="text-muted-foreground">下次检查</dt><dd className="mt-1">{formatDateTime(activeWaiting.nextCheckAt)}</dd></div>
                </dl>
                {editable && !waitingEdit && <div className="flex gap-2"><Button disabled={disabled} onClick={() => setWaitingEdit({ revision: task.responsibility.revision, waitingId: activeWaiting.id, mode: "finish", result: "", reason: "", nextCheckAt: dateInput(activeWaiting.nextCheckAt) })} theme="solid">结束等待并继续办理</Button><Button disabled={disabled} onClick={() => setWaitingEdit({ revision: task.responsibility.revision, waitingId: activeWaiting.id, mode: "reschedule", result: "", reason: "", nextCheckAt: dateInput(activeWaiting.nextCheckAt) })} type="tertiary" theme="outline">调整检查时间</Button></div>}
                {editable && waitingEdit && <form onSubmit={saveWaitingEdit} className="space-y-4 rounded-lg border p-4">
                  <h3 className="text-sm font-semibold">{waitingEdit.mode === "finish" ? "结束等待" : "调整检查时间"}</h3>
                  {waitingEdit.mode === "finish" ? <div className="space-y-2"><label htmlFor={`${fieldId}-waiting-result`} className="text-sm font-medium text-[var(--semi-color-text-1)]">实际结果或结束原因</label><TextArea id={`${fieldId}-waiting-result`} required maxLength={2000} rows={4} value={waitingEdit.result} onChange={inputValue => setWaitingEdit({ ...waitingEdit, result: inputValue })} disabled={disabled} /></div> : <>
                    <div className="space-y-2"><label htmlFor={`${fieldId}-check-date`} className="text-sm font-medium text-[var(--semi-color-text-1)]">下次检查（北京时间）</label><Input id={`${fieldId}-check-date`} type="datetime-local" required value={waitingEdit.nextCheckAt} onChange={inputValue => setWaitingEdit({ ...waitingEdit, nextCheckAt: inputValue })} disabled={disabled} /></div>
                    <div className="space-y-2"><label htmlFor={`${fieldId}-check-reason`} className="text-sm font-medium text-[var(--semi-color-text-1)]">调整原因</label><TextArea id={`${fieldId}-check-reason`} required maxLength={1000} value={waitingEdit.reason} onChange={inputValue => setWaitingEdit({ ...waitingEdit, reason: inputValue })} disabled={disabled} /></div>
                  </>}
                  <div className="flex gap-2"><Button disabled={disabled} htmlType="submit" theme="solid">{waitingEdit.mode === "finish" ? "保存结果并结束等待" : "保存检查时间"}</Button><Button disabled={disabled} onClick={async () => { if (await discard(waitingEditDirty)) setWaitingEdit(null); }} htmlType="button" type="tertiary" theme="outline">取消操作</Button></div>
                </form>}
              </> : waiting && editable ? <form onSubmit={saveWaiting} className="space-y-4">
                <p className="text-sm">内部责任人：{task.responsibility.name}</p>
                <div className="space-y-2"><label htmlFor={`${fieldId}-waiting-for`} className="text-sm font-medium text-[var(--semi-color-text-1)]">等待对象</label><Input id={`${fieldId}-waiting-for`} required maxLength={200} value={waiting.waitingFor} onChange={inputValue => setWaiting({ ...waiting, waitingFor: inputValue })} disabled={disabled} /></div>
                <div className="space-y-2"><label htmlFor={`${fieldId}-waiting-expected`} className="text-sm font-medium text-[var(--semi-color-text-1)]">待收成果</label><TextArea id={`${fieldId}-waiting-expected`} required maxLength={2000} rows={4} value={waiting.expectedResult} onChange={inputValue => setWaiting({ ...waiting, expectedResult: inputValue })} disabled={disabled} /></div>
                <div className="space-y-2"><label htmlFor={`${fieldId}-waiting-reason`} className="text-sm font-medium text-[var(--semi-color-text-1)]">等待原因（选填）</label><TextArea id={`${fieldId}-waiting-reason`} maxLength={1000} value={waiting.reason} onChange={inputValue => setWaiting({ ...waiting, reason: inputValue })} disabled={disabled} /></div>
                <div className="space-y-2"><label htmlFor={`${fieldId}-waiting-check`} className="text-sm font-medium text-[var(--semi-color-text-1)]">下次检查（北京时间）</label><Input id={`${fieldId}-waiting-check`} required type="datetime-local" value={waiting.nextCheckAt} onChange={inputValue => setWaiting({ ...waiting, nextCheckAt: inputValue })} disabled={disabled} /></div>
                <div className="flex gap-2"><Button disabled={disabled} htmlType="submit" theme="solid">保存等待</Button><Button disabled={disabled} onClick={async () => { if (await discard(waitingDirty)) setWaiting(null); }} htmlType="button" type="tertiary" theme="outline">取消登记</Button></div>
              </form> : <div className="space-y-3"><p className="text-sm text-muted-foreground">当前没有外部等待。</p>{editable && <Button onClick={() => { setWaiting({ revision: task.responsibility.revision, waitingId: crypto.randomUUID(), waitingFor: "", expectedResult: "", reason: "", nextCheckAt: "" }); setSaveError(""); }} theme="solid" size="small">登记等待</Button>}</div>}
            </Tabs.TabPane>
            <Tabs.TabPane itemKey="dependencies" tab={<> 前置任务{task.prerequisites.length > 0 ? `（${task.prerequisites.length}）` : ""}</>} className="space-y-4">
              {editingDependencies && editable ? <form onSubmit={saveDependencies} className="space-y-4">
                <div className="space-y-2"><label htmlFor={`${fieldId}-candidate-query`} className="text-sm font-medium text-[var(--semi-color-text-1)]">选择同案前置任务</label><Input id={`${fieldId}-candidate-query`} placeholder="查找任务" value={candidateQuery} onChange={inputValue => setCandidateQuery(inputValue)} disabled={disabled} /></div>
                {candidateError ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{candidateError}</p><Button onClick={() => setCandidateReload(value => value + 1)} htmlType="button" type="tertiary" theme="outline" size="small">重试候选任务</Button></div> : !candidates ? <p role="status" className="text-sm text-muted-foreground">正在读取同案任务…</p> : <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {candidates.filter(candidate => candidate.title.includes(candidateQuery.trim())).map(candidate => <div key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/40"><Checkbox checked={selectedIds.includes(candidate.id)} disabled={disabled} onChange={({ target: { checked } }) => setDependencyIds(checked === true ? [...selectedIds, candidate.id] : selectedIds.filter(id => id !== candidate.id))} className="mt-0.5"><span className="min-w-0 flex-1 break-words text-sm">{candidate.title}</span><Tag color={candidate.responsibility.state === "DONE" ? "green" : "grey"}>{prerequisiteLabel(candidate.responsibility.state)}</Tag></Checkbox></div>)}
                  {candidates.filter(candidate => candidate.title.includes(candidateQuery.trim())).length === 0 && <p className="p-2 text-sm text-muted-foreground">没有符合条件的同案任务。</p>}
                </div>}
                <p className="text-sm text-muted-foreground">已选 {selectedIds.length} 项</p>
                <div className="space-y-2"><label htmlFor={`${fieldId}-dependency-reason`} className="text-sm font-medium text-[var(--semi-color-text-1)]">变更原因</label><TextArea id={`${fieldId}-dependency-reason`} required maxLength={1000} value={dependencyReason} onChange={inputValue => setDependencyReason(inputValue)} disabled={disabled} /></div>
                <div className="flex gap-2"><Button disabled={disabled || !candidates || !dependenciesChanged} htmlType="submit" theme="solid">保存前置任务</Button><Button disabled={disabled} onClick={async () => { if (await discard(dependenciesChanged || Boolean(dependencyReason))) { setEditingDependencies(false); setDependencyIds(null); setDependencyReason(""); } }} htmlType="button" type="tertiary" theme="outline">取消编辑</Button></div>
              </form> : <>
                {task.prerequisites.length ? <ul className="divide-y rounded-lg border">{task.prerequisites.map(item => <li key={item.id} className="flex items-start justify-between gap-3 p-3 text-sm"><span className="min-w-0 break-words">{item.title}</span><Tag color={item.state === "DONE" ? "green" : "grey"}>{prerequisiteLabel(item.state)}</Tag></li>)}</ul> : <p className="text-sm text-muted-foreground">尚未设置前置任务。</p>}
                {editable && <Button onClick={() => { setEditingDependencies(true); setDependencyIds(task.prerequisites.map(item => item.id)); setDependencyRevision(task.responsibility.revision); setCandidateQuery(""); setSaveError(""); }} type="tertiary" theme="outline" size="small">维护前置任务</Button>}
              </>}
            </Tabs.TabPane>
            <Tabs.TabPane itemKey="history" tab={<> 等待记录{history.length > 0 ? `（${history.length}）` : ""}</>} className="space-y-3">
              {history.length ? <ul className="divide-y">{history.map(item => <li key={item.id} className="space-y-2 py-4 first:pt-0 text-sm">
                <div className="flex items-start justify-between gap-3"><h3 className="font-medium break-words">{item.waitingFor}</h3><Tag color="grey">已结束</Tag></div>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">待收成果：{item.expectedResult}</p>
                {item.reason && <p className="whitespace-pre-wrap break-words text-muted-foreground">等待原因：{item.reason}</p>}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground"><div><dt className="inline">开始：</dt><dd className="inline">{formatDateTime(item.startedAt)}</dd></div><div><dt className="inline">结束：</dt><dd className="inline">{formatDateTime(item.endedAt!)}</dd></div></dl>
                <p className="whitespace-pre-wrap break-words">{item.result}</p>
              </li>)}</ul> : <p className="text-sm text-muted-foreground">没有已结束的等待记录。</p>}
            </Tabs.TabPane>
          </Tabs></div>
        </>}
      </FormDialogBody>
      <DialogFooter>{busy && <span role="status" className="mr-auto text-sm text-muted-foreground">正在保存…</span>}<Button disabled={busy} onClick={onClose} type="tertiary" theme="outline">关闭详情</Button></DialogFooter>
    </FormDialogContent>
  </WorkspaceDialog>;
});
