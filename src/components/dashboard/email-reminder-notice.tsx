"use client";

import { Banner, Typography } from "@douyinfe/semi-ui";

export function EmailReminderNotice() {
  return (
    <Banner
      type="warning"
      closeIcon={null}
      description={
        <div className="flex items-center justify-between gap-3">
          <span>邮件提醒未启用，提醒仍可在站内查看。</span>
          <Typography.Text link={{ href: "/admin/reminders" }}>提醒维护</Typography.Text>
        </div>
      }
    />
  );
}
