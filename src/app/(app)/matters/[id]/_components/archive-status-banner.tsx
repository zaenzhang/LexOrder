"use client";

import { Button, Tag } from "@douyinfe/semi-ui";
import { IconHourglass as Hourglass, IconClear as XCircle, IconArchive as Archive } from "@douyinfe/semi-icons";
import { cn } from "@/lib/utils";

type ArchiveStatus = "PENDING_REVIEW" | "REJECTED" | "APPROVED";

interface ArchiveRecord {
  id: string;
  archiveNo: string;
  status: ArchiveStatus;
  reviewedAt: Date | null;
  reviewNote: string | null;
  archivedBy: string;
  missingItems: string[];
}

interface Props {
  record: ArchiveRecord | null;
  onReArchive?: () => void;
}

export function ArchiveStatusBanner({ record, onReArchive }: Props) {
  if (!record || record.status === "APPROVED") return null;

  const isRejected = record.status === "REJECTED";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-4 py-3",
        isRejected
          ? "border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)]"
          : "border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)]"
      )}
    >
      <div className={cn("mt-0.5", isRejected ? "text-[var(--semi-color-danger)]" : "text-[var(--semi-color-warning)]")}>
        {isRejected ? <XCircle aria-hidden size="default" /> : <Hourglass aria-hidden size="default" />}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium", isRejected ? "text-[var(--semi-color-danger)]" : "text-[var(--semi-color-warning)]")}>
            {isRejected ? "归档申请被驳回" : "归档申请审批中"}
          </span>
          <Tag
            className={cn(
              "text-xs",
              isRejected
                ? "border-[var(--semi-color-danger-light-active)] text-[var(--semi-color-danger)]"
                : "border-[var(--semi-color-warning-light-active)] text-[var(--semi-color-warning)]"
            )}
            color="grey"
            type="ghost"
          >
            {record.archiveNo}
          </Tag>
        </div>
        <div className="text-xs text-muted-foreground">
          {isRejected
            ? record.reviewNote
              ? `驳回原因：${record.reviewNote}`
              : "管理员未填写驳回原因"
            : "归档申请已提交，等待有归档审批权限的人员审批；审批通过后案件转为只读。"}
        </div>
        {isRejected && record.missingItems.length > 0 && (
          <div className="text-xs text-muted-foreground">
            上次缺项：{record.missingItems.join("、")}
          </div>
        )}
      </div>
      {isRejected && onReArchive && (
        <Button theme="outline" type="tertiary" size="small"
          htmlType="button"
          onClick={onReArchive}
          className="mt-0.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted/80"
        >
          <Archive aria-hidden size="small" />
          重新归档
        </Button>
      )}
    </div>
  );
}
