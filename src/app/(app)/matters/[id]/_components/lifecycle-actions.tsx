"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Notification, TextArea, Toast } from "@douyinfe/semi-ui";
import {
  CheckCircle2,
  Archive,
  Pause,
  Play,
  Loader2,
  MoreHorizontal,
  Lock,
  Download
} from "lucide-react";
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
  canExportBundle = false,
  extraItems = [],
  moreTriggerRef
}: {
  matterId: string;
  status: MatterStatus;
  canArchive: boolean;
  /** M-3c（D 批）：在办卷宗打包导出资格（与案件工作簿导出同口径，页面服务端判定） */
  canExportBundle?: boolean;
  /** 无主办/协办权限时只显示 extraItems（查看类入口） */
  canChangeStatus?: boolean;
  /** 墨案 04 页头「···」菜单：页面级入口（编辑信息）。服务轴 UI 已移除（2026-09-20 用户确认） */
  extraItems?: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; onSelect: () => void }[];
  /** 菜单项卸载后，外部弹窗仍可返回常驻的页头按钮。 */
  moreTriggerRef?: React.Ref<HTMLButtonElement>;
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

  const extras = extraItems.map((it) => (
    <Dropdown.Item key={it.key} onClick={() => { setMoreOpen(false); it.onSelect(); }}>
      <it.icon className="mr-2 h-4 w-4 text-[var(--t-muted)]" />
      {it.label}
    </Dropdown.Item>
  ));

  // M-3c（D 批）：在办卷宗打包导出（归档案件走归档包，见下方分支）
  const bundleLink = !isArchived && canExportBundle ? (
    <a href={`/api/matters/${matterId}/export-bundle`} className="btn btn-secondary btn-sm" title="导出在办卷宗 ZIP（manifest + 材料 + 记录与财务摘要）">
      <Download />
      导出卷宗
    </a>
  ) : null;
  if (isArchived) {
    return (
      <>
        <span className="badge b-bronze" style={{ height: 29, padding: "0 10px" }}>
          <Lock className="h-3.5 w-3.5" />
          已归档（只读）
        </span>
        <a href={`/api/archive/${matterId}/export`} className="btn btn-secondary btn-sm" title="导出归档 ZIP（含材料 + 结构化数据 + 卷宗封皮目录）">
          <Download />
          导出 ZIP
        </a>
        {extras.length > 0 ? (
          <Dropdown trigger="click" position="bottomRight" closeOnEsc clickTriggerToHide motion={false}
          visible={moreOpen} onVisibleChange={setMoreOpen}
          render={<Dropdown.Menu className="w-48">
            {extras}
          </Dropdown.Menu>}>
          <button ref={moreTriggerRef} type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen}>
                <MoreHorizontal />
              </button>
        </Dropdown>
        ) : null}
      </>
    );
  }

  return (
    <>
      {bundleLink}
      {extras.length > 0 || canChangeStatus ? (
        <Dropdown trigger="click" position="bottomRight" closeOnEsc clickTriggerToHide motion={false}
          visible={moreOpen} onVisibleChange={setMoreOpen}
          render={<Dropdown.Menu className="w-48">
            {extras}
            {extras.length > 0 && canChangeStatus ? <Dropdown.Divider /> : null}
            {canChangeStatus ? (<>
            {(status === "ON_HOLD" || status === "CLOSED") && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); void handleReopen(); }}>
                <Play className="mr-2 h-4 w-4" />
                重新开放
              </Dropdown.Item>
            )}
            {status === "IN_PROGRESS" && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); open("hold"); }}>
                <Pause className="mr-2 h-4 w-4" />
                暂停办理
              </Dropdown.Item>
            )}
            {status !== "CLOSED" && (
              <Dropdown.Item onClick={() => { setMoreOpen(false); open("close"); }}>
                <CheckCircle2 className="mr-2 h-4 w-4 text-[var(--green)]" />
                结案
              </Dropdown.Item>
            )}
            {canArchive && (
              <>
                <Dropdown.Divider />
                <Dropdown.Item
                  onClick={() => { setMoreOpen(false); setArchiveOpen(true); }}
                  className="text-[var(--bronze)] focus:text-[var(--bronze)]"
                >
                  <Archive className="mr-2 h-4 w-4" />
                  归档（不可逆）
                </Dropdown.Item>
              </>
            )}
            </>) : null}
          </Dropdown.Menu>}>
          <button ref={moreTriggerRef} type="button" disabled={isPending} className="btn btn-secondary btn-sm btn-icon" aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen}>
              {isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </button>
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
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
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
