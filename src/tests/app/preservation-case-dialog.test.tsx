import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { caseCreateSchema, caseUpdateSchema } from "@/server/preservations/schemas-v2";
import type { PreservationCaseRow } from "@/app/(app)/preservation/_components/preservation-types";

const mock = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), confirm: vi.fn(), error: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({
  createPreservationCase: mock.create, updatePreservationCase: mock.update, deletePreservationCase: vi.fn(), addProperty: vi.fn(), addTarget: vi.fn(), renewProperty: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: vi.fn() } }));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mock.confirm }));
vi.mock("@/components/layout/topbar-action", () => ({ useTopbarAction: vi.fn() }));

import { PreservationCaseDialog } from "@/app/(app)/preservation/_components/preservation-dialog";
import { PreservationsView } from "@/app/(app)/preservation/_components/preservations-view";

const matterId = "cm00000000000000000000001";
function record(): PreservationCaseRow {
  return {
    id: "cp00000000000000000000001", matterId, type: "LITIGATION", status: "ACTIVE", court: "合成原法院", rulingNumber: "合成裁定号",
    ownerId: "cu00000000000000000000001", note: "合成原备注", guaranteeType: "GUARANTEE_LETTER", appliedAt: new Date("2026-01-02T03:04:05.678Z"),
    remindDays: [12, 4], createdAt: new Date("2026-01-02T03:04:05.678Z"), updatedAt: new Date("2026-11-18T01:02:03.456Z"),
    matter: { id: matterId, internalCode: "SYNTHETIC-PRES-001", title: "合成原事项" }, owner: { id: "cu00000000000000000000001", name: "合成原负责人" }, targets: [],
  };
}
function view(item: PreservationCaseRow) { return <PreservationsView items={[item]} matters={[]} users={[]} />; }
function MatterCreateHarness() {
  const [open, setOpen] = useState(true);
  return <>
    <button type="button" onClick={() => setOpen(true)}>再次新建保全</button>
    <PreservationCaseDialog open={open} onOpenChange={setOpen} initialMatterId={matterId}
      matters={[{ id: matterId, internalCode: "SYNTHETIC-PRES-001", title: "合成事项" }]} users={[]} />
  </>;
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.create.mockImplementation(async input => {
    caseCreateSchema.parse(input);
    return { ok: true, id: "cp00000000000000000000001" };
  });
  mock.update.mockImplementation(async input => { caseUpdateSchema.parse(input); return { ok: true }; });
  mock.confirm.mockResolvedValue(true);
});

it("真实卡片编辑仅更新原 ID 和变化字段，不发送未展示字段；现关联不在选项仍显示", async () => {
  const original = record();
  render(view(original));
  fireEvent.click(screen.getByRole("button", { name: "编辑保全" }));
  expect(screen.getByRole("combobox", { name: "关联案件" })).toHaveTextContent("合成原事项");
  expect(screen.getByRole("combobox", { name: "跟进负责人" })).toHaveTextContent("合成原负责人");
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("备注"), { target: { value: "合成更正备注" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mock.update).toHaveBeenCalledExactlyOnceWith({ id: original.id, expectedUpdatedAt: original.updatedAt, note: "合成更正备注" });
  expect(mock.create).not.toHaveBeenCalled();
});

it("打开后父刷新保留旧版本和草稿，失败保稿；关闭重开才采用最新记录", async () => {
  const original = record(), refreshed = { ...original, note: "另一人更新", updatedAt: new Date(original.updatedAt.getTime() + 1) };
  const rendered = render(view(original));
  fireEvent.click(screen.getByRole("button", { name: "编辑保全" }));
  fireEvent.change(screen.getByLabelText("备注"), { target: { value: "当前未保存稿" } });
  rendered.rerender(view(refreshed));
  expect(screen.getByLabelText("备注")).toHaveValue("当前未保存稿");
  mock.update.mockRejectedValueOnce(new Error("保全记录已变化，请关闭后重新打开并核对"));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(mock.error).toHaveBeenCalled());
  expect(mock.update).toHaveBeenLastCalledWith({ id: original.id, expectedUpdatedAt: original.updatedAt, note: "当前未保存稿" });
  expect(screen.getByLabelText("备注")).toHaveValue("当前未保存稿");
  mock.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "编辑保全" }));
  expect(screen.getByLabelText("备注")).toHaveValue("另一人更新");
  fireEvent.change(screen.getByLabelText("备注"), { target: { value: "核对后保存" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(2));
  expect(mock.update).toHaveBeenLastCalledWith({ id: original.id, expectedUpdatedAt: refreshed.updatedAt, note: "核对后保存" });
});

it("保存期间禁止退出和重复提交，等待完成后关闭", async () => {
  let finish!: (value: { ok: boolean }) => void;
  mock.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(view(record()));
  fireEvent.click(screen.getByRole("button", { name: "编辑保全" }));
  fireEvent.change(screen.getByLabelText("保全法院"), { target: { value: "更正法院" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByLabelText("保全法院")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(mock.update).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
afterEach(cleanup);

it("事项入口成功创建后重开同一表单，再次创建仍默认关联当前事项", async () => {
  render(<MatterCreateHarness />);
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mock.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ matterId }));

  fireEvent.click(screen.getByRole("button", { name: "再次新建保全" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
  expect(mock.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ matterId }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
