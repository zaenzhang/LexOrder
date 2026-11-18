import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WorkspaceDialog, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/patterns/workspace-dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { MatterCombobox } from "@/app/(app)/approvals/seals/_components/matter-combobox";

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Form() {
  const [open, setOpen] = useState(true);
  return (
    <WorkspaceDialog open={open} onOpenChange={setOpen}>
      <FormDialogContent>
        <DialogHeader><DialogTitle>申请表</DialogTitle><DialogDescription>填写资料</DialogDescription></DialogHeader>
        <FormDialogBody>
          <input aria-label="填写中内容" defaultValue="保留这段草稿" />
          <MatterCombobox
            matters={[]}
            value=""
            onChange={() => {}}
            placeholder="选择关联案件"
          />
        </FormDialogBody>
        <DialogFooter><button onClick={() => setOpen(false)}>取消</button></DialogFooter>
      </FormDialogContent>
    </WorkspaceDialog>
  );
}
describe("统一表单中的嵌套菜单", () => {
  it("Esc 仅关闭案件菜单，继续保留申请窗口与草稿", async () => {
    render(<Form />);
    const combobox = screen.getByRole("combobox", { name: "关联案件" });
    fireEvent.click(combobox);
    const query = await within(combobox).findByRole("textbox");
    expect(await screen.findByRole("listbox")).toBeVisible();
    fireEvent.keyDown(query, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "申请表" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "填写中内容" })).toHaveValue("保留这段草稿");
    fireEvent.keyDown(combobox, { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
