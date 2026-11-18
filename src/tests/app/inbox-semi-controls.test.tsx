import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  parse: vi.fn(), hearing: vi.fn(), deadline: vi.fn(), backfill: vi.fn(), match: vi.fn(), upload: vi.fn(),
  targets: vi.fn(), decide: vi.fn(), error: vi.fn(), success: vi.fn(), refresh: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: mock.success }),
    Notification: Object.assign(semi.Notification, { success: mock.success, error: mock.error })
  };
});
vi.mock("@/server/sms/actions", () => ({
  parseAndSaveSms: mock.parse, generateHearingFromSms: mock.hearing, generateDeadlineFromSms: mock.deadline,
  backfillCaseNumberFromSms: mock.backfill, matchSmsToMatter: mock.match,
  extractSmsAttachments: vi.fn(), markSmsProcessed: vi.fn(), deleteSms: vi.fn(), uploadSmsInboundFile: mock.upload
}));
vi.mock("@/server/sms/confirm-actions", () => ({
  listSmsEventTargets: mock.targets, decideSmsSuggestions: mock.decide,
  analyzeSmsInboundFiles: vi.fn(), retrySmsSuggestionFiling: vi.fn()
}));

import { ActionError } from "@/lib/action-error";
import { InboxView } from "@/app/(app)/inbox/_components/inbox-view";
import { SmsPasteDialog } from "@/app/(app)/inbox/_components/sms-paste-dialog";
import { GenerateDeadlineDialog, GenerateHearingDialog } from "@/app/(app)/inbox/_components/sms-actions-dialogs";
import { SmsSuggestions } from "@/app/(app)/inbox/_components/sms-suggestions";
import type { MatterOption, ParsedJson, SmsRow } from "@/app/(app)/inbox/_components/sms-types";

const SMS = "csms000000000000000000001", MATTER = "cmatter000000000000000001", PROCEDURE = "cprocedure000000000000001";
const TARGET = "ctarget000000000000000001", SUGGESTION = "csuggestion00000000000001";
const VERSION = new Date("2026-11-18T08:30:00.123Z");
const matter: MatterOption = { id: MATTER, internalCode: "TEST-001", title: "合成事项", procedures: [{ id: PROCEDURE, type: "FIRST_INSTANCE", customLabel: null, caseNumber: null }] };
const parsed: ParsedJson = {
  smsType: "HEARING_NOTICE", summary: "合成开庭通知", caseNumbers: [], court: null, dates: [], hearingDate: null,
  filingDate: null, judgmentDate: null, appealDeadline: null, courtRoom: null, judge: null, clerk: null,
  phones: [], amounts: [], urls: [], platforms: [], importantItems: [], credentials: [], documentLinks: [], attachmentResults: []
};
function sms(overrides: Partial<SmsRow> = {}): SmsRow {
  return {
    id: SMS, rawText: "合成开庭通知", rawTextHash: "synthetic", receivedAt: VERSION, receivedById: "synthetic-user",
    receivedBy: { id: "synthetic-user", name: "合成经办" }, parsedJson: JSON.parse(JSON.stringify(parsed)), smsType: "HEARING_NOTICE",
    matchedMatterId: MATTER, matchedMatter: matter, matchedBy: "MANUAL", generatedHearingId: null, generatedDeadlineId: null,
    processed: false, processedAt: null, needsManualAction: false, processingState: "READY_FOR_REVIEW", processingNote: null,
    inboundFiles: [], suggestions: [], createdAt: VERSION, updatedAt: VERSION, ...overrides
  };
}

const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
  mock.parse.mockResolvedValue({ count: 1, aiEnrichedCount: 0 });
  mock.hearing.mockResolvedValue({ ok: true }); mock.deadline.mockResolvedValue({ ok: true }); mock.match.mockResolvedValue({ ok: true });
  mock.targets.mockResolvedValue({ targets: [{ id: TARGET, title: "合成原期限", at: VERSION, duePrecision: "DATE", updatedAt: VERSION }], truncated: false });
  mock.decide.mockResolvedValue({ results: [{ outcome: "LINKED", replayed: false }], warnings: [] });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});
async function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: typeof option === "string" ? new RegExp(option) : option }));
}

