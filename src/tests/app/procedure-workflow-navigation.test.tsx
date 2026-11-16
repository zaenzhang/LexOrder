import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn(), scroll: vi.fn(), search: "", listeners: new Set<() => void>() }));
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
vi.mock("@/server/tasks/actions", () => ({ createTask: vi.fn() }));
vi.mock("@/components/matters/task-work-panel", () => ({
  TaskWorkPanel: ({ matterId, selectedTaskId, onTaskSelect, onTaskCreated }: { matterId: string; selectedTaskId: string | null; onTaskSelect: (id: string | null) => void; onTaskCreated: (id: string) => void }) => <section aria-label="事项任务">
    <span>全案任务：{matterId}</span><span>当前任务：{selectedTaskId ?? "未选择"}</span>
    <button onClick={() => onTaskSelect("task-1")}>打开合成任务</button><button onClick={() => onTaskCreated("task-created")}>创建合成任务</button>
  </section>
}));
vi.mock("@/server/procedures/actions", () => ({ createProcedureStage: vi.fn(), deleteProcedureMemo: vi.fn(), ensureProcedureStage: vi.fn(), removeProcedureStage: vi.fn(), toggleDeadlineCompleted: vi.fn(), toggleProcedureMemo: vi.fn() }));
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
  id: `note-${index}`, channel: "PHONE", withWhom: null, occurredAt: date,
  content: index === 0 ? "合成当前环节记录内容" : "合成其他环节记录内容",
  tags: [`环节:${stage}`], author: { id: "author-1", name: "合成经办人" }
}));
const base: Omit<Props, "view" | "onViewChange"> = {
  matter: { id: "matter-1", internalCode: "A2026001", title: "合成事项", category: "CIVIL_COMMERCIAL" },
  procedure, documents: [], preservationCases: [], folders: [], templates: [], users: [], canManage: false,
  notes, timelineEvents: [], onWriteNote: vi.fn(), archiveNode: <p>合成档案内容</p>
};

function Harness({ initialView = "archive", ...overrides }: Partial<Props> & { initialView?: DossierView }) {
  const [view, setView] = useState<DossierView>(initialView);
  return <ProcedureWorkflowPanel {...base} {...overrides} view={view} onViewChange={setView} />;
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
  it("零程序保留日程空态和全案任务入口，不假报全部任务为空", () => {
    render(<Harness procedure={null} notes={[]} />);
    expect(screen.getByRole("tab", { name: "档案与摘要" })).toBeVisible();
    expect(screen.getByText("当前程序没有未结日程或审批")).toBeVisible();
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
    expect(screen.queryByRole("navigation", { name: "办案环节" })).not.toBeInTheDocument();
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
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案环节" })).getByRole("button", { name: /^合成当前环节/ }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "办理记录" }), { button: 0, ctrlKey: false });
    expect(within(records).getByText("合成其他环节记录内容")).toBeVisible();
  });

  it("无程序时材料空态和上传说明均指向事项，不虚构当前环节", () => {
    render(<Harness initialView="work" procedure={null} notes={[]} canManage />);
    expect(materialCard().getByText("本事项暂无材料")).toBeVisible();
    expect(materialCard().getByText("文件将保存到当前事项。")).toBeVisible();
    expect(screen.queryByText("本环节暂无材料")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 事项材料" });
    expect(within(dialog).getByText("文件将保存到当前事项。")).toBeVisible();
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
    expect(screen.getByText("当前记录 · 不限环节")).toBeVisible();
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

  it("任务保存与刷新地址始终绑定原Task，不丢事项、程序或材料位置", () => {
    window.history.replaceState(null, "", "/matters/matter-1?view=work&workPane=tasks&task=task-existing&stage=stage-stage-2");
    render(<Harness initialView="work" />);
    expect(screen.getByText("当前任务：task-existing")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "创建合成任务" }));
    expect(new URLSearchParams(window.location.search).get("task")).toBe("task-created");
    expect(new URLSearchParams(window.location.search).get("stage")).toBe("stage-stage-2");
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
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "合成上传草稿" } });
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?workPane=tasks"); });
    expect(screen.getByRole("dialog", { name: "上传材料 · 事项材料" })).toBe(dialog);
    expect(within(dialog).getByRole("textbox")).toHaveValue("合成上传草稿");
  });

  it("真实环节材料空态保留准确归属说明", () => {
    render(<Harness initialView="work" canManage />);
    expect(materialCard().getByText("本环节暂无材料")).toBeVisible();
    expect(materialCard().getByText("文件将关联到当前程序，并自动归入本环节。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料 · 合成当前环节" });
    expect(within(dialog).getByText("文件将关联到当前程序，并自动归入本环节。")).toBeVisible();
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("已有材料但筛选无命中时说明筛选结果，不声称材料为空", () => {
    const document: Props["documents"][number] = {
      id: "doc-1", name: "合成文书.txt", category: "PLEADING", mimeType: "text/plain", size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: "stage-1", procedureId: "procedure-1", sourceOrigin: "SELF_COLLECTED",
      ocrStatus: "READY", textSource: "MANUAL", pageCount: null, sha256: null, templateId: null, version: 1
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
      ocrStatus: "READY", textSource: "MANUAL", pageCount: null, sha256: null, templateId: null, version: 1
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
});
