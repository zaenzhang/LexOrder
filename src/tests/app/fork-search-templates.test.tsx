import { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseSearchPanel } from "@/app/(app)/matters/[id]/_components/case-search-panel";
import { TemplatePickerDialog } from "@/app/(app)/matters/[id]/_components/template-picker-dialog";
import type { TemplateSummary } from "@/app/(app)/matters/[id]/_components/folder-types";

const mocks = vi.hoisted(() => ({ local: vi.fn(), regulations: vi.fn(), render: vi.fn(), prepare: vi.fn(), confirm: vi.fn() }));
vi.mock("@/server/yuandian/cases", () => ({ searchSimilarCases: vi.fn(), searchSimilarCasesByVector: vi.fn() }));
vi.mock("@/server/yuandian/regulations", () => ({ searchRegulationsAction: mocks.regulations }));
vi.mock("@/server/cncases/search", () => ({ searchLocalJudgmentsAction: mocks.local }));
vi.mock("@/server/yuandian/save-case", () => ({ saveCaseToMatter: vi.fn(), saveVectorCaseToMatter: vi.fn() }));
vi.mock("@/server/document-templates/actions", () => ({ renderTemplate: mocks.render, prepareTemplate: mocks.prepare }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const matterId = "cmatter000000000000000000001";
const templates: TemplateSummary[] = [
  { id: "execution", name: "执行验收模板", category: "EXECUTION", description: null, applicableCategories: [], variables: ["execution.basis", "proceeding.court", "client.phone"], isBuiltIn: true },
  { id: "litigation", name: "诉讼验收模板", category: "LITIGATION", description: null, applicableCategories: [], variables: ["client.phone"], isBuiltIn: true }
];
function PickerHarness() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>重新打开模板</button><TemplatePickerDialog open={open} onOpenChange={setOpen} matterId={matterId} matterCategory="CIVIL_COMMERCIAL" folders={[]} templates={templates} /></>;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.render.mockResolvedValue({ missing: [], fileName: "合成文书.docx", documentId: "fixture" });
  mocks.confirm.mockResolvedValue(true);
  mocks.prepare.mockImplementation(async ({ templateId }: { templateId: string }) => ({ templateId, templateUpdatedAt: "2026-11-16T08:00:00.000Z", templateSourceDocumentId: "source",
    selection: { clientId: null, opposingPartyId: null, thirdPartyId: null, procedureId: null }, choices: { clients: [], opposing: [], thirds: [], procedures: [] },
    fields: templates.find(template => template.id === templateId)!.variables.map(path => ({ path, value: path === "client.phone" ? "原电话" : "", editable: true, missing: path !== "client.phone" })) }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("二开界面适配（组件交互）", () => {
  it("opens the configured local provider without a Yuandian account and submits the matter association", async () => {
    mocks.local.mockResolvedValue({ available: true, total: 1, items: [{ title: "合成检索判决书" }] });
    render(<CaseSearchPanel matterId={matterId} matterCategory="CIVIL_COMMERCIAL" defaultCauseName={null} providers={{ yuandian: false, localJudgments: true }} />);
    for (const name of ["关键词", "语义", "法规检索"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "本地文书" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("裁判文书关键词（自建服务）"), { target: { value: "合成关键词" } });
    fireEvent.click(screen.getByRole("button", { name: "检索文书" }));
    await waitFor(() => expect(mocks.local).toHaveBeenCalledWith("合成关键词", { max: 10, matterId }));
    expect(await screen.findByText("合成检索判决书")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /全文/ })).not.toBeInTheDocument();
  });
  it("submits regulation filters and exposes the original-source link", async () => {
    mocks.regulations.mockResolvedValue({ total: 1, items: [{ fgmc: "合成法规", content: "合成摘要", detailUrl: "https://source.example.invalid/law/1" }] });
    render(<CaseSearchPanel matterId={matterId} matterCategory="CIVIL_COMMERCIAL" defaultCauseName={null} providers={{ yuandian: true, localJudgments: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "法规检索" }));
    fireEvent.change(screen.getByLabelText("法规内容关键词"), { target: { value: "合成法条条件" } });
    fireEvent.change(screen.getByLabelText("法规名称（可选）"), { target: { value: "合成法规" } });
    fireEvent.click(screen.getByRole("button", { name: "检索法规" }));
    await waitFor(() => expect(mocks.regulations).toHaveBeenCalledWith(expect.objectContaining({ keyword: "合成法条条件", fgmc: "合成法规", sxx: "现行有效", top_k: 10, matterId })));
    expect(await screen.findByRole("link", { name: "查看原文" })).toHaveAttribute("href", "https://source.example.invalid/law/1");
  });
  it("clears every temporary field and review confirmation when switching templates", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<PickerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "执行验收模板" }));
    fireEvent.change(await screen.findByLabelText("执行依据名称"), { target: { value: "旧执行依据" } });
    fireEvent.change(screen.getByLabelText("受理法院"), { target: { value: "旧执行法院" } });
    fireEvent.change(screen.getByLabelText("委托人电话"), { target: { value: "TEST-PHONE" } });
    fireEvent.click(screen.getByRole("button", { name: "诉讼验收模板" }));
    await waitFor(() => expect(screen.queryByLabelText("执行依据名称")).not.toBeInTheDocument());
    expect(await screen.findByLabelText("委托人电话")).toHaveValue("原电话");
    fireEvent.click(screen.getByRole("button", { name: "执行验收模板" }));
    expect(await screen.findByLabelText("执行依据名称")).toHaveValue("");
    expect(screen.getByLabelText("委托人电话")).toHaveValue("原电话");
    expect(screen.getByRole("button", { name: "生成草稿并下载" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("执行依据名称"), { target: { value: "本次执行依据" } });
    fireEvent.change(screen.getByLabelText("受理法院"), { target: { value: "本次执行法院" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "生成草稿并下载" }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ matterId, templateId: "execution", folderId: null, reviewed: true,
      requestKey: expect.any(String), overrides: { "execution.basis": "本次执行依据", "proceeding.court": "本次执行法院" } })));
  });
  it("protects a dirty template on cancel and then clears it only after explicit discard", async () => {
    render(<PickerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "执行验收模板" }));
    fireEvent.change(await screen.findByLabelText("执行依据名称"), { target: { value: "旧执行依据" } });
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(screen.getByLabelText("执行依据名称")).toHaveValue("旧执行依据");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.render).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新打开模板" }));
    expect(screen.getByRole("button", { name: "生成草稿并下载" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "执行验收模板" }));
    expect(await screen.findByLabelText("执行依据名称")).toHaveValue("");
  });
});
