import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn(), scroll: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/server/documents/actions", () => ({ uploadDocument: mock.upload }));
vi.mock("@/server/tasks/actions", () => ({ createTask: vi.fn(), toggleTaskCompleted: vi.fn() }));
vi.mock("@/server/procedures/actions", () => ({ createProcedureStage: vi.fn(), deleteProcedureMemo: vi.fn(), ensureProcedureStage: vi.fn(), removeProcedureStage: vi.fn(), toggleDeadlineCompleted: vi.fn(), toggleProcedureMemo: vi.fn() }));
vi.mock("@/server/express/actions", () => ({ deleteExpress: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({ liftProperty: vi.fn() }));
vi.mock("@/server/deadlines/confirm", () => ({ confirmDeadline: vi.fn() }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-forms", () => ({ AddDeadlineDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/procedure-content", () => ({ AdjustDeadlineDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/template-picker-dialog", () => ({ TemplatePickerDialog: () => null }));
vi.mock("@/app/(app)/matters/[id]/_components/evidence-panel", () => ({ EvidencePoints: () => null }));
vi.mock("@/app/(app)/preservation/_components/preservation-dialog", () => ({ PreservationCaseDialog: () => null, AddTargetDialog: () => null, AddPropertyDialog: () => null, RenewPropertyDialog: () => null }));

import { ProcedureWorkflowPanel, type DossierView } from "@/app/(app)/matters/[id]/_components/procedure-workflow-panel";

type Props = React.ComponentProps<typeof ProcedureWorkflowPanel>;
const date = new Date("2026-11-16T01:00:00.000Z");
const procedure: NonNullable<Props["procedure"]> = {
  id: "procedure-1", type: "FIRST_INSTANCE", customLabel: "合成一审程序", caseNumber: null,
  acceptedAt: null, concludedAt: null, status: "IN_PROGRESS", deadlines: [], hearings: [], procedureParties: [],
  stages: ["合成当前环节", "合成其他环节"].map((name, index) => ({
    id: `stage-${index + 1}`, name, description: null, order: index, status: "ACTIVE", startedAt: date, completedAt: null,
    tasks: [{ id: `task-${index + 1}`, title: index === 0 ? "合成当前待办" : "合成其他环节待办", description: null,
      dueAt: null, completed: false, completedAt: null, priority: 0, stageId: `stage-${index + 1}`, assigneeId: null }]
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
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mock.scroll });
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("事项工作区入口与材料范围（组件环境）", () => {
  it("零待办、零记录保留真实空态，不提供“全部 0”入口", () => {
    render(<Harness procedure={null} notes={[]} />);
    expect(screen.getByRole("tab", { name: "档案与摘要" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "办案与材料" })).toBeVisible();
    expect(screen.getByText("没有待办")).toBeVisible();
    expect(screen.getByText("暂无记录")).toBeVisible();
    expect(screen.queryByRole("button", { name: /查看全部|全部 0/ })).not.toBeInTheDocument();
  });

  it("查看全部待办切换工作页、显示其他环节及折叠待办，并聚焦待办区域", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^查看全部待办/ }));
    const todo = await screen.findByRole("region", { name: "待办" });
    expect(screen.getByRole("tab", { name: /^办案与材料/ })).toHaveAttribute("aria-selected", "true");
    expect(within(todo).getByText("合成一审程序 · 全部环节")).toBeVisible();
    expect(within(todo).getByText("合成当前待办")).toBeVisible();
    expect(within(todo).getByText("合成其他环节待办")).toBeVisible();
    await waitFor(() => expect(todo).toHaveFocus());
    expect(mock.scroll).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(mock.scroll.mock.contexts.at(-1)).toBe(todo);
    expect(screen.getByRole("region", { name: "环节：合成当前环节" })).toBeVisible();
  });

  it("查看全部记录定位记录区；选择环节后恢复筛选，不改变材料环节", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^查看全部记录/ }));
    const records = await screen.findByRole("region", { name: "记录" });
    expect(within(records).getByText("当前记录 · 不限环节")).toBeVisible();
    expect(within(records).getByText("合成当前环节记录内容")).toBeVisible();
    expect(within(records).getByText("合成其他环节记录内容")).toBeVisible();
    await waitFor(() => expect(records).toHaveFocus());
    expect(mock.scroll.mock.contexts.at(-1)).toBe(records);
    expect(screen.getByRole("region", { name: "环节：合成当前环节" })).toBeVisible();
    fireEvent.click(within(screen.getByRole("navigation", { name: "办案环节" })).getByRole("button", { name: /^合成当前环节/ }));
    expect(within(records).queryByText("当前记录 · 不限环节")).not.toBeInTheDocument();
    expect(within(records).getByText("合成当前环节记录内容")).toBeVisible();
    expect(within(records).queryByText("合成其他环节记录内容")).not.toBeInTheDocument();
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
  });
});
