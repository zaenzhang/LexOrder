import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConfirmHost, confirmDialog } from "@/components/patterns/confirm-dialog";

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
