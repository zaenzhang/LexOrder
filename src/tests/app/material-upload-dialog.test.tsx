import React, { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";

const mock = vi.hoisted(() => ({ upload: vi.fn(), ensure: vi.fn(), receipt: vi.fn(), resume: vi.fn(), close: vi.fn(),
  confirm: vi.fn(), refresh: vi.fn(), push: vi.fn(), openDocument: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh, push: mock.push }) }));
vi.mock("@/server/documents/actions", () => ({ uploadDocument: mock.upload }));
vi.mock("@/server/documents/ingest-actions", () => ({ getMaterialUploadReceipt: mock.receipt, continueMaterialUpload: mock.resume, closeMaterialUpload: mock.close }));
vi.mock("@/server/procedures/actions", () => ({ ensureProcedureStage: mock.ensure }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/components/matters/context-input-picker", () => ({ ContextInputPicker: ({ value, onChange, disabled }: {
  value: ContextInputSelection[]; onChange(value: ContextInputSelection[]): void; disabled: boolean;
}) => <div><span>本件采用：{value.map(row => row.recordId).join(",") || "无"}</span>{["A", "B"].map(suffix => <button key={suffix} disabled={disabled}
  onClick={() => onChange([{ recordId: `cgoal000000000000000000${suffix}`, expectedCurrentRecordId: `cgoal000000000000000000${suffix}`, expectedConfirmedAt: null }])}>采用合成指示 {suffix}</button>)}</div> }));
vi.mock("@/app/(app)/matters/[id]/_components/material-processing-status", () => ({ MaterialProcessingStatus: ({ documentIds }: { documentIds: string[] }) =>
  <section aria-label="材料处理状态">待核对处理：{documentIds.join(",")}</section> }));
// Row/target/result contracts use real Dialog and inputs. Select's portal/keyboard is left to browser acceptance.
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange(value: string): void; disabled?: boolean; children: ReactNode }) => {
      const trigger = Children.toArray(children)[0];
      const id = isValidElement<{ id?: string }>(trigger) ? trigger.props.id : undefined;
      return <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>;
    }, SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) => <option value={value} disabled={disabled}>{children}</option>,
  };
});

