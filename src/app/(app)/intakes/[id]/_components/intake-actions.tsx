"use client";
import { Typography } from "@douyinfe/semi-ui";
import type { IntakeStatus } from "@prisma/client";

import { approvalHref } from "@/lib/approvals/workspace";

export function IntakeActions({ intakeId, status, canApprove = false, canResubmit = false }: {
  intakeId: string; status?: IntakeStatus; canApprove?: boolean; canResubmit?: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-3">
    <p className="t-xs t-mute">{canResubmit ? "补充材料后，可在审批工作台重新提交。" : "审批进度与处理记录统一在工作台查阅。"}</p>
    <Typography.Text link={{ href: approvalHref("INTAKE_APPROVE", intakeId) }} strong={canApprove || canResubmit}>
      {canApprove ? "前往审批" : canResubmit ? "查看补正并重新提交" : status === "PENDING_CONFIRMATION" ? "查看审批进度" : "查看审批记录"}
    </Typography.Text>
  </div>;
}
