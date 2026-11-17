// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { clientPageInputSchema, clientHistoryInputSchema } from "@/lib/clients/history";
import { decodeClientCursor, encodeClientCursor, pageBoundary } from "@/server/clients/history-cursor";

const clientId = "cmtestclient00000000000001", userId = "cmtestuser0000000000000001";
const point = { at: "2026-07-02T03:04:05.000Z", source: "CONTEXT" as const, id: "cmhiddenrecord000000000001" };
afterEach(() => vi.unstubAllEnvs());
describe("客户历史游标的保密与作用域", () => {
  it("隐藏记录的位置加密且随机化，仍能恢复准确值边界", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "synthetic-history-test-secret");
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
  it("交付事件的位置沿同一加密游标推进，不能当成其他列表的位置", () => {
    const delivery = { ...point, source: "DELIVERY" as const };
    const token = encodeClientCursor(clientId, userId, "history", delivery);
    expect(decodeClientCursor(token, clientId, userId, "history")).toEqual(delivery);
    expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain(delivery.id);
    expect(pageBoundary("occurredAt", delivery, "CONTEXT")).toEqual({ OR: [
      { occurredAt: { lt: new Date(point.at) } }, { occurredAt: new Date(point.at) }
    ] });
    expect(() => decodeClientCursor(token, clientId, userId, "communications")).toThrow("分页位置");
  });
  it("外部输入不能注入过滤条件或超长位置", () => {
    expect(() => clientPageInputSchema.parse({ clientId, where: {} })).toThrow();
    expect(() => clientPageInputSchema.parse({ clientId, cursor: "x".repeat(1201) })).toThrow();
    expect(() => clientPageInputSchema.parse({ clientId: "invalid" })).toThrow();
  });
  it("历史游标绑定四个规范筛选，不能转作事项候选或换条件读取", () => {
    const filters = { from: "2026-07-01", to: "2026-07-02", source: "CONTEXT" as const, matterId: "cmtestmatter00000000000001" };
    const token = encodeClientCursor(clientId, userId, "history", point, filters);
    expect(decodeClientCursor(token, clientId, userId, "history", { ...filters })).toEqual(point);
    for (const changed of [{ ...filters, from: undefined }, { ...filters, to: "2026-07-03" },
      { ...filters, source: "NOTE" as const }, { ...filters, matterId: "cmtestmatter00000000000002" }, {}]) {
      expect(() => decodeClientCursor(token, clientId, userId, "history", changed)).toThrow("分页位置");
    }
    expect(() => decodeClientCursor(token, clientId, userId, "historyMatters")).toThrow("分页位置");
    const event = { ...point, source: "DELIVERY" as const };
    const candidate = encodeClientCursor(clientId, userId, "historyMatters", event);
    expect(decodeClientCursor(candidate, clientId, userId, "historyMatters")).toEqual(event);
    expect(() => decodeClientCursor(candidate, clientId, userId, "history")).toThrow("分页位置");
    expect(() => decodeClientCursor(encodeClientCursor(clientId, userId, "historyMatters", point), clientId, userId, "historyMatters")).toThrow("分页位置");
  });
  it("旧无筛选历史密文失效，其他现行列表的位置不受影响", () => {
    const secret = "synthetic-history-old-envelope";
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const domain = Buffer.from("LexOrder.client-history.cursor.v1"), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(domain).update(secret).digest(), iv);
    cipher.setAAD(domain);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ v: 1, clientId, userId, kind: "history", ...point })), cipher.final()]);
    const legacy = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
    expect(() => decodeClientCursor(legacy, clientId, userId, "history")).toThrow("分页位置");
    for (const [kind, source] of [["matters", "MATTER"], ["communications", "CLIENT_ACTIVITY"], ["followUps", "FOLLOW_UP"]] as const) {
      const position = { ...point, source }, token = encodeClientCursor(clientId, userId, kind, position);
      expect(decodeClientCursor(token, clientId, userId, kind)).toEqual(position);
    }
  });
  it("独立历史输入接受单端有效业务日并拒绝坏区间和类型", () => {
    expect(clientHistoryInputSchema.parse({ clientId, from: "2024-02-29" }).from).toBe("2024-02-29");
    expect(clientHistoryInputSchema.parse({ clientId, to: "2026-07-02" }).to).toBe("2026-07-02");
    for (const filters of [{ from: "2026-02-29" }, { from: "2026-7-02" }, { to: "2026-07-32" },
      { from: "2026-07-03", to: "2026-07-02" }, { from: "" }, { source: "ALL" }, { matterId: "bad" }, { where: {} }]) {
      expect(clientHistoryInputSchema.safeParse({ clientId, ...filters }).success).toBe(false);
    }
    expect(clientPageInputSchema.safeParse({ clientId, source: "NOTE" }).success).toBe(false);
  });
});