import { MaterialUploadDialog, type UploadProcedureChoice } from "@/app/(app)/matters/[id]/_components/material-upload-dialog";
import { DocActionsContext } from "@/app/(app)/matters/[id]/_components/doc-actions-context";
type Props = React.ComponentProps<typeof MaterialUploadDialog>;
const procedures: UploadProcedureChoice[] = [
  { id: "procedure-a", label: "程序 A", sourceOptions: ["法院程序文件", "原告·合成甲"], stages: [
    { id: "stage-a", name: "环节 A", status: "ACTIVE" }, { id: "hidden-a", name: "隐藏环节", status: "HIDDEN" }] },
  { id: "procedure-b", label: "程序 B", sourceOptions: ["法院程序文件", "被告·合成乙"], stages: [{ id: "stage-b", name: "环节 B", status: "ACTIVE" }] },
];
const current: Props["current"] = { matterId: "matter-1", procedureId: "procedure-a", stageKey: "stage-stage-a", stageId: "stage-a", stageName: "环节 A", title: "环节 A" };
function Harness(overrides: Partial<Props>) {
  const [request, setRequest] = useState(0);
  return <DocActionsContext.Provider value={{ onOpenDocument: mock.openDocument }}><button onClick={() => setRequest(value => value + 1)}>打开批次</button>
    <MaterialUploadDialog current={current} procedures={procedures} canWrite scopeValid request={request} defaultCategory="EVIDENCE" {...overrides} />
  </DocActionsContext.Provider>;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function add(names: string[]) {
  const files = names.map((name, index) => new File([`合成第${index}份`], name, { type: "text/plain" }));
  fireEvent.change(screen.getByLabelText(/^文件 \*/), { target: { files } });
  return files;
}
function editor() { return within(screen.getByRole("region", { name: "当前材料" })); }
function choose(index: number) { fireEvent.click(within(screen.getByRole("list", { name: "本批材料" })).getAllByRole("button")[index]); }
function upload() { fireEvent.click(screen.getByRole("button", { name: "上传" })); }
function change(label: string, value: string) { fireEvent.change(editor().getByLabelText(label), { target: { value } }); }
function requestAt(index: number) { return mock.upload.mock.calls[index][0] as FormData; }
beforeEach(() => {
  vi.resetAllMocks();
  mock.confirm.mockResolvedValue(true); mock.close.mockResolvedValue(undefined);
  mock.upload.mockImplementation(async () => ({ ok: true, id: `doc-${mock.upload.mock.calls.length}` }));
  window.history.replaceState(null, "", "/matters/matter-1?procedure=procedure-a&stage=stage-stage-a");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("G04 批量接件：逐件身份、目标与接续（组件环境）", () => {
  it("30 份同名文件分别顺序提交，单件明确失败可纠正，成功项不重发且仅打开真实保存对象", async () => {
    mock.upload.mockResolvedValueOnce({ ok: false, code: "REJECTED_BEFORE_RESERVATION", message: "首份名称待核对" });
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" }));
    const files = add(Array.from({ length: 30 }, () => "同名材料.txt"));
    upload();
    await screen.findByText("30 份 · 已保存 29 份");
    expect(mock.upload).toHaveBeenCalledTimes(30);
    expect(new Set(mock.upload.mock.calls.map(([form]) => (form as FormData).get("requestKey"))).size).toBe(30);
    for (let index = 0; index < 30; index++) expect(requestAt(index).get("file")).toBe(files[index]);
    expect(within(screen.getByRole("list", { name: "本批材料" })).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true");
    expect(editor().getByText("首份名称待核对")).toBeVisible();
    change("显示名", "首份已核对材料"); upload();
    await screen.findByText("30 份 · 已保存 30 份");
    expect(mock.upload).toHaveBeenCalledTimes(31);
    expect(requestAt(30).get("requestKey")).toBe(requestAt(0).get("requestKey"));
    expect(requestAt(30).get("name")).toBe("首份已核对材料");
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
    choose(1); fireEvent.click(editor().getByRole("button", { name: "查看材料" }));
    expect(mock.openDocument).toHaveBeenCalledWith("doc-2");
    expect(screen.getByRole("region", { name: "材料处理状态" })).toHaveTextContent("doc-31,doc-2");
  });

  it("共同默认只作用可编辑项；同案逐件真实程序/ACTIVE 环节/未归属、来源和 G15 选择相互独立", async () => {
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" })); add(["甲.txt", "乙.txt", "丙.txt"]);
    fireEvent.click(editor().getByRole("button", { name: "采用合成指示 A" }));
    change("来源方", "原告·合成甲");
    fireEvent.click(editor().getByRole("button", { name: "上传此项" }));
    await screen.findByText("3 份 · 已保存 1 份");
    choose(1); change("显示名", "乙的独立显示名"); fireEvent.click(editor().getByRole("button", { name: "采用合成指示 B" }));
    fireEvent.click(screen.getByText("共同默认值", { selector: "summary" }));
    const defaults = within(screen.getByText("共同默认值", { selector: "summary" }).parentElement!);
    fireEvent.change(defaults.getByLabelText("材料来源"), { target: { value: "CLIENT_PROVIDED" } });
    fireEvent.click(defaults.getByRole("button", { name: "应用到可编辑项" }));
    expect(editor().getByLabelText("显示名")).toHaveValue("乙的独立显示名");
    expect(editor().getByText(/本件采用：cgoal.*B/)).toBeVisible();
    expect(editor().queryByRole("option", { name: "隐藏环节" })).not.toBeInTheDocument();
    change("来源方", "原告·合成甲"); change("归属程序", "procedure-b");
    expect(editor().getByLabelText("归属环节")).toHaveValue("none");
    expect(editor().getByLabelText("来源方")).toHaveValue("none");
    expect(editor().queryByRole("option", { name: "隐藏环节" })).not.toBeInTheDocument();
    change("归属环节", "stage-b"); change("来源方", "被告·合成乙");
    choose(2); change("归属程序", "none");
    expect(editor().getByText("本件采用：无")).toBeVisible();
    upload(); await screen.findByText("3 份 · 已保存 3 份");
    expect(mock.upload).toHaveBeenCalledTimes(3);
    expect(requestAt(0).get("sourceOrigin")).toBeNull();
    expect(requestAt(0).get("sourceParty")).toBe("原告·合成甲");
    expect(requestAt(1).get("procedureId")).toBe("procedure-b"); expect(requestAt(1).get("stageId")).toBe("stage-b");
    expect(requestAt(1).get("sourceParty")).toBe("被告·合成乙"); expect(requestAt(1).get("sourceOrigin")).toBe("CLIENT_PROVIDED");
    expect(JSON.parse(String(requestAt(0).get("contextInputs")))[0].recordId).toMatch(/A$/);
    expect(JSON.parse(String(requestAt(1).get("contextInputs")))[0].recordId).toMatch(/B$/);
    expect(requestAt(2).get("procedureId")).toBeNull(); expect(requestAt(2).get("stageId")).toBeNull(); expect(requestAt(2).get("sourceParty")).toBeNull();
    expect(requestAt(2).get("contextInputs")).toBe("[]");
  });

  it("未知调用后 typed 前置拒绝及 NOT_RESERVED 不解冻；同原请求重试，实际 CLOSED 后才能换文件与新键", async () => {
    mock.upload.mockRejectedValueOnce(new Error("响应中断")).mockResolvedValueOnce({ ok: false, code: "REJECTED_BEFORE_RESERVATION", message: "本次输入已被拒绝" });
    mock.receipt.mockResolvedValueOnce({ status: "NOT_RESERVED" }).mockResolvedValueOnce({ status: "INCOMPLETE", waiting: false, description: "原件未完成" });
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" })); add(["原件.txt"]);
    change("显示名", "发送时名称"); fireEvent.click(editor().getByRole("button", { name: "采用合成指示 A" })); upload();
    await screen.findByText("响应中断");
    expect(editor().getByLabelText("显示名")).toBeDisabled();
    fireEvent.click(editor().getByRole("button", { name: "重试原提交" }));
    await screen.findByText("本次输入已被拒绝");
    expect(editor().getByLabelText("显示名")).toBeDisabled();
    expect(editor().queryByRole("button", { name: "重新选择文件" })).not.toBeInTheDocument();
    expect([...requestAt(1).entries()]).toEqual([...requestAt(0).entries()]);
    fireEvent.click(editor().getByRole("button", { name: "核对上传结果" }));
    await screen.findByText(/暂未查到上传记录/); expect(editor().getByLabelText("显示名")).toBeDisabled();
    expect(mock.receipt).toHaveBeenCalledWith({ matterId: "matter-1", requestKey: requestAt(0).get("requestKey") });
    fireEvent.click(editor().getByRole("button", { name: "核对上传结果" }));
    await screen.findByText("原件未完成");
    expect(editor().queryByRole("button", { name: "重试原提交" })).not.toBeInTheDocument();
    fireEvent.click(editor().getByRole("button", { name: "关闭本次上传" }));
    await screen.findByText("本次上传已关闭，可以重新选择文件");
    expect(mock.close).toHaveBeenCalledWith(requestAt(0).get("requestKey"));
    fireEvent.click(editor().getByRole("button", { name: "重新选择文件" }));
    fireEvent.change(screen.getByLabelText("替换当前文件"), { target: { files: [new File(["新的原件"], "重选.txt", { type: "text/plain" })] } });
    expect(editor().getByLabelText("显示名")).toBeEnabled(); upload();
    await screen.findByText("1 份 · 已保存 1 份");
    expect(requestAt(2).get("requestKey")).not.toBe(requestAt(0).get("requestKey"));
    expect(requestAt(2).get("name")).toBe("重选.txt");
  });

  it("已保存但当前不可读的精确回执仅确认保存，不展示原件入口或重发", async () => {
    mock.upload.mockRejectedValueOnce(new Error("响应中断")); mock.receipt.mockResolvedValue({ status: "COMMITTED", document: null });
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" })); add(["材料.txt"]); upload();
    await screen.findByText("响应中断"); fireEvent.click(editor().getByRole("button", { name: "核对上传结果" }));
    await screen.findByText("已保存，当前不可读取该材料");
    expect(editor().queryByRole("button", { name: "查看材料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "材料处理状态" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled(); expect(mock.upload).toHaveBeenCalledOnce();
  });

  it("发送中换范围停止后续文件，迟到结果仍属于原行；返回原范围须显式继续且保持所选行", async () => {
    const pending = deferred<{ ok: true; id: string }>(); mock.upload.mockReturnValueOnce(pending.promise);
    const view = render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" })); add(["一.txt", "二.txt"]); upload();
    choose(1); expect(screen.getByText("关闭", { selector: "button" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).find(button => button.querySelector(".sr-only"))!);
    expect(screen.getByRole("dialog")).toBeVisible(); expect(mock.confirm).not.toHaveBeenCalled();
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?procedure=procedure-b&stage=stage-stage-b"); });
    view.rerender(<Harness current={{ ...current, procedureId: "procedure-b", stageId: "stage-b", stageKey: "stage-stage-b", stageName: "环节 B" }} />);
    await act(async () => pending.resolve({ ok: true, id: "saved-first" }));
    expect(mock.upload).toHaveBeenCalledOnce(); expect(editor().getByLabelText("显示名")).toHaveValue("二.txt");
    expect(screen.getByText(/上传范围已变化/)).toBeVisible();
    act(() => { window.history.replaceState(null, "", "/matters/matter-1?procedure=procedure-a&stage=stage-stage-a"); });
    view.rerender(<Harness />);
    expect(mock.upload).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole("button", { name: "继续上传" }));
    await screen.findByText("2 份 · 已保存 2 份"); expect(requestAt(1).get("name")).toBe("二.txt");
    expect(editor().getByLabelText("显示名")).toHaveValue("二.txt");
  });

  it("卸载仅停止未发送项，不把已经发送的请求当取消", async () => {
    const pending = deferred<{ ok: true; id: string }>(); mock.upload.mockReturnValueOnce(pending.promise);
    const view = render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "打开批次" })); add(["一.txt", "二.txt"]); upload();
    expect(mock.upload).toHaveBeenCalledOnce(); view.unmount();
    await act(async () => pending.resolve({ ok: true, id: "already-saved" }));
    expect(mock.upload).toHaveBeenCalledOnce(); expect(mock.close).not.toHaveBeenCalled(); expect(mock.refresh).not.toHaveBeenCalled();
  });

  it("关闭草稿拒绝后保留文件/逐件输入，确认关闭回到原触发按钮", async () => {
    mock.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Harness />); const trigger = screen.getByRole("button", { name: "打开批次" }); trigger.focus(); fireEvent.click(trigger);
    add(["未上传.txt"]); change("显示名", "保留的草稿"); fireEvent.click(editor().getByRole("button", { name: "采用合成指示 A" }));
    fireEvent.click(screen.getByText("关闭", { selector: "button" }));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledOnce());
    expect(editor().getByLabelText("显示名")).toHaveValue("保留的草稿"); expect(editor().getByText(/本件采用：cgoal.*A/)).toBeVisible();
    fireEvent.click(screen.getByText("关闭", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus()); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.close).not.toHaveBeenCalled();
  });
});
