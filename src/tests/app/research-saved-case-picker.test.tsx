import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/research/actions", () => ({ getSavedCaseResearchInput: vi.fn() }));
import { getSavedCaseResearchInput } from "@/server/research/actions";
import { ResearchSavedCasePicker } from "@/components/research/research-saved-case-picker";
import { emptyLawMetadata, emptyResearchContent, type ResearchContent, type ResearchOptions, type SavedCaseResearchInput } from "@/server/research/contracts";

const matterId = "cm00000000000000000000001";
const ids = ["cm00000000000000000000003", "cm00000000000000000000004"];
const options: ResearchOptions = { documents: ids.map((id, index) => ({ id, name: `合成类案${index + 1}.md`, version: index + 1, pageCount: null, isPdf: false, hasIdentity: true })),
  savedCaseDocumentIds: ids, issues: [] };
const draft = (): ResearchContent => ({ ...emptyResearchContent(), question: "保留研究正文", conclusion: "保留当前结论" });
function input(index = 0): SavedCaseResearchInput {
  return { source: { documentId: ids[index], page: null, relation: "CONTEXT", lawMetadata: { ...emptyLawMetadata(), kind: "CASE", title: `合成类案${index + 1}`,
    authority: "合成法院", acquiredVia: "元典保存入口；材料所载元信息，待核实" } },
    query: { sourceDocumentId: ids[index], query: "已保存类案片段（原查询未记录）", location: "javascript:仅作为合成原文", access: "SUMMARY", outcome: "UNREAD", notes: "原检索时间未知；仅保存返回片段。" } };
}
async function choose(index = 0) {
  const trigger = screen.getByRole("combobox", { name: "已保存类案材料" });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: name => name.endsWith(`合成类案${index + 1}.md · V${index + 1}`) }));
}
async function openAndRead(index = 0) {
  const trigger = screen.getByRole("button", { name: "采用已保存类案" });
  act(() => { trigger.focus(); });
  fireEvent.click(trigger);
  await choose(index);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "读取材料元信息" })); });
}
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.mocked(getSavedCaseResearchInput).mockReset().mockResolvedValue(input());
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

