import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ add: vi.fn(), error: vi.fn() }));
vi.mock("@/server/preservations/actions-v2", () => ({ addProperty: mock.add, createPreservationCase: vi.fn(), addTarget: vi.fn(), renewProperty: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: vi.fn() } }));
import { AddPropertyDialog } from "@/app/(app)/preservation/_components/preservation-dialog";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("不完整年份的日期预览保留表单；提交明确拒绝，修正后恢复参考", async () => {
  render(<AddPropertyDialog open onOpenChange={vi.fn()} targetId="cm00000000000000000000001" />);
  fireEvent.change(screen.getByPlaceholderText("如：账号/地址"), { target: { value: "应保留的合成财产描述" } });
  fireEvent.change(screen.getByLabelText("生效日期"), { target: { value: "0202-11-16" } });
  fireEvent.change(screen.getByLabelText("到期日（法院文书载明）"), { target: { value: "2027-11-16" } });
  expect(screen.getByRole("status")).toHaveTextContent("日期尚未完整或无效");
  expect(screen.getByPlaceholderText("如：账号/地址")).toHaveValue("应保留的合成财产描述");
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  await waitFor(() => expect(mock.error).toHaveBeenCalledWith("请填写有效的生效日期与到期日"));
  expect(mock.add).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("生效日期"), { target: { value: "2026-11-16" } });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText(/法定上限.*2027-11-16/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText("如：账号/地址")).toHaveValue("应保留的合成财产描述");
});
