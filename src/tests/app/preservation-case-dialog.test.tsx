import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { caseCreateSchema } from "@/server/preservations/schemas-v2";

const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({
  createPreservationCase: mock.create, addProperty: vi.fn(), addTarget: vi.fn(), renewProperty: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PreservationCaseDialog } from "@/app/(app)/preservation/_components/preservation-dialog";

const matterId = "cm00000000000000000000001";
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
