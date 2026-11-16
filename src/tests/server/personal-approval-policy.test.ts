// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalAction, Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

const { state, db, actor } = vi.hoisted(() => ({
  state: { personal: true },
  actor: { id: "local", role: "INDEPENDENT_LAWYER", systemRole: "NONE", managerAuthorized: false, runtimeMode: "PERSONAL" as const },
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() }, systemSetting: { findUnique: vi.fn() },
    sealTypeConfig: { findUnique: vi.fn() }, sealPurposeConfig: { findUnique: vi.fn() },
    approvalPermissionRule: { findMany: vi.fn() }, matter: { count: vi.fn() },
    intake: { findUniqueOrThrow: vi.fn(), count: vi.fn() }, document: { findUniqueOrThrow: vi.fn() },
    archiveRecord: { findUniqueOrThrow: vi.fn() }, invoiceRequest: { findUniqueOrThrow: vi.fn(), count: vi.fn() },
    sealRequest: { findUniqueOrThrow: vi.fn() }, auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async (_db, id?: string) => {
  if (!state.personal) return null;
  if (id !== undefined && id !== actor.id) throw new ActionError("非本机操作者");
  return actor;
}) }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: vi.fn(async () => ({ ...actor, runtimeMode: state.personal ? "PERSONAL" : "SERVER", enabled: true })) }));

import { approvalAudit, approvalRecipients, canApproveContext, canApproveItem, canExecuteInvoice, requireApprovalRoute } from "@/lib/approvals/service";
import { canExecuteFinance, hasCustomPermission, scopeFor } from "@/lib/roles/catalog";
import { canConfirmReceipt, isManager } from "@/lib/permissions";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { reportAccess } from "@/lib/roles/report-scope";

beforeEach(() => {
  vi.clearAllMocks(); state.personal = true;
  db.user.findUnique.mockResolvedValue({ ...actor, active: true });
  db.user.findMany.mockResolvedValue([{ id: actor.id }, { id: "other" }]);
  db.systemSetting.findUnique.mockResolvedValue(null);
  db.approvalPermissionRule.findMany.mockResolvedValue([]);
  db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false });
  db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["OFFICIAL_SEAL", "LEGAL_REP_SEAL"] });
  db.matter.count.mockResolvedValue(1); db.intake.count.mockResolvedValue(1);
  db.intake.findUniqueOrThrow.mockResolvedValue({ category: "CIVIL_COMMERCIAL", createdById: actor.id, ownerUserId: actor.id });
  db.document.findUniqueOrThrow.mockResolvedValue({ uploadedById: actor.id, matterId: "matter", intakeId: null, matter: { category: "CIVIL_COMMERCIAL" } });
  db.archiveRecord.findUniqueOrThrow.mockResolvedValue({ archivedById: actor.id, matterId: "matter", matter: { category: "CIVIL_COMMERCIAL" } });
  db.invoiceRequest.findUniqueOrThrow.mockResolvedValue({ requestedById: actor.id, matterId: "matter", matter: { category: "CIVIL_COMMERCIAL" } });
  db.invoiceRequest.count.mockResolvedValue(1);
  db.sealRequest.findUniqueOrThrow.mockResolvedValue({ requestedById: actor.id, matterId: "matter", matter: { category: "CIVIL_COMMERCIAL" }, sealType: "OFFICIAL_SEAL", purposeConfigId: "purpose" });
});

const context = (action: ApprovalAction) => ({ action, requesterId: actor.id, category: "CIVIL_COMMERCIAL" as const,
  ...(action.startsWith("SEAL_") ? { sealType: "OFFICIAL_SEAL" as const, purposeId: "purpose" } : {}),
});

