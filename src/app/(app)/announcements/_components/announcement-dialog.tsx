"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, TextArea, Notification, Toast } from "@douyinfe/semi-ui";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  createAnnouncement,
  updateAnnouncement
} from "@/server/announcements/actions";
import { shDayKey } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type Editing = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  expiresAt: Date | null;
} | null;

function toDateInput(d: Date | null): string {
  return d ? shDayKey(d) : "";
}

export function AnnouncementDialog({
  open,
  onOpenChange,
  editing
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Editing;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      if (editing) {
        setTitle(editing.title);
        setContent(editing.content);
        setPinned(editing.pinned);
        setExpiresAt(toDateInput(editing.expiresAt));
      } else {
        setTitle("");
        setContent("");
        setPinned(false);
        setExpiresAt("");
      }
    }
  }, [open, editing]);

  function handleSave() {
    if (!title.trim() || !content.trim()) {
      Notification.error({ title: "标题和内容必填", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          title,
          content,
          pinned,
          expiresAt: expiresAt ? new Date(`${expiresAt}T00:00+08:00`) : null
        };
        if (editing) {
          await updateAnnouncement({ ...payload, id: editing.id });
          Toast.success("已更新");
        } else {
          await createAnnouncement(payload);
          Toast.success("已发布");
        }
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "保存失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑公告" : "发布公告"}</DialogTitle>
          <DialogDescription className="text-xs">
            置顶公告显示在顶部公告栏；到期后退出公告栏，列表仍保留。
          </DialogDescription>
        </DialogHeader>
        <FormDialogBody>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label htmlFor="announcement-title" className="text-sm">标题 *</label>
            <Input id="announcement-title" value={title} onChange={setTitle} maxLength={120} disabled={isPending} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="announcement-content" className="text-sm">内容 *</label>
            <TextArea
              id="announcement-content"
              value={content}
              onChange={setContent}
              disabled={isPending}
              rows={6}
              placeholder="支持普通文本换行"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Checkbox
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked === true)}
              disabled={isPending}
            >
              置顶到公告栏
            </Checkbox>
            <div className="space-y-1.5">
              <label htmlFor="announcement-expires" className="text-sm">过期日期（可选）</label>
              <Input
                id="announcement-expires"
                type="date"
                value={expiresAt}
                onChange={setExpiresAt}
                disabled={isPending}
              />
            </div>
          </div>
        </div>

        </FormDialogBody>
        <DialogFooter>
          <Button htmlType="button" theme="outline" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button htmlType="button" theme="solid" onClick={handleSave} loading={isPending} disabled={isPending}>
            {editing ? "更新" : "发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
