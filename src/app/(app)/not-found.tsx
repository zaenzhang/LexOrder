"use client";

import { Typography } from "@douyinfe/semi-ui";

/** 业务区 404：记录不存在或当前账号无权查看（不区分两者，避免泄露记录是否存在） */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card max-w-md px-8 py-10 text-center">
        <div className="font-mono text-sm text-[var(--semi-color-text-3)]">404</div>
        <h1 className="mt-2 text-[20px] font-bold text-[var(--semi-color-text-0)]">页面不存在或无权查看</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--semi-color-text-2)]">
          该记录可能已被删除、链接有误，或当前账号没有查看权限。需要处理审批事项时，请从「审批」工作台进入。
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Typography.Text link={{ href: "/" }}>返回工作台</Typography.Text>
          <Typography.Text link={{ href: "/approvals" }}>进入审批</Typography.Text>
        </div>
      </div>
    </div>
  );
}
