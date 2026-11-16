// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const { serverAuth } = vi.hoisted(() => ({ serverAuth: vi.fn() }));
vi.mock("next-auth/middleware", () => ({ withAuth: () => serverAuth }));

import proxy from "@/proxy";
import { GET as openWorkspace } from "@/app/api/personal/open/route";
import { isPersonalMode, runtimeMode } from "@/lib/runtime/mode";
import {
  PERSONAL_CHANNEL_COOKIE,
  personalChannelAllowed,
  personalRuntime,
  validPersonalToken,
} from "@/lib/runtime/personal-channel";

const ORIGIN = "http://127.0.0.1:43781";
const HOST = "127.0.0.1:43781";
const TOKEN = "a7".repeat(32);
const ACTOR_ID = "cpersonal00000000000000001";
const WORKSPACE_ID = "4a96b074-b5f6-4df5-a456-f15e4c2ed2f4";
const event = {} as NextFetchEvent;

// withAuth is the only proxy dependency replaced here; its boundary is synchronous in this fixture.
function runProxy(req: NextRequest, fetchEvent: NextFetchEvent): Response {
  const response = proxy(req, fetchEvent);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

function headers(values: Record<string, string | null> = {}, cookie = true) {
  const result = new Headers({ host: HOST });
  if (cookie) result.set("cookie", `${PERSONAL_CHANNEL_COOKIE}=${TOKEN}`);
  for (const [name, value] of Object.entries(values)) {
    if (value === null) result.delete(name);
    else result.set(name, value);
  }
  return result;
}

function request(path = "/matters", values: Record<string, string | null> = {}, method = "GET", cookie = true) {
  return new NextRequest(new URL(path, ORIGIN), { method, headers: headers(values, cookie) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LEXORDER_RUNTIME_MODE", "PERSONAL");
  vi.stubEnv("LEXORDER_PERSONAL_ORIGIN", ORIGIN);
  vi.stubEnv("LEXORDER_PERSONAL_CHANNEL_TOKEN", TOKEN);
  vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", WORKSPACE_ID);
  vi.stubEnv("LEXORDER_PERSONAL_ACTOR_ID", ACTOR_ID);
  vi.stubEnv("LEXORDER_PERSONAL_MANIFEST", "/tmp/lexorder-test-only/workspace.json");
  serverAuth.mockReturnValue(new Response("Server authentication required", { status: 401 }));
});

afterEach(() => vi.unstubAllEnvs());

describe("运行模式只由启动配置确定", () => {
  it("未配置时保留 Server，未知配置拒绝而不回退", () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", undefined);
    expect(runtimeMode()).toBe("SERVER");
    expect(isPersonalMode()).toBe(false);
    expect(() => personalRuntime()).toThrow("PERSONAL_RUNTIME_UNAVAILABLE");
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "personal");
    expect(() => runtimeMode()).toThrow("INVALID_RUNTIME_MODE");
    expect(() => runProxy(request(), event)).toThrow("INVALID_RUNTIME_MODE");
    expect(serverAuth).not.toHaveBeenCalled();
  });

  it("伪造 Personal 查询、头和 cookie 不能跳过 Server 会话", () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    const req = request("/matters?mode=PERSONAL&runtimeMode=PERSONAL", {
      "x-lexorder-runtime-mode": "PERSONAL",
      "x-runtime-mode": "PERSONAL",
      cookie: `${PERSONAL_CHANNEL_COOKIE}=${TOKEN}; LEXORDER_RUNTIME_MODE=PERSONAL`,
    });
    expect(runProxy(req, event)?.status).toBe(401);
    expect(serverAuth).toHaveBeenCalledWith(req, event);
    expect(runtimeMode()).toBe("SERVER");
  });

  it("Personal 请求不能声明 Server 来逃避本地通道", () => {
    const req = request("/matters?mode=SERVER", { "x-lexorder-runtime-mode": "SERVER" }, "GET", false);
    expect(runProxy(req, event)?.status).toBe(403);
    expect(serverAuth).not.toHaveBeenCalled();
    expect(runtimeMode()).toBe("PERSONAL");
  });

  it.each([
    ["LEXORDER_PERSONAL_ORIGIN", "http://localhost:43781"],
    ["LEXORDER_PERSONAL_ORIGIN", "http://0.0.0.0:43781"],
    ["LEXORDER_PERSONAL_ORIGIN", "https://127.0.0.1:43781"],
    ["LEXORDER_PERSONAL_ORIGIN", `${ORIGIN}/nested`],
    ["LEXORDER_PERSONAL_CHANNEL_TOKEN", "short-token"],
    ["LEXORDER_PERSONAL_ACTOR_ID", "admin"],
    ["LEXORDER_PERSONAL_WORKSPACE_ID", "other-workspace"],
    ["LEXORDER_PERSONAL_MANIFEST", "./workspace.json"],
  ])("不完整启动配置 %s=%s 拒绝开放通道", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => personalRuntime()).toThrow("PERSONAL_RUNTIME_INCOMPLETE");
  });
});

