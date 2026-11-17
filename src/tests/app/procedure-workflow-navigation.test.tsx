import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ upload: vi.fn(), ensureStage: vi.fn(), removeStage: vi.fn(), confirm: vi.fn(), refresh: vi.fn(), scroll: vi.fn(), search: "", listeners: new Set<() => void>() }));
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
vi.mock("@/server/tasks/actions", () => ({ createTask: vi.fn() }));
vi.mock("@/components/matters/task-work-panel", () => ({
  TaskWorkPanel: ({ matterId, selectedTaskId, onTaskSelect, onTaskCreated }: { matterId: string; selectedTaskId: string | null; onTaskSelect: (id: string | null) => void; onTaskCreated: (id: string, stageId: string | null) => void }) => <section aria-label="事项任务">
    <span>全案任务：{matterId}</span><span>当前任务：{selectedTaskId ?? "未选择"}</span>
    <button onClick={() => onTaskSelect("task-1")}>打开合成任务</button><button onClick={() => onTaskCreated("task-created", null)}>创建合成任务</button>
  </section>
}));
vi.mock("@/server/procedures/actions", () => ({ createProcedureStage: vi.fn(), deleteProcedureMemo: vi.fn(), ensureProcedureStage: mock.ensureStage, removeProcedureStage: mock.removeStage, toggleDeadlineCompleted: vi.fn(), toggleProcedureMemo: vi.fn() }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/server/express/actions", () => ({ deleteExpress: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({ liftProperty: vi.fn() }));
vi.mock("@/server/deadlines/confirm", () => ({ confirmDeadline: vi.fn() }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-forms", () => ({ AddDeadlineDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-content", () => ({ AdjustDeadlineDialog: () => null }));
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
  notes, timelineEvents: [], onWriteNote: vi.fn(), archiveNode: <p>合成档案内容</p>
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

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const replaceState = window.history.replaceState.bind(window.history);
const pushState = window.history.pushState.bind(window.history);
beforeEach(() => {
  vi.clearAllMocks();
  mock.confirm.mockResolvedValue(true);
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
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案范围" })).getByRole("button", { name: /合成其他环节/ }));
    await act(async () => finish({ hidden: true }));
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-stage-2");
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("取消唯一任务不会把该环节显示为已完成", () => {
    const cancelled = {
      ...procedure,
      stages: [{ ...procedure.stages[0], tasks: [{ ...procedure.stages[0].tasks[0], completed: true, responsibility: { state: "CANCELLED" as const, closedAt: date } }] }]
    };
    render(<Harness initialView="work" procedure={cancelled} />);
    expect(screen.getByRole("button", { name: /合成当前环节/ })).not.toHaveAttribute("title", expect.stringContaining("已完成"));
    expect(screen.getByRole("button", { name: /合成当前环节/ })).toHaveAttribute("title", expect.stringContaining("进行中"));
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
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案范围" })).getAllByRole("button").find(button => button.title.includes("未记录进度"))!);
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
    const stageButton = within(screen.getByRole("navigation", { name: "办案范围" })).getAllByRole("button").find(button => button.title.includes("未记录进度"))!;
    fireEvent.click(stageButton);
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
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案范围" })).getAllByRole("button").find(button => button.title.includes("未记录进度"))!);
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
    expect(screen.getByRole("navigation", { name: "办案范围" })).toBeVisible();
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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "材料" }), { button: 0, ctrlKey: false });
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案范围" })).getByRole("button", { name: /^合成当前环节/ }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("region", { name: "记录" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "环节：合成其他环节" })).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("workPane")).toBe("records");
    expect(new URLSearchParams(window.location.search).get("procedure")).toBe("procedure-1");
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-stage-2");
    expect(new URLSearchParams(window.location.search).get("source")).toBe("test");
    expect(window.location.hash).toBe("#work");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "材料" }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole("region", { name: "记录" })).not.toBeInTheDocument();
  });

  it("从现行地址恢复全案记录及材料环节，不读取旧scope参数", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records&stage=stage-stage-2&recordsExpanded=1");
    render(<Harness initialView="work" />);
    expect(screen.getByRole("tab", { name: "办理记录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("全案记录 · 全部程序")).toBeVisible();
    expect(screen.getByText("合成其他环节记录内容")).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "材料" }), { button: 0, ctrlKey: false });
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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "待办" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("region", { name: "待办" })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
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

  it("页头上传草稿打开后切换环节不能改写上传目标", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=materials&stage=stage-stage-1");
    const apiRef: NonNullable<Props["apiRef"]> = { current: null };
    render(<Harness initialView="work" canManage apiRef={apiRef} />);
    act(() => apiRef.current?.openUpload());
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

  it("未绑定环节的材料不因名称或标签相同被算作该环节材料", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "未归属环节" }));
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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "材料" }), { button: 0, ctrlKey: false });
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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
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
    fireEvent.mouseDown(materialsTab, { button: 0, ctrlKey: false });
    expect(materialCard().getByText("没有符合筛选条件的材料")).toBeVisible();
  });

  it("未选择环节时显示程序全部材料，不从未完成任务推定当前环节", () => {
    render(<Harness initialView="work" procedure={{ ...procedure, stages: procedure.stages.map(stage => ({ ...stage, startedAt: null })) }} />);
    expect(screen.getByRole("button", { name: "全部环节" })).toBeVisible();
    expect(screen.queryByRole("region", { name: /环节：/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /合成当前环节/ })).toHaveAttribute("title", expect.stringContaining("未记录进度"));
  });

  it("过了计划开庭时间仍不宣称已经开庭", () => {
    window.history.replaceState(null, "", "/matters/matter-1?workPane=records");
    render(<Harness initialView="work" allProcedures={[{ ...procedure, hearings: [{ id: "hearing-past", title: "合成待核庭期", room: null, address: null, startsAt: new Date("2020-01-01") }] }]} />);
    expect(screen.getByText("开庭计划：合成待核庭期")).toBeVisible();
    expect(screen.getByText("计划时间已过，实际结果尚未记录。")).toBeVisible();
    expect(screen.queryByText(/已开庭：/)).not.toBeInTheDocument();
  });

});
