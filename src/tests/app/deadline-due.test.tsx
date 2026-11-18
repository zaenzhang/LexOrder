import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ add: vi.fn(), adjust: vi.fn(), change: vi.fn(), rules: vi.fn(), error: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@douyinfe/semi-ui", async (load) => ({ ...await load<typeof import("@douyinfe/semi-ui")>(), Toast: { success: vi.fn(), warning: vi.fn(), error: mock.error }, Notification: { success: vi.fn(), warning: vi.fn(), error: mock.error } }));
vi.mock("@/server/procedures/actions", () => ({ addDeadline: mock.add, addProcedure: vi.fn(), addHearing: vi.fn(), toggleDeadlineCompleted: vi.fn(), deleteDeadline: vi.fn(), deleteHearing: vi.fn(), addProcedureMemo: vi.fn(), deleteProcedureMemo: vi.fn() }));
vi.mock("@/server/deadlines/confirm", () => ({ adjustDeadline: mock.adjust, confirmDeadline: vi.fn() }));
vi.mock("@/server/deadline-rules/actions", () => ({ listDeadlineRulesForProcedure: mock.rules }));
vi.mock("@/server/express/actions", () => ({ createExpress: vi.fn(), deleteExpress: vi.fn() }));
vi.mock("@/server/ai/parse-express", () => ({ parseExpressLabel: vi.fn() }));
vi.mock("@/server/ai/parse-summons", () => ({ parseSummons: vi.fn() }));
vi.mock("@/server/reminders/work-actions", () => ({ getWorkBoard: vi.fn(), changeWork: mock.change, requestHandover: vi.fn(), decideHandover: vi.fn(), refreshHandover: vi.fn(), createUrgent: vi.fn() }));
vi.mock("@/server/tasks/actions", () => ({ completeTasksBatch: vi.fn() }));
vi.mock("@/components/matters/task-detail-dialog", () => ({ TaskDetailDialog: () => null }));
vi.mock("@/components/matters/intake-handover-panel", () => ({ IntakeHandoverPanel: () => null }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: vi.fn(async () => true) }));

import { AdjustDeadlineDialog, ImportantItemDialog } from "@/app/(app)/matters/[id]/_components/procedure-content";
import { AddDeadlineDialog } from "@/app/(app)/matters/[id]/_components/procedure-forms";
import { WorkResponsibilityPanel } from "@/components/matters/work-responsibility-panel";
import { ActionError } from "@/lib/action-error";

const matterId = "cmatter000000000000000001", procedureId = "cprocedure000000000000001";
const procedures = [{ id: procedureId, label: "合成程序" }];
const original = { id: "cdeadline000000000000001", title: "合成期限", dueAt: new Date("2027-02-05T17:00:03.456+08:00"), duePrecision: "DATETIME" as const, updatedAt: new Date("2026-11-17T01:00:00Z") };
type Board = NonNullable<React.ComponentProps<typeof WorkResponsibilityPanel>["data"]>;
const work = (): Board["items"][number] => ({ id: "cwork000000000000000001", targetId: original.id, kind: "Deadline", title: original.title, dueAt: original.dueAt, duePrecision: original.duePrecision, matterId, intakeId: null, assigneeId: "actor", name: "合成经办", active: true, proposedAssigneeId: null, proposedName: null, acceptedAt: null, state: "OPEN", revision: 2, reason: null, taskHref: null, taskProgress: null });
const board = (): Board => ({ currentUserId: "actor", emergency: false, canWrite: true, canTransfer: false, items: [work()], people: [], matters: [], intakes: [], handovers: [], intakeHandovers: [] });
const descriptors = ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
beforeEach(() => {
  vi.resetAllMocks();
  mock.rules.mockResolvedValue([]); mock.add.mockResolvedValue({ ok: true, id: original.id }); mock.adjust.mockResolvedValue({ ok: true }); mock.change.mockResolvedValue({ ok: true });
  for (const [name] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});
async function choose(trigger: HTMLElement, option: string | RegExp) {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: typeof option === "string" ? name => name.includes(option) : option }));
}
async function exact() { await choose(screen.getByRole("combobox", { name: "期限精度" }), "准确时刻（北京时间）"); }
const reason = () => fireEvent.change(screen.getByPlaceholderText("如：法院通知书载明举证期限延长至…"), { target: { value: "按合成来件明确核对" } });

