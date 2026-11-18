import { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseSearchPanel } from "@/app/(app)/matters/[id]/_components/case-search-panel";
import { TemplatePickerDialog } from "@/app/(app)/matters/[id]/_components/template-picker-dialog";
import type { TemplateSummary } from "@/app/(app)/matters/[id]/_components/folder-types";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";

const mocks = vi.hoisted(() => ({ local: vi.fn(), regulations: vi.fn(), render: vi.fn(), prepare: vi.fn(), confirm: vi.fn() }));
vi.mock("@/server/yuandian/cases", () => ({ searchSimilarCases: vi.fn(), searchSimilarCasesByVector: vi.fn() }));
vi.mock("@/server/yuandian/regulations", () => ({ searchRegulationsAction: mocks.regulations }));
vi.mock("@/server/cncases/search", () => ({ searchLocalJudgmentsAction: mocks.local }));
vi.mock("@/server/yuandian/save-case", () => ({ saveCaseToMatter: vi.fn(), saveVectorCaseToMatter: vi.fn() }));
vi.mock("@/server/document-templates/actions", () => ({ renderTemplate: mocks.render, prepareTemplate: mocks.prepare }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));
const adopted: ContextInputSelection = { recordId: "ccontext000000000000000000001", expectedCurrentRecordId: "ccontext000000000000000000001", expectedConfirmedAt: null };
vi.mock("@/components/matters/context-input-picker", () => ({ ContextInputPicker: ({ value, onChange, disabled }: { value: ContextInputSelection[]; onChange(value: ContextInputSelection[]): void; disabled?: boolean }) =>
  <button disabled={disabled} onClick={() => onChange([adopted])}>{value.length ? "已选合成目标" : "选择合成目标"}</button> }));
