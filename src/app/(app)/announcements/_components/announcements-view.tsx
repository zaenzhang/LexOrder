"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, Pencil, Archive } from "lucide-react";
import { Button, Tag, Notification, Toast } from "@douyinfe/semi-ui";
import { formatDate } from "@/lib/utils";
import { AnnouncementDialog } from "./announcement-dialog";
import { archiveAnnouncement } from "@/server/announcements/actions";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { actionErrorMessage } from "@/lib/action-error";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  archivedAt: Date | null;
  author: { id: string; name: string };
};

export function AnnouncementsView({
  items,
  isManager,
  currentUserId
}: {
  items: AnnouncementItem[];
  isManager: boolean;
  currentUserId: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const router = useRouter();
  useTopbarAction(isManager ? { label: "发布公告", onClick: () => { setEditing(null); setDialogOpen(true); } } : "none", [isManager]);

  async function handleArchive(a: AnnouncementItem) {
    if (!(await confirmDialog({ title: `归档公告「${a.title}」？`, description: "归档后不再显示，但保留历史。", confirmText: "归档" }))) return;
    try {
      await archiveAnnouncement(a.id);
      Toast.success("已归档");
      router.refresh();
    } catch (err) {
      Notification.error({ title: "归档失败", content: actionErrorMessage(err), duration: 6 });
    }
  }

  const active = items.filter((a) => !a.archivedAt);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mo-ph-title">公告指引</h1>
          <p className="mo-ph-sub">
            共 {active.length} 条公告
          </p>
        </div>
      </header>

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-background py-8 text-center text-xs text-muted-foreground">
          暂无公告
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((a) => {
            const canEdit = isManager || a.author.id === currentUserId;
            const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
            return (
              <li key={a.id} className="ll-surface p-4">
                <header className="mb-1.5 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {a.pinned && (
                      <Tag color="orange" prefixIcon={<Pin size={12} aria-hidden />}>置顶</Tag>
                    )}
                    <h3 className="min-w-0 break-words text-sm font-medium">{a.title}</h3>
                    {expired && (
                      <Tag color="grey">已过期</Tag>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        htmlType="button"
                        theme="borderless"
                        size="small"
                        onClick={() => {
                          setEditing(a);
                          setDialogOpen(true);
                        }}
                        aria-label={`编辑公告：${a.title}`}
                        icon={<Pencil size={14} aria-hidden />}
                      />
                      <Button
                        htmlType="button"
                        theme="borderless"
                        size="small"
                        onClick={() => handleArchive(a)}
                        type="danger"
                        aria-label={`归档公告：${a.title}`}
                        icon={<Archive size={14} aria-hidden />}
                      />
                    </div>
                  )}
                </header>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
                  {a.content}
                </p>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {a.author.name} · 发布于 {formatDate(a.publishedAt)}
                  {a.expiresAt && ` · 过期于 ${formatDate(a.expiresAt)}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AnnouncementDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}
