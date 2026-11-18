"use client";

import { FocusButton } from "@/components/patterns/focus-button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Notification, TextArea, Toast } from "@douyinfe/semi-ui";
import { IconTickCircle as CheckCircle2, IconArchive as Archive, IconPause as Pause, IconPlay as Play, IconLoading as Loader2, IconMore as MoreHorizontal, IconDownload as Download } from "@douyinfe/semi-icons";
import type { MatterStatus } from "@prisma/client";
import {
  WorkspaceDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/patterns/workspace-dialog";
import {
  closeMatter,
  reopenMatter,
  holdMatter
} from "@/server/matters/lifecycle";
import { ArchiveWizardDialog } from "./archive-wizard";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

export function LifecycleActions({
  matterId,
  status,
  canArchive,
  canChangeStatus = true,
  canExportBundle = false
}: {
  matterId: string;
  status: MatterStatus;
  canArchive: boolean;
  /** M-3c（D 批）：在办卷宗打包导出资格（与案件工作簿导出同口径，页面服务端判定） */
  canExportBundle?: boolean;
  canChangeStatus?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"close" | "hold" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [text, setText] = useState("");

  const isArchived = status === "ARCHIVED";

  function open(d: "close" | "hold") {
    setText("");
    setDialog(d);
  }

  function handleSubmit() {
    if (dialog === "close" && !text.trim()) {
      Toast.warning("请填写结案小结");
      return;
    }
    startTransition(async () => {
      try {
        if (dialog === "close") {
          await closeMatter({ id: matterId, summary: text });
          Toast.success("案件已结案");
        } else if (dialog === "hold") {
          await holdMatter({ id: matterId, reason: text });
          Toast.success("案件已暂停");
        }
        setDialog(null);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  async function handleReopen() {
    if (!(await confirmDialog({ title: "重新开放案件？", description: "案件状态将改为「办理中」。", confirmText: "重新开放" }))) return;
    startTransition(async () => {
      try {
        await reopenMatter(matterId);
        Toast.success("案件已重新开放");
        router.refresh();
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  // M-3c（D 批）：在办卷宗打包导出（归档案件走归档包，见下方分支）
  const bundleLink = !isArchived && canExportBundle ? (
    <a href={`/api/matters/${matterId}/export-bundle`} className="workspace-action-link" title="导出在办卷宗 ZIP（manifest + 材料 + 记录与财务摘要）">
      <Download aria-hidden />
      导出卷宗
    </a>
  ) : null;
  if (isArchived) {
    return <a href={`/api/archive/${matterId}/export`} className="workspace-action-link" title="导出归档 ZIP（含材料 + 结构化数据 + 卷宗封皮目录）">
      <Download aria-hidden />
      导出 ZIP
    </a>;
  }

  return (
    <>
      {bundleLink}
      {canChangeStatus ? (
        <Dropdown trigger="click" position="bottomRight" closeOnEsc clickTriggerToHide motion={false}
          visible={moreOpen} onVisibleChange={setMoreOpen}
          render={<Dropdown.Menu className="w-48">
            {(status === "ON_HOLD" || status === "CLOSED") && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); void handleReopen(); }}>
                <Play aria-hidden size="default" className="mr-2" />
                重新开放
              </Dropdown.Item>
            )}
            {status === "IN_PROGRESS" && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); open("hold"); }}>
                <Pause aria-hidden size="default" className="mr-2" />
                暂停办理
              </Dropdown.Item>
            )}
            {status !== "CLOSED" && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); open("close"); }}>
                <CheckCircle2 aria-hidden size="default" className="mr-2 text-[var(--semi-color-success)]" />
                结案
              </Dropdown.Item>
            )}
            {canArchive && (
              <>
                <Dropdown.Divider />
                <Dropdown.Item
                  onClick={() => { setMoreOpen(false); setArchiveOpen(true); }}
                  className="text-[var(--semi-color-warning)] focus:text-[var(--semi-color-warning)]"
                >
                  <Archive aria-hidden size="default" className="mr-2" />
                  归档（不可逆）
                </Dropdown.Item>
              </>
            )}
          </Dropdown.Menu>}>
          <FocusButton theme="outline" type="tertiary" htmlType="button" disabled={isPending} aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen}>
              {isPending ? <Loader2 aria-hidden spin /> : <MoreHorizontal aria-hidden />}
            </FocusButton>
        </Dropdown>
      ) : null}

      <WorkspaceDialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "close" ? "结案" : "暂停案件"}</DialogTitle>
            <DialogDescription>
              {dialog === "close" &&
                "结案后案件状态为'已结案'，仍可编辑。结案小结会进入时间线。"}
              {dialog === "hold" && "暂停后案件不再显示在'办理中'筛选。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-xs">
              {dialog === "close" ? "结案小结" : "暂停原因"}
              {dialog === "close" && <span className="ml-1 text-destructive">*</span>}
            </label>
            <TextArea
              value={text}
              onChange={inputValue => setText(inputValue)}
              placeholder={
                dialog === "close"
                  ? "如：经一审判决支持原告诉请，对方未上诉，判决已生效"
                  : "如：等待客户补充证据材料"
              }
              rows={5}
            />
          </div>

          <DialogFooter>
            <Button onClick={() => setDialog(null)} disabled={isPending} type="tertiary" theme="outline">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} theme="solid">
              {isPending && <Loader2 aria-hidden size="small" className="mr-1.5" spin />}
              {dialog === "close" ? "确认结案" : "确认暂停"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </WorkspaceDialog>

      <ArchiveWizardDialog
        matterId={matterId}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
      />
    </>
  );
}
