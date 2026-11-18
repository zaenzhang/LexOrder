"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Button, Checkbox, Input, RadioGroup, Select, TextArea } from "@douyinfe/semi-ui";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createTask } from "@/server/tasks/actions";
import { civilKey, shParts, WEEKDAY_CN } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type MatterPickerItem = { id: string; internalCode: string; title: string };

export function AddTaskDialog({
  open,
  onOpenChange,
  date,
  matters
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: Date | null;
  matters: MatterPickerItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [matterId, setMatterId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<0 | 1 | 2>(0);
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState("09:00");
  const requestKey = useRef(crypto.randomUUID());
  const dialogRef = useRef<HTMLDivElement>(null);
  const [matterPickerOpen, setMatterPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    requestKey.current = crypto.randomUUID();
    setMatterPickerOpen(false);
    setMatterId("");
    setTitle("");
    setDescription("");
    setPriority(0);
    setAllDay(false);
    setTime("09:00");
  }, [open]);

  function submit() {
    if (!matterId) {
      toast.warning("请选择关联案件");
      return;
    }
    if (!title.trim()) {
      toast.warning("请填写事项标题");
      return;
    }
    if (!date) {
      toast.warning("缺少日期");
      return;
    }

    // 合成 dueAt（上海时区）：date 是 sh-time「本地正午」载体，不能用浏览器本地 setHours——
    // 境外浏览器会把所选时刻/全天边界挪到别的日历日；统一以 +08:00 拼接
    const key = civilKey(date);
    const [hhStr, mmStr] = time.split(":");
    const timePart = allDay ? "23:59" : `${hhStr ?? "09"}:${mmStr ?? "00"}`;
    const dueAt = new Date(`${key}T${timePart}:00+08:00`);

    startTransition(async () => {
      try {
        await createTask({
          requestKey: requestKey.current,
          matterId,
          title: title.trim(),
          description,
          dueAt,
          priority,
          assigneeId: "",
          stageId: ""
        });
        toast.success("任务已创建");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("创建失败", {
          description: actionErrorMessage(err)
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent ref={dialogRef} className="max-w-md" onEscapeKeyDown={(event) => { if (matterPickerOpen) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription className="text-xs">
            {date
              ? (() => {
                  const p = shParts(date);
                  return `${p.y}年${p.m}月${p.d}日 星期${WEEKDAY_CN[p.w] ?? p.w}`;
                })()
              : "—"}
          </DialogDescription>
        </DialogHeader>
        <FormDialogBody>
          <form id="schedule-add-task" onSubmit={(event) => { event.preventDefault(); if (!isPending) submit(); }} className="space-y-3">
            <div className="space-y-1.5">
              <label id="schedule-task-matter-label" className="text-xs">关联案件 <span className="text-destructive">*</span></label>
              <Select
                aria-labelledby="schedule-task-matter-label"
                value={matterId || undefined}
                onChange={(value) => setMatterId(value as string)}
                disabled={isPending}
                placeholder="请选择"
                filter
                optionList={matters.map((matter) => ({ value: matter.id, label: `${matter.internalCode} ${matter.title}` }))}
                style={{ width: "100%" }}
                motion={false}
                getPopupContainer={() => dialogRef.current!}
                onDropdownVisibleChange={setMatterPickerOpen}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="schedule-task-title" className="text-xs">事项标题 <span className="text-destructive">*</span></label>
              <Input id="schedule-task-title" placeholder="如：起草起诉状 / 提交证据清单" value={title} onChange={setTitle} disabled={isPending} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="schedule-task-time" className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />时间</label>
              <div className="flex items-center gap-2">
                <Input id="schedule-task-time" type="time" step={300} value={time} disabled={allDay || isPending} onChange={setTime} style={{ width: 140 }} />
                <Checkbox checked={allDay} onChange={(event) => setAllDay(Boolean(event.target.checked))} disabled={isPending}>全天</Checkbox>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="schedule-task-description" className="text-xs">描述（可选）</label>
              <TextArea id="schedule-task-description" rows={2} placeholder="事项详情、相关材料等" value={description} onChange={setDescription} disabled={isPending} />
            </div>
            <div className="space-y-1.5">
              <div id="schedule-task-priority-label" className="text-xs">优先级</div>
              <RadioGroup aria-labelledby="schedule-task-priority-label" type="button" buttonSize="small" value={priority} onChange={(event) => setPriority(event.target.value as 0 | 1 | 2)} disabled={isPending} options={[
                { value: 0, label: "普通" }, { value: 1, label: "高" }, { value: 2, label: "紧急" }
              ]} />
            </div>
          </form>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="outline" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button htmlType="submit" form="schedule-add-task" theme="solid" loading={isPending} disabled={isPending}>创建任务</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
