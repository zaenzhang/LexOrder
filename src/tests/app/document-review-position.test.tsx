import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPositionSourceButton } from "@/components/document-reviews/review-position-source";
import { ReviewPositionEditor } from "@/components/document-reviews/review-position-editor";
import { MaterialSourceLocationPicker, type MaterialSourceLocation } from "@/components/documents/material-source-location-picker";
import type { EvidenceSourceResult } from "@/server/evidence/contracts";

const mocks = vi.hoisted(() => ({ saved: vi.fn(), preview: vi.fn(), reviewSources: vi.fn(), materialSources: vi.fn() }));
vi.mock("@/server/document-reviews/actions", () => ({ getSavedDocumentReviewPosition: mocks.saved,
  previewDocumentReviewPosition: mocks.preview, getDocumentReviewPositionOptions: mocks.reviewSources }));
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: mocks.materialSources }));
const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
beforeEach(() => {
  vi.resetAllMocks();
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); for (const [name, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLElement.prototype, name);
} });

function source(text: string): EvidenceSourceResult {
  return { status: "AVAILABLE", documentName: "合成固定旧版.docx", documentVersion: 2, locationLabel: "第 3 段",
    text, legacy: false, historicalParse: true, previewKind: "CONVERTED", previewUrl: "/api/documents/fixed-old/preview", downloadUrl: "/api/documents/fixed-old/download" };
}

describe("复核固定位置的只读呈现和窄来源选择", () => {
  it("保存后仅传确切 issue/event/slot，分别显示历史片段、整份转换和同版下载，关闭恢复焦点", async () => {
    mocks.saved.mockResolvedValue(source("合成旧解析固定片段"));
    const input = { issueId: "issue-one", eventId: "event-two", slot: "REVISION" as const };
    render(<ReviewPositionSourceButton target={{ kind: "SAVED", input }}>查看固定修订</ReviewPositionSourceButton>);
    const trigger = screen.getByRole("button", { name: "查看固定修订" }); trigger.focus(); fireEvent.click(trigger);
    expect(await screen.findByText("合成旧解析固定片段")).toBeInTheDocument();
    expect(screen.getByText("显示记录保留的历史解析位置。")).toBeInTheDocument();
    expect(screen.getByText("转换预览打开整份文件，未按引用位置跳转。")).toBeInTheDocument();
    expect(screen.getByTitle("整份转换预览")).toHaveAttribute("src", "/api/documents/fixed-old/preview");
    expect(screen.getByRole("link", { name: "下载此版本" })).toHaveAttribute("href", "/api/documents/fixed-old/download");
    expect(mocks.saved).toHaveBeenCalledWith(input);
    fireEvent.click(screen.getByRole("button", { name: "返回复核内容" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("失效位置可重试，换确切目标后旧回复不进入新弹窗", async () => {
    let finish!: (value: EvidenceSourceResult) => void;
    mocks.saved.mockImplementationOnce(() => new Promise<EvidenceSourceResult>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ status: "UNAVAILABLE" }).mockResolvedValueOnce(source("合成当前目标片段"));
    const view = render(<ReviewPositionSourceButton target={{ kind: "SAVED", input: { issueId: "issue-old", slot: "SUBJECT" } }}>查看固定位置</ReviewPositionSourceButton>);
    fireEvent.click(screen.getByRole("button", { name: "查看固定位置" }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledTimes(1));
    view.rerender(<ReviewPositionSourceButton target={{ kind: "SAVED", input: { issueId: "issue-new", slot: "SUBJECT" } }}>查看固定位置</ReviewPositionSourceButton>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看固定位置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("此固定位置当前不可读取");
    expect(screen.queryByRole("link", { name: "下载此版本" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取位置" }));
    await screen.findByText("合成当前目标片段");
    await act(async () => finish(source("合成旧目标迟到片段")));
    expect(screen.queryByText("合成旧目标迟到片段")).not.toBeInTheDocument();
    expect(mocks.saved).toHaveBeenLastCalledWith({ issueId: "issue-new", slot: "SUBJECT" });
  });

  it("复核 Picker 使用窄 slot loader，事实/研究默认 loader 仍接真实原文位置", async () => {
    const document = { id: "document-basis", name: "合成依据.pdf", version: 3, isPdf: true, pageCount: 5, hasIdentity: true };
    const position = { documentId: document.id, documentName: document.name, documentVersion: 3, documentSha256: "a".repeat(64),
      runId: "csyntheticrun000000000000001", anchorId: "anchor-one", location: { kind: "PAGE" as const, page: 3 }, locationLabel: "第 3 页", excerpt: "合成实际位置" };
    mocks.reviewSources.mockResolvedValue({ items: [position], nextOffset: null });
    mocks.materialSources.mockResolvedValue({ items: [position], nextOffset: null });
    function Entry({ review }: { review: boolean }) {
      const [value, setValue] = useState<MaterialSourceLocation>({ page: "", position: null });
      return review ? <ReviewPositionEditor documentId="document-subject" matterId="matter-one" slot="BASIS" document={document} value={value} onChange={setValue} disabled={false} />
        : <MaterialSourceLocationPicker matterId="matter-one" document={document} value={value} onChange={setValue} disabled={false} />;
    }
    const view = render(<Entry review />);
    fireEvent.click(screen.getByRole("button", { name: "读取可引用的原文位置" }));
    const select = await screen.findByRole("combobox", { name: "原文位置" });
    expect(mocks.reviewSources).toHaveBeenCalledWith({ documentId: "document-subject", slot: "BASIS", sourceDocumentId: document.id });
    expect(mocks.materialSources).not.toHaveBeenCalled();
    select.focus(); fireEvent.keyDown(select, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "第 3 页 · 合成实际位置" }));
    expect(screen.queryByLabelText("页码（可选，共 5 页）")).not.toBeInTheDocument();
    view.unmount();
    render(<Entry review={false} />);
    fireEvent.click(screen.getByRole("button", { name: "读取可引用的原文位置" }));
    await screen.findByRole("combobox", { name: "原文位置" });
    expect(mocks.materialSources).toHaveBeenCalledWith({ matterId: "matter-one", documentIds: [document.id], limit: 20 });
  });
});