describe("采用已保存类案弹窗", () => {
  it("键盘可选择固定版本，Escape 先关选项再关弹窗", async () => {
    render(<ResearchSavedCasePicker matterId={matterId} options={options} value={draft()} onChange={vi.fn()} disabled={false} />);
    const open = screen.getByRole("button", { name: "采用已保存类案" });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "采用已保存类案" });
    const select = within(dialog).getByRole("combobox", { name: "已保存类案材料" });
    act(() => { select.focus(); });
    fireEvent.keyDown(select, { key: "ArrowDown", keyCode: 40 });
    await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "true"));
    fireEvent.keyDown(select, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "false"));
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(select, { key: "ArrowDown", keyCode: 40 });
    await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "true"));
    fireEvent.keyDown(select, { key: "Enter", keyCode: 13 });
    expect(within(dialog).getByRole("button", { name: "读取材料元信息" })).toBeEnabled();

    fireEvent.keyDown(select, { key: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it("确认前不改草稿；返回后按最新正文及集合原子加入来源/阅读，所载链接没有可执行入口", async () => {
    const pending = Promise.withResolvers<SavedCaseResearchInput>(), changed = vi.fn();
    vi.mocked(getSavedCaseResearchInput).mockReturnValueOnce(pending.promise);
    const props = { matterId, options, disabled: false, onChange: changed };
    const rendered = render(<ResearchSavedCasePicker {...props} value={draft()} />);
    await openAndRead();
    const latest = { ...draft(), question: "读取期间的新问题", sources: [input(1).source], queryLog: [input(1).query] };
    rendered.rerender(<ResearchSavedCasePicker {...props} value={latest} />);
    await act(async () => { pending.resolve(input()); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("javascript:仅作为合成原文")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加入研究" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({ ...latest, sources: [...latest.sources, input().source], queryLog: [...latest.queryLog, input().query] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "采用已保存类案" })).toHaveFocus());
  });

  it("失败可重试；取消后的迟到结果不复活、不追加", async () => {
    const pending = Promise.withResolvers<SavedCaseResearchInput>(), changed = vi.fn();
    vi.mocked(getSavedCaseResearchInput).mockRejectedValueOnce(new Error("合成读取失败")).mockReturnValueOnce(pending.promise);
    render(<ResearchSavedCasePicker matterId={matterId} options={options} value={draft()} onChange={changed} disabled={false} />);
    await openAndRead();
    expect(await screen.findByRole("alert")).toHaveTextContent("合成读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重新读取材料" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { pending.resolve(input()); });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "采用已保存类案" }));
    expect(screen.getByRole("button", { name: "加入研究" })).toBeDisabled();
    expect(screen.queryByText("合成法院")).not.toBeInTheDocument();
  });

  it("换材料后旧读取迟到不能覆盖已选具体版本", async () => {
    const pending = Promise.withResolvers<SavedCaseResearchInput>(), changed = vi.fn();
    vi.mocked(getSavedCaseResearchInput).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(input(1));
    render(<ResearchSavedCasePicker matterId={matterId} options={options} value={draft()} onChange={changed} disabled={false} />);
    await openAndRead(); await choose(1);
    fireEvent.click(screen.getByRole("button", { name: "读取材料元信息" }));
    await screen.findByText("合成类案2");
    await act(async () => { pending.resolve(input()); });
    expect(screen.queryByText("合成类案1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加入研究" }));
    expect(changed.mock.calls[0][0].sources).toEqual([input(1).source]);
  });

  it.each(["disabled", "matter", "unmount"] as const)("%s 使进行中的旧读取失效", async change => {
    const pending = Promise.withResolvers<SavedCaseResearchInput>(), changed = vi.fn();
    vi.mocked(getSavedCaseResearchInput).mockReturnValueOnce(pending.promise);
    const props = { matterId, options, disabled: false, onChange: changed, value: draft() };
    const rendered = render(<ResearchSavedCasePicker {...props} />);
    await openAndRead();
    if (change === "unmount") rendered.unmount();
    else rendered.rerender(<ResearchSavedCasePicker {...props} disabled={change === "disabled"} matterId={change === "matter" ? "cm00000000000000000000009" : matterId} />);
    await act(async () => { pending.resolve(input()); });
    expect(changed).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each(["source", "query", "sourceLimit", "queryLimit"] as const)("%s 已存在或超限时保留全部输入，不发生半次添加", async constraint => {
    const changed = vi.fn(), value = draft();
    if (constraint === "source") value.sources = [input().source];
    if (constraint === "query") value.queryLog = [input().query];
    if (constraint === "sourceLimit") value.sources = Array.from({ length: 50 }, (_, index) => ({ ...input(1).source, documentId: `cm${String(index + 100).padStart(23, "0")}` }));
    if (constraint === "queryLimit") value.queryLog = Array.from({ length: 40 }, () => ({ query: "原有人工范围", location: "", access: "NONE", outcome: "NOT_OBTAINED", notes: "保留原记录" }));
    render(<ResearchSavedCasePicker matterId={matterId} options={options} value={value} onChange={changed} disabled={false} />);
    await openAndRead(); await screen.findByText("合成类案1");
    fireEvent.click(screen.getByRole("button", { name: "加入研究" }));
    expect(screen.getByRole("alert")).toHaveTextContent(constraint.endsWith("Limit") ? "最多保留" : "已在当前研究中");
    expect(changed).not.toHaveBeenCalled();
  });

  it("49项来源/39条记录可同时增加一对，到上限时不误拒绝", async () => {
    const value = draft(), changed = vi.fn();
    value.sources = Array.from({ length: 49 }, (_, index) => ({ ...input(1).source, documentId: `cm${String(index + 100).padStart(23, "0")}` }));
    value.queryLog = Array.from({ length: 39 }, () => ({ query: "人工范围", location: "", access: "NONE", outcome: "NOT_OBTAINED", notes: "" }));
    render(<ResearchSavedCasePicker matterId={matterId} options={options} value={value} onChange={changed} disabled={false} />);
    await openAndRead(); await screen.findByText("合成类案1");
    fireEvent.click(screen.getByRole("button", { name: "加入研究" }));
    expect(changed.mock.calls[0][0].sources).toHaveLength(50); expect(changed.mock.calls[0][0].queryLog).toHaveLength(40);
  });

  it("没有可识别候选时说明可手工选材，不能把所有材料误当保存类案", () => {
    render(<ResearchSavedCasePicker matterId={matterId} options={{ ...options, savedCaseDocumentIds: [] }} value={draft()} onChange={vi.fn()} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "采用已保存类案" }));
    expect(screen.getByText(/缺少保存记录的材料仍可在研究中手工选入/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
