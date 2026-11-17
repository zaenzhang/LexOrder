import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextInputChoice, ContextInputSelection, ContextInputSummary } from "@/lib/matters/context-inputs";

const mock = vi.hoisted(() => ({ options: vi.fn(), choice: vi.fn(), history: vi.fn(), change: vi.fn() }));
vi.mock("@/server/matters/context-actions", () => ({ getMatterContextInputOptions: mock.options, getMatterContextInputChoice: mock.choice, getMatterContextHistory: mock.history }));
import { ContextInputPicker, ContextInputsSummary } from "@/components/matters/context-input-picker";
const matterId = "cm00000000000000000000001", id = "cm00000000000000000000002", tail = "cm00000000000000000000003";
const original: ContextInputChoice = { kind: "INSTRUCTION", version: 1, content: "合成固定指示原文", sourceDescription: "合成电话记录", historical: false,
  selection: { recordId: id, expectedCurrentRecordId: id, expectedConfirmedAt: null } };
const summary: ContextInputSummary = { unavailable: false, inputs: [{ ...original, currentRecordIdAtAdoption: id, adoptedConfirmedAt: null, changed: false }] };
function Harness({ initial = [], saved, matter = matterId }: { initial?: ContextInputSelection[]; saved?: ContextInputSummary; matter?: string }) {
  const [value, setValue] = useState(initial);
  return <><ContextInputPicker matterId={matter} initial={saved} value={value} onChange={next => { mock.change(next); setValue(next); }} /><output data-testid="selected">{JSON.stringify(value)}</output></>;
}
beforeEach(() => { vi.resetAllMocks(); mock.options.mockResolvedValue({ choices: [original], nextCursor: null }); });
afterEach(cleanup);
describe("真实采用选择与固定版本", () => {
  it("重新读取后须再次明确采用，沿用原recordId且只更新所见末版和确认时点", async () => {
    const changed = { ...original, historical: true, selection: { recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: "2026-11-17T08:00:00.000Z" } };
    mock.choice.mockResolvedValue(changed);
    render(<Harness initial={[original.selection]} saved={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "重新读取这版" }));
    await screen.findByRole("button", { name: "采用所显示的这版" });
    expect(mock.change).not.toHaveBeenCalled();
    expect(screen.getByTestId("selected")).toHaveTextContent(JSON.stringify([original.selection]));
    fireEvent.click(screen.getByRole("button", { name: "采用所显示的这版" }));
    expect(mock.change).toHaveBeenLastCalledWith([changed.selection]);
    expect(mock.choice).toHaveBeenCalledWith(matterId, id);
  });

  it("已选正文在确切重读或整页读取拒绝后隐藏，固定三元组和草稿选择保留", async () => {
    mock.choice.mockRejectedValueOnce(new Error("已无权读取"));
    render(<Harness initial={[original.selection]} saved={summary} />);
    expect(screen.getByText(original.content)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取这版" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(original.content)).not.toBeInTheDocument();
    expect(screen.getByTestId("selected")).toHaveTextContent(JSON.stringify([original.selection]));
    expect(mock.change).not.toHaveBeenCalled();
    mock.choice.mockResolvedValue(original);
    fireEvent.click(screen.getByRole("button", { name: "重新读取这版" }));
    await screen.findByRole("button", { name: "采用所显示的这版" });
    expect(screen.getAllByText(original.content).length).toBeGreaterThan(0);
    mock.options.mockRejectedValueOnce(new Error("当前账号已无权读取"));
    fireEvent.click(screen.getByRole("button", { name: "选择目标或指示" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(original.content)).not.toBeInTheDocument();
    expect(screen.getByTestId("selected")).toHaveTextContent(JSON.stringify([original.selection]));
  });

  it("历史列表明确选择旧修订；来源页迟到结果不能在收起或另案后复现", async () => {
    const current = { ...original, version: 2, content: "合成新版指示", selection: { ...original.selection, recordId: tail, expectedCurrentRecordId: tail } };
    mock.options.mockResolvedValueOnce({ choices: [current], nextCursor: null });
    mock.history.mockResolvedValue({ records: [{ id, version: 1, kind: "INSTRUCTION", readable: true, content: original.content, sourceDescription: original.sourceDescription, confirmedAt: null }], nextBeforeVersion: null });
    const rendered = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "选择目标或指示" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看历史版本" }));
    fireEvent.click(await screen.findByRole("button", { name: "采用所显示的这版" }));
    expect(mock.change).toHaveBeenLastCalledWith([{ recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: null }]);
    let resolve!: (value: { choices: ContextInputChoice[]; nextCursor: null }) => void;
    mock.options.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "选择目标或指示" }));
    fireEvent.click(screen.getByRole("button", { name: "收起选择" }));
    rendered.rerender(<Harness matter="cm00000000000000000000004" />);
    await act(async () => resolve({ choices: [{ ...original, content: "不得复现的旧页正文" }], nextCursor: null }));
    expect(screen.queryByText("不得复现的旧页正文")).not.toBeInTheDocument();
  });

  it("历史采用和采用后变化分别显示，精确链接仍指向原修订", () => {
    render(<ContextInputsSummary matterId={matterId} summary={{ unavailable: false, inputs: [{ ...summary.inputs[0], historical: true, changed: true }] }} />);
    expect(screen.getByText("采用历史版")).toBeInTheDocument();
    expect(screen.getByText("采用后发生变化，待核对")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看这版记录" })).toHaveAttribute("href", `/matters/${matterId}?view=archive&contextRecord=${id}`);
  });
});
