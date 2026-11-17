import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceItemRow } from "@/app/(app)/matters/[id]/_components/evidence-panel";

const mock = vi.hoisted(() => ({ add: vi.fn(), retry: vi.fn(), openDocument: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/evidence/actions", () => ({ getEvidenceItem: vi.fn(), updateEvidenceItem: vi.fn(), confirmEvidenceItem: vi.fn(),
  listEvidenceRevisions: vi.fn(), resolveEvidenceSource: vi.fn(), addEvidenceSource: vi.fn(), removeEvidenceSource: vi.fn(), createEvidenceItem: vi.fn() }));
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: vi.fn() }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
// Research has its own service/editor tests. Here its state observes the real workspace mounting boundary.
vi.mock("@/components/research/research-workspace", () => ({ ResearchWorkspace: ({ issueId }: { issueId: string | null }) => {
  const [draft, setDraft] = useState("");
  return <section aria-label="合成研究工作区"><p>研究争点：{issueId ?? "未选择"}</p>
    <label>合成研究输入<input value={draft} onChange={event => setDraft(event.target.value)} /></label></section>;
} }));
import { FactsWorkspace } from "@/app/(app)/matters/[id]/_components/facts-workspace";

const base: EvidenceItemRow = { id: "fact", title: "合成有日期事实", content: "这条事实正文只显示一次", kind: "FACT",
  sourceDocumentId: null, sourceDocumentName: null, sourcePage: null, sources: [], restricted: false, canEdit: true,
  createdByName: "合成经办人", createdAt: "2026-11-17T08:00:00Z", revision: 1, confirmedAt: null,
  eventDate: { precision: "EXACT", start: "2024-03-01", end: null, text: null } };
const issue: EvidenceItemRow = { ...base, id: "issue", kind: "ISSUE", title: "合成未知日期争点", content: "这条争点正文只显示一次",
  eventDate: { precision: "UNKNOWN", start: null, end: null, text: "合成事件时间未明" } };
const restricted: EvidenceItemRow = { ...base, id: "restricted", kind: "ISSUE", title: "来源不可用的要点", content: "不能显示的受限正文",
  restricted: true, canEdit: false, eventDate: { precision: "EXACT", start: "1999-12-31", end: null, text: "不能显示的受限日期" } };
const props = { matterId: "matter", items: [issue, restricted, base], canAdd: true,
  onAdd: mock.add, onRetry: mock.retry, onOpenDocument: mock.openDocument };
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/matters/SYNTHETIC-FACTS?view=work&workPane=facts&procedure=procedure-one&stage=stage-one&factsView=facts&research=old-research");
});
afterEach(cleanup);

describe("事实工作区的单套呈现", () => {
  it("日期、未知日期与受限占位各出现一次，争点动作就在同一条记录", () => {
    render(<FactsWorkspace {...props} />);
    expect(screen.getAllByText(base.title)).toHaveLength(1); expect(screen.getAllByText(base.content)).toHaveLength(1);
    expect(screen.getAllByText(issue.title)).toHaveLength(1); expect(screen.getAllByText(issue.content)).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "已记录日期" })).getByText(base.title)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "时间未明" })).getByText(issue.title)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "以此争点开始研究" })).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "时间未明" })).getByRole("button", { name: "以此争点开始研究" })).toBeInTheDocument();
    expect(screen.getAllByText(restricted.title)).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "来源不可用" })).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(restricted.content)).not.toBeInTheDocument(); expect(screen.queryByText("1999-12-31")).not.toBeInTheDocument();
    expect(screen.queryByText("不能显示的受限日期")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加事实或争点" })); expect(mock.add).toHaveBeenCalledOnce();
  });

  it("真实争点ID进入研究并保留原程序和环节，往返事实页签保留研究输入", () => {
    const view = render(<FactsWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "以此争点开始研究" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("issue")).toBe(issue.id); expect(params.get("research")).toBeNull();
    expect(params.get("factsView")).toBe("research"); expect(params.get("procedure")).toBe("procedure-one"); expect(params.get("stage")).toBe("stage-one");
    // Next observes native history; this isolated hook consumes the updated URL on rerender.
    view.rerender(<FactsWorkspace {...props} />);
    expect(screen.getByText("研究争点：issue")).toBeVisible();
    fireEvent.change(screen.getByLabelText("合成研究输入"), { target: { value: "切换分区时保留的研究草稿" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "事实与争点" }), { button: 0 });
    view.rerender(<FactsWorkspace {...props} />);
    expect(screen.getByLabelText("合成研究输入")).toHaveValue("切换分区时保留的研究草稿");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "法律研究" }), { button: 0 });
    view.rerender(<FactsWorkspace {...props} />);
    expect(screen.getByLabelText("合成研究输入")).toBeVisible();
    expect(screen.getByLabelText("合成研究输入")).toHaveValue("切换分区时保留的研究草稿");
  });

  it("没有实际新建资格时仍可读事实与已有研究，但不显示新建研究动作", () => {
    const view = render(<FactsWorkspace {...props} canAdd={false} items={[{ ...issue, canEdit: false }]} />);
    expect(screen.getByText(issue.content)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `查看要点：${issue.title}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以此争点开始研究" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加事实或争点" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "法律研究" }), { button: 0 });
    view.rerender(<FactsWorkspace {...props} canAdd={false} items={[{ ...issue, canEdit: false }]} />);
    expect(screen.getByRole("region", { name: "合成研究工作区" })).toBeVisible();
  });

  it("读取失败遮蔽旧事实，只有真正空集合显示空态，受限项仍保留一次提示", () => {
    const view = render(<FactsWorkspace {...props} />);
    view.rerender(<FactsWorkspace {...props} error="合成事实读取失败" />);
    expect(screen.getByRole("alert")).toHaveTextContent("合成事实读取失败");
    expect(screen.queryByText(base.content)).not.toBeInTheDocument(); expect(screen.queryByText(issue.content)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" })); expect(mock.retry).toHaveBeenCalledOnce();
    view.rerender(<FactsWorkspace {...props} items={[restricted]} />);
    expect(screen.getAllByText(restricted.title)).toHaveLength(1);
    expect(screen.queryByText("暂无可展示的要点。")).not.toBeInTheDocument();
    expect(screen.queryByText("尚未记录事实或争点，可从材料添加来源。")).not.toBeInTheDocument();
    view.rerender(<FactsWorkspace {...props} items={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("尚未记录事实或争点，可从材料添加来源。");
  });
});
