// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientPageInputSchema } from "@/lib/clients/history";
import { decodeClientCursor, encodeClientCursor, pageBoundary } from "@/server/clients/history-cursor";

const clientId = "cmtestclient00000000000001", userId = "cmtestuser0000000000000001";
const point = { at: "2026-07-02T03:04:05.000Z", source: "CONTEXT" as const, id: "cmhiddenrecord000000000001" };
beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "synthetic-history-test-secret"));
afterEach(() => vi.unstubAllEnvs());
describe("客户历史游标的保密与作用域", () => {
  it("隐藏记录的位置加密且随机化，仍能恢复准确值边界", () => {
    const token = encodeClientCursor(clientId, userId, "history", point);
    expect(token).not.toBe(encodeClientCursor(clientId, userId, "history", point));
    const decodedBytes = Buffer.from(token, "base64url").toString("utf8");
    expect(decodedBytes).not.toContain(point.id); expect(decodedBytes).not.toContain(point.at);
    expect(decodeClientCursor(token, clientId, userId, "history")).toEqual(point);
    expect(pageBoundary("occurredAt", point, "CONTEXT")).toEqual({ OR: [
      { occurredAt: { lt: new Date(point.at) } }, { occurredAt: new Date(point.at), id: { lt: point.id } }
    ] });
  });
  it("拒绝跨客户、用户、列表类型及被篡改的游标", () => {
    const token = encodeClientCursor(clientId, userId, "history", point);
    expect(() => decodeClientCursor(token, "cmtestclient00000000000002", userId, "history")).toThrow("分页位置");
    expect(() => decodeClientCursor(token, clientId, "cmtestuser0000000000000002", "history")).toThrow("分页位置");
    expect(() => decodeClientCursor(token, clientId, userId, "matters")).toThrow("分页位置");
    const bytes = Buffer.from(token, "base64url"); bytes[30] ^= 1;
    expect(() => decodeClientCursor(bytes.toString("base64url"), clientId, userId, "history")).toThrow("分页位置");
  });
  it("同时间跨来源分页保留稳定顺序，跟进按到期时间正序", () => {
    expect(pageBoundary("createdAt", point, "CONTACT")).toEqual({ OR: [{ createdAt: { lt: new Date(point.at) } }, { createdAt: new Date(point.at) }] });
    expect(pageBoundary("createdAt", point, "NOTE")).toEqual({ OR: [{ createdAt: { lt: new Date(point.at) } }] });
    expect(pageBoundary("dueAt", { ...point, source: "FOLLOW_UP" }, "FOLLOW_UP", true)).toEqual({ OR: [
      { dueAt: { gt: new Date(point.at) } }, { dueAt: new Date(point.at), id: { gt: point.id } }
    ] });
  });
  it("外部输入不能注入过滤条件或超长位置", () => {
    expect(() => clientPageInputSchema.parse({ clientId, where: {} })).toThrow();
    expect(() => clientPageInputSchema.parse({ clientId, cursor: "x".repeat(1201) })).toThrow();
    expect(() => clientPageInputSchema.parse({ clientId: "invalid" })).toThrow();
  });
  it("未配置分页密钥时明确失败，不生成仅本进程可读的游标", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(() => encodeClientCursor(clientId, userId, "history", point)).toThrow("分页配置不可用");
  });
});
