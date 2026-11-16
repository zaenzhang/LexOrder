import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mock = vi.hoisted(() => ({ basic: vi.fn(), team: vi.fn(), procedure: vi.fn(), confirm: vi.fn() }));
vi.mock("@/server/matters/actions", () => ({ updateMatterBasicInfo: mock.basic, updateMatterTeam: mock.team, updateProcedureInfo: mock.procedure }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/app/(app)/matters/_components/cause-combobox", () => ({ CauseCombobox: () => <span>案由选择</span> }));
vi.mock("@/app/(app)/intakes/_components/jurisdiction-select", () => ({ JurisdictionSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input aria-label="管辖地" value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock("@/components/matters/enterprise-name-input", () => ({ EnterpriseNameInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input aria-label="组织名称" value={value} onChange={event => onChange(event.target.value)} /> }));
import { TeamEditorDialog, type TeamEditorDialogProps } from "@/app/(app)/matters/[id]/_components/team-editor-dialog";

const version = new Date("2026-11-16T01:00:00Z");
const ownerId = "cmtestowner000000000000001";
const memberId = "cmtestmember00000000000001";
const partyId = "cmtestparty000000000000001";
function props(): TeamEditorDialogProps {
  return {
    open: true, onOpenChange: vi.fn(), onOpenHandover: vi.fn(), matterId: "cmtestmatter00000000000001",
    matterMeta: { updatedAt: version, title: "合成案件", category: "CIVIL_COMMERCIAL", intakeDate: version, causeId: null, causeFreeText: null, claimAmount: null, ourStanding: null, teamAccessRestricted: false },
    currentProcedure: { id: "cmtestprocedure00000000001", updatedAt: version, type: "FIRST_INSTANCE", customLabel: null, jurisdiction: "上海市", handlingAgency: "合成机构", caseNumber: "合成案号", presidingJudge: null, presidingJudgeContact: null, judgeAssistant: null, judgeAssistantContact: null, ourStanding: null, acceptedAt: null, concludedAt: null, procedureParties: [] },
    parties: [{ id: partyId, updatedAt: version, role: "OPPOSING_PARTY", standing: null, ordinal: 1, name: "合成当事人", partyType: "NATURAL_PERSON", idType: "PASSPORT", idNumber: "TESTONLY123", phone: null, address: null, legalRep: null, contactName: null, enterpriseSocialCode: null }],
    currentOwnerId: ownerId, currentMembers: [{ userId: ownerId, role: "LEAD", name: "合成主办" }, { userId: memberId, role: "CO_LEAD", name: "合成协办" }],
    userOptions: [{ id: ownerId, name: "合成主办", role: "LAWYER", active: true }, { id: memberId, name: "合成协办", role: "LAWYER", active: true }],
    canEditMatterInfo: true, canManageTeam: true, canManageProcedure: true
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mock.basic.mockResolvedValue({ ok: true }); mock.team.mockResolvedValue({ ok: true }); mock.procedure.mockResolvedValue(undefined); mock.confirm.mockResolvedValue(false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("三个对象独立保存（组件环境）", () => {
  it("案件入口只显示案件表单，只提交案件 action", async () => {
    const input = props(); render(<TeamEditorDialog {...input} initialSection="matter" />);
    fireEvent.change(screen.getByLabelText("案件名称"), { target: { value: "修改后的合成案件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存案件信息" }));
    await waitFor(() => expect(mock.basic).toHaveBeenCalledOnce());
    expect(mock.basic).toHaveBeenCalledWith(expect.objectContaining({ title: "修改后的合成案件", expectedUpdatedAt: version }));
    expect(mock.team).not.toHaveBeenCalled(); expect(mock.procedure).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "当前程序信息" })).not.toBeInTheDocument();
    expect(input.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("程序校验或提交失败不保存案件/团队，并保留输入及错误", async () => {
    mock.procedure.mockRejectedValueOnce(new ActionError("程序已被其他人修改，请保留输入并重新核对"));
    const input = props(); render(<TeamEditorDialog {...input} initialSection="procedure" />);
    fireEvent.change(screen.getByDisplayValue("合成案号"), { target: { value: "编辑中的合成案号" } });
    fireEvent.click(screen.getByRole("button", { name: "保存程序与当事人" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("程序已被其他人修改");
    expect(screen.getByDisplayValue("编辑中的合成案号")).toBeVisible();
    expect(mock.basic).not.toHaveBeenCalled(); expect(mock.team).not.toHaveBeenCalled();
    expect(input.onOpenChange).not.toHaveBeenCalled();
  });

  it("修改程序时不会把无关 Party 或猜测出的程序地位写回", async () => {
    render(<TeamEditorDialog {...props()} initialSection="procedure" />);
    fireEvent.change(screen.getByDisplayValue("合成案号"), { target: { value: "新合成案号" } });
    fireEvent.click(screen.getByRole("button", { name: "保存程序与当事人" }));
    await waitFor(() => expect(mock.procedure).toHaveBeenCalledOnce());
    expect(mock.procedure).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: version, updatedParties: [], procedureParties: [] }));
  });

  it("当事人入口仍是同一程序任务，只携带实际修改 Party 的版本", async () => {
    render(<TeamEditorDialog {...props()} initialSection="parties" />);
    fireEvent.change(screen.getByDisplayValue("合成当事人"), { target: { value: "新合成当事人" } });
    fireEvent.click(screen.getByRole("button", { name: "保存程序与当事人" }));
    await waitFor(() => expect(mock.procedure).toHaveBeenCalledOnce());
    expect(mock.procedure).toHaveBeenCalledWith(expect.objectContaining({ updatedParties: [expect.objectContaining({ partyId, name: "新合成当事人", expectedUpdatedAt: version })] }));
    expect(mock.basic).not.toHaveBeenCalled(); expect(mock.team).not.toHaveBeenCalled();
  });

  it("成员保存只写成员，主办不能在此更换", async () => {
    const input = props(); render(<TeamEditorDialog {...input} initialSection="team" />);
    fireEvent.click(within(screen.getByRole("region", { name: "协办律师" })).getByRole("checkbox", { name: "合成协办" }));
    fireEvent.click(screen.getByRole("button", { name: "保存承办成员" }));
    await waitFor(() => expect(mock.team).toHaveBeenCalledOnce());
    expect(mock.team).toHaveBeenCalledWith(expect.objectContaining({ expectedOwnerId: ownerId, expectedMembers: input.currentMembers.map(({userId, role}) => ({userId, role})), coLeadIds: [] }));
    expect(mock.team.mock.calls[0][0]).not.toHaveProperty("ownerId");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(mock.basic).not.toHaveBeenCalled(); expect(mock.procedure).not.toHaveBeenCalled();
  });

  it("主办交接只调用既有入口，不偷偷保存成员", async () => {
    const input = props(); render(<TeamEditorDialog {...input} initialSection="team" />);
    fireEvent.click(screen.getByRole("button", { name: "办理主办交接" }));
    await waitFor(() => expect(input.onOpenHandover).toHaveBeenCalledOnce());
    expect(input.onOpenChange).toHaveBeenCalledWith(false);
    expect(mock.team).not.toHaveBeenCalled();
  });
});

describe("编辑对象和草稿保持", () => {
  it("后台重新取数不会重置草稿或替换最初的前置值", async () => {
    const input = props(); const view = render(<TeamEditorDialog {...input} initialSection="matter" />);
    fireEvent.change(screen.getByLabelText("案件名称"), { target: { value: "本地未保存修改" } });
    view.rerender(<TeamEditorDialog {...input} matterMeta={{ ...input.matterMeta, title: "另一人已更新", updatedAt: new Date("2026-11-16T02:00:00Z") }} initialSection="matter" />);
    expect(screen.getByLabelText("案件名称")).toHaveValue("本地未保存修改");
    fireEvent.click(screen.getByRole("button", { name: "保存案件信息" }));
    await waitFor(() => expect(mock.basic).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: version, title: "本地未保存修改" })));
  });

  it("取消默认继续编辑，明确放弃后才关闭", async () => {
    const input = props(); render(<TeamEditorDialog {...input} initialSection="matter" />);
    fireEvent.change(screen.getByLabelText("案件名称"), { target: { value: "保留此输入" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(input.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("案件名称")).toHaveValue("保留此输入");
    mock.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(input.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("待保存时关闭按钮不卸载表单、也不重复提交", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mock.basic.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const input = props(); render(<TeamEditorDialog {...input} initialSection="matter" />);
    fireEvent.change(screen.getByLabelText("案件名称"), { target: { value: "提交中的合成案件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存案件信息" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存案件信息" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(input.onOpenChange).not.toHaveBeenCalled();
    expect(mock.basic).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true }));
  });

  it("硬刷新只注册原生离开提醒，不持久化正文草稿", () => {
    render(<TeamEditorDialog {...props()} initialSection="matter" />);
    const cleanLeave = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(cleanLeave);
    expect(cleanLeave.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("案件名称"), { target: { value: "未保存" } });
    const dirtyLeave = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirtyLeave);
    expect(dirtyLeave.defaultPrevented).toBe(true);
  });

  it("请求的编辑任务无权或不存在时显示失效状态，不自动换成别的对象", () => {
    render(<TeamEditorDialog {...props()} currentProcedure={null} initialSection="procedure" />);
    expect(screen.getByRole("alert")).toHaveTextContent("当前对象不存在或已无权修改");
    expect(screen.queryByLabelText("案件名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /保存/ })).not.toBeInTheDocument();
  });
});
