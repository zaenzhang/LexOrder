import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/documents/processing-actions", () => ({ listMaterialSources: vi.fn() }));
import { ResearchSourceEditor } from "@/components/research/research-source-editor";
import { listMaterialSources } from "@/server/documents/processing-actions";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";
import { emptyLawMetadata, researchSourceInputSchema, type ResearchSourceInput } from "@/server/research/contracts";

const documents: EvidenceDocumentOption[] = [
  { id: "cm00000000000000000000003", name: "合成甲材料.pdf", version: 1, isPdf: true, pageCount: 3, hasIdentity: true },
  { id: "cm00000000000000000000004", name: "合成乙材料.pdf", version: 1, isPdf: true, pageCount: 3, hasIdentity: true },
];
const matterId = "cm00000000000000000000001";
type Positions = Awaited<ReturnType<typeof listMaterialSources>>;
function position(document: EvidenceDocumentOption, runId: string, excerpt: string): Positions["items"][number] {
  return { documentId: document.id, documentName: document.name, documentVersion: document.version,
    documentSha256: "a".repeat(64), runId, anchorId: "synthetic-page-2", location: { kind: "PAGE", page: 2 },
    locationLabel: "第 2 页", excerpt };
}

function PickerHarness({ onChange, initial = [] }: { onChange(value: ResearchSourceInput[]): void; initial?: ResearchSourceInput[] }) {
  const [value, setValue] = useState(initial);
  return <ResearchSourceEditor matterId={matterId} value={value} documents={documents} disabled={false}
    onChange={next => { setValue(next); onChange(next); }} onPreview={vi.fn()} />;
}

async function choose(label: string, name: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: text => text.includes(name) }));
  await waitFor(() => expect(trigger).toHaveFocus());
}

function Harness() {
  const [value, setValue] = useState<ResearchSourceInput[]>([{ documentId: "synthetic-source", relation: "SUPPORTS", lawMetadata: {
    ...emptyLawMetadata(), kind: "STATUTE", title: "合成旧版规范", authority: "合成机关", jurisdiction: "中国大陆",
    effectiveFrom: "2019-01-01", effectiveTo: "2020-12-31", verification: "CHECKED", usageScope: "本案研究",
  } }]);
  return <ResearchSourceEditor matterId="synthetic-matter" value={value} documents={[]} disabled={false} onChange={setValue} onPreview={vi.fn()} />;
}
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.mocked(listMaterialSources).mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

describe("法源元信息重新核对", () => {
  it.each([
    ["法源名称", "合成更正后的规范名称"],
    ["效力开始日期", "2020-01-01"],
    ["授权使用范围", "仅内部复核，不能向客户提供"],
  ])("修改%s后不会沿用原先已核实状态", (label, next) => {
    render(<Harness />);
    fireEvent.click(screen.getByText("来源身份与使用范围"));
    expect(screen.getByRole("combobox", { name: "来源核实状态 1" })).toHaveTextContent("已核实");
    fireEvent.change(screen.getByLabelText(label), { target: { value: next } });
    expect(screen.getByLabelText(label)).toHaveValue(next);
    expect(screen.getByRole("combobox", { name: "来源核实状态 1" })).toHaveTextContent("待核实");
  });
});

