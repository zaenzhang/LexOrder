import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ add: vi.fn(), renew: vi.fn(), error: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({ addProperty: mock.add, createPreservationCase: vi.fn(), updatePreservationCase: vi.fn(), addTarget: vi.fn(), renewProperty: mock.renew }));
vi.mock("@douyinfe/semi-ui", async importOriginal => {
  const semi = await importOriginal<typeof import("@douyinfe/semi-ui")>();
  return {
    ...semi,
    Toast: Object.assign(semi.Toast, { success: vi.fn() }),
    Notification: Object.assign(semi.Notification, { error: mock.error, success: vi.fn() })
  };
});
import { AddPropertyDialog, RenewPropertyDialog } from "@/app/(app)/preservation/_components/preservation-dialog";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("不完整年份的日期预览保留表单；提交明确拒绝，修正后恢复参考", async () => {
  render(<AddPropertyDialog open onOpenChange={vi.fn()} targetId="cm00000000000000000000001" />);
  fireEvent.change(screen.getByLabelText("财产详情"), { target: { value: "应保留的合成财产描述" } });
  fireEvent.change(screen.getByLabelText("生效日期"), { target: { value: "0202-11-16" } });
  fireEvent.change(screen.getByLabelText("到期日（法院文书载明）"), { target: { value: "2027-11-16" } });
  expect(screen.getByRole("status")).toHaveTextContent("日期尚未完整或无效");
  expect(screen.getByLabelText("财产详情")).toHaveValue("应保留的合成财产描述");
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  await waitFor(() => expect(mock.error).toHaveBeenCalledWith(expect.objectContaining({ title: "请填写有效的生效日期与到期日" })));
  expect(mock.add).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("生效日期"), { target: { value: "2026-11-16" } });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText(/法定上限.*2027-11-16/)).toBeInTheDocument();
  expect(screen.getByLabelText("财产详情")).toHaveValue("应保留的合成财产描述");
});

it("续保拒绝空白、零、负数与小数，并只提交明确填写的整数天数", async () => {
  const id = "cm00000000000000000000001";
  const expiryDate = new Date("2026-11-16T04:00:00.000Z");
  const close = vi.fn();
  mock.renew.mockResolvedValue({ ok: true });
  render(<RenewPropertyDialog open onOpenChange={close} property={{ id, expiryDate }} />);
  const input = screen.getByRole("spinbutton", { name: "续保天数" });
  const confirm = screen.getByRole("button", { name: "确认续保" });

  for (const value of ["", "0", "-7", "1.5"]) {
    fireEvent.change(input, { target: { value } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("请输入大于 0 的整数天数。")).toBeVisible();
  }
  expect(mock.renew).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "7" } });
  expect(screen.getByText(/续保后到期日.*2026-11-23/)).toBeVisible();
  fireEvent.click(confirm);
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(mock.renew).toHaveBeenCalledExactlyOnceWith({
    propertyId: id, renewalDuration: 7, newExpiryDate: new Date("2026-11-23T04:00:00.000Z"), note: ""
  });
});
