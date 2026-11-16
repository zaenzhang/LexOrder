import React, { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  detail: vi.fn(), approval: vi.fn(), upload: vi.fn(), submit: vi.fn(), file: vi.fn(), approve: vi.fn(), reject: vi.fn(),
  confirm: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh, push: mock.push, replace: mock.replace }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("sonner", () => ({ toast: { success: mock.toast, error: mock.toast } }));
vi.mock("@/server/documents/detail-actions", () => ({ getDocumentDetail: mock.detail }));
vi.mock("@/server/documents/actions", () => ({ uploadNewVersion: mock.upload, submitDocumentForReview: mock.submit, fileDocument: mock.file, approveDocument: mock.approve, rejectDocument: mock.reject }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/server/approval-permissions/inbox", () => ({ getApprovalDetail: mock.approval }));
vi.mock("@/server/intakes/actions", () => ({ convertIntakeToMatter: vi.fn(), declineIntake: vi.fn(), markIntakeNeedsRevision: vi.fn(), resubmitIntake: vi.fn() }));
vi.mock("@/server/archive/actions", () => ({ approveArchiveRecord: vi.fn(), rejectArchiveRecord: vi.fn() }));
vi.mock("@/server/invoices/actions", () => ({ approveInvoiceRequest: vi.fn(), rejectInvoiceRequest: vi.fn() }));
vi.mock("@/server/seals/actions", () => ({ approveSealRequest: vi.fn(), rejectSealRequest: vi.fn(), stampSealRequest: vi.fn(), cancelSealRequest: vi.fn() }));
vi.mock("@/components/matters/execution-termination-panel", () => ({ ExecutionTerminationPanel: () => null }));
vi.mock("@/app/(app)/approvals/approval-create-menu", () => ({ ApprovalCreateMenu: () => null }));
vi.mock("@/app/(app)/approvals/approval-review-summary", () => ({ ApprovalReviewSummary: () => null, approvalAlert: () => null }));
vi.mock("@/app/(app)/approvals/intake-approval-dialog", () => ({ IntakeApprovalDialog: () => null }));
vi.mock("@/app/(app)/approvals/invoice-recognition", () => ({ InvoiceRecognition: () => null }));
// The real review panel has separate response/check tests. Keep its mount,
// dirty and pending contract here so wrapper navigation cannot discard it.
vi.mock("@/components/document-reviews/document-review-panel", () => ({
  DocumentReviewPanel: ({ documentId, initialIssueId, onDirtyChange, onPendingChange }: {
    documentId: string; initialIssueId?: string | null; onDirtyChange?(value: boolean): void; onPendingChange?(value: boolean): void;
  }) => {
    const [value, setValue] = useState("");
    useEffect(() => () => { onDirtyChange?.(false); onPendingChange?.(false); }, [onDirtyChange, onPendingChange]);
    return <div><span data-testid="review-target">{documentId}:{initialIssueId ?? ""}</span>
      <label>合成复核输入<input aria-label="合成复核输入" value={value} onChange={event => { setValue(event.target.value); onDirtyChange?.(Boolean(event.target.value)); }} /></label>
      <button type="button" onClick={() => onPendingChange?.(true)}>合成复核保存中</button>
      <button type="button" onClick={() => onPendingChange?.(false)}>合成复核保存结束</button>
    </div>;
  },
}));

import { DocumentDetail } from "@/components/documents/document-detail";
import { ApprovalInbox } from "@/app/(app)/approvals/approval-inbox";
import type { getDocumentDetail } from "@/server/documents/detail-actions";
import type { getApprovalDetail, listApprovalWorkspace } from "@/server/approval-permissions/inbox";

const matterId = "cm00000000000000000000001", oldId = "cm00000000000000000000002", latestId = "cm00000000000000000000003", issueId = "issue-specific";
const close = vi.fn(), change = vi.fn(), issue = vi.fn(), prepare = vi.fn();
function detail(changes: Partial<Awaited<ReturnType<typeof getDocumentDetail>>> = {}): Awaited<ReturnType<typeof getDocumentDetail>> {
  return { id: oldId, name: "合成旧版意见.docx", version: 1, isLatest: false, status: "APPROVED", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    createdAt: "2026-11-16T08:00:00.000Z", updatedAt: new Date("2026-11-16T08:00:00.000Z"), uploadedByName: "合成作者", folderName: null, reviewSourceId: null, canWithdraw: false, withdrawBlockedReason: null, hasVersionFamily: true, canUploadVersion: false, canSubmit: false, canFile: true, canPrepareDelivery: true,
    versions: [{ id: oldId, version: 1, name: "合成旧版意见.docx", isLatest: false, status: "APPROVED" }, { id: latestId, version: 2, name: "合成新稿.docx", isLatest: true, status: "DRAFT" }], ...changes };
}
function approval(changes: Partial<Awaited<ReturnType<typeof getApprovalDetail>>> = {}): Awaited<ReturnType<typeof getApprovalDetail>> {
  return { title: "合成旧版审批", requester: "合成作者", submittedAt: new Date("2026-11-16T08:00:00Z"), status: "DRAFT", task: null,
    canResubmit: true, canCancel: false, fields: [], attachments: [], history: [], intakeDetail: null, archiveReview: null, sealType: null, returnTarget: null, ...changes };
}
const approvalData: Awaited<ReturnType<typeof listApprovalWorkspace>> = {
  rows: [], counts: { pending: 0, processed: 0, mine: 1, all: 0 }, canViewAll: false, total: 0, page: 1, pageSize: 20,
  query: { tab: "mine", page: 1 },
};
function renderDetail(extra: Partial<React.ComponentProps<typeof DocumentDetail>> = {}) {
  return render(<DocumentDetail matterId={matterId} documentId={oldId} onClose={close} onDocumentChange={change} onIssueChange={issue} onPrepareDelivery={prepare} {...extra} />);
}
function tab(name: string) { fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false }); }
beforeEach(() => {
  vi.resetAllMocks(); window.history.replaceState(null, "", "/");
  mock.detail.mockResolvedValue(detail()); mock.approval.mockResolvedValue(approval()); mock.confirm.mockResolvedValue(false);
  mock.submit.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("文书详情的版本定位与输入保护", () => {
  it("读取指定案件和旧版，审批另页打开；切页签保留复核输入，切新版本须确认", async () => {
    renderDetail({ issueId });
    expect(await screen.findByTestId("review-target")).toHaveTextContent(`${oldId}:${issueId}`);
    expect(mock.detail).toHaveBeenCalledWith(matterId, oldId);
    const approvalLink = screen.getByRole("link", { name: "审批记录" });
    expect(approvalLink).toHaveAttribute("href", `/approvals?type=DOCUMENT_APPROVE&id=${oldId}`);
    expect(approvalLink).toHaveAttribute("target", "_blank");
    fireEvent.change(screen.getByLabelText("合成复核输入"), { target: { value: "不能遗失的复核说明" } });
    tab("版本"); tab("人工复核");
    expect(screen.getByLabelText("合成复核输入")).toHaveValue("不能遗失的复核说明");
    tab("版本");
    fireEvent.click(screen.getByRole("button", { name: /第 2 版/ }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel" })));
    expect(change).not.toHaveBeenCalled();
    mock.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: /第 2 版/ }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(latestId));
  });

  it("复核正在保存时不切换版本、不关闭，也不执行文书处理", async () => {
    renderDetail({ issueId });
    fireEvent.click(await screen.findByRole("button", { name: "合成复核保存中" }));
    tab("版本");
    fireEvent.click(screen.getByRole("button", { name: /第 2 版/ }));
    fireEvent.click(screen.getByRole("button", { name: "入卷" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await act(async () => undefined);
    expect(change).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(mock.file).not.toHaveBeenCalled();
  });

  it("新稿上传失败可保留同一请求；确认放弃并重新读取后不能提交已丢弃的 File", async () => {
    mock.detail.mockResolvedValue(detail({ canUploadVersion: true, isLatest: true }));
    mock.upload.mockRejectedValue(new Error("合成上传失败"));
    renderDetail(); await screen.findByRole("link", { name: "审批记录" }); tab("版本");
    const file = new File(["synthetic text"], "合成未保存新稿.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("上传新稿"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成上传失败");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存新版本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(2));
    expect(mock.upload.mock.calls[0][0].requestKey).toBe(mock.upload.mock.calls[1][0].requestKey);
    expect(mock.upload.mock.calls[1][0].file).toBe(file);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存新版本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalled());
    expect(mock.detail).toHaveBeenCalledTimes(1);
    mock.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(mock.detail).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("上传新稿");
    expect(screen.getByRole("button", { name: "保存新版本" })).toBeDisabled();
  });

  it("指定版本读取被拒后不展示替代版本或写入口", async () => {
    mock.detail.mockRejectedValue(new Error("此文书版本不存在、已撤回或无权读取"));
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("无权读取");
    expect(screen.queryByRole("link", { name: "下载此版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "准备交付" })).not.toBeInTheDocument();
    expect(screen.queryByText("合成新稿.docx")).not.toBeInTheDocument();
  });
});

describe("审批内具体文书复核入口", () => {
  it("精确问题直达人工复核；未存或正在保存的回应阻止重新提交审批", async () => {
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${oldId}&reviewIssue=${issueId}`);
    render(<ApprovalInbox data={approvalData} initialSelection={{ id: oldId, action: "DOCUMENT_APPROVE" }} />);
    const input = await screen.findByLabelText("合成复核输入");
    expect(screen.getByRole("tab", { name: "人工复核" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("review-target")).toHaveTextContent(`${oldId}:${issueId}`);
    fireEvent.change(input, { target: { value: "尚未保存的回应" } });
    fireEvent.click(screen.getByRole("button", { name: "重新提交审批" }));
    await act(async () => undefined);
    expect(mock.submit).not.toHaveBeenCalled();
    expect(input).toHaveValue("尚未保存的回应");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "合成复核保存中" }));
    fireEvent.click(screen.getByRole("button", { name: "重新提交审批" }));
    await act(async () => undefined);
    expect(mock.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "合成复核保存结束" }));
    fireEvent.click(screen.getByRole("button", { name: "重新提交审批" }));
    await waitFor(() => expect(mock.submit).toHaveBeenCalledWith(oldId));
    await waitFor(() => expect(new URL(window.location.href).searchParams.has("id")).toBe(false));
    expect(new URL(window.location.href).searchParams.has("reviewIssue")).toBe(false);
  });

  it("URL 指定对象读取失败不留下前一文书正文，同一目标之后仍可重试", async () => {
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${oldId}`);
    const rendered = render(<ApprovalInbox data={approvalData} initialSelection={{ id: oldId, action: "DOCUMENT_APPROVE" }} />);
    await screen.findByText("合成旧版审批");
    mock.approval.mockRejectedValueOnce(new Error("合成新对象无权读取"));
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${latestId}`);
    await act(async () => { rendered.rerender(<ApprovalInbox data={approvalData} initialSelection={{ id: latestId, action: "DOCUMENT_APPROVE" }} />); });
    await waitFor(() => expect(mock.approval).toHaveBeenCalledWith({ id: latestId, action: "DOCUMENT_APPROVE" }));
    await waitFor(() => expect(screen.queryByText("合成旧版审批")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "重新提交审批" })).not.toBeInTheDocument();
    mock.approval.mockResolvedValueOnce(approval({ title: "合成重试后可读审批" }));
    fireEvent.click(await screen.findByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("合成重试后可读审批")).toBeInTheDocument();
  });

  it("拒绝丢弃复核草稿时恢复原 URL，之后仍能再次选择同一目标", async () => {
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${oldId}&reviewIssue=${issueId}`);
    const rendered = render(<ApprovalInbox data={approvalData} initialSelection={{ id: oldId, action: "DOCUMENT_APPROVE" }} />);
    fireEvent.change(await screen.findByLabelText("合成复核输入"), { target: { value: "仍需保留的原稿说明" } });
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${latestId}`);
    await act(async () => { rendered.rerender(<ApprovalInbox data={approvalData} initialSelection={{ id: latestId, action: "DOCUMENT_APPROVE" }} />); });
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel" })));
    expect(mock.approval).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("合成复核输入")).toHaveValue("仍需保留的原稿说明");
    expect(new URL(window.location.href).searchParams.get("id")).toBe(oldId);
    expect(new URL(window.location.href).searchParams.get("reviewIssue")).toBe(issueId);
    mock.confirm.mockResolvedValueOnce(true);
    mock.approval.mockResolvedValueOnce(approval({ title: "合成另一个指定审批" }));
    window.history.replaceState(null, "", `/approvals?type=DOCUMENT_APPROVE&id=${latestId}`);
    await act(async () => { rendered.rerender(<ApprovalInbox data={approvalData} initialSelection={{ id: latestId, action: "DOCUMENT_APPROVE" }} />); });
    await waitFor(() => expect(mock.approval).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("合成另一个指定审批")).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("id")).toBe(latestId);
  });
});
