import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDetailSection } from "@/components/patterns/detail-section-loading";

it("未进入区块时不取数，并且忽略前一个案件的延迟响应", async () => {
  let resolveOld!: (value: string) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce("新案件");
  const { result, rerender } = renderHook(
    ({ id, active }) => useDetailSection(load, id, 1, active),
    { initialProps: { id: "old", active: false } },
  );
  expect(load).not.toHaveBeenCalled();
  rerender({ id: "old", active: true });
  rerender({ id: "new", active: true });
  await waitFor(() => expect(result.current.data).toBe("新案件"));
  await act(async () => resolveOld("旧案件"));
  expect(result.current.data).toBe("新案件");
});

it("加载失败可重试，案件刷新后重新读取", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("暂不可用")).mockResolvedValueOnce("已加载").mockResolvedValueOnce("已刷新");
  const { result, rerender } = renderHook(key => useDetailSection(load, "matter", key, true), { initialProps: 1 });
  await waitFor(() => expect(result.current.error).toBe("暂不可用"));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.data).toBe("已加载"));
  rerender(2);
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.data).toBe("已刷新"));
});
