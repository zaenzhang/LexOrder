// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { actor, state, db, autoConfirm } = vi.hoisted(() => ({
  actor: { id: "local", role: "INDEPENDENT_LAWYER", runtimeMode: "PERSONAL" as const, systemRole: "NONE", managerAuthorized: false },
  state: { documentStatus: "DRAFT", invoiceStatus: "PENDING", failAudit: false }, autoConfirm: vi.fn(),
  db: {
    user: { findUnique: vi.fn() }, systemSetting: { findUnique: vi.fn() },
    matter: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    document: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() },
    sealRequest: { findFirst: vi.fn() }, documentContextInput: { findMany: vi.fn() }, documentResearchSource: { findMany: vi.fn() },
    invoiceRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(), $queryRaw: vi.fn(), auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/runtime/mode", () => ({ isPersonalMode: () => true }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async () => actor) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: actor })) }));
vi.mock("@/lib/approvals/self-confirm", () => ({ selfConfirmEligible: autoConfirm }));
vi.mock("@/server/approval-permissions/termination", () => ({ assertExecutionOpen: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/notifications/approval", () => ({ notifyRoleApprovers: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { approveDocument, submitDocumentForReview } from "@/server/documents/actions";
import { approveInvoiceRequest } from "@/server/invoices/actions";

const revision = new Date("2026-01-01");
beforeEach(() => {
  vi.clearAllMocks(); state.documentStatus = "DRAFT"; state.invoiceStatus = "PENDING"; state.failAudit = false;
  autoConfirm.mockResolvedValue(true);
  db.user.findUnique.mockResolvedValue({ ...actor, active: true });
  db.systemSetting.findUnique.mockResolvedValue(null);
  db.sealRequest.findFirst.mockResolvedValue(null);
  db.documentContextInput.findMany.mockResolvedValue([]);
  db.documentResearchSource.findMany.mockResolvedValue([]);
  db.matter.count.mockResolvedValue(1);
  db.matter.findFirst.mockResolvedValue({ id: "matter", status: "IN_PROGRESS" });
  db.matter.findUnique.mockResolvedValue({ category: "CIVIL_COMMERCIAL" });
  db.document.findUnique.mockImplementation(async () => ({ id: "document", name: "合成文书", uploadedById: actor.id, matterId: "matter", intakeId: null, status: state.documentStatus, updatedAt: revision }));
  db.document.findUniqueOrThrow.mockResolvedValue({ uploadedById: actor.id, matterId: "matter", intakeId: null, matter: { category: "CIVIL_COMMERCIAL" } });
  db.document.update.mockImplementation(async ({ where, data }) => {
    if (where.status !== state.documentStatus || where.updatedAt !== revision) throw new Error("stale document");
    state.documentStatus = data.status; return { id: "document" };
  });
  db.invoiceRequest.findUnique.mockImplementation(async () => ({ id: "invoice", matterId: "matter", status: state.invoiceStatus, updatedAt: revision, evidenceDocIds: [], contractScanId: null, invoiceFileId: null }));
  db.invoiceRequest.findUniqueOrThrow.mockResolvedValue({ requestedById: actor.id, matterId: "matter", matter: { category: "CIVIL_COMMERCIAL" } });
  db.invoiceRequest.update.mockImplementation(async ({ where, data }) => {
    if (where.status !== state.invoiceStatus || where.updatedAt !== revision) throw new Error("stale invoice");
    state.invoiceStatus = data.status; return { id: "invoice" };
  });
  db.auditLog.create.mockImplementation(async () => { if (state.failAudit) throw new Error("audit unavailable"); });
  db.$transaction.mockImplementation(async write => {
    const documentStatus=state.documentStatus,invoiceStatus=state.invoiceStatus;
    try { return await write(db); } catch(error) { state.documentStatus=documentStatus;state.invoiceStatus=invoiceStatus;throw error; }
  });
});

describe("Personal submission stays pending", () => {
  it("does not apply an imported automatic self-confirm list when submitting a document", async () => {
    await expect(submitDocumentForReview("document")).resolves.toEqual({ ok: true });
    expect(state.documentStatus).toBe("PENDING_REVIEW");
    expect(autoConfirm).not.toHaveBeenCalled();
    expect(db.document.update).toHaveBeenCalledWith({ where: { id: "document", status: "DRAFT", updatedAt: revision }, data: { status: "PENDING_REVIEW" } });
  });

  it("uses the existing separate decision and prevents repeat confirmation", async () => {
    await submitDocumentForReview("document");
    await approveDocument("document");
    expect(state.documentStatus).toBe("APPROVED");
    await expect(approveDocument("document")).rejects.toThrow("不在待审核");
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "DOCUMENT_APPROVE", detail: expect.objectContaining({ decisionPolicy: "PERSONAL_SELF" }) }) });
  });

  it("keeps a pending document when the decision audit cannot commit", async () => {
    state.documentStatus="PENDING_REVIEW";state.failAudit=true;
    await expect(approveDocument("document")).rejects.toThrow("audit unavailable");
    expect(state.documentStatus).toBe("PENDING_REVIEW");
  });

  it("rejects an invoice file attached to the initial pending approval", async () => {
    const form=new FormData();form.set("requestId","invoice");form.set("invoiceNo","SYNTHETIC-1");form.set("invoiceFile",new File(["synthetic"],"synthetic.pdf",{type:"application/pdf"}));
    await expect(approveInvoiceRequest(form)).rejects.toThrow("先完成本人确认");
    expect(state.invoiceStatus).toBe("PENDING");expect(db.invoiceRequest.update).not.toHaveBeenCalled();expect(db.document.create).not.toHaveBeenCalled();
  });

  it("confirms the invoice request without pretending the invoice was issued", async () => {
    const form=new FormData();form.set("requestId","invoice");
    await expect(approveInvoiceRequest(form)).resolves.toEqual({ok:true,status:"APPROVED"});
    expect(state.invoiceStatus).toBe("APPROVED");expect(db.document.create).not.toHaveBeenCalled();
    expect(db.auditLog.create.mock.calls.map(call=>call[0].data.action)).toEqual(["INVOICE_APPROVED"]);
  });
});