describe("收件箱 Semi 控件接线（真实组件，服务动作受控）", () => {
  it("解析失败保留原文与实际勾选，再次提交同一载荷", async () => {
    const close = vi.fn();
    mock.parse.mockRejectedValueOnce(new ActionError("保存失败，请重试"));
    render(<SmsPasteDialog open onOpenChange={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "法院短信原文" }), { target: { value: "合成短信第一条\n\n合成短信第二条" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /多条短信/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /尝试提取电子送达附件/ }));
    fireEvent.click(screen.getByRole("button", { name: "解析并保存" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith(expect.objectContaining({ title: "保存失败，请重试" })));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "法院短信原文" })).toHaveValue("合成短信第一条\n\n合成短信第二条");
    expect(screen.getByRole("checkbox", { name: /多条短信/ })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "解析并保存" })).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(screen.getByRole("button", { name: "解析并保存" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mock.parse.mock.calls[1][0]).toEqual(mock.parse.mock.calls[0][0]);
    expect(mock.parse.mock.calls[0][0]).toMatchObject({ batch: true, useAi: false, extractAttachments: true });
  });

  it("提交过程中输入和取消锁定，Escape 不关闭正在处理的原短信", async () => {
    let resolve!: (value: { count: number; aiEnrichedCount: number }) => void;
    mock.parse.mockReturnValue(new Promise(done => { resolve = done; }));
    const close = vi.fn();
    render(<SmsPasteDialog open onOpenChange={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "法院短信原文" }), { target: { value: "合成待处理短信" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "法院短信原文" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /多条短信/ })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", keyCode: 27 });
    expect(close).not.toHaveBeenCalled();
    await act(async () => resolve({ count: 1, aiEnrichedCount: 0 }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });

  it("取消后重新打开清空原文和附件提取选择，不发起解析", async () => {
    const close = vi.fn();
    const view = render(<SmsPasteDialog open onOpenChange={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "法院短信原文" }), { target: { value: "合成取消的短信" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /尝试提取电子送达附件/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(close).toHaveBeenCalledWith(false);
    view.rerender(<SmsPasteDialog open={false} onOpenChange={close} />);
    view.rerender(<SmsPasteDialog open onOpenChange={close} />);
    expect(screen.getByRole("textbox", { name: "法院短信原文" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /尝试提取电子送达附件/ })).not.toBeChecked();
    expect(mock.parse).not.toHaveBeenCalled();
  });

  it("实际程序和上海时刻进入开庭请求，失败后保留输入重试", async () => {
    const close = vi.fn();
    mock.hearing.mockRejectedValueOnce(new ActionError("程序已变化，请核对"));
    render(<GenerateHearingDialog open onOpenChange={close} sms={sms()} matter={matter} />);
    fireEvent.change(screen.getByLabelText("标题 *"), { target: { value: "合成证据交换" } });
    fireEvent.change(screen.getByLabelText("开庭时间 *"), { target: { value: "2027-02-05T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "生成开庭" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith(expect.objectContaining({ title: "程序已变化，请核对" })));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("开庭时间 *")).toHaveValue("2027-02-05T09:30");
    await waitFor(() => expect(screen.getByRole("button", { name: "生成开庭" })).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(screen.getByRole("button", { name: "生成开庭" }));
    await waitFor(() => expect(mock.hearing).toHaveBeenCalledTimes(2));
    expect(mock.hearing.mock.calls[1][0]).toEqual(mock.hearing.mock.calls[0][0]);
    expect(mock.hearing.mock.calls[0][0]).toMatchObject({ smsId: SMS, procedureId: PROCEDURE, title: "合成证据交换", startsAt: new Date("2027-02-05T09:30:00+08:00") });
  });

  it("迁移后的期限输入仍消费共享精度字段，提交明确日期而非浏览器本地时间", async () => {
    render(<GenerateDeadlineDialog open onOpenChange={vi.fn()} sms={sms()} matter={matter} />);
    fireEvent.change(screen.getByLabelText("标题 *"), { target: { value: "合成举证期限" } });
    fireEvent.change(screen.getByLabelText("到期日期"), { target: { value: "2027-02-05" } });
    fireEvent.change(screen.getByLabelText("期限依据"), { target: { value: "合成来件明确日期" } });
    fireEvent.click(screen.getByRole("button", { name: "生成期限" }));
    await waitFor(() => expect(mock.deadline).toHaveBeenCalledOnce());
    expect(mock.deadline.mock.calls[0][0]).toMatchObject({ smsId: SMS, procedureId: PROCEDURE, title: "合成举证期限", dueAt: new Date("2027-02-05T00:00:00+08:00"), duePrecision: "DATE", basis: "合成来件明确日期" });
  });

  it("必须明确采用方式和原事项，失败后沿原建议与目标版本重试", async () => {
    mock.decide.mockRejectedValueOnce(new ActionError("当前目标已变化，请核对"));
    const row = sms({ suggestions: [{ id: SUGGESTION, kind: "DEADLINE", fieldKey: null, currentValue: null, suggestedValue: "合成待核期限", sourcePage: 1, sourceExcerpt: "合成来源原文", status: "PENDING", fileId: "synthetic-file", payload: { procedureId: PROCEDURE, dateText: "2026-11-18", timeText: "16:30", title: "合成待核期限" }, updatedAt: VERSION, targetType: null, targetId: null }] });
    render(<SmsSuggestions sms={row} busy={false} />);
    expect(screen.getByRole("button", { name: "采用" })).toBeDisabled();
    await choose("采用方式", "关联已有事项");
    await waitFor(() => expect(mock.targets).toHaveBeenCalledWith({ smsId: SMS, suggestionId: SUGGESTION, procedureId: PROCEDURE, query: "" }));
    await choose("已有事项", /合成原期限/);
    await waitFor(() => expect(screen.getByRole("button", { name: "采用" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
    expect(await screen.findByText("当前目标已变化，请核对")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "采用" })).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
    await waitFor(() => expect(mock.decide).toHaveBeenCalledTimes(2));
    expect(mock.decide.mock.calls[1][0]).toEqual(mock.decide.mock.calls[0][0]);
    expect(mock.decide.mock.calls[0][0]).toMatchObject({ smsId: SMS, expectedMatchedMatterId: MATTER, decision: "ACCEPTED", items: [{ id: SUGGESTION, expectedUpdatedAt: VERSION, event: { mode: "LINK", procedureId: PROCEDURE, targetId: TARGET, expectedTargetUpdatedAt: VERSION } }] });
  });

  it("来件指派使用选中的实际案件ID，失败不展示已关联，可重试同一目标", async () => {
    mock.match.mockRejectedValueOnce(new ActionError("该案件已不可关联"));
    const second = { ...matter, id: "cmatter000000000000000002", internalCode: "TEST-002" };
    render(<InboxView unprocessed={[sms({ matchedMatter: null, matchedMatterId: null, matchedBy: "UNMATCHED" })]} processed={[]} needsManual={[]} needsMatch={[]} matters={[matter, second]} />);
    await choose("指派案件", "TEST-002 合成事项");
    expect(await screen.findByRole("alert")).toHaveTextContent("该案件已不可关联");
    expect(screen.getByRole("combobox", { name: "指派案件" })).toHaveTextContent("TEST-002 合成事项");
    expect(screen.queryByRole("link", { name: /TEST-002/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "重试关联" })).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(screen.getByRole("button", { name: "重试关联" }));
    await waitFor(() => expect(mock.match).toHaveBeenCalledTimes(2));
    expect(mock.match.mock.calls[0][0]).toEqual({ smsId: SMS, matterId: second.id });
    expect(mock.match.mock.calls[1][0]).toEqual(mock.match.mock.calls[0][0]);
  });

  it("补传入口触发真实文件输入，沿原短信提交文件且处理中不可重复操作", async () => {
    let finish!: (value: unknown) => void;
    mock.upload.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<InboxView unprocessed={[sms({ processingState: "NEEDS_MANUAL_FETCH" })]} processed={[]} needsManual={[]} needsMatch={[]} matters={[matter]} />);
    const input = screen.getByLabelText("补传来件原件") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    const trigger = screen.getByRole("button", { name: "补传文件" });
    fireEvent.click(trigger);
    expect(click).toHaveBeenCalledOnce();
    const file = new File(["synthetic original"], "synthetic-notice.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mock.upload).toHaveBeenCalledOnce());
    expect(trigger).toBeDisabled();
    expect(input).toBeDisabled();
    const payload = mock.upload.mock.calls[0][0] as FormData;
    expect(payload.get("smsId")).toBe(SMS);
    expect(payload.getAll("files")).toEqual([file]);
    await act(async () => finish({ saved: [], replenished: [], skippedDuplicates: [], failed: [], filedFiles: 0 }));
    await waitFor(() => expect(trigger).toBeEnabled());
    click.mockRestore();
  });
});
