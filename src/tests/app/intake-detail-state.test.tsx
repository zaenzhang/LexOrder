import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeStatus } from "@prisma/client";

const mock = vi.hoisted(() => ({
  intake: vi.fn(), canApprove: vi.fn(), refresh: vi.fn(),
  session: { user: { id: "applicant", role: "LAWYER", systemRole: "NONE" } }
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  useRouter: () => ({ refresh: mock.refresh })
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => mock.session }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: async () => ({ id: "applicant", name: "合成申请人" }) },
  matter: { findMany: async () => [] }
} }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: mock.canApprove }));
vi.mock("@/server/intakes/actions", () => ({ getIntakeById: mock.intake, resubmitIntake: vi.fn(), voidIntake: vi.fn() }));
vi.mock("@/server/intakes/workflow", () => ({ intakeWorkflowReady: async () => true }));
vi.mock("@/server/intakes/revision-history", () => ({ readIntakeRounds: async () => [] }));
vi.mock("@/server/intakes/revision-actions", () => ({ getIntakeEditForm: vi.fn(), withdrawIntake: vi.fn() }));
vi.mock("@/server/clients/actions", () => ({ listClients: vi.fn() }));
vi.mock("@/server/users/actions", () => ({ listActiveColleagues: vi.fn() }));
vi.mock("@/server/conflicts/actions", () => ({ runCheckAndSave: vi.fn(), setConflictConclusion: vi.fn() }));
vi.mock("@/server/reminders/work-actions", () => ({ getWorkBoard: async () => null }));
vi.mock("@/components/matters/work-responsibility-panel", () => ({ WorkResponsibilityPanel: () => null }));
vi.mock("@/app/(app)/intakes/_components/intake-wizard", () => ({ IntakeWizard: () => null }));

import IntakeDetailPage from "@/app/(app)/intakes/[id]/page";

const note = "合成：已核对主体并排除冲突";
function intake(status: IntakeStatus) {
  return {
    id: "intake-state", title: "合成收案状态核查", status, category: "CIVIL_COMMERCIAL", teamReadOnly: false,
    receivedAt: new Date("2026-11-01T00:00:00Z"), createdById: "applicant", ownerUserId: "lead",
    ownerUser: { name: "合成主办" }, client: null, parties: [], matter: null, description: null,
    declinedReason: null, firstAgency: null, cause: null, causeFreeText: null,
    conflictChecks: [{
      id: "check", conclusion: "DIFFERENT", note, checkedAt: new Date("2026-11-02T02:00:00Z"),
      decidedAt: new Date("2026-11-02T03:00:00Z"), decidedBy: { id: "applicant", name: "合成申请人" },
      queryPayload: {}, hits: []
    }]
  };
}
async function renderPage(status: IntakeStatus) {
  mock.intake.mockResolvedValue(intake(status));
  render(await IntakeDetailPage({ params: Promise.resolve({ id: "intake-state" }) }));
}
function expectReadonlyConclusion() {
  expect(screen.getByRole("heading", { name: "结论说明" })).toBeVisible();
  expect(screen.getByText(note)).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "可承接" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重新检索" })).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.session.user.id = "applicant";
  mock.canApprove.mockResolvedValue(false);
});
afterEach(cleanup);

// 只核对 mock 取数完成后的页面组合与真实子组件；不替代 Next RSC、HTTP 或浏览器验收。
describe("收案详情按状态和身份提供入口", () => {
  it("待审批申请人查看进度，结论冻结但原说明仍可读，保留撤回入口", async () => {
    await renderPage("PENDING_CONFIRMATION");
    expect(screen.getByRole("link", { name: "查看审批进度" })).toHaveAttribute("href", "/approvals?type=INTAKE_APPROVE&id=intake-state");
    expect(screen.queryByRole("link", { name: /补正/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回补正" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "复核并送审" })).not.toBeInTheDocument();
    expectReadonlyConclusion();
  });

  it("待审批审批人可以前往审批，无编辑资格时不出现撤回或结论编辑", async () => {
    mock.session.user.id = "reviewer";
    mock.canApprove.mockResolvedValue(true);
    await renderPage("PENDING_CONFIRMATION");
    expect(screen.getByRole("link", { name: "前往审批" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "撤回补正" })).not.toBeInTheDocument();
    expectReadonlyConclusion();
  });

  it("退回后编辑人才能补正，不能因仍有审批资格继续显示前往审批", async () => {
    mock.canApprove.mockResolvedValue(true);
    await renderPage("NEEDS_REVISION");
    expect(screen.getByRole("link", { name: "查看补正并重新提交" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑收案资料" })).toBeVisible();
    expect(screen.getByRole("button", { name: "复核并送审" })).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveValue(note);
    expect(screen.getByRole("button", { name: "可承接" })).toBeVisible();
    expect(mock.canApprove).not.toHaveBeenCalled();
  });

  it("草稿沿已有编辑和送审入口，不展示尚不存在的审批入口", async () => {
    await renderPage("INTAKE");
    expect(screen.queryByRole("link", { name: /审批|补正/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑收案资料" })).toBeVisible();
    expect(screen.getByRole("button", { name: "复核并送审" })).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveValue(note);
    expect(mock.canApprove).not.toHaveBeenCalled();
  });

  it("退回状态的无编辑资格查看者仅查看记录与原结论说明", async () => {
    mock.session.user.id = "reviewer";
    mock.canApprove.mockResolvedValue(true);
    await renderPage("NEEDS_REVISION");
    expect(screen.getByRole("link", { name: "查看审批记录" })).toBeVisible();
    expect(screen.queryByText("补充材料后，可在审批工作台重新提交。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑收案资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复核并送审" })).not.toBeInTheDocument();
    expect(mock.canApprove).not.toHaveBeenCalled();
    expectReadonlyConclusion();
  });
});