describe("Personal 本地 Host、Origin 与 cookie 边界", () => {
  it("同机有效 cookie 可读，无 Origin 的写入仍拒绝", () => {
    expect(personalChannelAllowed(headers())).toBe(true);
    expect(personalChannelAllowed(headers(), { method: "POST" })).toBe(false);
    expect(personalChannelAllowed(headers({ origin: ORIGIN }), { method: "POST" })).toBe(true);
  });

  it.each([
    ["host", null],
    ["host", "evil.example"],
    ["host", "127.0.0.1:43782"],
    ["host", "localhost:43781"],
    ["host", "127.0.0.1:43781.evil.example"],
    ["x-forwarded-host", "evil.example"],
    ["x-forwarded-host", `${HOST}, evil.example`],
    ["origin", "https://evil.example"],
    ["origin", "null"],
    ["origin", "http://127.0.0.1:43782"],
    ["origin", `${ORIGIN}.evil.example`],
    ["sec-fetch-site", "cross-site"],
  ])("即使 cookie 正确，恶意 %s=%s 仍拒绝", (name, value) => {
    expect(personalChannelAllowed(headers({ [name]: value }))).toBe(false);
    expect(runProxy(request("/matters", { [name]: value }), event)?.status).toBe(403);
    expect(serverAuth).not.toHaveBeenCalled();
  });

  it.each([
    null,
    `${PERSONAL_CHANNEL_COOKIE}=${"b8".repeat(32)}`,
    `${PERSONAL_CHANNEL_COOKIE}=${TOKEN.slice(1)}`,
    `${PERSONAL_CHANNEL_COOKIE}=${TOKEN.toUpperCase()}`,
    `${PERSONAL_CHANNEL_COOKIE}=${TOKEN}; ${PERSONAL_CHANNEL_COOKIE}=${TOKEN}`,
    `${PERSONAL_CHANNEL_COOKIE}=${TOKEN}; ${PERSONAL_CHANNEL_COOKIE}=wrong`,
    `${PERSONAL_CHANNEL_COOKIE}_suffix=${TOKEN}`,
  ])("缺失、错误或歧义 cookie 不提供业务会话：%s", (cookie) => {
    expect(personalChannelAllowed(headers({ cookie }))).toBe(false);
  });

  it("其他 cookie 不影响唯一有效本地通道，令牌不会从查询或 Authorization 补取", () => {
    expect(personalChannelAllowed(headers({ cookie: `theme=dark; ${PERSONAL_CHANNEL_COOKIE}=${TOKEN}; other=value` }))).toBe(true);
    expect(runProxy(request(`/matters?token=${TOKEN}`, { authorization: `Bearer ${TOKEN}` }, "GET", false), event)?.status).toBe(403);
    expect(validPersonalToken(TOKEN)).toBe(true);
    expect(validPersonalToken(undefined)).toBe(false);
    expect(validPersonalToken("00")).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s 必须有相同 Origin，即使有合法 cookie", (method) => {
    expect(runProxy(request("/matters", {}, method), event)?.status).toBe(403);
    expect(runProxy(request("/matters", { origin: ORIGIN }, method), event)?.headers.get("x-middleware-next")).toBe("1");
  });

  it("读取静态资源可不带 cookie，但不能绕过 Host 检查", () => {
    expect(runProxy(request("/_next/static/app.js", {}, "GET", false), event)?.headers.get("x-middleware-next")).toBe("1");
    expect(runProxy(request("/_next/static/app.js", { host: "evil.example" }, "GET", false), event)?.status).toBe(403);
  });
});

