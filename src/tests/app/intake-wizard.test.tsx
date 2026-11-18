import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeCreateInput } from "@/server/intakes/schemas";

const mock = vi.hoisted(() => ({
  actor: null as { id: string } | null,
  create: vi.fn(), revision: vi.fn(), resubmit: vi.fn(), upload: vi.fn(), conflicts: vi.fn(),
  duplicate: vi.fn(), enterpriseSearch: vi.fn(), enterpriseDetail: vi.fn(),
  warning: vi.fn(), submitted: vi.fn(), closed: vi.fn(), push: vi.fn(), refresh: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, refresh: mock.refresh }) }));
vi.mock("@/components/workspace-actor-provider", () => ({ useWorkspaceActor: () => mock.actor }));
vi.mock("@/server/intakes/actions", () => ({ createIntake: mock.create, resubmitIntake: mock.resubmit }));
vi.mock("@/server/intakes/revision-actions", () => ({ saveIntakeRevision: mock.revision }));
vi.mock("@/server/documents/actions", () => ({ uploadDocument: mock.upload }));
vi.mock("@/server/conflicts/actions", () => ({ runCheckAndSave: mock.conflicts }));
vi.mock("@/server/clients/dedup", () => ({ checkClientDuplicate: mock.duplicate }));
vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: mock.enterpriseSearch, getEnterpriseDetail: mock.enterpriseDetail }));
vi.mock("@/server/ai/parse-pleading", () => ({ parsePleading: vi.fn() }));
vi.mock("@/server/ai/recommend-cause", () => ({ recommendCause: vi.fn() }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { warning: mock.warning, success: vi.fn(), info: vi.fn() }),
    Notification: Object.assign(semi.Notification, { warning: mock.warning, success: vi.fn(), error: vi.fn(), info: vi.fn() })
  };
});
// 案由回显另有独立切片；向导的 RHF、schema、PartyCard、ChoiceField 均使用真实实现。
vi.mock("@/app/(app)/matters/_components/cause-combobox", () => ({ CauseCombobox: () => <span>案由选择</span> }));

import { IntakeWizard } from "@/app/(app)/intakes/_components/intake-wizard";

const clientId = "cmtestclient00000000000001";
const intakeId = "cmtestintake00000000000001";
const ownerId = "cmtestowner000000000000001";
const clientName = "合成海州设备有限公司";
const opposingName = "合成远川贸易有限公司";

function party(role: IntakeCreateInput["parties"][number]["role"], name: string, ordinal = 1): IntakeCreateInput["parties"][number] {
  return {
    role, name, ordinal, partyType: "COMPANY", enterpriseSocialCode: `SYNTHETIC-${role}-${ordinal}`,
    standing: role === "CLIENT_PARTY" ? undefined : role === "THIRD_PARTY" ? "THIRD_PARTY" : "DEFENDANT"
  };
}

function values(): IntakeCreateInput {
  return {
    category: "CIVIL_COMMERCIAL", title: "合成设备买卖合同纠纷", firstProcedureType: "FIRST_INSTANCE",
    ourStanding: "PLAINTIFF", clientId, ownerUserId: "", counterclaim: false, coUserIds: [],
    parties: [party("CLIENT_PARTY", clientName), party("OPPOSING_PARTY", opposingName)]
  };
}

function renderWizard(overrides: Partial<IntakeCreateInput> = {}) {
  const initial = { ...values(), ...overrides };
  return render(<IntakeWizard
    open onOpenChange={mock.closed} onSubmitted={mock.submitted}
    clientOptions={[{ id: clientId, name: initial.parties[0]?.name ?? clientName, type: "COMPANY" }]}
    colleagues={[{ id: ownerId, name: "合成主办律师" }]}
    editing={{ id: intakeId, revision: 1, values: initial }}
  />);
}

function footer() {
  return screen.getByText(/^第 [1-4] \/ 4 步/);
}

async function nextTo(step: number) {
  fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
  await waitFor(() => expect(footer()).toHaveTextContent(`第 ${step} / 4 步`));
}

async function toConfirmation() {
  await nextTo(2);
  await nextTo(3);
  await nextTo(4);
}

function input(name: string) {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(field).not.toBeNull();
  return field!;
}

function card(name: string) {
  return screen.getByText(name, { selector: ".entity-name > span" }).closest<HTMLElement>(".entity-card")!;
}

