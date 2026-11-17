// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, session, canApprove } = vi.hoisted(() => {
  const tables = ["intake", "document", "archiveRecord", "invoiceRequest", "sealRequest", "auditLog"] as const;
  const models = Object.fromEntries(tables.map(t => [t, { findMany: vi.fn(), findFirst: vi.fn() }])) as Record<typeof tables[number], { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> }>;
  return { db: models, session: { user: { id: "reviewer", role: "LAWYER", systemRole: "NONE" } }, canApprove: vi.fn() };
});
vi.mock("@/server/approval-permissions/termination",()=>({executionTerminations:async()=>[],canResolveTermination:async()=>false}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => session }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: canApprove, canExecuteInvoice: (userId: string, id: string) => canApprove(userId, "INVOICE_APPROVE", id) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { listApprovalWorkspace } from "@/server/approval-permissions/inbox";
import { requireApprovalRecord } from "@/server/approval-permissions/records";
import { hasHandledApproval } from "@/lib/approvals/history-access";

const at = new Date("2026-09-01T02:00:00Z");
const later = new Date("2026-09-02T02:00:00Z");
const invoice = { id: "invoice", buyerName: "测试开票", title: null, status: "ISSUED", requestedAt: at, requestedById: "applicant", requestedBy: { name: "申请人" }, processedById: "issuer", processedBy: { name: "开票人" }, processedAt: later, processNote: "开票说明", matter: { title: "测试案件" } };
function event(action: string, userId = "reviewer", time = at, detail = {}) { return { id: action + time.toISOString(), action, targetId: "invoice", targetType: "InvoiceRequest", userId, user: { name: userId }, createdAt: time, detail }; }
beforeEach(() => {
  vi.resetAllMocks(); session.user.id = "reviewer"; session.user.role = "LAWYER"; session.user.systemRole = "NONE";
  for (const model of Object.values(db)) { model.findMany.mockResolvedValue([]); model.findFirst.mockResolvedValue(null); }
  canApprove.mockResolvedValue(false);
});
describe("统一审批工作台的历史与权限", () => {
  it("收案提交时间取最新送审轮次，重新送审后不沿用收案日或第一轮", async () => {
    session.user.id = "applicant";
    const intake = { id: "intake", title: "合成收案", status: "PENDING_CONFIRMATION", receivedAt: new Date("2026-08-01T00:00:00Z"), createdById: "applicant", createdBy: { name: "申请人" }, ownerUserId: "lead", matter: null };
    db.intake.findMany.mockResolvedValue([{ ...intake, revisions: [{ submittedAt: at }] }]);
    expect((await listApprovalWorkspace({ tab: "mine" })).rows[0].submittedAt).toEqual(at);
    expect(db.intake.findMany.mock.calls[0][0].select.revisions).toEqual({ orderBy: { round: "desc" }, take: 1, select: { submittedAt: true } });

    db.intake.findMany.mockResolvedValue([{ ...intake, revisions: [{ submittedAt: later }] }]);
    expect((await listApprovalWorkspace({ tab: "mine", start: "2026-09-02", end: "2026-09-02" })).rows[0].submittedAt).toEqual(later);
    expect((await listApprovalWorkspace({ tab: "mine", end: "2026-09-01" })).rows).toEqual([]);
  });
  it("缺失送审轮次保持未知，筛选不补造日期，正反排序均置于末尾", async () => {
    const intake = { title: "合成收案", status: "PENDING_CONFIRMATION", receivedAt: later, createdById: "applicant", createdBy: { name: "申请人" }, ownerUserId: "lead", matter: null };
    db.intake.findMany.mockResolvedValue([
      { ...intake, id: "unknown", revisions: [] },
      { ...intake, id: "later", revisions: [{ submittedAt: later }] },
      { ...intake, id: "earlier", revisions: [{ submittedAt: at }] },
    ]);
    canApprove.mockResolvedValue(true);
    const pending = await listApprovalWorkspace();
    expect(pending.rows.map(row => row.id)).toEqual(["earlier", "later", "unknown"]);
    expect(pending.rows[2].submittedAt).toBeNull();

    session.user.id = "applicant";
    canApprove.mockResolvedValue(false);
    expect((await listApprovalWorkspace({ tab: "mine" })).rows.map(row => row.id)).toEqual(["later", "earlier", "unknown"]);
    expect((await listApprovalWorkspace({ tab: "mine", start: "2026-09-02" })).rows.map(row => row.id)).toEqual(["later"]);
    expect((await listApprovalWorkspace({ tab: "mine", end: "2026-09-01" })).rows.map(row => row.id)).toEqual(["earlier"]);
    expect((await requireApprovalRecord(session.user, { action: "INTAKE_APPROVE", id: "unknown" })).row.submittedAt).toBeNull();
  });
  it("我已处理仍按本人实际处理时刻筛选和排序，不用最新送审或后续他人处理时间替代", async () => {
    const intake = { title: "合成收案", status: "CONVERTED", createdById: "applicant", createdBy: { name: "申请人" }, ownerUserId: "lead", matter: null };
    db.intake.findMany.mockResolvedValue([
      { ...intake, id: "older-own", revisions: [{ submittedAt: new Date("2026-09-03T02:00:00Z") }] },
      { ...intake, id: "newer-own", revisions: [] },
    ]);
    db.auditLog.findMany.mockResolvedValue([
      { ...event("INTAKE_NEEDS_REVISION", "reviewer", at), targetId: "older-own", targetType: "Intake" },
      { ...event("INTAKE_APPROVE", "reviewer", later), targetId: "newer-own", targetType: "Intake" },
      { ...event("INTAKE_APPROVE", "another", new Date("2026-09-04T02:00:00Z")), targetId: "older-own", targetType: "Intake" },
    ]);
    expect((await listApprovalWorkspace({ tab: "processed" })).rows.map(row => row.id)).toEqual(["newer-own", "older-own"]);
    const filtered = await listApprovalWorkspace({ tab: "processed", start: "2026-09-02", end: "2026-09-02" });
    expect(filtered.rows).toMatchObject([{ id: "newer-own", submittedAt: null, processedAt: later }]);
  });
  it("曾审批人撤权后仍能查到自己的批准记录，不因随后由其他人开票而消失", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([invoice]);
    db.auditLog.findMany.mockResolvedValue([event("INVOICE_APPROVED", "reviewer", at, { note: "原审批意见" }), event("INVOICE_ISSUED", "issuer", later, { note: "后续开票" })]);
    const result = await listApprovalWorkspace({ tab: "processed" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull();
    const detail = await requireApprovalRecord(session.user, { id: "invoice", action: "INVOICE_APPROVE" });
    expect(detail.row.history.map(h => h.note)).toEqual(["原审批意见", "后续开票"]);
    expect(canApprove).not.toHaveBeenCalled();
  });
  it("已处理申请不会因当前拥有同类审批权限而对未参与人开放", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([invoice]); canApprove.mockResolvedValue(true);
    expect((await listApprovalWorkspace({ tab: "processed" })).rows).toEqual([]);
    await expect(requireApprovalRecord(session.user, { id: "invoice", action: "INVOICE_APPROVE" })).rejects.toThrow("不可查看");
  });
  it("申请人可以跟进结果，但不会自动获得处理按钮", async () => {
    session.user.id = "applicant"; db.invoiceRequest.findMany.mockResolvedValue([invoice]);
    const result = await listApprovalWorkspace({ tab: "mine" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull(); expect(result.counts.processed).toBe(0);
  });
  it("非管理员伪造全部记录参数时拒绝读取", async () => {
    await expect(listApprovalWorkspace({ tab: "all" })).rejects.toThrow("仅管理员");
    expect(db.invoiceRequest.findMany).not.toHaveBeenCalled();
  });
  it("系统管理员可审计全部，但无事项授权时不可处理", async () => {
    session.user.systemRole = "SUPER_ADMIN"; db.invoiceRequest.findMany.mockResolvedValue([{ ...invoice, status: "PENDING", processedAt: null, processedById: null }]);
    const result = await listApprovalWorkspace({ tab: "all" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull(); expect(result.counts.pending).toBe(0);
  });
  it("已批准开票与用章以执行环节进入待办，用章回填验证单独授权", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([{ ...invoice, status: "APPROVED" }]);
    db.sealRequest.findMany.mockResolvedValue([{ id: "seal", documentTitle: "测试用章", status: "APPROVED", requestedAt: at, requestedById: "applicant", requestedBy: { name: "申请人" }, matter: null }]);
    canApprove.mockResolvedValue(true);
    const result = await listApprovalWorkspace();
    expect(result.rows.map(r => r.task)).toEqual(["issue", "stamp"]);
    expect(canApprove).toHaveBeenCalledWith("reviewer", "SEAL_STAMP", "seal");
  });
  it("重新提交的文书保留前次驳回意见；普通草稿材料不混入审批", async () => {
    db.document.findMany.mockResolvedValue([{ id: "doc", name: "测试文书", status: "PENDING_REVIEW", createdAt: at, updatedAt: later, uploadedById: "applicant", uploadedBy: { name: "申请人" }, matter: null }, { id: "plain", name: "普通附件", status: "DRAFT", createdAt: at, uploadedById: "applicant", uploadedBy: { name: "申请人" }, matter: null }]);
    db.auditLog.findMany.mockResolvedValue([{ ...event("DOCUMENT_REJECT", "reviewer", at, { reason: "补充签名" }), targetId: "doc", targetType: "Document" }, { ...event("DOCUMENT_SUBMIT_REVIEW", "applicant", later), targetId: "doc", targetType: "Document" }]);
    const result = await listApprovalWorkspace({ tab: "processed" });
    expect(result.rows.map(r => r.id)).toEqual(["doc"]);
    const detail = await requireApprovalRecord(session.user, { id: "doc", action: "DOCUMENT_APPROVE" });
    expect(detail.row.history[0].note).toBe("补充签名"); expect(detail.row.history).toHaveLength(2);
  });
  it("搜索、事项、日期和分页在授权过滤后执行，不提前截断自己的记录", async () => {
    session.user.id = "applicant";
    db.invoiceRequest.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...invoice, id: "invoice-" + i })));
    const result = await listApprovalWorkspace({ tab: "mine", type: "INVOICE_APPROVE", q: "测试案件", start: "2026-09-01", end: "2026-09-01", page: 2 });
    expect(result.total).toBe(25); expect(result.rows).toHaveLength(5); expect(result.page).toBe(2);
    expect((await listApprovalWorkspace({ tab: "mine", start: "2026-09-03" })).rows).toEqual([]);
  });
  it("历史附件以当次快照明确关联，不能用文件创建时间推测", async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: "event" });
    expect(await hasHandledApproval("reviewer", "INTAKE_APPROVE", "intake", "original-doc")).toBe(true);
    expect(db.auditLog.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "reviewer", targetId: "intake", targetType: "Intake", detail: { path: ["attachmentIds"], array_contains: ["original-doc"] } });
    db.auditLog.findFirst.mockResolvedValue(null);
    expect(await hasHandledApproval("reviewer", "INTAKE_APPROVE", "intake", "new-doc")).toBe(false);
  });
});