describe("研究来源选择使用真实材料位置", () => {
  it("切换材料后忽略旧请求的迟到结果，并把选中位置的 runId 保存为 parseRunId", async () => {
    let finishFirst!: (result: Positions) => void;
    const firstRequest = new Promise<Positions>(resolve => { finishFirst = resolve; });
    const first = position(documents[0], "cm00000000000000000000006", "合成甲的旧请求片段");
    const second = position(documents[1], "cm00000000000000000000007", "合成乙的当前片段");
    vi.mocked(listMaterialSources).mockReturnValueOnce(firstRequest).mockResolvedValueOnce({ items: [second], nextOffset: null });
    const onChange = vi.fn<(value: ResearchSourceInput[]) => void>();
    render(<PickerHarness onChange={onChange} />);
    await choose("选择研究来源材料", "合成甲材料.pdf · V1");
    fireEvent.click(screen.getByRole("button", { name: "读取可引用的原文位置" }));
    expect(screen.getByRole("button", { name: "正在读取原文位置…" })).toBeDisabled();

    await choose("选择研究来源材料", "合成乙材料.pdf · V1");
    fireEvent.change(screen.getByRole("spinbutton", { name: /页码/ }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "读取可引用的原文位置" }));
    const location = await screen.findByRole("combobox", { name: "原文位置" });
    await act(async () => { finishFirst({ items: [first], nextOffset: null }); await firstRequest; });
    expect(listMaterialSources).toHaveBeenNthCalledWith(1, { matterId, documentIds: [documents[0].id], limit: 20 });
    expect(listMaterialSources).toHaveBeenNthCalledWith(2, { matterId, documentIds: [documents[1].id], limit: 20 });
    expect(screen.getByRole("combobox", { name: "选择研究来源材料" })).toHaveTextContent("合成乙材料.pdf");
    location.focus();
    fireEvent.click(location);
    const selected = await screen.findByRole("option", { name: text => text.includes("第 2 页 · 合成乙的当前片段") });
    expect(screen.queryByRole("option", { name: text => text.includes("第 2 页 · 合成甲的旧请求片段") })).not.toBeInTheDocument();
    fireEvent.click(selected);
    await waitFor(() => expect(location).toHaveFocus());
    expect(screen.queryByRole("spinbutton", { name: /页码/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选入" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0];
    expect(added).toMatchObject({ documentId: documents[1].id, relation: "SUPPORTS", parseRunId: second.runId, anchorId: second.anchorId });
    expect(added).not.toHaveProperty("page");
    expect(researchSourceInputSchema.safeParse(added).success).toBe(true);
    expect(screen.getByText("支持依据 · 第 2 页")).toBeInTheDocument();
  });

  it("位置读取失败与空结果分别提示，重试保留已选来源及材料、用途和手填页码", async () => {
    const existing: ResearchSourceInput = { documentId: documents[0].id, relation: "SUPPORTS", lawMetadata: {
      ...emptyLawMetadata(), kind: "STATUTE", title: "合成已核实规范", authority: "合成机关", jurisdiction: "中国大陆", verification: "CHECKED",
    } };
    const onChange = vi.fn<(value: ResearchSourceInput[]) => void>();
    vi.mocked(listMaterialSources).mockRejectedValueOnce(new Error("合成读取失败")).mockResolvedValueOnce({ items: [], nextOffset: null });
    render(<PickerHarness onChange={onChange} initial={[existing]} />);
    await choose("选择研究来源材料", "合成乙材料.pdf · V1");
    await choose("来源用途", "反向依据");
    fireEvent.change(screen.getByRole("spinbutton", { name: /页码/ }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "读取可引用的原文位置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原文位置读取失败：合成读取失败");
    expect(screen.queryByText("暂无可引用的已处理位置，可以引用原件。")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择研究来源材料" })).toHaveTextContent("合成乙材料.pdf");
    expect(screen.getByRole("combobox", { name: "来源用途" })).toHaveTextContent("反向依据");
    expect(screen.getByRole("spinbutton", { name: /页码/ })).toHaveValue(2);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重新读取原文位置" }));
    expect(await screen.findByText("暂无可引用的已处理位置，可以引用原件。")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /页码/ })).toHaveValue(2);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选入" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(existing);
    expect(saved[1]).toMatchObject({ documentId: documents[1].id, relation: "REBUTS", page: 2 });
    expect(saved[1]).not.toHaveProperty("parseRunId");
    expect(researchSourceInputSchema.safeParse(saved[1]).success).toBe(true);
  });
});