function summary(label: string) {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(option));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.actor = null;
  mock.create.mockResolvedValue({ id: intakeId, workflowEnabled: false });
  mock.revision.mockResolvedValue({ id: intakeId, workflowEnabled: false });
  mock.conflicts.mockResolvedValue({ hits: [] });
  mock.duplicate.mockResolvedValue({ idNumberExists: false, nameDuplicates: [] });
  mock.enterpriseSearch.mockResolvedValue({ configured: false, items: [] });
  mock.enterpriseDetail.mockResolvedValue({ configured: false, info: null });
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("向导完成度与真实表单校验", () => {
  it("两个组织缺代码时按字段计数，修正一个后计数与该字段红字一起减少", async () => {
    renderWizard({ parties: values().parties.map(p => ({ ...p, enterpriseSocialCode: "" })) });
    expect(footer()).not.toHaveTextContent("待检查");
    await nextTo(2);
    expect(footer()).toHaveTextContent("本步 2 项待检查");
    fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
    await waitFor(() => expect(within(card(clientName)).getByText("公司/组织需填写统一社会信用代码")).toBeVisible());
    expect(within(card(opposingName)).getByText("公司/组织需填写统一社会信用代码")).toBeVisible();
    fireEvent.change(input("parties.0.enterpriseSocialCode"), { target: { value: "TEST-1" } });
    await waitFor(() => {
      expect(footer()).toHaveTextContent("本步 1 项待检查");
      expect(within(card(clientName)).queryByText("公司/组织需填写统一社会信用代码")).not.toBeInTheDocument();
    });
    expect(within(card(opposingName)).getByText("公司/组织需填写统一社会信用代码")).toBeVisible();
    fireEvent.change(input("parties.1.enterpriseSocialCode"), { target: { value: "TEST-2" } });
    await waitFor(() => expect(footer()).not.toHaveTextContent("待检查"));
    await nextTo(3);
  });

  it("同一信用代码同时超长且为空白也只算一个字段", async () => {
    const parties = values().parties;
    parties[0].enterpriseSocialCode = " ".repeat(51);
    renderWizard({ parties });
    await nextTo(2);
    expect(footer()).toHaveTextContent("本步 1 项待检查");
  });

  it.each(["", "   "])("委托方姓名为 %j 时保留空白守卫且不重复计数", async (name) => {
    const parties = values().parties;
    parties[0].name = name;
    renderWizard({ parties });
    await nextTo(2);
    expect(footer()).toHaveTextContent("本步 1 项待检查");
    fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
    await waitFor(() => expect(mock.warning).toHaveBeenCalledWith("请填写委托方名称"));
    expect(footer()).toHaveTextContent("第 2 / 4 步");
    expect(mock.revision).not.toHaveBeenCalled();
  });

  it("自然人号码格式错误进入相同步骤的计数和真实 PartyCard 红字", async () => {
    const parties = values().parties;
    parties[0] = { ...parties[0], partyType: "NATURAL_PERSON", idType: "OTHER", idNumber: "BAD" };
    renderWizard({ parties });
    await nextTo(2);
    expect(footer()).toHaveTextContent("本步 1 项待检查");
    fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
    await waitFor(() => expect(within(card(clientName)).getByText("证件号码应为 5–30 位字母、数字或连字符")).toBeVisible());
    fireEvent.change(input("parties.0.idNumber"), { target: { value: "SYNTHETIC-PERSON" } });
    await waitFor(() => expect(footer()).not.toHaveTextContent("待检查"));
    await nextTo(3);
  });

  it("诉讼地位错误后切为非诉，已有依赖红字与计数同步清除并可继续", async () => {
    const parties = values().parties.map(p => ({ ...p, standing: undefined }));
    renderWizard({ ourStanding: undefined, parties });
    await nextTo(2);
    expect(footer()).toHaveTextContent("本步 2 项待检查");
    fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
    await waitFor(() => expect(within(screen.getByRole("combobox", { name: "委托方诉讼地位" }).parentElement!).getByText("请选择委托方诉讼地位")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    await select("案件类别", "非诉项目");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(footer()).not.toHaveTextContent("待检查");
    await nextTo(2);
    expect(footer()).not.toHaveTextContent("待检查");
    expect(screen.queryByRole("combobox", { name: "委托方诉讼地位" })).not.toBeInTheDocument();
    await nextTo(3);
  });

  it("顾问对接电话的长度错误属于收案信息步，修正后可继续", async () => {
    renderWizard({ category: "LEGAL_COUNSEL", firstProcedureType: undefined, ourStanding: undefined, parties: [values().parties[0]], contactPhone: "1".repeat(31) });
    expect(footer()).toHaveTextContent("本步 1 项待检查");
    fireEvent.click(screen.getByRole("button", { name: /^下一步 ·/ }));
    await screen.findByRole("alert");
    expect(footer()).toHaveTextContent("第 1 / 4 步");
    fireEvent.change(screen.getByPlaceholderText("对接人电话"), { target: { value: "021-00000000" } });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(footer()).not.toHaveTextContent("待检查");
    await nextTo(2);
    await nextTo(3);
  });

  it("收费方式、主办和程序保持可选，CLIENT_PARTY 不要求第二个 standing", async () => {
    renderWizard({ firstProcedureType: undefined, feeType: undefined, ownerUserId: "" });
    expect(screen.getByText("代理程序", { selector: "label" })).not.toHaveTextContent("*");
    await toConfirmation();
    expect(footer()).not.toHaveTextContent("待检查");
    fireEvent.click(screen.getByRole("button", { name: "保存补正" }));
    await waitFor(() => expect(mock.submitted).toHaveBeenCalledWith(intakeId));
    expect(mock.revision).toHaveBeenCalledWith(intakeId, 1, expect.objectContaining({
      ownerUserId: "", feeType: undefined, firstProcedureType: undefined,
      clientName, parties: [expect.objectContaining({ role: "OPPOSING_PARTY" })]
    }));
  });

  it("已选择收费方式后清空金额仍可提交，空值不会变成 0 或待完成项", async () => {
    renderWizard({ feeType: "FIXED", feeAmount: 8000 });
    await nextTo(2);
    await nextTo(3);
    expect(screen.getByText("总金额（元）", { selector: "label" })).not.toHaveTextContent("*");
    expect(screen.getByText("主办律师", { selector: "label" })).not.toHaveTextContent("*");
    const amount = screen.getByRole("spinbutton");
    fireEvent.change(amount, { target: { value: "0.0" } });
    expect(amount).toHaveDisplayValue("0.0");
    fireEvent.change(amount, { target: { value: "1.20" } });
    expect(amount).toHaveDisplayValue("1.20");
    fireEvent.change(amount, { target: { value: "" } });
    await nextTo(4);
    expect(summary("收费约定")).toHaveTextContent(/^固定收费$/);
    expect(footer()).not.toHaveTextContent("待检查");
    fireEvent.click(screen.getByRole("button", { name: "保存补正" }));
    await waitFor(() => expect(mock.submitted).toHaveBeenCalledWith(intakeId));
    expect(mock.revision.mock.calls[0][2].feeAmount).toBeUndefined();
  });
});

describe("委托方地位与确认摘要", () => {
  it("已有客户身份折叠时仍能直接选择委托方诉讼地位", async () => {
    renderWizard({ ourStanding: undefined });
    await nextTo(2);
    expect(within(card(clientName)).getByRole("button", { name: "编辑" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("combobox", { name: "委托方诉讼地位" })).toBeVisible();
    await select("委托方诉讼地位", "原告");
    expect(within(card(clientName)).getByRole("button", { name: "编辑" })).toHaveAttribute("aria-expanded", "false");
    expect(footer()).not.toHaveTextContent("待检查");
    await nextTo(3);
  });

  it("从客户档案新建收案也直接显示独立地位选择", async () => {
    render(<IntakeWizard open onOpenChange={vi.fn()} initialClientId={clientId}
      clientOptions={[{ id: clientId, name: clientName, type: "COMPANY" }]} colleagues={[]} />);
    await nextTo(2);
    expect(screen.getByText("已关联档案")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "委托方诉讼地位" })).toBeVisible();
    await select("委托方诉讼地位", "原告");
    expect(screen.getByRole("combobox", { name: "委托方诉讼地位" })).toHaveTextContent("原告");
  });

  it("确认完整案名和各方角色姓名、区分标的与收费，返回修改后使用最新姓名", async () => {
    const title = "合成 海州精密设备有限公司与合成远川供应链管理有限公司关于自动化生产线采购、交付验收及尾款支付的买卖合同纠纷";
    const thirdName = "合成第三方设备安装服务有限公司";
    const secondOpponent = "合成远川贸易担保有限公司";
    renderWizard({ title, claimAmount: 61560, feeType: "FIXED", feeAmount: 8000,
      parties: [...values().parties, party("THIRD_PARTY", thirdName), party("OPPOSING_PARTY", secondOpponent, 2)] });
    await toConfirmation();
    expect(summary("案件名称")).toHaveTextContent(title);
    expect(input("title")).toHaveValue(title);
    expect(summary("委托方")).toHaveTextContent(clientName);
    expect(summary("其他当事人")).toHaveTextContent(`对方：${opposingName}`);
    expect(summary("其他当事人")).toHaveTextContent(`第三人：${thirdName}`);
    expect(summary("其他当事人")).toHaveTextContent(`对方：${secondOpponent}`);
    expect(summary("标的额")).toHaveTextContent(/^¥61,560$/);
    expect(summary("收费约定")).toHaveTextContent(/^固定收费 · ¥8,000$/);
    fireEvent.click(screen.getByRole("button", { name: /当事人与冲突/ }));
    fireEvent.click(within(card(opposingName)).getByRole("button", { name: "编辑" }));
    fireEvent.change(input("parties.1.name"), { target: { value: "合成修改后的相对方名称" } });
    await nextTo(3);
    await nextTo(4);
    expect(summary("其他当事人")).toHaveTextContent("对方：合成修改后的相对方名称");
    expect(summary("其他当事人")).not.toHaveTextContent(opposingName);
  });

  it("标的额和收费金额为 0 时保留明确的零值", async () => {
    renderWizard({ claimAmount: 0, feeType: "FIXED", feeAmount: 0 });
    await toConfirmation();
    expect(summary("标的额")).toHaveTextContent(/^¥0$/);
    expect(summary("收费约定")).toHaveTextContent(/^固定收费 · ¥0$/);
  });

  it("补充说明超长时留在确认步并显示相邻错误，修正后错误和计数同时清除", async () => {
    renderWizard();
    await toConfirmation();
    const description = screen.getByPlaceholderText("客户来源、核心诉求、注意事项…");
    fireEvent.change(description, { target: { value: "合".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "保存补正" }));
    await waitFor(() => expect(within(description.closest(".fsec-body") as HTMLElement).getByText(/2000/)).toBeVisible());
    expect(footer()).toHaveTextContent("第 4 / 4 步 · 全部 1 项待检查");
    expect(description).toBeVisible();
    await waitFor(() => expect(description).toHaveFocus());
    expect(mock.revision).not.toHaveBeenCalled();
    fireEvent.change(description, { target: { value: "合成补充说明" } });
    await waitFor(() => {
      expect(within(description.closest(".fsec-body") as HTMLElement).queryByText(/2000/)).not.toBeInTheDocument();
      expect(footer()).not.toHaveTextContent("待检查");
    });
  });
});


describe("Semi 向导弹层与保存接续", () => {
  it("备案下拉第一下 Escape 只关闭选项，第二下才交给父抽屉", async () => {
    const close = vi.fn();
    render(<IntakeWizard open onOpenChange={close} clientOptions={[]} colleagues={[]}
      editing={{ id: intakeId, revision: 1, values: values() }} />);
    const filing = screen.getByRole("combobox", { name: "是否需向律协备案" });
    fireEvent.click(filing);
    await screen.findByRole("listbox");
    fireEvent.keyDown(filing, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() => expect(filing).toHaveAttribute("aria-expanded", "false"));
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(filing, { key: "Escape", keyCode: 27, which: 27 });
    expect(close).toHaveBeenCalledWith(false);
  });

  it("保存失败保留 Semi 选择及草稿，重试仍保存原收案与修订", async () => {
    mock.revision.mockRejectedValueOnce(new Error("合成保存失败"));
    renderWizard();
    fireEvent.click(screen.getByRole("combobox", { name: "是否需向律协备案" }));
    fireEvent.click(await screen.findByRole("option", { name: /需要，涉重大案件/ }));
    await toConfirmation();
    fireEvent.change(screen.getByPlaceholderText("客户来源、核心诉求、注意事项…"), { target: { value: "合成失败后保留的说明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存补正" }));
    await waitFor(() => expect(mock.revision).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存补正" })).not.toBeDisabled());
    expect(mock.submitted).not.toHaveBeenCalled();
    expect(mock.closed).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("客户来源、核心诉求、注意事项…")).toHaveValue("合成失败后保留的说明");
    fireEvent.click(screen.getByRole("button", { name: "保存补正" }));
    await waitFor(() => expect(mock.submitted).toHaveBeenCalledWith(intakeId));
    expect(mock.revision).toHaveBeenNthCalledWith(2, intakeId, 1, expect.objectContaining({ barFiling: "MAJOR", description: "合成失败后保留的说明" }));
  });
});