describe("启动入口只建立本地通道，不选择操作者或账号", () => {
  it("有效启动令牌签发 HttpOnly、Strict cookie 并清除 URL 参数", () => {
    const response = openWorkspace(request(`/api/personal/open?token=${TOKEN}&actorId=admin&mode=SERVER`, {}, "GET", false));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PERSONAL_CHANNEL_COOKIE}=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/next-auth|actorId|admin/i);
    expect(personalRuntime().actorId).toBe(ACTOR_ID);
    expect(serverAuth).not.toHaveBeenCalled();
  });

  it.each(["", "?token=wrong", `?token=${TOKEN}&token=${TOKEN}`, `?token=${TOKEN}&token=wrong`])("缺失、错误或重复启动令牌拒绝：%s", (query) => {
    const response = openWorkspace(request(`/api/personal/open${query}`, {}, "GET", false));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("跨站启动导航仍需秘密令牌，恶意 Origin 或 Host 不获豁免", () => {
    expect(openWorkspace(request(`/api/personal/open?token=${TOKEN}`, { "sec-fetch-site": "cross-site" }, "GET", false)).status).toBe(303);
    const invalidHeaders: Record<string, string>[] = [{ origin: "https://evil.example" }, { host: "evil.example" }];
    for (const values of invalidHeaders) {
      expect(openWorkspace(request(`/api/personal/open?token=${TOKEN}`, values, "GET", false)).status).toBe(403);
    }
  });

  it("Server 不提供 Personal 启动入口", () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    const response = openWorkspace(request(`/api/personal/open?token=${TOKEN}`, {}, "GET", false));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("代理保留 Server 认证和独立令牌入口", () => {
  it.each(["/api/auth", "/api/auth/session", "/api/auth/callback/credentials", "/admin/users", "/admin/teams", "/admin/roles", "/admin/approval-permissions", "/admin/ai/users", "/admin/unknown-future-page"])("Personal 不开放账号或未列明管理入口 %s", (path) => {
    expect(runProxy(request(path), event)?.status).toBe(404);
    expect(serverAuth).not.toHaveBeenCalled();
  });

  it("Personal 登录页返回工作台，业务配置入口仍可达", () => {
    expect(runProxy(request("/login"), event)?.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(runProxy(request("/admin/ai"), event)?.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/api/calendar/subscription-token", "/api/desktop/file?token=checkout-token"])("GET %s 不要求浏览器 cookie，仍受本地与跨源边界保护", (path) => {
    expect(runProxy(request(path, {}, "GET", false), event)?.headers.get("x-middleware-next")).toBe("1");
    expect(runProxy(request(path, { host: "evil.example" }, "GET", false), event)?.status).toBe(403);
    expect(runProxy(request(path, { origin: "https://evil.example" }, "GET", false), event)?.status).toBe(403);
    expect(runProxy(request(path, { "sec-fetch-site": "cross-site" }, "GET", false), event)?.status).toBe(403);
    expect(runProxy(request(path, { origin: ORIGIN }, "POST", false), event)?.status).toBe(403);
  });

  it.each(["/login", "/api/auth/session", "/api/health", "/api/calendar/subscription-token", "/_next/static/app.js"])("Server 原有公开入口 %s 保持可达", (path) => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    expect(runProxy(request(path, {}, "GET", false), event)?.headers.get("x-middleware-next")).toBe("1");
    expect(serverAuth).not.toHaveBeenCalled();
  });

  it.each(["/matters", "/admin/users", "/api/documents/document-id/download", "/api/desktop/file?token=checkout-token"])("Server 受保护入口 %s 继续交给原认证代理", (path) => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    const req = request(path);
    expect(runProxy(req, event)?.status).toBe(401);
    expect(serverAuth).toHaveBeenCalledWith(req, event);
  });
});
