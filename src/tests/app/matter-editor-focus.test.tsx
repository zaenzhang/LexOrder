import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: () => undefined }));
vi.mock("@/server/matters/actions", () => ({ updateMatterTeam: vi.fn(), updateMatterBasicInfo: vi.fn(), updateProcedureInfo: vi.fn() }));
vi.mock("@/server/matters/lifecycle", () => ({ closeMatter: vi.fn(), reopenMatter: vi.fn(), holdMatter: vi.fn() }));
vi.mock("@/server/procedures/actions", () => ({ deleteProcedure: vi.fn() }));
vi.mock("@/components/matters/enterprise-name-input", () => ({ EnterpriseNameInput: () => null }));
vi.mock("@/app/(app)/matters/_components/cause-combobox", () => ({ CauseCombobox: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/case-search-panel", () => ({ CaseSearchPanel: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/document-review-dialog", () => ({ DocumentReviewDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/progress-dialog", () => ({ ProgressDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/info-panel", () => ({ contactRoleLabels: vi.fn() }));
vi.mock("@/app/(app)/matters/[id]/_components/matter-archive", () => ({
  MatterArchive: ({ onEdit }: { onEdit: (section: "matter") => void }) => <button onClick={() => onEdit("matter")}>编辑基本信息</button>,
  TeamRailCard: ({ onManage }: { onManage: () => void }) => <button onClick={onManage}>管理团队</button>,
}));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-workflow-panel", () => ({
  MatterPreservationContent: () => null,
  ProcedureWorkflowPanel: ({ archiveNode, archiveRailTop }: { archiveNode: React.ReactNode; archiveRailTop: React.ReactNode }) => <>{archiveNode}{archiveRailTop}</>,
}));
vi.mock("@/app/(app)/matters/[id]/_components/finance-panel", () => ({ FinancePanel: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-content", () => ({ ImportantItemDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/approvals-panel", () => ({ ApprovalsPanel: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-forms", () => ({ AddDeadlineDialog: () => null, AddHearingDialog: () => null, AddProcedureSheet: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/finance-forms", () => ({ AddBillingSheet: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/evidence-panel", () => ({ EvidenceItemDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/evidence-timeline", () => ({ EvidenceTimeline: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/archive-status-banner", () => ({ ArchiveStatusBanner: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/archive-wizard", () => ({ ArchiveWizardDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/material-tools-sheet", () => ({ MaterialToolsSheet: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/pending-material-uploads", () => ({ PendingMaterialUploads: () => null }));

import { MatterDetailTabs } from "@/app/(app)/matters/[id]/_components/matter-detail-tabs";

type Props = React.ComponentProps<typeof MatterDetailTabs>;
const date = new Date("2026-11-16T01:00:00Z");
const matter: Props["matter"] = {
  id: "matter-no-procedure", internalCode: "M2C-focus", firmCaseNo: null, title: "合成无程序事项", category: "NON_LITIGATION",
  status: "IN_PROGRESS", serviceStatus: "SERVICE_ACTIVE", teamAccessRestricted: false,
  causeId: null, cause: null, causeFreeText: null, claimAmount: null, ourStanding: null,
  counterclaimAsPlaintiff: false, counterclaimAsDefendant: false, barFiling: null,
  businessType: null, serviceScope: null, deliverables: null, counselType: null, serviceStart: null, serviceEnd: null,
  intakeDate: null, primaryClientId: null, primaryClient: null, clientLinks: [],
  ownerId: "owner", owner: { id: "owner", name: "合成主办", role: "PRINCIPAL_LAWYER" }, registeredById: null, members: [],
  intakeId: null, intake: null, firstAcceptedAt: null, closedAt: null, archivedAt: null,
  procedures: [], parties: [], relatedEntities: [], linksFrom: [], linksTo: [], timelineEvents: [],
  customValues: {}, deletedAt: null, createdAt: date, updatedAt: date,
};
const props: Props = {
  matter, finance: { billings: [], entries: [], plans: [], contractDocuments: [], stats: {
    outstanding: 0, allocated: 0, clientFunds: 0, contractAmount: 0, receivable: 0, received: 0,
    pendingReceived: 0, refund: 0, cost: 0, commission: 0, invoiced: 0,
  } },
  userOptions: [{ id: "owner", name: "合成主办", role: "PRINCIPAL_LAWYER" }], documents: [], folders: [], folderDocuments: [], templates: [], colleagues: [],
  currentUserId: "owner", currentUserRole: "PRINCIPAL_LAWYER", canAssociateThisMatter: true, canLeadThisMatter: true, canOwnThisMatter: true,
  sealContracts: [], expresses: [], latestArchive: null, customFieldDefs: [], preservationCases: [], evidenceItems: [], notes: [],
};

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

async function openFromMore() {
  const more = screen.getByRole("button", { name: "更多操作" });
  more.focus();
  fireEvent.keyDown(more, { key: "Enter" });
  const edit = await screen.findByRole("menuitem", { name: "编辑案件与团队" });
  await waitFor(() => expect(edit).toHaveFocus());
  fireEvent.keyDown(edit, { key: "Enter" });
  const dialog = await screen.findByRole("dialog", { name: "编辑案件信息" });
  await waitFor(() => expect(edit).not.toBeInTheDocument());
  return { more, dialog };
}

describe("无程序事项编辑弹窗的返回位置", () => {
  it.each(["IN_PROGRESS", "ARCHIVED"] as const)("%s 从更多菜单取消后回到稳定页头按钮", async (status) => {
    render(<MatterDetailTabs {...props} matter={{ ...matter, status }} />);
    const { more, dialog } = await openFromMore();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(more).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("菜单打开后按 Escape 返回；再次从基本信息或团队打开仍返回各自入口", async () => {
    render(<MatterDetailTabs {...props} />);
    const { more, dialog } = await openFromMore();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(more).toHaveFocus());
    for (const name of ["编辑基本信息", "管理团队"]) {
      const trigger = screen.getByRole("button", { name });
      trigger.focus();
      fireEvent.click(trigger);
      const editor = await screen.findByRole("dialog");
      fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  });
});
