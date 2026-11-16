import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseMaterialEntry } from "@/lib/matters/dossier-location";
import type { getCaseMaterialDetail } from "@/server/evidence/workspace-actions";

const mocks = vi.hoisted(() => ({ material: vi.fn(), upload: vi.fn(), submit: vi.fn(), approve: vi.fn(), reject: vi.fn(), file: vi.fn(), withdraw: vi.fn(), move: vi.fn(), ask: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.ask }));
vi.mock("@/server/evidence/workspace-actions", () => ({ getCaseMaterialDetail: mocks.material, getEvidenceCreateOptions: vi.fn() }));
vi.mock("@/server/evidence/actions", () => ({ getEvidenceItem: vi.fn(), updateEvidenceItem: vi.fn(), confirmEvidenceItem: vi.fn(), listEvidenceRevisions: vi.fn(), resolveEvidenceSource: vi.fn(), addEvidenceSource: vi.fn(), removeEvidenceSource: vi.fn(), createEvidenceItem: vi.fn() }));
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: vi.fn() }));
vi.mock("@/server/documents/actions", () => ({ uploadNewVersion: mocks.upload, submitDocumentForReview: mocks.submit, approveDocument: mocks.approve, rejectDocument: mocks.reject, fileDocument: mocks.file, deleteDocument: mocks.withdraw }));
vi.mock("@/server/document-folders/actions", () => ({ moveDocumentToFolder: mocks.move }));
import { CaseMaterialWorkspace } from "@/app/(app)/matters/[id]/_components/case-material-workspace";

const documentId = "cdocume000000000000000000001";
const newId = "cdocume000000000000000000002";
const matterId = "cmatter00000000000000000001";
const updatedAt = new Date("2026-11-16T08:00:00.000Z");
type MaterialData = Awaited<ReturnType<typeof getCaseMaterialDetail>>;
let detail: MaterialData;
function initial(): MaterialData {
  return {
    document: { id: documentId, name: "合成诉状.docx", familyId: "cfamily00000000000000000001", version: 1, isLatest: true, status: "DRAFT",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pageCount: null, createdAt: updatedAt, updatedAt,
      folderId: null, folderName: null, uploadedByName: "合成上传人", previewable: true, reviewReport: null,
      originalUrl: `/api/documents/${documentId}/preview`, downloadUrl: `/api/documents/${documentId}/download` },
    items: [], canCreateEvidence: false,
    versions: [{ id: documentId, name: "合成诉状.docx", version: 1, isLatest: true, status: "DRAFT" }], currentVersionUnavailable: false,
    folders: [{ id: "cfolder00000000000000000001", name: "程序文书" }],
    actions: { canUploadVersion: true, canMoveFolder: true, canWithdraw: true, submitMode: "review", canDecide: false, canFile: false,
      restriction: null, submitBlockedReason: null, withdrawBlockedReason: null }, approval: { history: [] },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); detail = initial();
  mocks.material.mockImplementation(async () => structuredClone(detail));
  mocks.ask.mockResolvedValue(false);
});
afterEach(cleanup);
function Workspace({ changed = () => undefined }: { changed?: (entry: CaseMaterialEntry | null, mode?: "push" | "replace") => void }) {
  const [entry, setEntry] = useState<CaseMaterialEntry | null>({ kind: "material", documentId });
  return <CaseMaterialWorkspace matterId={matterId} entry={entry} onEntryChange={(next, mode) => { changed(next, mode); setEntry(next); }} />;
}
async function chooseVersionFile() {
  fireEvent.click(await screen.findByRole("button", { name: "传新版" }));
  const file = new File(["synthetic newer content"], "合成诉状-v2.docx", { type: detail.document.mimeType! });
  fireEvent.change(screen.getByLabelText("新版本文件"), { target: { files: [file] } });
  return file;
}

