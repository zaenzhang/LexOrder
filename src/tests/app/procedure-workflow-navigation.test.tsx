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
import { DocActionsContext } from "@/app/(app)/matters/[id]/_components/doc-actions-context";

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
  procedure, procedures: [procedure], procedureFilter: <p>程序范围</p>, invalidProcedure: false,
  factsNode: <p>全案事实内容</p>, documents: [], preservationCases: [], folders: [], templates: [], users: [],
  canManage: false, canManageMaterials: false,
  notes, timelineEvents: [], onWriteNote: vi.fn(), archiveNode: <p>合成档案内容</p>
};
const openDocument = vi.fn();
function Harness({ initialView = "archive", ...overrides }: Partial<Props> & { initialView?: DossierView }) {
  const [view, setView] = useState<DossierView>(initialView);
  return <DocActionsContext.Provider value={{ onOpenDocument: openDocument }}>
    <ProcedureWorkflowPanel {...base} {...overrides} view={view} onViewChange={setView} />
  </DocActionsContext.Provider>;
}
function chooseTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const replaceState = window.history.replaceState.bind(window.history);
const pushState = window.history.pushState.bind(window.history);
beforeEach(() => {
  vi.clearAllMocks();
  replaceState(null, "", "/matters/A2026001");
  mock.search = "";
  for (const [key, original] of [["replaceState", replaceState], ["pushState", pushState]] as const) {
    vi.spyOn(window.history, key).mockImplementation((data, unused, url) => {
      original(data, unused, url);
      mock.search = window.location.search;
      for (const listener of mock.listeners) listener();
    });
  }
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: mock.scroll });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("案件任务区、真实关联与返回", () => {
  it("档案只挂载当前内容，空待办和记录没有虚假跳转", () => {
    render(<Harness procedure={null} procedures={[]} notes={[]} />);
    expect(screen.getByText("合成档案内容")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "材料" })).not.toBeInTheDocument();
    expect(screen.getByText("没有待办")).toBeVisible();
    expect(screen.getByText("暂无记录")).toBeVisible();
    expect(screen.queryByRole("button", { name: /查看全部/ })).not.toBeInTheDocument();
  });

  it("查看全部待办进入待办区、清除环节范围并聚焦", async () => {
    window.history.replaceState(null, "", "/matters/A2026001?stage=stage-stage-1");
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^查看全部待办/ }));
    const todo = await screen.findByRole("region", { name: "待办" });
    expect(screen.getByRole("tab", { name: "待办" })).toHaveAttribute("aria-selected", "true");
    expect(within(todo).getByText("合成当前待办")).toBeVisible();
    expect(within(todo).getByText("合成其他环节待办")).toBeVisible();
    expect(new URLSearchParams(window.location.search).has("stage")).toBe(false);
    await waitFor(() => expect(todo).toHaveFocus());
  });

  it("事实和记录不继承材料程序环节，工作区切换进入历史", () => {
    window.history.replaceState(null, "", "/matters/A2026001?procedure=procedure-1&stage=stage-stage-2#case");
    render(<Harness initialView="work" />);
    chooseTab("事实与来源");
    expect(screen.getByText("全案事实内容")).toBeVisible();
    expect(screen.queryByLabelText("环节")).not.toBeInTheDocument();
    chooseTab("办案记录");
    const records = screen.getByRole("region", { name: "记录" });
    expect(within(records).getByText("合成当前环节记录内容")).toBeVisible();
    expect(within(records).getByText("合成其他环节记录内容")).toBeVisible();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("workPane")).toBe("records");
    expect(params.get("stage")).toBe("stage-stage-2");
    expect(params.get("procedure")).toBe("procedure-1");
    expect(window.location.hash).toBe("#case");
    expect(window.history.pushState).toHaveBeenCalled();
    expect(screen.queryByText("全案事实内容")).not.toBeInTheDocument();
  });

  it("显式无效工作区不替换成另一个任务；用户可重新选择", () => {
    window.history.replaceState(null, "", "/matters/A2026001?workPane=unknown");
    render(<Harness initialView="work" />);
    expect(screen.getByRole("alert")).toHaveTextContent("这个工作区链接已失效");
    expect(screen.queryByText("本程序暂无材料")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看材料" }));
    expect(screen.getByText("本程序暂无材料")).toBeVisible();
  });

  it("显式无效环节显示不可用，不能悄悄选当前环节", () => {
    window.history.replaceState(null, "", "/matters/A2026001?stage=another-case-stage");
    render(<Harness initialView="work" />);
    expect(screen.getByRole("alert")).toHaveTextContent("所选环节不可用");
    expect(screen.queryByText("本程序暂无材料")).not.toBeInTheDocument();
    chooseTab("事实与来源");
    expect(screen.getByText("全案事实内容")).toBeVisible();
  });

  it("材料与记录的筛选写入地址，工作区切换后保留", () => {
    window.history.replaceState(null, "", "/matters/A2026001?workPane=materials&materialWritten=1");
    const material: Props["documents"][number] = {
      id: "written", name: "合成文书.docx", category: "PLEADING", mimeType: null, size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: null, procedureId: "procedure-1", sourceOrigin: null,
      ocrStatus: null, textSource: null, pageCount: null, sha256: null, templateId: null, version: 1,
      familyId: "written-family", isLatest: true, status: "DRAFT"
    };
    render(<Harness initialView="work" documents={[material, { ...material, id: "evidence", familyId: "evidence-family", name: "合成证据.pdf", category: "EVIDENCE" }]} />);
    expect(screen.getByRole("button", { name: "合成文书.docx" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "合成证据.pdf" })).not.toBeInTheDocument();
    chooseTab("办案记录");
    fireEvent.click(within(screen.getByRole("group", { name: "记录筛选" })).getByRole("button", { name: "研判" }));
    expect(new URLSearchParams(window.location.search).get("recordKind")).toBe("note");
    chooseTab("材料");
    expect(screen.getByRole("button", { name: "文书 1" })).toHaveAttribute("aria-pressed", "true");
    chooseTab("办案记录");
    expect(within(screen.getByRole("group", { name: "记录筛选" })).getByRole("button", { name: "研判" })).toHaveAttribute("aria-pressed", "true");
  });

  it("版本按真实族展示，当前版撤回后不把历史版升级", () => {
    const material: Props["documents"][number] = {
      id: "old-version", name: "合成旧稿.docx", category: "PLEADING", mimeType: null, size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: null, procedureId: "procedure-1", sourceOrigin: null,
      ocrStatus: null, textSource: null, pageCount: null, sha256: null, templateId: null, version: 1,
      familyId: "real-family", isLatest: false, status: "APPROVED"
    };
    render(<Harness initialView="work" documents={[material]} />);
    expect(screen.getByText("此范围仅有历史版本")).toBeVisible();
    expect(screen.getByText("历史版本", { exact: true })).toBeVisible();
    expect(screen.queryByText("当前版本", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "合成旧稿.docx" }));
    expect(openDocument).toHaveBeenCalledWith("old-version");
  });

  it("材料只按真实环节外键筛选，名称和旧标签不伪造归属", () => {
    window.history.replaceState(null, "", "/matters/A2026001?stage=stage-stage-1");
    const material: Props["documents"][number] = {
      id: "document-1", name: "真实关联材料.pdf", category: "EVIDENCE", mimeType: "application/pdf", size: 10, createdAt: date,
      sourceParty: null, tags: [], stageId: "stage-1", procedureId: "procedure-1", sourceOrigin: null,
      ocrStatus: "READY", textSource: "PDF_TEXT", pageCount: 1, sha256: null, templateId: null, version: 1, familyId: "family-1", isLatest: true, status: "DRAFT"
    };
    render(<Harness initialView="work" documents={[material, { ...material, id: "document-2", name: "合成当前环节证据.pdf", stageId: null, tags: ["阶段:合成当前环节"] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "真实关联材料.pdf" }));
    expect(openDocument).toHaveBeenCalledWith("document-1");
    expect(screen.queryByRole("button", { name: "合成当前环节证据.pdf" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传" })).not.toBeInTheDocument();
  });

  it("同案 URL 切换不卸载当前上传草稿，也不发起隐藏上传", () => {
    render(<Harness initialView="work" procedure={null} procedures={[]} canManageMaterials />);
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    const dialog = screen.getByRole("dialog", { name: "上传材料" });
    fireEvent.change(within(dialog).getByLabelText("显示名"), { target: { value: "合成上传草稿" } });
    act(() => { window.history.pushState(null, "", "/matters/A2026001?workPane=records"); });
    expect(screen.getByRole("dialog", { name: "上传材料" })).toBe(dialog);
    expect(within(dialog).getByLabelText("显示名")).toHaveValue("合成上传草稿");
    expect(mock.upload).not.toHaveBeenCalled();
  });
});
