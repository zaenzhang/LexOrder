import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmsPasteDialog } from "@/app/(app)/inbox/_components/sms-paste-dialog";
import { BackfillCaseNumberDialog, GenerateDeadlineDialog, GenerateHearingDialog } from "@/app/(app)/inbox/_components/sms-actions-dialogs";
import { InboxView } from "@/app/(app)/inbox/_components/inbox-view";
import { SmsSuggestions } from "@/app/(app)/inbox/_components/sms-suggestions";
import type { SmsRow } from "@/app/(app)/inbox/_components/sms-types";

const mock = vi.hoisted(() => ({ paste: vi.fn(), hearing: vi.fn(), deadline: vi.fn(), backfill: vi.fn(), match: vi.fn(), decide: vi.fn(), targets: vi.fn(), refresh: vi.fn(), close: vi.fn(), error: vi.fn() }));
vi.mock("@/server/sms/actions", () => ({ parseAndSaveSms: mock.paste, generateHearingFromSms: mock.hearing, generateDeadlineFromSms: mock.deadline, backfillCaseNumberFromSms: mock.backfill, matchSmsToMatter: mock.match, extractSmsAttachments: vi.fn(), markSmsProcessed: vi.fn(), deleteSms: vi.fn(), uploadSmsInboundFile: vi.fn() }));
vi.mock("@/server/sms/confirm-actions", () => ({ decideSmsSuggestions: mock.decide, listSmsEventTargets: mock.targets, analyzeSmsInboundFiles: vi.fn(), retrySmsSuggestionFiling: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.error } }));

