"use client";

/**
 * v1.0: 工作流开关卡片（系统后台，仅超级管理员）。
 * 目前只有一个开关：外部联系人审核流（默认关——小所信任环境直接通过）。
 */
import { Notification, Switch, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { IconCustomize as SlidersHorizontal } from "@douyinfe/semi-icons";
import { saveWorkflowTogglesAction } from "@/server/settings/workflow-toggles-actions";
import { actionErrorMessage } from "@/lib/action-error";

export function WorkflowTogglesCard({
  initialExternalContactReview
}: {
  initialExternalContactReview: boolean;
}) {
  const [externalContactReview, setExternalContactReview] = useState(
    initialExternalContactReview
  );
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    const prev = externalContactReview;
    setExternalContactReview(next);
    startTransition(async () => {
      try {
        await saveWorkflowTogglesAction({ externalContactReview: next });
        Toast.success(next ? "已开启联系人审核" : "已关闭联系人审核（新增直接通过）");
      } catch (err) {
        setExternalContactReview(prev);
        Notification.error({ title: "保存失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <section className="card p-6">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal aria-hidden size="default" className="text-primary" />
        <h2 className="text-base font-semibold">工作流开关</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        按团队规模选择流程松紧；改动即时生效。
      </p>
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="external-contact-review" className="text-sm font-medium">外部联系人需管理员审核</label>
          <p id="external-contact-review-help" className="mt-1 text-xs leading-5 text-muted-foreground">
            开启后，普通律师新增的外部联系人须经管理员或主任律师审核，才会对全所显示。
          </p>
        </div>
        <Switch id="external-contact-review" aria-describedby="external-contact-review-help" loading={pending} disabled={pending} checked={externalContactReview} onChange={toggle} />
      </div>
    </section>
  );
}