vi.mock("@douyinfe/semi-ui", async (load) => ({ ...await load<typeof import("@douyinfe/semi-ui")>(), Toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }, Notification: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));
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
    expectedSubjects: {}, expectedValues: Object.fromEntries(templates.find(template => template.id === templateId)!.variables.map(path => [path, `原始值:${path}`])),
    fields: templates.find(template => template.id === templateId)!.variables.map(path => ({ path, value: path === "client.phone" ? "原电话" : "", editable: true, required: true, controlsScope: false, missing: path !== "client.phone" })) }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("二开界面适配（组件交互）", () => {
  it("opens the configured local provider without a Yuandian account and submits the matter association", async () => {
    mocks.local.mockResolvedValue({ available: true, total: 1, items: [{ title: "合成检索判决书" }] });
    render(<CaseSearchPanel matterId={matterId} matterCategory="CIVIL_COMMERCIAL" defaultCauseName={null} providers={{ yuandian: false, localJudgments: true }} />);
    for (const name of ["关键词", "语义", "法规检索"]) expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("tab", { name: "本地文书" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("裁判文书关键词（自建服务）"), { target: { value: "合成关键词" } });
    fireEvent.click(screen.getByRole("button", { name: "检索文书" }));
    await waitFor(() => expect(mocks.local).toHaveBeenCalledWith("合成关键词", { max: 10, matterId }));
    expect(await screen.findByText("合成检索判决书")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /全文/ })).not.toBeInTheDocument();
  });
  it("submits regulation filters and exposes the original-source link", async () => {
    mocks.regulations.mockResolvedValue({ total: 1, items: [{ fgmc: "合成法规", content: "合成摘要", detailUrl: "https://source.example.invalid/law/1" }] });
    render(<CaseSearchPanel matterId={matterId} matterCategory="CIVIL_COMMERCIAL" defaultCauseName={null} providers={{ yuandian: true, localJudgments: false }} />);
    fireEvent.click(screen.getByRole("tab", { name: "法规检索" }));
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

  it("同模板重新核对及失败保留本稿和G15，使用原值expectations；生成失败原请求可直接重试", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<PickerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "诉讼验收模板" }));
    fireEvent.change(await screen.findByLabelText("委托人电话"), { target: { value: "仅本稿电话" } });
    fireEvent.click(screen.getByRole("button", { name: "选择合成目标" }));
    const original = await mocks.prepare.mock.results[0].value;
    mocks.prepare.mockRejectedValueOnce(new Error("合成核对暂时失败"));
    fireEvent.click(screen.getByRole("button", { name: "重新核对字段" }));
    await screen.findByText("合成核对暂时失败");
    expect(screen.getByLabelText("委托人电话")).toHaveValue("仅本稿电话");
    expect(screen.getByRole("button", { name: "已选合成目标" })).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
    mocks.prepare.mockResolvedValueOnce({ ...original, fields: original.fields.map((field: { path: string }) => ({ ...field, value: "仅本稿电话", editable: true, required: true, controlsScope: false, missing: false })) });
    fireEvent.click(screen.getByRole("button", { name: "重新核对字段" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    expect(mocks.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ overrides: { "client.phone": "仅本稿电话" }, expectedSubjects: {} }));
    fireEvent.click(screen.getByRole("checkbox"));
    mocks.render.mockRejectedValueOnce(new Error("合成回执未收到"));
    fireEvent.click(screen.getByRole("button", { name: "生成草稿并下载" }));
    await screen.findByText("合成回执未收到");
    const request = mocks.render.mock.calls[0][0];
    expect(request).toMatchObject({ overrides: { "client.phone": "仅本稿电话" }, expectedValues: { "client.phone": "原始值:client.phone" }, contextInputs: [adopted] });
    expect(screen.getByLabelText("委托人电话")).toHaveValue("仅本稿电话");
    const retry = screen.getByRole("button", { name: "生成草稿并下载" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(mocks.render.mock.calls[1][0]).toEqual(request);
  });

  it("明确重核条件才更新字段，隐藏补填可恢复但不提交；原有空白控制值不误锁核对", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mocks.prepare.mockImplementation(async ({ templateId, overrides = {} }: { templateId: string; overrides?: Record<string, string> }) => {
      const show = overrides["custom.show"] ?? " 有条件 ";
      return { templateId, templateUpdatedAt: "2026-11-16T08:00:00.000Z", templateSourceDocumentId: "source",
        selection: { clientId: null, opposingPartyId: null, thirdPartyId: null, procedureId: null }, choices: { clients: [], opposing: [], thirds: [], procedures: [] }, expectedSubjects: {},
        expectedValues: { "custom.show": "原条件", ...(show.trim() ? { "custom.detail": "原明细" } : {}) },
        fields: [{ path: "custom.show", value: Object.hasOwn(overrides, "custom.show") ? show.trim() : show, editable: true, required: false, controlsScope: true, missing: false },
          ...(show.trim() ? [{ path: "custom.detail", value: overrides["custom.detail"] ?? "原明细", editable: true, required: true, controlsScope: false, missing: false }] : [])] };
    });
    render(<PickerHarness />); fireEvent.click(screen.getByRole("button", { name: "诉讼验收模板" }));
    await screen.findByLabelText("custom.show");
    expect(screen.getByRole("checkbox")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("custom.detail"), { target: { value: "暂存明细" } });
    fireEvent.change(screen.getByLabelText("custom.show"), { target: { value: "" } });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新核对字段" }));
    await waitFor(() => expect(screen.queryByLabelText("custom.detail")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("custom.show"), { target: { value: "启用" } });
    fireEvent.click(screen.getByRole("button", { name: "重新核对字段" }));
    expect(await screen.findByLabelText("custom.detail")).toHaveValue("暂存明细");
    fireEvent.change(screen.getByLabelText("custom.show"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "重新核对字段" }));
    await waitFor(() => expect(screen.queryByLabelText("custom.detail")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "生成草稿并下载" }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalled());
    expect(mocks.render.mock.calls[0][0]).toMatchObject({ overrides: { "custom.show": "" }, expectedValues: { "custom.show": "原条件" } });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