const now = new Date("2026-11-18T08:00:00.000Z");
const matter: NonNullable<SmsRow["matchedMatter"]> = { id: "cmtestmatter000000000001", internalCode: "SYN-01", title: "合成案件", procedures: [
  { id: "cmtestprocedure000000001", type: "FIRST_INSTANCE", customLabel: "合成第一程序", caseNumber: "（2026）合民初1号" },
  { id: "cmtestprocedure000000002", type: "SECOND_INSTANCE", customLabel: "合成第二程序", caseNumber: null }
] };
const sms: SmsRow = {
  id: "cmtestsms000000000000001", rawText: "合成法院短信", rawTextHash: "synthetic-hash", receivedAt: now, receivedById: "cmtestuser00000000000001", receivedBy: { id: "cmtestuser00000000000001", name: "合成人员" },
  parsedJson: {
    smsType: "HEARING_NOTICE", court: "合成法院", caseNumbers: ["（2026）合民初1号", "（2026）合民终2号"],
    hearingDate: "2026-11-20 09:30", dates: ["2026-11-20"], summary: "合成送达内容",
    filingDate: null, judgmentDate: null, appealDeadline: null, courtRoom: null, judge: null, clerk: null,
    phones: [], amounts: [], urls: [], platforms: [], importantItems: [], credentials: [], documentLinks: [], attachmentResults: []
  }, smsType: "HEARING_NOTICE", matchedMatterId: matter.id, matchedMatter: matter, matchedBy: "AUTO_CASE_NUMBER",
  generatedHearingId: null, generatedDeadlineId: null, processed: false, processedAt: null, needsManualAction: false, processingState: "READY_FOR_REVIEW", processingNote: null, inboundFiles: [], suggestions: [], createdAt: now, updatedAt: now
};
beforeEach(() => {
  Object.values(mock).forEach(fn => fn.mockReset());
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Semi 收件箱操作（真实控件，服务替身）", () => {
  it("解析失败保留短信、批量与附件选项，发送中 Escape 不能关闭；成功后才清空", async () => {
    let reject!: (error: Error) => void;
    mock.paste.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<SmsPasteDialog open onOpenChange={mock.close} />);
    const text = screen.getByPlaceholderText("原文粘贴在此...");
    fireEvent.change(text, { target: { value: "合成法院短信一\n\n合成法院短信二" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /多条短信/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /尝试提取电子送达附件/ }));
    fireEvent.click(screen.getByRole("button", { name: "解析并保存" }));
    await waitFor(() => expect(mock.paste).toHaveBeenCalledOnce());
    expect(mock.paste.mock.calls[0][0]).toEqual({ rawText: "合成法院短信一\n\n合成法院短信二", batch: true, useAi: false, extractAttachments: true });
    expect(text).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mock.close).not.toHaveBeenCalled();
    await act(async () => { reject(new Error("合成保存失败")); });
    expect(mock.error).toHaveBeenCalledWith("合成保存失败");
    expect(text).toHaveValue("合成法院短信一\n\n合成法院短信二");
    expect(screen.getByRole("checkbox", { name: /多条短信/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /尝试提取电子送达附件/ })).toBeChecked();
    mock.paste.mockResolvedValueOnce({ count: 2, aiEnrichedCount: 0 });
    await waitFor(() => expect(screen.getByRole("button", { name: "解析并保存" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "解析并保存" }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledWith(false));
    expect(text).toHaveValue("");
  });

  it("改选实际程序后开庭保存失败保留草稿，重试使用同一短信与北京时间", async () => {
    mock.hearing.mockRejectedValueOnce(new Error("合成庭期失败")).mockResolvedValueOnce({});
    render(<GenerateHearingDialog open onOpenChange={mock.close} sms={sms} matter={matter} />);
    fireEvent.click(screen.getByRole("combobox", { name: /关联程序/ }));
    fireEvent.click(await screen.findByRole("option", { name: /合成第二程序/ }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "合成询问" } });
    fireEvent.change(screen.getByLabelText("开庭时间"), { target: { value: "2026-11-21T15:20" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "合成待核对说明" } });
    fireEvent.click(screen.getByRole("button", { name: "生成开庭" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("合成庭期失败"));
    expect(mock.close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("标题")).toHaveValue("合成询问");
    expect(screen.getByRole("combobox", { name: /关联程序/ })).toHaveTextContent("合成第二程序");
    await waitFor(() => expect(screen.getByRole("button", { name: "生成开庭" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "生成开庭" }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledWith(false));
    expect(mock.hearing.mock.calls[1][0]).toEqual(mock.hearing.mock.calls[0][0]);
    expect(mock.hearing.mock.calls[0][0]).toMatchObject({ smsId: sms.id, procedureId: matter.procedures[1].id, startsAt: new Date("2026-11-21T07:20:00.000Z"), title: "合成询问", notes: "合成待核对说明" });
  });

  it("期限只改表单控件，日期精度与类别保留原服务合同", async () => {
    mock.deadline.mockResolvedValueOnce({});
    render(<GenerateDeadlineDialog open onOpenChange={mock.close} sms={sms} matter={matter} />);
    fireEvent.click(screen.getByRole("combobox", { name: /关联程序/ }));
    await screen.findByRole("option", { name: /合成第二程序/ });
    fireEvent.click(screen.getByRole("combobox", { name: /期限类别/ }));
    await screen.findByRole("option", { name: /答辩期/ });
    fireEvent.keyDown(screen.getByRole("combobox", { name: /期限类别/ }), { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("option", { name: /答辩期/ })).not.toBeInTheDocument());
    expect(mock.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: /期限类别/ }));
    fireEvent.click(await screen.findByRole("option", { name: /答辩期/ }));
    fireEvent.change(screen.getByLabelText("到期日期"), { target: { value: "2026-11-25" } });
    fireEvent.change(screen.getByLabelText("期限依据"), { target: { value: "合成期限依据" } });
    fireEvent.click(screen.getByRole("button", { name: "生成期限" }));
    await waitFor(() => expect(mock.deadline).toHaveBeenCalledOnce());
    expect(mock.deadline.mock.calls[0][0]).toMatchObject({ smsId: sms.id, procedureId: matter.procedures[0].id, category: "RESPONSE", duePrecision: "DATE", dueAt: new Date("2026-11-24T16:00:00.000Z"), basis: "合成期限依据" });
  });

  it("案号回填仅提供未有案号的程序，失败保留选择并可重试", async () => {
    mock.backfill.mockRejectedValueOnce(new Error("合成回填失败")).mockResolvedValueOnce({});
    render(<BackfillCaseNumberDialog open onOpenChange={mock.close} sms={sms} matter={matter} />);
    fireEvent.click(screen.getByRole("combobox", { name: /回填到程序/ }));
    expect(await screen.findByRole("option", { name: /合成第二程序/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /合成第一程序/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /合成第二程序/ }));
    fireEvent.click(screen.getByRole("button", { name: "回填案号" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("合成回填失败"));
    expect(mock.close).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: /短信解析出的案号/ })).toHaveTextContent("（2026）合民终2号");
    await waitFor(() => expect(screen.getByRole("button", { name: "回填案号" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "回填案号" }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledWith(false));
    expect(mock.backfill.mock.calls[1][0]).toEqual({ smsId: sms.id, procedureId: matter.procedures[1].id, caseNumber: "（2026）合民终2号" });
  });

  it("手工关联失败保留所选案件，重试仍发送原短信与原案件 ID", async () => {
    mock.match.mockRejectedValueOnce(new Error("合成关联失败")).mockResolvedValueOnce({});
    const unassigned = { ...sms, matchedMatterId: null, matchedMatter: null, matchedBy: "UNMATCHED" as const };
    render(<InboxView unprocessed={[unassigned]} processed={[]} needsManual={[]} matters={[matter]} />);
    fireEvent.click(screen.getByRole("combobox", { name: "指派案件" }));
    fireEvent.click(await screen.findByRole("option", { name: /SYN-01 合成案件/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("合成关联失败");
    expect(screen.getByRole("combobox", { name: "指派案件" })).toHaveTextContent("合成案件");
    fireEvent.click(screen.getByRole("button", { name: "重试关联" }));
    await waitFor(() => expect(mock.match).toHaveBeenCalledTimes(2));
    expect(mock.match.mock.calls.map(call => call[0])).toEqual([{ smsId: sms.id, matterId: matter.id }, { smsId: sms.id, matterId: matter.id }]);
  });

  it("采用建议失败保留实际程序、采用方式和人工填写，重试仍提交原版本", async () => {
    const suggestion: SmsRow["suggestions"][number] = { id: "cmtestsuggestion000000001", kind: "HEARING", fieldKey: null, currentValue: null, suggestedValue: "合成开庭建议", sourcePage: null, sourceExcerpt: null, status: "PENDING", fileId: null, payload: { procedureId: matter.procedures[0].id, title: "合成初始标题", dateText: "2026-11-20", timeText: "09:30" }, updatedAt: now, targetType: null, targetId: null };
    mock.decide.mockRejectedValueOnce(new Error("合成建议保存失败")).mockResolvedValueOnce({ results: [], warnings: [] });
    render(<SmsSuggestions sms={{ ...sms, suggestions: [suggestion] }} busy={false} />);
    fireEvent.click(screen.getByRole("combobox", { name: "程序" }));
    fireEvent.click(await screen.findByRole("option", { name: /合成第二程序/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "采用方式" }));
    fireEvent.click(await screen.findByRole("option", { name: /新建事项/ }));
    fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "合成人工核对标题" } });
    fireEvent.change(screen.getByLabelText("实际时刻（北京时间）"), { target: { value: "14:10" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "采用" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
    expect(await screen.findByRole("status")).toHaveTextContent("合成建议保存失败");
    expect(screen.getByLabelText("事项标题")).toHaveValue("合成人工核对标题");
    expect(screen.getByRole("combobox", { name: "程序" })).toHaveTextContent("合成第二程序");
    await waitFor(() => expect(screen.getByRole("button", { name: "采用" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
    await waitFor(() => expect(mock.decide).toHaveBeenCalledTimes(2));
    expect(mock.decide.mock.calls[1][0]).toEqual(mock.decide.mock.calls[0][0]);
    expect(mock.decide.mock.calls[0][0]).toMatchObject({ smsId: sms.id, expectedMatchedMatterId: matter.id, items: [{ id: suggestion.id, expectedUpdatedAt: now, event: { mode: "CREATE", procedureId: matter.procedures[1].id, title: "合成人工核对标题", dateText: "2026-11-20", timeText: "14:10" } }] });
  });
});
