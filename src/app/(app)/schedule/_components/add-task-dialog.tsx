"use client";

import { Button, Checkbox, Input, RadioGroup, Select, TextArea, Notification, Toast } from "@douyinfe/semi-ui";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clock } from "lucide-react";

import {
  WorkspaceDialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/patterns/workspace-dialog";

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
  const formId = useId();
  const editorContent = useRef<HTMLDivElement>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setOpenSelect(null); return; }
    requestKey.current = crypto.randomUUID();
    setMatterId("");
    setTitle("");
    setDescription("");
    setPriority(0);
    setAllDay(false);
    setTime("09:00");
  }, [open]);

  function submit() {
    if (isPending) return;
    if (!matterId) {
      Toast.warning("请选择关联案件");
      return;
    }
    if (!title.trim()) {
      Toast.warning("请填写事项标题");
      return;
    }
    if (!date) {
      Toast.warning("缺少日期");
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
        Toast.success("任务已创建");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "创建失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={value => { if (!isPending) onOpenChange(value); }}>
      <DialogContent ref={editorContent} className="max-w-md" onEscapeKeyDown={event => { if (openSelect) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            新建任务
          </DialogTitle>
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
        <form id={formId} onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset disabled={isPending} className="space-y-3">
          <div className="space-y-1.5">
            <label id="task-matter-label" htmlFor="task-matter" className="text-xs">
              关联案件 <span className="text-destructive">*</span>
            </label>
            <Select id="task-matter" aria-labelledby="task-matter-label" className="w-full" disabled={isPending} motion={false} getPopupContainer={() => editorContent.current!} placeholder="请选择" onDropdownVisibleChange={visible => setOpenSelect(previous => visible ? "task-matter" : previous === "task-matter" ? null : previous)} value={matterId || undefined} onChange={value => { if (typeof value === "string") setMatterId(value); }}
              filter searchPlaceholder="搜索编号或案件名" optionList={matters.map(matter => ({ value: matter.id, label: `${matter.internalCode} ${matter.title}` }))} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-xs">
              事项标题 <span className="text-destructive">*</span>
            </label>
            <Input
              id="task-title"
              placeholder="如：起草起诉状 / 提交证据清单"
              value={title}
              onChange={value => setTitle(value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-time" className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" />
              时间
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="task-time"
                type="time"
                step={300}
                value={time}
                disabled={allDay || isPending}
                onChange={setTime}
                className="max-w-40 font-mono"
              />
                <Checkbox
                  checked={allDay}
                  disabled={isPending}
                  onChange={event => setAllDay(event.target.checked === true)}
                >全天</Checkbox>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-description" className="text-xs">描述（可选）</label>
            <TextArea
              id="task-description"
              rows={2}
              placeholder="事项详情、相关材料等"
              value={description}
              onChange={value => setDescription(value)}
            />
          </div>

          <div className="space-y-1.5">
            <label id="task-priority-label" className="text-xs">优先级</label>
            <RadioGroup type="button" aria-labelledby="task-priority-label" value={priority} disabled={isPending}
              onChange={event => setPriority(event.target.value as 0 | 1 | 2)} options={[
                { value: 0, label: "普通" },
                { value: 1, label: "高" },
                { value: 2, label: "紧急" }
              ]} />
          </div>
        </fieldset>
        </form>
        </FormDialogBody>
        <DialogFooter>
          <Button
            theme="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button theme="solid" htmlType="submit" form={formId} disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