describe("F01 真实期限表单（组件环境，服务动作边界受控）", () => {
  it("新增默认为日期并发送上海日界，不因容器时区变成上午八时", async () => {
    render(<AddDeadlineDialog open onOpenChange={vi.fn()} procedures={procedures} defaultProcedureId={procedureId} />);
    fireEvent.change(screen.getByPlaceholderText("如：举证截止 / 上诉到期日"), { target: { value: "合成日期期限" } });
    expect(screen.getByRole("combobox", { name: "期限精度" })).toHaveTextContent("日期");
    expect(screen.queryByLabelText("准确时刻（北京时间）")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("到期日期"), { target: { value: "2027-02-05" } });
    fireEvent.click(screen.getByRole("button", { name: "添加期限" }));
    await waitFor(() => expect(mock.add).toHaveBeenCalledOnce());
    expect(mock.add.mock.calls[0][0]).toMatchObject({ procedureId, dueAt: new Date("2027-02-05T00:00:00+08:00"), duePrecision: "DATE" });
  });

  it("规则先填日期，随后明确改准确午夜仍携带规则来源与人工选择", async () => {
    const ruleId = "crule0000000000000000001";
    mock.rules.mockResolvedValue([{ id: ruleId, name: "合成日期规则", periodValue: 15, periodUnit: "DAYS", category: "APPEAL", triggerLabel: "送达日期", legalBasis: "合成依据", remindDays: 3 }]);
    render(<AddDeadlineDialog open onOpenChange={vi.fn()} procedures={procedures} defaultProcedureId={procedureId} />);
    const ruleTrigger = (await screen.findByText("选择适用的法定期限")).closest<HTMLElement>('[role="combobox"]')!;
    await choose(ruleTrigger, /合成日期规则/);
    fireEvent.click(screen.getByRole("button", { name: "填入下方表单" }));
    expect(screen.getByRole("combobox", { name: "期限精度" })).toHaveTextContent("日期");
    await exact();
    fireEvent.change(screen.getByLabelText("到期日期"), { target: { value: "2027-02-05" } });
    fireEvent.change(screen.getByLabelText("准确时刻（北京时间）"), { target: { value: "00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "添加期限" }));
    await waitFor(() => expect(mock.add).toHaveBeenCalledOnce());
    expect(mock.add.mock.calls[0][0]).toMatchObject({ procedureId, sourceRuleId: ruleId, dueAt: new Date("2027-02-05T00:00:00+08:00"), duePrecision: "DATETIME" });
  });

  it("统一添加事项的准确时刻失败后保留日期、时间与真实程序重试", async () => {
    const close = vi.fn();
    mock.add.mockRejectedValueOnce(new ActionError("当前程序已变化，请核对"));
    render(<ImportantItemDialog open onOpenChange={close} matterId={matterId} defaultType="deadline" types={["deadline"]} procedures={procedures} defaultProcedureId={procedureId} hearingCounts={{}} proceduresDetail={{}} />);
    fireEvent.change(screen.getByPlaceholderText("如：举证截止 / 上诉到期日"), { target: { value: "合成时刻期限" } });
    await exact();
    fireEvent.change(screen.getByLabelText("到期日期"), { target: { value: "2027-02-05" } });
    fireEvent.change(screen.getByLabelText("准确时刻（北京时间）"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "添加期限" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("到期日期")).toHaveValue("2027-02-05");
    expect(screen.getByLabelText("准确时刻（北京时间）")).toHaveValue("17:00");
    fireEvent.click(screen.getByRole("button", { name: "添加期限" }));
    await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(2));
    expect(mock.add.mock.calls[1][0]).toEqual(mock.add.mock.calls[0][0]);
    expect(mock.add.mock.calls[1][0]).toMatchObject({ procedureId, dueAt: new Date("2027-02-05T17:00:00+08:00"), duePrecision: "DATETIME" });
  });

  it("历史未知不会因打开或保存原因被默认为DATE；明确选择后才提交", async () => {
    render(<AdjustDeadlineDialog deadline={{ ...original, duePrecision: null }} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "期限精度" })).toHaveTextContent("历史精度未记录");
    expect(screen.queryByLabelText("准确时刻（北京时间）")).not.toBeInTheDocument();
    reason(); fireEvent.click(screen.getByRole("button", { name: "保存调整" }));
    expect(await screen.findByText("历史时间精度未记录，请明确选择本次日期或准确时刻")).toBeVisible();
    expect(mock.adjust).not.toHaveBeenCalled();
    await choose(screen.getByRole("combobox", { name: "期限精度" }), "日期");
    fireEvent.click(screen.getByRole("button", { name: "保存调整" }));
    await waitFor(() => expect(mock.adjust).toHaveBeenCalledOnce());
    expect(mock.adjust.mock.calls[0][0]).toMatchObject({ id: original.id, expectedUpdatedAt: original.updatedAt, duePrecision: "DATE", dueAt: new Date("2027-02-05T00:00:00+08:00") });
  });

  it("准确时刻未编辑时保留原秒毫秒，失败保留原因并重试同一原值", async () => {
    mock.adjust.mockRejectedValueOnce(new ActionError("保存失败，请重试"));
    render(<AdjustDeadlineDialog deadline={original} onClose={vi.fn()} />);
    reason(); fireEvent.click(screen.getByRole("button", { name: "保存调整" }));
    expect(await screen.findByText("保存失败，请重试")).toBeVisible();
    expect(screen.getByLabelText("准确时刻（北京时间）")).toHaveValue("17:00");
    expect(screen.getByPlaceholderText("如：法院通知书载明举证期限延长至…")).toHaveValue("按合成来件明确核对");
    fireEvent.click(screen.getByRole("button", { name: "保存调整" }));
    await waitFor(() => expect(mock.adjust).toHaveBeenCalledTimes(2));
    expect(mock.adjust.mock.calls[1][0]).toEqual(mock.adjust.mock.calls[0][0]);
    expect(mock.adjust.mock.calls[1][0]).toMatchObject({ dueAt: original.dueAt, duePrecision: "DATETIME" });
  });

  it("责任改期也保留未改秒毫秒与精度，失败后实际原revision重试", async () => {
    mock.change.mockRejectedValueOnce(new ActionError("并发变化，请核对"));
    render(<WorkResponsibilityPanel data={board()} matterId={matterId} />);
    fireEvent.click(screen.getByRole("button", { name: "改期" }));
    fireEvent.change(screen.getByLabelText("依据、处理原因及通知情况"), { target: { value: "按合成来件核对" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并留痕" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("并发变化，请核对"));
    expect(screen.getByLabelText("准确时刻（北京时间）")).toHaveValue("17:00");
    expect(screen.getByLabelText("依据、处理原因及通知情况")).toHaveValue("按合成来件核对");
    fireEvent.click(screen.getByRole("button", { name: "保存并留痕" }));
    await waitFor(() => expect(mock.change).toHaveBeenCalledTimes(2));
    expect(mock.change.mock.calls[1][0]).toEqual(mock.change.mock.calls[0][0]);
    expect(mock.change.mock.calls[1][0]).toMatchObject({ id: work().id, revision: 2, dueAt: original.dueAt, duePrecision: "DATETIME" });
  });

  it("固定交接清单按快照精度展示，旧缺失值不借用当前准确时刻", () => {
    const data = board();
    const old = { ...work(), id: "legacy-work", title: "合成旧快照", dueAt: new Date("2027-02-05T08:00:00+08:00") };
    Reflect.deleteProperty(old, "duePrecision"); // 真实旧快照没有此键；不从当前 Deadline 补写。
    data.handovers = [{ id: "handover", matterId, title: "合成交接", fromName: "合成甲", toName: "合成乙", fromUserId: "actor", toUserId: "recipient", initiatedById: "actor", status: "ACCEPTED", reason: "固定历史", emergency: false, revision: 0, createdAt: original.updatedAt,
      snapshot: { work: [{ ...work(), title: "合成日期快照", dueAt: new Date("2027-02-05T00:00:00+08:00"), duePrecision: "DATE" }, old], procedures: [], pendingReceipts: [], invoices: [], seals: [] } }];
    render(<WorkResponsibilityPanel data={data} matterId={matterId} />);
    const snapshot = screen.getByText(/固定交接清单：2 项待办/).closest("details")!;
    fireEvent.click(within(snapshot).getByText(/固定交接清单/));
    expect(within(snapshot).getByText(/合成日期快照/)).toHaveTextContent("2027-02-05 · 原责任人");
    expect(within(snapshot).getByText(/合成旧快照/)).toHaveTextContent("2027-02-05 · 时间精度未记录");
    expect(snapshot.textContent).not.toMatch(/00:00|08:00|17:00/);
  });
});
