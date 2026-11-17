import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkQueueCard } from "@/components/dashboard/work-queue-card";
import type { WorkQueue } from "@/server/dashboard/actions";

afterEach(cleanup);

describe("待我处理的审批等待标签", () => {
  it("区分未知提交时间、今日和已等待，不把未知审批渲染为紧急", () => {
    const row = { action: "INTAKE_APPROVE", requester: "合成申请人", matter: null, task: "approve" };
    const queue: WorkQueue = {
      approvals: [
        { ...row, id: "unknown", title: "未知时间申请", waitDays: null },
        { ...row, id: "today", title: "今日申请", waitDays: 0 },
        { ...row, id: "waiting", title: "等待申请", waitDays: 2 },
      ], approvalTotal: 3, tasks: [], taskTotal: 0,
    };
    render(<WorkQueueCard queue={queue} alerts={[]} />);
    const unknown = screen.getByRole("link", { name: /未知时间申请/ });
    expect(within(unknown).getByText("提交时间未记录")).not.toHaveClass("d-red");
    expect(within(unknown).queryByText("今日")).not.toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /今日申请/ })).getByText("今日")).toBeVisible();
    expect(within(screen.getByRole("link", { name: /等待申请/ })).getByText("等待 2 天")).toHaveClass("d-red");
  });
});
