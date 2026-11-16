// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(), read: vi.fn(), search: vi.fn(), local: vi.fn(), audit: vi.fn(), settings: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/permissions", () => ({ assertCanReadMatter: mocks.read }));
vi.mock("@/server/audit", () => ({ auditStrict: mocks.audit }));
vi.mock("@/lib/yuandian/settings", () => ({ getYuandianSettings: mocks.settings }));
vi.mock("@/lib/yuandian/client", () => ({ searchRegulations: mocks.search, YuandianNotConfiguredError: class extends Error {} }));
vi.mock("@/lib/cncases/client", () => ({ searchLocalJudgments: mocks.local }));
import { searchRegulationsAction } from "./regulations";
import { searchLocalJudgmentsAction } from "../cncases/search";
const matterId = "cmatter000000000000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: "u1", role: "CUSTOM", rolePermissions: [{ key: "matters.write", scope: "OWN" }] } });
  mocks.read.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ configured: true });
  mocks.search.mockResolvedValue({ total: 0, items: [] });
  mocks.local.mockResolvedValue({ available: true, total: 0, items: [] });
});
describe("法律检索授权与输入边界", () => {
  it("uses custom-role permission and validates matter association before network", async () => {
    await searchRegulationsAction({ keyword: "合同", matterId });
    expect(mocks.requireSession).toHaveBeenCalledWith("matters.write");
    expect(mocks.read).toHaveBeenCalledWith("u1", "CUSTOM", matterId, expect.any(Array));
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ keyword: "合同", top_k: 10 }), { configured: true }, "u1");
  });
  it.each(["regulations", "local"])("rejects wrong matter before %s request", async mode => {
    mocks.read.mockRejectedValue(new Error("无权访问"));
    const call = mode === "local" ? searchLocalJudgmentsAction("合同", { matterId }) : searchRegulationsAction({ keyword: "合同", matterId });
    await expect(call).rejects.toThrow("无权");
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects empty and excessive requests before network", async () => {
    await expect(searchRegulationsAction({})).rejects.toThrow();
    await expect(searchLocalJudgmentsAction(" ")).rejects.toThrow();
    await expect(searchLocalJudgmentsAction("合同", { max: 99 })).rejects.toThrow();
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("does not hide failed audit and does not store the search text", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(searchLocalJudgmentsAction("合成私有关键词", { matterId })).rejects.toThrow("audit unavailable");
    expect(mocks.audit.mock.calls[0][0].detail).toMatchObject({ queryLength: 7 });
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("合成私有关键词");
  });
});
