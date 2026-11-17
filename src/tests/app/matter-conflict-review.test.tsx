import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ run: vi.fn(), decide: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/conflicts/matter-actions", () => ({ runMatterReview: actions.run, decideMatterReview: actions.decide }));
import { MatterConflictReview } from "@/app/(app)/matters/[id]/_components/conflict-review";
import type { readMatterReview } from "@/server/conflicts/matter-review";

type Review = NonNullable<Awaited<ReturnType<typeof readMatterReview>>>;
function view(conclusion: "PENDING" | "DIFFERENT" = "PENDING", decisionRecorded = false): Review {
  return { needsReview: true, reviewReason: "本案当前冲突复核尚未通过，请记录人工判断及理由", checks: [{
    id: "check", checkedAt: new Date("2026-11-01T04:00:00Z"), conclusion,
    note: "系统检索未命中，仍须结合实际业务判断", decidedBy: "合成记录人", decidedAt: decisionRecorded ? new Date("2026-11-01T05:00:00Z") : null,
    current: true, decisionRecorded, hits: []
  }] };
}
beforeEach(() => { vi.resetAllMocks(); actions.run.mockResolvedValue({ ok: true }); actions.decide.mockResolvedValue({ ok: true }); });
it("零命中待核查仍显示人工理由与决定入口，重新检索不代替决定", async () => {
  render(<MatterConflictReview matterId="matter" data={view()} canWrite />);
  const note = screen.getByRole("textbox", { name: "冲突复核理由" });
  expect(note).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "按当前主体重新检索" }));
  await waitFor(() => expect(actions.run).toHaveBeenCalledWith("matter"));
  expect(actions.decide).not.toHaveBeenCalled();
  fireEvent.change(note, { target: { value: "已核实实际业务背景" } });
  const decision = screen.getByRole("button", { name: "可承接" });
  await waitFor(() => expect(decision).not.toBeDisabled());
  fireEvent.click(decision);
  await waitFor(() => expect(actions.decide).toHaveBeenCalledWith({ matterId: "matter", checkId: "check", expectedDecidedAt: null, conclusion: "DIFFERENT", note: "已核实实际业务背景" }));
});
it("旧自动 DIFFERENT 显示待人工核对，不冒充核查人的实际决定", () => {
  render(<MatterConflictReview matterId="matter" data={view("DIFFERENT")} canWrite />);
  expect(screen.getByText(/待人工核对/)).toBeInTheDocument();
  expect(screen.queryByText(/合成记录人/)).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "冲突复核理由" })).toBeInTheDocument();
});
it("新增他案命中后的待核卡保持重新检索入口，当前授权只读者没有决定动作", () => {
  const data = view("DIFFERENT", true); data.reviewReason = "检索后新增相关命中，请重新检索并复核再承接";
  render(<MatterConflictReview matterId="matter" data={data} canWrite={false} />);
  expect(screen.getByText(data.reviewReason)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