describe("Personal manual decisions", () => {
  it("provides explicit business capabilities without admin, management or ALL grants", () => {
    expect(canConfirmReceipt(actor)).toBe(true);
    expect(canExecuteFinance(actor, "finance.correct")).toBe(true);
    expect(canExecuteFinance(actor, "finance.settle")).toBe(true);
    expect(scopeFor(actor, "finance.confirm")).toBeUndefined();
    expect(hasCustomPermission(actor, "matters.transfer")).toBe(false);
    expect(isManager(actor)).toBe(false); expect(isSystemAdmin(actor)).toBe(false);
    const server = { ...actor, runtimeMode: "SERVER" as const };
    expect(canConfirmReceipt(server)).toBe(false);
    expect(canExecuteFinance(server, "finance.correct")).toBe(false);
  });

  it("scopes Personal reports and exports to actual matters without changing Server defaults", () => {
    const own={deletedAt:null,OR:[{ownerId:actor.id},{members:{some:{userId:actor.id}}}]};
    expect(reportAccess(actor)).toEqual({matters:own,finance:own});
    expect(reportAccess(actor,true)).toEqual({matters:own,finance:own});
    expect(reportAccess({...actor,runtimeMode:"SERVER"})).toEqual({matters:{},finance:{}});
  });

  it.each<ApprovalAction>(["INTAKE_APPROVE", "DOCUMENT_APPROVE", "ARCHIVE_APPROVE", "INVOICE_APPROVE", "SEAL_APPROVE", "SEAL_STAMP"])("supports an explicit own %s decision without a synthetic approval group", async action => {
    expect(await canApproveItem(actor.id, action, "item")).toBe(true);
    await expect(requireApprovalRoute(context(action))).resolves.toBeUndefined();
    expect(await approvalRecipients(context(action))).toEqual([actor.id]);
    expect(db.approvalPermissionRule.findMany).not.toHaveBeenCalled();
  });

  it("does not grant Server sole lawyers the Personal policy", async () => {
    state.personal = false;
    expect(await canApproveItem(actor.id, "INTAKE_APPROVE", "item")).toBe(false);
    await expect(requireApprovalRoute(context("INTAKE_APPROVE"))).rejects.toThrow("尚无可审批人员");
  });

  it("rejects another actor and a forged runtimeMode on a context", async () => {
    await expect(canApproveContext("other", context("INTAKE_APPROVE"))).rejects.toThrow("非本机操作者");
    state.personal = false;
    expect(await canApproveContext(actor.id, { ...context("INTAKE_APPROVE"), runtimeMode: "PERSONAL" } as ReturnType<typeof context>)).toBe(false);
  });

  it("rejects another requester, unassigned requests and unknown actions", async () => {
    expect(await canApproveContext(actor.id, { ...context("INTAKE_APPROVE"), requesterId: "other" })).toBe(false);
    expect(await canApproveContext(actor.id, { ...context("INTAKE_APPROVE"), requesterId: null })).toBe(false);
    expect(await canApproveContext(actor.id, { ...context("INTAKE_APPROVE"), action: "UNKNOWN" as ApprovalAction })).toBe(false);
  });

  it("checks current intake ownership and current matter access for existing items", async () => {
    db.intake.findUniqueOrThrow.mockResolvedValue({ category: "CIVIL_COMMERCIAL", createdById: actor.id, ownerUserId: "other" });
    expect(await canApproveItem(actor.id, "INTAKE_APPROVE", "item")).toBe(false);
    db.matter.count.mockResolvedValue(0);
    for (const action of ["DOCUMENT_APPROVE", "ARCHIVE_APPROVE", "INVOICE_APPROVE", "SEAL_APPROVE"] as const) {
      expect(await canApproveItem(actor.id, action, "item")).toBe(false);
    }
    expect(db.matter.count).toHaveBeenCalledWith({ where: { id: "matter", deletedAt: null, OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] } });
  });

  it("checks an intake document's current owner and refuses unbound documents", async () => {
    db.document.findUniqueOrThrow.mockResolvedValue({ uploadedById: actor.id, matterId: null, intakeId: "intake", intake: { category: "CIVIL_COMMERCIAL" } });
    db.intake.count.mockResolvedValue(0);
    expect(await canApproveItem(actor.id, "DOCUMENT_APPROVE", "item")).toBe(false);
    db.document.findUniqueOrThrow.mockResolvedValue({ uploadedById: actor.id, matterId: null, intakeId: null });
    expect(await canApproveItem(actor.id, "DOCUMENT_APPROVE", "item")).toBe(false);
  });

  it("retains seal purpose, activation and real legal representative requirements", async () => {
    expect(await canApproveContext(actor.id, { ...context("SEAL_APPROVE"), sealType: undefined })).toBe(false);
    expect(await canApproveContext(actor.id, { ...context("SEAL_APPROVE"), purposeId: null })).toBe(false);
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: false, allowedSealTypes: ["OFFICIAL_SEAL"] });
    expect(await canApproveContext(actor.id, context("SEAL_APPROVE"))).toBe(false);
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["LEGAL_REP_SEAL"] });
    const legalRep = { ...context("SEAL_STAMP"), sealType: "LEGAL_REP_SEAL" as const };
    expect(await canApproveContext(actor.id, legalRep)).toBe(false);
    db.systemSetting.findUnique.mockImplementation(({ where }) => Promise.resolve(where.key === "firmLegalRepUserId" ? { value: { value: actor.id } } : null));
    expect(await canApproveContext(actor.id, legalRep)).toBe(true);
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: false });
    expect(await canApproveContext(actor.id, legalRep)).toBe(false);
  });

  it("allows invoice execution only after approval and within actual ownership", async () => {
    db.invoiceRequest.count.mockResolvedValue(0);
    expect(await canExecuteInvoice(actor.id, "invoice")).toBe(false);
    db.invoiceRequest.count.mockResolvedValue(1);
    expect(await canExecuteInvoice(actor.id, "invoice")).toBe(true);
    expect(db.invoiceRequest.count).toHaveBeenCalledWith({ where: { id: "invoice", status: "APPROVED", requestedById: actor.id } });
    db.invoiceRequest.findUniqueOrThrow.mockResolvedValue({ requestedById: "other", matterId: null });
    expect(await canExecuteInvoice(actor.id, "invoice")).toBe(false);
  });

  it.each([['DOCUMENT_APPROVE','CONFIRMATION','PERSONAL_SELF'],['DOCUMENT_REJECT','REJECTION','PERSONAL_LOCAL'],['INVOICE_ISSUED','EXECUTION','PERSONAL_LOCAL']])("records the true policy for %s", async (action, decisionKind, decisionPolicy) => {
    await approvalAudit(db as unknown as Prisma.TransactionClient, actor.id, action, "item", { runtimeMode: "SERVER", note: "合成检查" });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: actor.id, action, detail: { runtimeMode: "PERSONAL", decisionKind, decisionPolicy, note: "合成检查" } }) });
  });
});
