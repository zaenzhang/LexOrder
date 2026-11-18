import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmHost, confirmDialog, promptDialog } from "@/components/patterns/confirm-dialog";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";

afterEach(cleanup);

it("既有确认默认不变，排队请求可明确将初始焦点放到取消", async () => {
  render(<ConfirmHost />);
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => {
    first = confirmDialog({ title: "原有确认", confirmText: "原有确认按钮", description: "合成说明" });
    second = confirmDialog({ title: "核对本条记录", initialFocus: "cancel", cancelText: "暂不确认", description: "合成记录第 2 版" });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "原有确认按钮" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "原有确认按钮" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "暂不确认" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "暂不确认" }));
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(false);
});

function DraftForm({ onResult }: { onResult: (confirmed: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button>编辑记录</button></DialogTrigger>
      <FormDialogContent>
        <DialogHeader><DialogTitle>编辑原记录</DialogTitle><DialogDescription>合成表单</DialogDescription></DialogHeader>
        <FormDialogBody><input aria-label="原记录草稿" defaultValue="尚未提交" /></FormDialogBody>
        <DialogFooter><button onClick={async () => onResult(await confirmDialog({ title: "放弃更改？", initialFocus: "cancel", cancelText: "继续编辑", confirmText: "放弃更改" }))}>检查退出</button></DialogFooter>
      </FormDialogContent>
    </Dialog>
    <ConfirmHost />
  </>;
}

it.each(["Escape", "cancel"] as const)("旧表单内的确认以 %s 取消后保稿并回到真实入口", async (exit) => {
  const onResult = vi.fn();
  render(<DraftForm onResult={onResult} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑记录" }));
  const input = await screen.findByRole("textbox", { name: "原记录草稿" });
  fireEvent.change(input, { target: { value: "本次编辑尚未保存" } });
  const trigger = screen.getByRole("button", { name: "检查退出" });
  trigger.focus();
  fireEvent.click(trigger);
  const cancel = await screen.findByRole("button", { name: "继续编辑" });
  await waitFor(() => expect(cancel).toHaveFocus());
  if (exit === "Escape") fireEvent.keyDown(cancel, { key: "Escape", code: "Escape", keyCode: 27 });
  else fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "放弃更改？" })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole("dialog", { name: "编辑原记录" })).toBeVisible();
  expect(input).toHaveValue("本次编辑尚未保存");
  expect(onResult).toHaveBeenCalledExactlyOnceWith(false);
});

it("跨种类排队逐项重置输入与焦点，末项返回整批原始入口", async () => {
  render(<><button>发起批次</button><ConfirmHost /></>);
  const trigger = screen.getByRole("button", { name: "发起批次" });
  trigger.focus();
  let first!: Promise<boolean>;
  let second!: Promise<string | null>;
  let third!: Promise<string | null>;
  let fourth!: Promise<boolean>;
  act(() => {
    first = confirmDialog({ title: "第一项确认", confirmText: "继续下一项" });
    second = promptDialog({ title: "填写更正理由", label: "更正理由", defaultValue: "原始说明", required: true, maxLength: 30 });
    third = promptDialog({ title: "下一项说明", label: "下一项内容", required: true });
    fourth = confirmDialog({ title: "最后核对", initialFocus: "cancel", cancelText: "暂不确认" });
  });
  fireEvent.click(await screen.findByRole("button", { name: "继续下一项" }));
  const input = await screen.findByRole("textbox", { name: "更正理由" });
  await waitFor(() => expect(input).toHaveFocus());
  expect(input).toHaveValue("原始说明");
  expect(input).toHaveAttribute("maxlength", "30");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请填写更正理由");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "  已核对原记录  " } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  const nextInput = await screen.findByRole("textbox", { name: "下一项内容" });
  await waitFor(() => expect(nextInput).toHaveFocus());
  expect(nextInput).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  const lastCancel = await screen.findByRole("button", { name: "暂不确认" });
  await waitFor(() => expect(lastCancel).toHaveFocus());
  fireEvent.click(lastCancel);
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe("已核对原记录");
  await expect(third).resolves.toBeNull();
  await expect(fourth).resolves.toBe(false);
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("输入窗口使用字段标签，普通 Enter 不提交，Cmd+Enter 只结算一次", async () => {
  render(<ConfirmHost />);
  const resolved = vi.fn();
  let result!: Promise<string | null>;
  act(() => { result = promptDialog({ title: "补充说明", label: "说明内容", defaultValue: "合成说明" }); void result.then(resolved); });
  const input = await screen.findByRole("textbox", { name: "说明内容" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("dialog", { name: "补充说明" })).toBeInTheDocument();
  expect(resolved).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await expect(result).resolves.toBe("合成说明");
  await waitFor(() => expect(resolved).toHaveBeenCalledExactlyOnceWith("合成说明"));
});

it("危险确认沿用取消语义，关闭图标返回 false", async () => {
  render(<ConfirmHost />);
  let result!: Promise<boolean>;
  act(() => { result = confirmDialog({ title: "删除合成记录？", danger: true }); });
  const dialog = await screen.findByRole("dialog", { name: "删除合成记录？" });
  expect(within(dialog).getByRole("button", { name: "确认" })).toHaveAttribute("type", "button");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await expect(result).resolves.toBe(false);
});
