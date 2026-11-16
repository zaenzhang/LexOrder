import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientPagination, useClientPagination } from "@/app/(app)/clients/[id]/_components/client-pagination";
import type { ClientPageInput } from "@/lib/clients/history";

type Page = { items: string[]; nextCursor: string | null };
const first: Page = { items: ["合成第一页"], nextCursor: "opaque-next" };
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Harness({ initial = first, clientId = "client-a", read }: { initial?: Page; clientId?: string; read: (input: ClientPageInput) => Promise<Page> }) {
  const controls = useClientPagination(clientId, initial, read);
  return <><ul>{controls.page?.items.map(item => <li key={item}>{item}</li>)}</ul><ClientPagination controls={controls} label="测试记录" /></>;
}
afterEach(cleanup);
describe("客户分页只保留当前授权页", () => {
  it("换页隐藏旧正文；失败可重试；返回上一页也重新读取", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("资格已变化")).mockResolvedValueOnce({ items: ["合成第二页"], nextCursor: null }).mockResolvedValueOnce(first);
    render(<Harness read={read} />);
    fireEvent.click(screen.getByRole("button", { name: "测试记录下一页" }));
    expect(screen.queryByText("合成第一页")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("资格已变化"));
    fireEvent.click(screen.getByRole("button", { name: "重试测试记录" }));
    await screen.findByText("合成第二页");
    expect(read.mock.calls[1][0]).toEqual({ clientId: "client-a", cursor: "opaque-next" });
    fireEvent.click(screen.getByRole("button", { name: "测试记录上一页" }));
    await screen.findByText("合成第一页");
    expect(read.mock.calls[2][0]).toEqual({ clientId: "client-a" });
  });
  it("刷新使正在进行的旧页请求失效，旧响应不能覆盖新页", async () => {
    const old = pending<Page>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: ["最新权限页"], nextCursor: null });
    render(<Harness read={read} />);
    fireEvent.click(screen.getByRole("button", { name: "测试记录下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新测试记录" }));
    await screen.findByText("最新权限页");
    await act(async () => old.resolve({ items: ["旧请求受限正文"], nextCursor: null }));
    expect(screen.queryByText("旧请求受限正文")).not.toBeInTheDocument();
    expect(screen.getByText("最新权限页")).toBeInTheDocument();
  });
  it("服务端新 payload 或切换客户会清页并拒绝迟到结果", async () => {
    const old = pending<Page>(), read = vi.fn().mockReturnValue(old.promise);
    const result = render(<Harness read={read} />);
    fireEvent.click(screen.getByRole("button", { name: "测试记录下一页" }));
    result.rerender(<Harness read={read} initial={{ items: ["刷新后的授权记录"], nextCursor: null }} />);
    await act(async () => old.resolve({ items: ["旧页正文"], nextCursor: null }));
    expect(screen.queryByText("旧页正文")).not.toBeInTheDocument();
    expect(screen.getByText("刷新后的授权记录")).toBeInTheDocument();
    result.rerender(<Harness clientId="client-b" read={read} initial={{ items: ["另一客户"], nextCursor: null }} />);
    expect(screen.queryByText("刷新后的授权记录")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试记录上一页" })).toBeDisabled();
  });
});
