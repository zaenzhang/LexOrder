import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchSourceEditor } from "@/components/research/research-source-editor";
import { emptyLawMetadata, type ResearchSourceInput } from "@/server/research/contracts";

function Harness() {
  const [value, setValue] = useState<ResearchSourceInput[]>([{ documentId: "synthetic-source", relation: "SUPPORTS", lawMetadata: {
    ...emptyLawMetadata(), kind: "STATUTE", title: "合成旧版规范", authority: "合成机关", jurisdiction: "中国大陆",
    effectiveFrom: "2019-01-01", effectiveTo: "2020-12-31", verification: "CHECKED", usageScope: "本案研究",
  } }]);
  return <ResearchSourceEditor value={value} documents={[]} disabled={false} onChange={setValue} onPreview={vi.fn()} />;
}
afterEach(cleanup);

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
