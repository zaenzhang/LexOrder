// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ safeFetch: vi.fn(), log: vi.fn(async (_input, fn: () => Promise<unknown>) => fn()) }));
vi.mock("@/lib/net/safe-url", () => ({ safeFetch: mocks.safeFetch, assertSafeHttpUrl: vi.fn() }));
vi.mock("@/lib/external-call-log", () => ({ withExternalCallLog: mocks.log }));
vi.mock("./settings", () => ({ getYuandianSettings: vi.fn() }));
import { searchRegulations } from "./client";
const settings = { configured: true, apiKey: "fixture-key", baseUrl: "https://api.example.invalid/open", caseDetailHost: "https://laws.example.invalid" };
beforeEach(() => { mocks.safeFetch.mockReset(); mocks.log.mockClear(); });
describe("元典法规协议", () => {
  it("uses safe transport, actor log, array response and absolute original-source link", async () => {
    mocks.safeFetch.mockResolvedValue(new Response(JSON.stringify({ status: "success", data: [{ title: "合成法规", url: "/zxt/statuteDetail/detailPage/test", content: "合成命中片段" }] })));
    const result = await searchRegulations({ keyword: "合同", top_k: 10 }, settings, "actor");
    expect(result.items[0]).toMatchObject({ fgmc: "合成法规", detailUrl: "https://laws.example.invalid/zxt/statuteDetail/detailPage/test" });
    expect(mocks.safeFetch).toHaveBeenCalledWith("https://api.example.invalid/open/rh_fg_search", expect.objectContaining({ redirect: "error" }));
    expect(JSON.parse(mocks.safeFetch.mock.calls[0][1].body)).toEqual({ keyword: "合同", search_mode: "AND", top_k: 10 });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ userId: "actor", action: "regulation-search" }), expect.any(Function));
  });
  it("reports provider refusal instead of claiming zero results", async () => {
    mocks.safeFetch.mockResolvedValue(new Response(JSON.stringify({ status: "failed", code: 403, message: "无接口权益" })));
    await expect(searchRegulations({ fgmc: "合同法" }, settings)).rejects.toThrow("无接口权益");
  });
});
