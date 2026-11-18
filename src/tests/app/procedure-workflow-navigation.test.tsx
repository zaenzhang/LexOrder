import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ upload: vi.fn(), ensureStage: vi.fn(), removeStage: vi.fn(), confirm: vi.fn(), refresh: vi.fn(), scroll: vi.fn(), changeWork: vi.fn(), confirmDeadline: vi.fn(), completeDeadline: vi.fn(), adjustDialog: vi.fn(), error: vi.fn(), search: "", listeners: new Set<() => void>() }));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ refresh: mock.refresh }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(
      (listener) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener); },
      () => mock.search,
      () => mock.search
    ))
  };
});

vi.mock("@/server/documents/actions", () => ({ uploadDocument: mock.upload }));
vi.mock("@/server/documents/ingest-actions", () => ({ getMaterialUploadReceipt: vi.fn(), continueMaterialUpload: vi.fn(), closeMaterialUpload: vi.fn() }));
vi.mock("@/components/matters/context-input-picker", () => ({ ContextInputPicker: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/material-processing-status", () => ({ MaterialProcessingStatus: () => null }));
vi.mock("@/server/tasks/actions", () => ({ createTask: vi.fn(), completeTasksBatch: vi.fn() }));
vi.mock("@/server/reminders/work-actions", () => ({ getWorkBoard: vi.fn(), changeWork: mock.changeWork, requestHandover: vi.fn(), decideHandover: vi.fn(), refreshHandover: vi.fn(), createUrgent: vi.fn() }));
vi.mock("@/components/matters/task-detail-dialog", () => ({ TaskDetailDialog: () => null }));
vi.mock("@/components/matters/intake-handover-panel", () => ({ IntakeHandoverPanel: () => null }));
vi.mock("@douyinfe/semi-ui", async (load) => ({ ...await load<typeof import("@douyinfe/semi-ui")>(), Toast: { success: vi.fn(), error: mock.error }, Notification: { success: vi.fn(), error: mock.error } }));
vi.mock("@/components/matters/task-work-panel", () => ({
  TaskWorkPanel: ({ matterId, selectedTaskId, onTaskSelect, onTaskCreated }: { matterId: string; selectedTaskId: string | null; onTaskSelect: (id: string | null) => void; onTaskCreated: (id: string, stageId: string | null) => void }) => <section aria-label="事项任务">
    <span>全案任务：{matterId}</span><span>当前任务：{selectedTaskId ?? "未选择"}</span>
    <button onClick={() => onTaskSelect("task-1")}>打开合成任务</button><button onClick={() => onTaskCreated("task-created", null)}>创建合成任务</button>
  </section>
}));
vi.mock("@/server/procedures/actions", () => ({ createProcedureStage: vi.fn(), deleteProcedureMemo: vi.fn(), ensureProcedureStage: mock.ensureStage, removeProcedureStage: mock.removeStage, toggleDeadlineCompleted: mock.completeDeadline, toggleProcedureMemo: vi.fn() }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/server/express/actions", () => ({ deleteExpress: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({ liftProperty: vi.fn() }));
vi.mock("@/server/deadlines/confirm", () => ({ confirmDeadline: mock.confirmDeadline }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-forms", () => ({ AddDeadlineDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-content", () => ({ AdjustDeadlineDialog: (props: { deadline: unknown; onClose: () => void }) => {
  mock.adjustDialog(props);
  return <div role="dialog" aria-label="日期调整入参"><button onClick={props.onClose}>关闭日期入参</button></div>;
} }));
vi.mock("@/app/(app)/matters/[id]/_components/template-picker-dialog", () => ({ TemplatePickerDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/evidence-panel", () => ({ EvidencePoints: () => null }));
vi.mock("@/app/(app)/preservation/_components/preservation-dialog", () => ({ PreservationCaseDialog: () => null, AddTargetDialog: () => null, AddPropertyDialog: () => null, RenewPropertyDialog: () => null }));

import { ProcedureWorkflowPanel } from "@/app/(app)/matters/[id]/_components/procedure-workflow-panel";

import type { DossierView } from "@/lib/matters/dossier-location";

type Props = React.ComponentProps<typeof ProcedureWorkflowPanel>;
const date = new Date("2026-11-16T01:00:00.000Z");
const procedure: NonNullable<Props["procedure"]> = {
  id: "procedure-1", type: "FIRST_INSTANCE", customLabel: "合成一审程序", caseNumber: null,
  acceptedAt: null, concludedAt: null, status: "IN_PROGRESS", deadlines: [], hearings: [], procedureParties: [],
  stages: ["合成当前环节", "合成其他环节"].map((name, index) => ({
    id: `stage-${index + 1}`, name, description: null, order: index, status: "ACTIVE", startedAt: date, completedAt: null,
    tasks: [{ id: `task-${index + 1}`, title: index === 0 ? "合成当前待办" : "合成其他环节待办", description: null,
      dueAt: null, completed: false, completedAt: null, priority: 0, stageId: `stage-${index + 1}`, assigneeId: null, responsibility: { state: "OPEN", closedAt: null } }]
  }))
};
const notes: Props["notes"] = ["合成当前环节", "合成其他环节"].map((stage, index) => ({
  id: `note-${index}`, channel: "PHONE", withWhom: null, occurredAt: date, updatedAt: date,
  content: index === 0 ? "合成当前环节记录内容" : "合成其他环节记录内容",
  tags: [`环节:${stage}`], author: { id: "author-1", name: "合成经办人" }
}));
const base: Omit<Props, "view" | "onViewChange"> = {
  matter: { id: "matter-1", internalCode: "A2026001", title: "合成事项", category: "CIVIL_COMMERCIAL" },
  procedure, allProcedures: [procedure], documents: [], folders: [], templates: [], users: [], canManage: false, canWriteRecords: false, canWriteTasks: false, canWriteMaterials: false, canReadSchedule: true,
  notes, timelineEvents: [], onWriteNote: vi.fn(), archiveNode: <p>合成档案内容</p>, workBoard: null
};

function Harness({ initialView = "archive", ...overrides }: Partial<Props> & { initialView?: DossierView }) {
  const [view, setView] = useState<DossierView>(initialView);
  return <ProcedureWorkflowPanel {...base} canWriteMaterials={overrides.canManage ?? base.canWriteMaterials} {...overrides} view={view} onViewChange={setView} />;
}

function materialCard() {
  const card = screen.getByRole("button", { name: "上传" }).closest(".card");
  if (!card) throw new Error("材料区域缺失");
  return within(card as HTMLElement);
}

async function chooseStage(option: RegExp) {
  const select = screen.getByRole("combobox", { name: "环节范围" });
  fireEvent.click(select);
  await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "true"));
  const options = await screen.findAllByRole("option", { name: option });
  fireEvent.click(options[0]);
}

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const replaceState = window.history.replaceState.bind(window.history);
const pushState = window.history.pushState.bind(window.history);
beforeEach(() => {
  vi.clearAllMocks();
  mock.confirm.mockResolvedValue(true);
  mock.changeWork.mockReset().mockResolvedValue({ ok: true });
  mock.confirmDeadline.mockReset().mockResolvedValue({ ok: true });
  mock.completeDeadline.mockReset().mockResolvedValue({ ok: true });
  replaceState(null, "", "/matters/matter-1");
  mock.search = "";
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replaceState(data, unused, url);
    mock.search = window.location.search;
    for (const listener of mock.listeners) listener();
  });
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => {
    pushState(data, unused, url);
    mock.search = window.location.search;
    for (const listener of mock.listeners) listener();
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mock.scroll });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("事项工作区入口与材料范围（组件环境）", () => {
  it("移除旧环节的迟到响应不会清空新选中的环节", async () => {
    let finish!: (value: { hidden: boolean }) => void;
    mock.removeStage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    render(<Harness initialView="work" canWriteTasks />);
    fireEvent.click(screen.getByRole("button", { name: "移除环节" }));
    await waitFor(() => expect(mock.removeStage).toHaveBeenCalledWith({ id: "stage-1" }));
    await chooseStage(/合成其他环节/);
    await act(async () => finish({ hidden: true }));
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-stage-2");
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("取消唯一任务不会把该环节显示为已完成", async () => {
    const cancelled = {
      ...procedure,
      stages: [{ ...procedure.stages[0], tasks: [{ ...procedure.stages[0].tasks[0], completed: true, responsibility: { state: "CANCELLED" as const, closedAt: date } }] }]
    };
    render(<Harness initialView="work" procedure={cancelled} />);
    fireEvent.click(screen.getByRole("combobox", { name: "环节范围" }));
    expect(await screen.findByRole("option", { name: /合成当前环节.*开始/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /合成当前环节.*已完成/ })).not.toBeInTheDocument();
  });

  it("所选真实环节可进入任务创建，失效环节不展示材料操作", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    render(<Harness initialView="work" canWriteTasks />);
    fireEvent.click(screen.getByRole("button", { name: "为此环节新建任务" }));
    expect(screen.getByRole("tab", { name: "待办" })).toHaveAttribute("aria-selected", "true");
    cleanup();
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=invalid");
    render(<Harness initialView="work" canManage canWriteTasks materialsActions={<button>材料工具</button>} />);
    expect(screen.getByText("指定环节不可用。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "材料工具" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "为此环节新建任务" })).not.toBeInTheDocument();
  });

  it("新程序的虚拟环节可显式启用并定位到真实环节", async () => {
    mock.ensureStage.mockResolvedValue({ id: "created-stage", created: true });
    render(<Harness initialView="work" canManage canWriteTasks procedure={{ ...procedure, stages: [] }} />);
    await chooseStage(/尚未启用/);
    fireEvent.click(screen.getByRole("button", { name: "启用此环节" }));
    await waitFor(() => expect(mock.ensureStage).toHaveBeenCalledWith(expect.objectContaining({ procedureId: procedure.id })));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-created-stage"));
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("G04 虚拟环节建立触发真实 stages 父层刷新后，批次仍接续真实 ID 且只 ensure 一次", async () => {
    let finish!: (value: { id: string; created: boolean }) => void;
    mock.ensureStage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mock.upload.mockImplementation(async () => ({ ok: true, id: `saved-${mock.upload.mock.calls.length}` }));
    const virtual = { ...procedure, stages: [] };
    const view = render(<Harness initialView="work" canManage procedure={virtual} allProcedures={[virtual]} />);
    await chooseStage(/尚未启用/);
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^文件 \*/), { target: { files: [new File(["甲"], "甲.txt", { type: "text/plain" }), new File(["乙"], "乙.txt", { type: "text/plain" })] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    await waitFor(() => expect(mock.ensureStage).toHaveBeenCalledOnce());
    const actual = { ...procedure, stages: [{ ...procedure.stages[0], id: "materialized-stage", name: mock.ensureStage.mock.calls[0][0].name }] };
    // The real action revalidates before returning: server props may change while the old default URL remains.
    view.rerender(<Harness initialView="work" canManage procedure={actual} allProcedures={[actual]} />);
    expect(new URLSearchParams(window.location.search).get("stage")).toMatch(/^default-/);
    await act(async () => finish({ id: "materialized-stage", created: true }));
    await screen.findByText("2 份 · 已保存 2 份");
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-materialized-stage");
    expect(mock.ensureStage).toHaveBeenCalledOnce(); expect(mock.upload).toHaveBeenCalledTimes(2);
    for (const [form] of mock.upload.mock.calls) expect((form as FormData).get("stageId")).toBe("materialized-stage");
    expect(within(dialog).queryByText(/上传范围已变化/)).not.toBeInTheDocument();
  });

  it("G04 ensure 期间用户已切走时不抢回导航，保留返回的真实环节供显式接续", async () => {
    let finish!: (value: { id: string; created: boolean }) => void;
    mock.ensureStage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mock.upload.mockResolvedValue({ ok: true, id: "saved-returned" });
    const virtual = { ...procedure, stages: [] };
    const view = render(<Harness initialView="work" canManage procedure={virtual} allProcedures={[virtual]} />);
    await chooseStage(/尚未启用/);
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^文件 \*/), { target: { files: [new File(["甲"], "甲.txt", { type: "text/plain" })] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    await waitFor(() => expect(mock.ensureStage).toHaveBeenCalledOnce());
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?workPane=materials"); });
    const actual = { ...procedure, stages: [{ ...procedure.stages[0], id: "materialized-stage", name: mock.ensureStage.mock.calls[0][0].name }] };
    view.rerender(<Harness initialView="work" canManage procedure={actual} allProcedures={[actual]} />);
    await act(async () => finish({ id: "materialized-stage", created: true }));
    expect(new URLSearchParams(window.location.search).get("stage")).toBeNull(); expect(mock.upload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回上传范围" }));
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-materialized-stage");
    expect(mock.upload).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("button", { name: "继续上传" }));
    await screen.findByText("1 份 · 已保存 1 份"); expect(mock.ensureStage).toHaveBeenCalledOnce();
    expect((mock.upload.mock.calls[0][0] as FormData).get("stageId")).toBe("materialized-stage");
  });

  it("具有案件维护资格但没有记录写入资格时，只保留获准的快递入口", async () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records");
    const onAddLedger = vi.fn();
    render(<Harness initialView="work" canManage canWriteRecords={false} onAddLedger={onAddLedger} />);
    const records = screen.getByRole("region", { name: "记录" });
    const add = within(records).getByRole("button", { name: "记录" });
    add.focus();
    fireEvent.keyDown(add, { key: "Enter" });
    const express = await screen.findByRole("menuitem", { name: /^快递/ });
    expect(screen.queryByRole("menuitem", { name: /^沟通/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^研判/ })).not.toBeInTheDocument();
    fireEvent.click(express);
    expect(onAddLedger).toHaveBeenCalledWith("express");
    expect(base.onWriteNote).not.toHaveBeenCalled();
  });

  it("有记录写入资格时沟通与研判入口正常，全案记录不默认附带环节", async () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records");
    const onWriteNote = vi.fn();
    render(<Harness initialView="work" canManage canWriteRecords onWriteNote={onWriteNote} />);
    const records = screen.getByRole("region", { name: "记录" });
    const add = within(records).getByRole("button", { name: "记录" });
    add.focus();
    fireEvent.keyDown(add, { key: "Enter" });
    const communication = await screen.findByRole("menuitem", { name: /^沟通/ });
    expect(screen.getByRole("menuitem", { name: /^研判/ })).toBeVisible();
    fireEvent.click(communication);
    expect(onWriteNote).toHaveBeenCalledWith({ judgment: false });
  });

  it("名称相同的笔记标签不被当成环节关联", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    render(<Harness initialView="work" notes={notes.map(note => ({ ...note, tags: [...note.tags, "研判笔记"] }))} />);
    const stage = screen.getByRole("region", { name: "环节：合成当前环节" });
    expect(within(stage).queryByText(/研判 [0-9]/)).not.toBeInTheDocument();
  });

  it("零程序保留日程空态和全案任务入口，不假报全部任务为空", () => {
    render(<Harness procedure={null} notes={[]} />);
    expect(screen.getByRole("tab", { name: "档案与摘要" })).toBeVisible();
    expect(screen.getByText("当前范围没有未结日程或审批")).toBeVisible();
    expect(screen.getByText("暂无记录")).toBeVisible();
    expect(screen.getByRole("button", { name: "查看全部任务与日程" })).toBeVisible();
  });

  it("查看全部任务切换到全案任务并聚焦工作区，不显示环节任务副本", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部任务与日程" }));
    const todo = await screen.findByRole("region", { name: "待办" });
    expect(screen.getByRole("tab", { name: /^办案与材料/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "待办" })).toHaveAttribute("aria-selected", "true");
    expect(within(todo).getByText("全案任务：matter-1")).toBeVisible();
    expect(screen.queryByText("合成当前待办")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "办案范围" })).toBeVisible();
    await waitFor(() => expect(todo).toHaveFocus());
    expect(mock.scroll.mock.contexts.at(-1)).toBe(todo);
  });

  it("办理记录保持全案，材料的环节选择不截掉其他环节记录", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^查看全部记录/ }));
    const records = await screen.findByRole("region", { name: "记录" });
    expect(screen.getByRole("tab", { name: "办理记录" })).toHaveAttribute("aria-selected", "true");
    expect(within(records).getByText("合成当前环节记录内容")).toBeVisible();
    expect(within(records).getByText("合成其他环节记录内容")).toBeVisible();
    await waitFor(() => expect(records).toHaveFocus());
    fireEvent.click(screen.getByRole("tab", { name: "材料" }));
    await chooseStage(/合成当前环节/);
    fireEvent.click(screen.getByRole("tab", { name: "办理记录" }));
    expect(within(records).getByText("合成其他环节记录内容")).toBeVisible();
  });

  it("无程序时材料空态和上传说明均指向事项，不虚构当前环节", () => {
    render(<Harness initialView="work" procedure={null} notes={[]} canManage />);
    expect(materialCard().getByText("本事项暂无材料")).toBeVisible();
    expect(materialCard().getByText("文件将保存到当前事项，可逐件选择程序和环节。")).toBeVisible();
    expect(screen.queryByText("本环节暂无材料")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 事项材料" });
    expect(within(dialog).getByText("逐件核对归属和来源，文件分别保存。")).toBeVisible();
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("工作区切换保留环节与其他地址参数，只显示当前业务", () => {
    window.history.replaceState(null, "", "/matters/matter-1?procedure=procedure-1&stage=stage-stage-2&source=test#work");
    render(<Harness initialView="work" />);
    fireEvent.click(screen.getByRole("tab", { name: "办理记录" }));
    expect(screen.getByRole("region", { name: "记录" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "环节：合成其他环节" })).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("workPane")).toBe("records");
    expect(new URLSearchParams(window.location.search).get("procedure")).toBe("procedure-1");
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-stage-2");
    expect(new URLSearchParams(window.location.search).get("source")).toBe("test");
    expect(window.location.hash).toBe("#work");
    fireEvent.click(screen.getByRole("tab", { name: "材料" }));
    expect(screen.queryByRole("region", { name: "记录" })).not.toBeInTheDocument();
  });

  it("从现行地址恢复全案记录及材料环节，不读取旧scope参数", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records&stage=stage-stage-2&recordsExpanded=1");
    render(<Harness initialView="work" />);
    expect(screen.getByRole("tab", { name: "办理记录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("全案记录 · 全部程序")).toBeVisible();
    expect(screen.getByText("合成其他环节记录内容")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "材料" }));
    expect(screen.getByRole("region", { name: "环节：合成其他环节" })).toBeVisible();
  });

  it("失效工作区或环节显示不可用，不替换成默认对象", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=unknown&stage=another-matter-stage");
    render(<Harness initialView="work" />);
    expect(screen.getByText("指定工作区不可用，请选择上方工作区。")).toBeVisible();
    expect(screen.getByText("指定环节不可用。")).toBeVisible();
    expect(screen.getByRole("tab", { name: "材料" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("region", { name: "环节：合成当前环节" })).not.toBeInTheDocument();
  });

  it("事项任务保存后进入全案并绑定原Task", () => {
    window.history.replaceState(null, "", "/matters/matter-1?view=work&workPane=tasks&task=task-existing&stage=stage-stage-2");
    render(<Harness initialView="work" />);
    expect(screen.getByText("当前任务：task-existing")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "创建合成任务" }));
    expect(new URLSearchParams(window.location.search).get("task")).toBe("task-created");
    expect(new URLSearchParams(window.location.search).get("stage")).toBeNull();
    expect(screen.getByText("当前任务：task-created")).toBeVisible();
  });

  it("无程序也可切换事项与期限、办理记录", () => {
    render(<Harness initialView="work" procedure={null} notes={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "待办" }));
    expect(screen.getByRole("region", { name: "待办" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "办理记录" }));
    expect(screen.getByRole("region", { name: "记录" })).toBeVisible();
  });

  it("上传草稿不因工作区变化清除", () => {
    render(<Harness initialView="work" procedure={null} notes={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 事项材料" });
    fireEvent.change(within(dialog).getByLabelText(/^文件 \*/), { target: { files: [new File(["合成"], "草稿.txt", { type: "text/plain" })] } });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "合成上传草稿" } });
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?workPane=tasks"); });
    expect(screen.getByRole("dialog", { name: "上传材料 · 事项材料" })).toBe(dialog);
    expect(within(dialog).getByRole("textbox")).toHaveValue("合成上传草稿");
  });

  it("材料区上传草稿打开后切换环节不能改写上传目标", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    render(<Harness initialView="work" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 合成当前环节" });
    fireEvent.change(within(dialog).getByLabelText(/^文件 \*/), { target: { files: [new File(["内容"], "材料.txt", { type: "text/plain" })] } });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "保留的草稿" } });
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-2"); });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("上传范围已变化");
    expect(within(dialog).getByRole("button", { name: "继续上传" })).toBeDisabled();
    expect(within(dialog).getByRole("textbox")).toHaveValue("保留的草稿");
    expect(mock.upload).not.toHaveBeenCalled();
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1"); });
    expect(within(dialog).getByRole("button", { name: "继续上传" })).toBeEnabled();
  });

  it("真实环节材料空态保留准确归属说明", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    render(<Harness initialView="work" canManage />);
    expect(materialCard().getByText("本环节暂无材料")).toBeVisible();
    expect(materialCard().getByText("文件默认关联到当前程序和环节，可逐件调整。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 合成当前环节" });
    expect(within(dialog).getByText("逐件核对归属和来源，文件分别保存。")).toBeVisible();
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("未绑定环节的材料不因名称或标签相同被算作该环节材料", async () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    const unassigned: Props["documents"][number] = {
      id: "doc-unassigned", name: "合成当前环节材料.txt", category: "PLEADING", mimeType: "text/plain", size: 10, createdAt: date,
      sourceParty: null, tags: ["阶段:合成当前环节"], stageId: null, procedureId: "procedure-1", sourceOrigin: "SELF_COLLECTED",
      ocrStatus: "READY", textSource: "MANUAL", pageCount: null, sha256: null, templateId: null, version: 1, familyId: null, isLatest: true
    };
    render(<Harness initialView="work" canManage documents={[unassigned]} />);
    expect(materialCard().getByText("本环节暂无材料")).toBeVisible();
    expect(materialCard().queryByText("合成当前环节材料.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("合成当前环节材料.txt")).not.toBeInTheDocument();
    await chooseStage(/未归属环节/);
    expect(screen.getByText("合成当前环节材料.txt")).toBeVisible();
  });

  it("已有材料但筛选无命中时说明筛选结果，不声称材料为空", () => {
    const document: Props["documents"][number] = {
      id: "doc-1", name: "合成文书.txt", category: "PLEADING", mimeType: "text/plain", size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: "stage-1", procedureId: "procedure-1", sourceOrigin: "SELF_COLLECTED",
      ocrStatus: "READY", textSource: "MANUAL", pageCount: null, sha256: null, templateId: null, version: 1, familyId: null, isLatest: true
    };
    render(<Harness initialView="work" canManage documents={[document, { ...document, id: "doc-2", name: "合成证据.txt", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED" }]} />);
    const card = materialCard();
    fireEvent.click(card.getByRole("button", { name: "文书 1" }));
    fireEvent.click(card.getByRole("button", { name: /当事人提供 1/ }));
    expect(card.getByText("没有符合筛选条件的材料")).toBeVisible();
    expect(card.getByText("调整上方筛选条件可查看其他材料。")).toBeVisible();
    expect(card.queryByText("本环节暂无材料")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "办理记录" }));
    fireEvent.click(screen.getByRole("tab", { name: "材料" }));
    expect(materialCard().getByText("没有符合筛选条件的材料")).toBeVisible();
  });

  it("首次进入前不挂载工作区，无程序时跨档案和财务返回仍保留材料与记录筛选", () => {
    const document: Props["documents"][number] = {
      id: "doc-1", name: "合成文书.txt", category: "PLEADING", mimeType: "text/plain", size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: null, procedureId: null, sourceOrigin: "SELF_COLLECTED",
      ocrStatus: "READY", textSource: "MANUAL", pageCount: null, sha256: null, templateId: null, version: 1, familyId: null, isLatest: true
    };
    render(<Harness procedure={null} canManage financeNode={<p>合成财务内容</p>}
      documents={[document, { ...document, id: "doc-2", name: "合成证据.txt", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED" }]} />);
    expect(screen.queryByRole("tab", { name: "材料", hidden: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "办案与材料" }));
    const materialsTab = screen.getByRole("tab", { name: "材料" });
    fireEvent.click(materialCard().getByRole("button", { name: "文书 1" }));
    fireEvent.click(materialCard().getByRole("button", { name: /当事人提供 1/ }));
    fireEvent.click(screen.getByRole("tab", { name: "办理记录" }));
    const records = screen.getByRole("region", { name: "记录" });
    fireEvent.click(within(records).getByRole("button", { name: "研判" }));

    fireEvent.click(screen.getByRole("tab", { name: "档案与摘要" }));
    expect(materialsTab).toBeInTheDocument();
    expect(materialsTab).not.toBeVisible();
    expect(records).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "办案与材料" }));
    expect(screen.getByRole("region", { name: "记录" })).toBe(records);
    expect(within(records).getByRole("button", { name: "研判" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("tab", { name: "委托与财务" }));
    expect(screen.getByText("合成财务内容")).toBeVisible();
    expect(records).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "办案与材料" }));
    expect(within(records).getByRole("button", { name: "研判" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(materialsTab);
    expect(materialCard().getByText("没有符合筛选条件的材料")).toBeVisible();
  });

  it("未选择环节时显示程序全部材料，不从未完成任务推定当前环节", async () => {
    render(<Harness initialView="work" procedure={{ ...procedure, stages: procedure.stages.map(stage => ({ ...stage, startedAt: null })) }} />);
    expect(screen.getByRole("combobox", { name: "环节范围" })).toHaveTextContent("全部环节");
    expect(screen.queryByRole("region", { name: /环节：/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "环节范围" }));
    expect(await screen.findByRole("option", { name: /合成当前环节.*未记录进度/ })).toBeVisible();
  });

  it("过了计划开庭时间仍不宣称已经开庭", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records");
    render(<Harness initialView="work" allProcedures={[{ ...procedure, hearings: [{ id: "hearing-past", title: "合成待核庭期", room: null, address: null, startsAt: new Date("2020-01-01") }] }]} />);
    expect(screen.getByText("开庭计划：合成待核庭期")).toBeVisible();
    expect(screen.getByText("计划时间已过，实际结果尚未记录。")).toBeVisible();
    expect(screen.queryByText(/已开庭：/)).not.toBeInTheDocument();
  });

});

type ResponsibilityBoard = NonNullable<Props["workBoard"]>;
const scheduleDate = new Date("2099-02-05T09:00:03.456Z");
function deadline(id = "shared-target"): NonNullable<Props["procedure"]>["deadlines"][number] {
  return { id, title: "同名日程", updatedAt: date, dueAt: scheduleDate, duePrecision: "DATETIME", category: "CUSTOM", basis: "合成来件", remindDays: 3, completed: false, confirmStatus: "PENDING" };
}
function scheduleProcedure(id = "procedure-1"): NonNullable<Props["procedure"]> {
  return { ...procedure, id, deadlines: [deadline()], hearings: [{ id: "shared-target", title: "同名日程", startsAt: scheduleDate, room: null, address: null }] };
}
function responsibility(kind: "Deadline" | "Hearing", targetId = "shared-target", overrides: Partial<ResponsibilityBoard["items"][number]> = {}): ResponsibilityBoard["items"][number] {
  return { id: `work-${kind}-${targetId}`, kind, targetId, title: "同名日程", dueAt: scheduleDate, duePrecision: kind === "Deadline" ? "DATETIME" : null,
    matterId: "matter-1", intakeId: null, assigneeId: "actor", name: kind === "Deadline" ? "期限经办人" : "庭期经办人", active: true,
    proposedAssigneeId: null, proposedName: null, acceptedAt: null, state: "OPEN", revision: 2, reason: null, taskHref: null, taskProgress: null, ...overrides };
}
function responsibilities(items: ResponsibilityBoard["items"], overrides: Partial<ResponsibilityBoard> = {}): ResponsibilityBoard {
  return { currentUserId: "actor", emergency: false, canWrite: true, canTransfer: false, items, people: [], matters: [], intakes: [], handovers: [], intakeHandovers: [], ...overrides };
}
function responsibilitySection() {
  return screen.getByRole("heading", { name: "事项责任与交接" }).closest("section")!;
}
function scheduleRow(name: string) {
  return within(screen.getByRole("region", { name: "期限与庭期" })).getByText(new RegExp(`责任人：${name}`)).closest(".dos-act") as HTMLElement;
}

describe("D03真实工作区与责任板组合；业务Action边界受控", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/matters/matter-1?view=work&workPane=tasks"); });

  it("同名同刻按真实kind与ID匹配；换程序/全案后其他责任、备忘、等待及固定历史仍可达", () => {
    const first = { ...scheduleProcedure(), memos: [{ id: "memo-1", content: "旧备忘仍保留", createdAt: date, done: false, doneAt: null }] };
    const second = { ...procedure, id: "procedure-2", customLabel: "另一程序", deadlines: [deadline("other-target")], hearings: [] };
    const firstWork = responsibility("Deadline"), hearingWork = responsibility("Hearing");
    const otherWork = responsibility("Deadline", "other-target", { name: "另一程序经办" });
    const orphan = responsibility("Deadline", "unmatched-target", { name: "未匹配经办" });
    const done = responsibility("Deadline", "closed-target", { state: "DONE", name: "已办结经办" });
    const data = responsibilities([firstWork, hearingWork, otherWork, orphan, done], { handovers: [{ id: "handover-1", matterId: "matter-1", title: "合成交接", fromName: "旧主办", toName: "新主办", fromUserId: "previous", toUserId: "actor", initiatedById: "previous", status: "ACCEPTED", reason: "固定交接理由", emergency: false, revision: 1, createdAt: date,
      snapshot: { work: [{ ...firstWork, title: "快照期限定稿", name: "快照原责任人" }], procedures: [{ id: first.id, customLabel: first.customLabel }], pendingReceipts: [], invoices: [], seals: [] } }] });
    const props = { initialView: "work" as const, workBoard: data, allProcedures: [first, second], waiting: [{ key: "waiting-1", title: "独立审批等待", meta: "未处理" }] };
    const view = render(<Harness {...props} procedure={first} />);
    expect(scheduleRow("期限经办人")).toBeVisible();
    expect(scheduleRow("庭期经办人")).toBeVisible();
    expect(within(responsibilitySection()).queryByText(/责任人：期限经办人/)).not.toBeInTheDocument();
    expect(within(responsibilitySection()).getByText(/责任人：另一程序经办/)).toBeVisible();
    expect(within(responsibilitySection()).getByText(/责任人：未匹配经办/)).toBeVisible();
    expect(screen.queryByText(/责任人：已办结经办/)).not.toBeInTheDocument();
    expect(screen.getByText("旧备忘仍保留")).toBeVisible();
    expect(screen.getByText("独立审批等待")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "显示已办结和已取消事项" }));
    expect(screen.getByText(/责任人：已办结经办/)).toBeVisible();
    expect(screen.getByText(/固定交接清单：1 项待办/)).toBeVisible();
    expect(screen.getByText(/快照期限定稿/)).toBeInTheDocument();
    view.rerender(<Harness {...props} procedure={second} />);
    expect(scheduleRow("另一程序经办")).toBeVisible();
    expect(within(responsibilitySection()).getByText(/责任人：期限经办人/)).toBeVisible();
    expect(within(responsibilitySection()).getByText(/责任人：庭期经办人/)).toBeVisible();
    view.rerender(<Harness {...props} procedure={null} />);
    for (const name of ["期限经办人", "庭期经办人", "另一程序经办"]) {
      expect(screen.getAllByText(new RegExp(`责任人：${name}`))).toHaveLength(1);
      expect(scheduleRow(name)).toBeVisible();
    }
    expect(within(responsibilitySection()).getByText(/责任人：未匹配经办/)).toBeVisible();
    expect(screen.getByText(/责任人：已办结经办/)).toBeVisible();
    expect(mock.changeWork).not.toHaveBeenCalled();
  });

  it("折叠仅保唯一可达日程；全匹配空态准确，责任读取null不卸载日程折叠状态", () => {
    const current = scheduleProcedure(), data = responsibilities([responsibility("Deadline"), responsibility("Hearing")]);
    const view = render(<Harness initialView="work" procedure={current} workBoard={data} />);
    expect(screen.getByText("其他责任事项为空，期限与庭期责任见上方对应记录。")).toBeVisible();
    expect(screen.queryByText("当前范围内没有待办事项。")).not.toBeInTheDocument();
    const fold = screen.getByRole("button", { name: /之后 · 2/ });
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/责任人：期限经办人/)).not.toBeInTheDocument();
    expect(screen.queryByText(/责任人：庭期经办人/)).not.toBeInTheDocument();
    view.rerender(<Harness initialView="work" procedure={current} workBoard={null} />);
    expect(screen.getByRole("button", { name: /之后 · 2/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "事项责任与交接" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /之后 · 2/ }));
    expect(within(screen.getByRole("region", { name: "期限与庭期" })).getAllByText("同名日程")).toHaveLength(2);
    view.rerender(<Harness initialView="work" procedure={current} workBoard={data} />);
    expect(screen.getAllByText(/责任人：期限经办人/)).toHaveLength(1);
    expect(screen.getAllByText(/责任人：庭期经办人/)).toHaveLength(1);
  });

  it("日期与承接分别用业务/责任版本；办结失败、换程序及刷新保打开时版本和原因，回已移除入口时聚焦责任标题", async () => {
    const current = { ...scheduleProcedure(), hearings: [] }, work = responsibility("Deadline");
    const data = responsibilities([work]);
    const view = render(<Harness initialView="work" procedure={current} workBoard={data} canWriteTasks />);
    let row = within(scheduleRow("期限经办人"));
    expect(row.queryByRole("button", { name: "完成" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "改期" })).not.toBeInTheDocument();
    fireEvent.click(row.getByRole("button", { name: "确认日期" }));
    await waitFor(() => expect(mock.confirmDeadline).toHaveBeenCalledWith({ id: "shared-target", expectedUpdatedAt: date }));
    fireEvent.click(row.getByRole("button", { name: "确认承接" }));
    await waitFor(() => expect(mock.changeWork).toHaveBeenCalledWith({ id: work.id, revision: 2, action: "ACCEPT" }));
    await waitFor(() => expect(row.getByRole("button", { name: "确认承接" })).toBeEnabled());
    await waitFor(() => expect(row.getByRole("button", { name: "调整日期" })).toBeEnabled());
    fireEvent.click(row.getByRole("button", { name: "调整日期" }));
    expect(mock.adjustDialog.mock.calls.at(-1)?.[0].deadline).toEqual({ id: "shared-target", title: "同名日程", dueAt: scheduleDate, duePrecision: "DATETIME", updatedAt: date });
    fireEvent.click(screen.getByRole("button", { name: "关闭日期入参" }));
    mock.changeWork.mockRejectedValueOnce(new Error("合成旧责任版本冲突")).mockRejectedValueOnce(new Error("合成旧责任版本冲突"));
    row = within(scheduleRow("期限经办人"));
    fireEvent.click(row.getByRole("button", { name: "办结" }));
    fireEvent.change(screen.getByLabelText("依据、处理原因及通知情况"), { target: { value: "核对原责任后办理，保留此原因" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并留痕" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    const expected = { id: work.id, revision: 2, action: "COMPLETE", reason: "核对原责任后办理，保留此原因", assigneeId: undefined };
    expect(mock.changeWork).toHaveBeenLastCalledWith(expected);
    const other = { ...procedure, id: "procedure-2", deadlines: [deadline("other-target")] };
    view.rerender(<Harness initialView="work" procedure={other} allProcedures={[current, other]} workBoard={responsibilities([{ ...work, revision: 9 }])} canWriteTasks />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("依据、处理原因及通知情况")).toHaveValue(expected.reason);
    fireEvent.click(screen.getByRole("button", { name: "保存并留痕" }));
    await waitFor(() => expect(mock.changeWork).toHaveBeenCalledTimes(3));
    expect(mock.changeWork).toHaveBeenLastCalledWith(expected);
    expect(mock.completeDeadline).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存并留痕" })).toBeEnabled());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "事项责任与交接" })).toHaveFocus());
  });

  it("只读匹配仍有责任摘要且不恢复旧完成；无日程读权时保原责任板", () => {
    const current = scheduleProcedure(), data = responsibilities([responsibility("Deadline"), responsibility("Hearing")], { canWrite: false });
    const view = render(<Harness initialView="work" procedure={current} workBoard={data} canWriteTasks />);
    const row = within(scheduleRow("期限经办人"));
    expect(row.queryByRole("button", { name: "确认承接" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "办结" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "完成" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "调整日期" })).toBeVisible();
    view.rerender(<Harness initialView="work" procedure={current} workBoard={data} canReadSchedule={false} />);
    expect(screen.queryByRole("region", { name: "期限与庭期" })).not.toBeInTheDocument();
    expect(within(responsibilitySection()).getByText(/责任人：期限经办人/)).toBeVisible();
    expect(within(responsibilitySection()).getByText(/责任人：庭期经办人/)).toBeVisible();
  });

  it("没有就近日期调整资格时保责任改期；无匹配期限仍沿原完成入口", async () => {
    const current = scheduleProcedure(), data = responsibilities([responsibility("Deadline"), responsibility("Hearing")]);
    const view = render(<Harness initialView="work" procedure={current} workBoard={data} />);
    for (const name of ["期限经办人", "庭期经办人"]) expect(within(scheduleRow(name)).getByRole("button", { name: "改期" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "调整日期" })).not.toBeInTheDocument();
    view.rerender(<Harness initialView="work" procedure={{ ...current, hearings: [] }} workBoard={responsibilities([])} canWriteTasks />);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(mock.completeDeadline).toHaveBeenCalledWith("shared-target"));
    expect(mock.changeWork).not.toHaveBeenCalled();
  });

  it.each(["撤写权", "对象不再可读"] as const)("打开后的%s禁提交且不清原因或换版本", async reason => {
    const current = { ...scheduleProcedure(), hearings: [] }, work = responsibility("Deadline");
    const view = render(<Harness initialView="work" procedure={current} workBoard={responsibilities([work])} />);
    fireEvent.click(within(scheduleRow("期限经办人")).getByRole("button", { name: "办结" }));
    fireEvent.change(screen.getByLabelText("依据、处理原因及通知情况"), { target: { value: "尚未提交的原处理说明" } });
    const next = reason === "撤写权" ? responsibilities([work], { canWrite: false }) : responsibilities([]);
    view.rerender(<Harness initialView="work" procedure={current} workBoard={next} />);
    expect(screen.getByRole("alert")).toHaveTextContent("当前责任或办理资格已变化");
    expect(screen.getByRole("button", { name: "保存并留痕" })).toBeDisabled();
    expect(screen.getByLabelText("依据、处理原因及通知情况")).toHaveValue("尚未提交的原处理说明");
    fireEvent.submit(screen.getByLabelText("依据、处理原因及通知情况").closest("form")!);
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    expect(mock.changeWork).not.toHaveBeenCalled();
  });

  it("已知归档事项只保开放责任的取消，终态历史不提供重新办理", async () => {
    const work = responsibility("Deadline"), closed = responsibility("Deadline", "closed", { state: "DONE", name: "已办结经办" });
    const data = responsibilities([work, closed], { matters: [{ id: "matter-1", internalCode: "A2026001", title: "合成已归档", ownerId: "actor", status: "ARCHIVED", ownerInactive: false,
      owner: { name: "期限经办人", active: true, role: "LAWYER", roleDefinition: null } }] });
    render(<Harness initialView="work" procedure={{ ...scheduleProcedure(), hearings: [] }} workBoard={data} />);
    const row = within(scheduleRow("期限经办人"));
    expect(row.getAllByRole("button").map(button => button.textContent)).toEqual(["取消事项"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "显示已办结和已取消事项" }));
    expect(screen.getByText(/责任人：已办结经办/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新办理" })).not.toBeInTheDocument();
    fireEvent.click(row.getByRole("button", { name: "取消事项" }));
    fireEvent.change(screen.getByLabelText("依据、处理原因及通知情况"), { target: { value: "归档后明确取消未结责任" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并留痕" }));
    await waitFor(() => expect(mock.changeWork).toHaveBeenCalledWith({ id: work.id, revision: 2, action: "CANCEL", reason: "归档后明确取消未结责任", assigneeId: undefined }));
  });
});
