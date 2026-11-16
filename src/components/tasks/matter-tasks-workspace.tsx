"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey } from "@/lib/ui/sh-time";
import { getMatterTasks, getTask } from "@/server/tasks/actions";
import { taskStateLabels, type MatterTasksView, type TaskDetail as Detail } from "@/server/tasks/contracts";
import { TaskEditor } from "./task-editor";
import { TaskDetail } from "./task-detail";

type Props = {
  matterId: string; taskId?: string|null; createSignal?: number;
  onSelectTask(id: string|null): void; onDraftStateChange?(dirty: boolean, busy: boolean): void;
};
export function MatterTasksWorkspace({ matterId, taskId = null, createSignal = 0, onSelectTask, onDraftStateChange }: Props) {
  const [view, setView] = useState<MatterTasksView|null>(null), [record, setRecord] = useState<Detail|null>(null);
  const [mode, setMode] = useState<"list"|"detail"|"new"|"edit">(taskId ? "detail" : "list");
  const [selectedId, setSelectedId] = useState<string|null>(taskId);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [stage, setStage] = useState("all");
  const selected = useRef<string|null>(taskId), seen = useRef(""), seq = useRef(0), signal = useRef(0);
  const dirty = useRef(false), busy = useRef(false);
  const callback = useRef(onDraftStateChange), selectCallback = useRef(onSelectTask);
  useEffect(() => { callback.current = onDraftStateChange; selectCallback.current = onSelectTask; }, [onDraftStateChange, onSelectTask]);
  const draftState = useCallback((changed: boolean, pending: boolean) => {
    dirty.current = changed; busy.current = pending; callback.current?.(changed, pending);
  }, []);
  const load = useCallback(async (id: string|null, nextMode: "list"|"detail"|"new" = id ? "detail" : "list") => {
    const token = ++seq.current;
    selected.current = id; setSelectedId(id); setMode(nextMode); setRecord(null); setView(null); setLoading(true); setError("");
    try {
      const [list, detail] = await Promise.all([getMatterTasks(matterId), id ? getTask(matterId, id) : null]);
      if (token !== seq.current) return;
      if (nextMode === "new" && !list.canWrite) throw new Error("当前无权新增本案待办");
      setView(list); setRecord(detail); draftState(false, false);
    } catch (error) { if (token === seq.current) setError(actionErrorMessage(error) || "待办读取失败，请重试"); }
    finally { if (token === seq.current) setLoading(false); }
  }, [matterId, draftState]);
  const allowLeave = useCallback(async () => {
    if (busy.current) return false;
    return !dirty.current || await confirmDialog({ title: "放弃未保存的待办记录？", confirmText: "放弃并切换", cancelText: "继续填写", initialFocus: "cancel" });
  }, []);
  const navigate = useCallback(async function navigate(id: string|null, nextMode: "list"|"detail"|"new" = id ? "detail" : "list") {
    if (!await allowLeave()) return;
    draftState(false, false); seen.current = `${matterId}:${id ?? ""}`;
    selectCallback.current(id); await load(id, nextMode);
  }, [allowLeave, draftState, matterId, load]);
  useEffect(() => {
    const key = `${matterId}:${taskId ?? ""}`;
    if (seen.current === key) return;
    seen.current = key;
    let disposed = false;
    void (async () => {
      if ((dirty.current || busy.current) && !await allowLeave()) {
        if (!disposed) { seen.current = `${matterId}:${selected.current ?? ""}`; selectCallback.current(selected.current); }
        return;
      }
      if (!disposed) await load(taskId);
    })();
    return () => { disposed = true; };
  }, [matterId, taskId, load, allowLeave]);
  useEffect(() => {
    if (createSignal === signal.current) return;
    signal.current = createSignal;
    if (createSignal) void navigate(null, "new");
    // createSignal is a request edge, not a state mirror; it must not re-open after a read.
  }, [createSignal, navigate]);
  useEffect(() => () => { seq.current++; callback.current?.(false, false); }, []);
  function saved(id: string) {
    if (mode === "new") { setStage("all"); setStatus("all"); setSearch(""); }
    draftState(false, false); seen.current = `${matterId}:${id}`; selectCallback.current(id); void load(id);
  }
  const visible = view?.tasks.filter(task => (status === "all" || task.state === status)
    && (stage === "all" || (stage === "none" ? !task.stageId : task.stageId === stage))
    && (!search.trim() || task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) ?? [];
  return <section aria-label="案件待办" className="space-y-4">
    <header className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><h2 className="font-semibold">待办</h2>{view ? <span className="text-sm text-muted-foreground">{view.tasks.length} 项</span> : null}</div>{view?.canWrite ? <Button size="sm" onClick={() => void navigate(null, "new")}>新建待办</Button> : null}</header>
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取待办…</p> : null}
    {error ? <div role="alert" className="space-y-2 rounded-md border p-3 text-sm"><p>{error}</p><Button variant="outline" size="sm" onClick={() => void load(selected.current, mode === "new" ? "new" : selected.current ? "detail" : "list")}>重试</Button>{selectedId ? <Button variant="ghost" size="sm" onClick={() => void navigate(null)}>返回待办列表</Button> : null}</div> : null}
    {!loading && view ? <div className="grid grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)] gap-5">
      <div className="space-y-3">
        <Input aria-label="筛选待办标题" placeholder="查找待办" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="flex gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="待办状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="OPEN">办理中</SelectItem><SelectItem value="DONE">已完成</SelectItem><SelectItem value="CANCELLED">已取消</SelectItem></SelectContent></Select>
          <Select value={stage} onValueChange={setStage}><SelectTrigger aria-label="待办阶段"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全案全部阶段</SelectItem><SelectItem value="none">不绑定阶段</SelectItem>{view.stages.map(option => <SelectItem key={option.id} value={option.id}>{option.procedureLabel} · {option.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="divide-y rounded-md border">{visible.length ? visible.map(task => <Button key={task.id} variant={selectedId === task.id ? "secondary" : "ghost"} className="h-auto w-full flex-col items-start gap-2 rounded-none p-3 text-left whitespace-normal" onClick={() => void navigate(task.id)}>
          <span className="break-words font-medium">{task.title}</span><span className="text-xs text-muted-foreground">{task.assigneeName} · {task.dueAt ? shDayKey(task.dueAt) : "未安排日期"} · {taskStateLabels[task.state]}</span>
          {task.waiting || task.blockers ? <span className="flex flex-wrap gap-2">{task.waiting ? <Badge variant="outline">待 {task.waiting.externalParty} · {task.waiting.nextCheckDate} 检查</Badge> : null}{task.blockers ? <Badge variant="outline">{task.blockers} 项前置未满足</Badge> : null}</span> : null}
        </Button>) : <p className="p-3 text-sm text-muted-foreground">{view.tasks.length ? "没有符合筛选的待办" : "暂无待办"}</p>}</div>
      </div>
      <div className="min-w-0 rounded-md border p-4">
        {mode === "new" || mode === "edit" ? <TaskEditor key={mode === "new" ? "new" : record!.id} matterId={matterId} record={mode === "edit" ? record : null} options={view} onSaved={saved} onCancel={() => void navigate(record?.id ?? null)} onDraftStateChange={draftState} />
          : record ? <TaskDetail key={`${record.id}:${record.revision}`} matterId={matterId} record={record} options={view} onEdit={() => setMode("edit")} onOpenTask={id => void navigate(id)} onChanged={() => void load(record.id)} onDraftStateChange={draftState} />
          : <p className="text-sm text-muted-foreground">选择待办查看办理、等待与依赖记录。</p>}
      </div>
    </div> : null}
  </section>;
}