describe("材料详情的版本与文书操作", () => {
  it("固定报告不提供传新版，按实际关联在同一详情打开原材料", async () => {
    const changed = vi.fn();
    detail.document.reviewReport = { sourceDocumentId: newId };
    detail.actions.canUploadVersion = false;
    mocks.material.mockImplementation(async ({ documentId: id }) => {
      const value = structuredClone(detail);
      if (id === newId) {
        value.document = { ...value.document, id, name: "合成审查原材料.txt", reviewReport: null };
        value.actions.canUploadVersion = true;
      }
      return value;
    });
    render(<Workspace changed={changed} />);
    await screen.findByText(/审查报告为固定记录/);
    expect(screen.queryByRole("button", { name: "传新版" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开原材料" }));
    await screen.findByRole("heading", { name: "合成审查原材料.txt" });
    expect(changed).toHaveBeenLastCalledWith({ kind: "material", documentId: newId }, "push");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("传新版失败后同键重试，查看原件返回仍保留文件，成功定位新草稿 ID", async () => {
    const changed = vi.fn();
    mocks.upload.mockRejectedValueOnce(new Error("合成回执中断")).mockImplementationOnce(async () => {
      detail.document = { ...detail.document, id: newId, name: "合成诉状-v2.docx", version: 2 };
      detail.versions = [{ id: newId, name: detail.document.name, version: 2, isLatest: true, status: "DRAFT" }, { id: documentId, name: "合成诉状.docx", version: 1, isLatest: false, status: "APPROVED" }];
      return { ok: true, id: newId, version: 2 };
    });
    render(<Workspace changed={changed} />);
    const file = await chooseVersionFile();
    fireEvent.click(screen.getByRole("button", { name: "上传新版本" }));
    await screen.findByText("合成回执中断");
    const requestKey = mocks.upload.mock.calls[0][0].requestKey;
    fireEvent.click(screen.getByRole("button", { name: "查看当前原件" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "返回上传新版本" }));
    expect(screen.getByText("已选择：合成诉状-v2.docx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传新版本" }));
    await screen.findByRole("heading", { name: "合成诉状-v2.docx" });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls[1][0]).toEqual({ documentId, file, requestKey });
    expect(changed).toHaveBeenLastCalledWith({ kind: "material", documentId: newId }, "replace");
    expect(screen.getByRole("button", { name: "提交审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准版入卷" })).not.toBeInTheDocument();
  });

  it("新版本文件是同任务草稿，关闭默认继续；上传未决时不能关闭", async () => {
    let finish!: (value: { ok: true; id: string; version: number }) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Workspace />); await chooseVersionFile();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(screen.getByText("已选择：合成诉状-v2.docx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传新版本" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { detail.document = { ...detail.document, id: newId }; finish({ ok: true, id: newId, version: 2 }); });
  });

  it("首次送审原草稿并读取新状态，同一窗口不产生新版", async () => {
    mocks.submit.mockImplementation(async () => { detail.document.status = "PENDING_REVIEW"; detail.actions.submitMode = null; return { ok: true }; });
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "提交审核" }));
    await screen.findByText("待审核");
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(documentId);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("退回原因在同一表面填写，退回与重提仍绑定原版本", async () => {
    detail.document.status = "PENDING_REVIEW"; detail.actions.submitMode = null; detail.actions.canDecide = true;
    mocks.reject.mockImplementation(async (_id, reason) => {
      detail.document.status = "DRAFT"; detail.actions.canDecide = false; detail.actions.submitMode = "review";
      detail.approval.history = [{ id: "audit", action: "DOCUMENT_REJECT", at: updatedAt, userName: "合成审批人", note: reason }];
      return { ok: true };
    });
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "退回修改" }));
    fireEvent.change(screen.getByLabelText("退回原因"), { target: { value: "请补正诉讼请求" } });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "退回修改" }));
    await screen.findByText("退回原因：请补正诉讼请求");
    fireEvent.click(screen.getByRole("button", { name: "重新送审" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(documentId));
    expect(mocks.reject).toHaveBeenCalledExactlyOnceWith(documentId, "请补正诉讼请求");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("批准历史版入卷提交当前看到的具体 ID 和 updatedAt，不暗换最新版", async () => {
    detail.document.status = "APPROVED"; detail.document.isLatest = false;
    detail.actions.canFile = true; detail.actions.canUploadVersion = false; detail.actions.submitMode = null;
    detail.versions = [{ id: newId, name: "另一新版", version: 2, isLatest: true, status: "DRAFT" }, { id: documentId, name: detail.document.name, version: 1, isLatest: false, status: "APPROVED" }];
    mocks.file.mockImplementation(async () => { detail.document.status = "FILED"; detail.actions.canFile = false; return { ok: true }; });
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "批准版入卷" }));
    await screen.findByText("已入卷");
    expect(mocks.file).toHaveBeenCalledExactlyOnceWith({ documentId, expectedUpdatedAt: updatedAt });
    expect(screen.getByText("历史版本")).toBeInTheDocument();
  });

  it("撤回确认默认保留，确认后只撤回当前版本并返回列表", async () => {
    const changed = vi.fn();
    render(<Workspace changed={changed} />);
    fireEvent.click(await screen.findByRole("button", { name: "撤回材料" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "保留材料" })));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    mocks.ask.mockResolvedValueOnce(true); mocks.withdraw.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "撤回材料" }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null, "push"));
    expect(mocks.withdraw).toHaveBeenCalledExactlyOnceWith(documentId);
  });

  it("只读详情不显示写入动作，当前版本不可用时保留历史版标识", async () => {
    detail.document.isLatest = false; detail.currentVersionUnavailable = true;
    detail.actions = { ...detail.actions, canUploadVersion: false, canMoveFolder: false, canWithdraw: false, submitMode: null };
    render(<Workspace />); await screen.findByRole("heading", { name: detail.document.name });
    for (const name of ["传新版", "调整卷宗", "撤回材料", "提交审核", "批准", "批准版入卷"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByText("历史版本")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前版本不可用");
  });
});
