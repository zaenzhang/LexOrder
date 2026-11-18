"use client";

import { Button, Notification } from "@douyinfe/semi-ui";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh as RefreshCw } from "@douyinfe/semi-icons";
import { triggerDueReminderScan } from "@/server/reminders/actions";
import { actionErrorMessage } from "@/lib/action-error";

export function ReminderScanButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleScan() {
    startTransition(async () => {
      try {
        const r = await triggerDueReminderScan();
        const total = r.deadlineNotified + r.hearingNotified;
        router.refresh();
        Notification.success({ title: `扫描完成：新推送 ${total} 条`, content: `期限 ${r.deadlineNotified}·开庭 ${r.hearingNotified}（去重跳过 ${r.suppressed}）` });
      } catch (err) {
        Notification.error({ title: "扫描失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <Button htmlType="button" size="small" theme="outline" onClick={handleScan} loading={isPending} disabled={isPending} icon={<RefreshCw size="default" aria-hidden />}>
      立即扫描
    </Button>
  );
}
