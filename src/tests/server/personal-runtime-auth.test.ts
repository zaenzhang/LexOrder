// @vitest-environment node
/** Real manifest files and runtime/auth/route code; Prisma and external I/O are boundary doubles. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    systemSetting: { findUnique: vi.fn() },
    document: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  serverSession: vi.fn(),
  authHandler: vi.fn(),
  requestHeaders: vi.fn(),
  redirect: vi.fn(),
  audit: vi.fn(),
  auditTx: vi.fn(),
  comparePassword: vi.fn(),
  hashPassword: vi.fn(),
  recordLoginFailure: vi.fn(),
  scheduleItems: vi.fn(),
  readStoredFile: vi.fn(),
  canReadDocument: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("next-auth", () => ({ getServerSession: mocks.serverSession, default: () => mocks.authHandler }));
vi.mock("next/headers", () => ({ headers: mocks.requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: mocks.audit, auditTx: mocks.auditTx }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.comparePassword, hash: mocks.hashPassword } }));
vi.mock("@/lib/auth/login-lockout", () => ({ recordLoginFailure: mocks.recordLoginFailure }));
vi.mock("@/lib/storage", () => ({ storage: { readFile: mocks.readStoredFile } }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.canReadDocument }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: vi.fn(), approvalAudit: vi.fn() }));
vi.mock("@/server/schedule/query", () => ({ queryScheduleItems: mocks.scheduleItems }));

import { ActionError } from "@/lib/action-error";
import { authOptions } from "@/lib/auth/options";
import { getSession, requireSession, requireSystemAdmin, requireWorkspaceConfiguration } from "@/lib/auth/session";
import { issueCheckoutToken } from "@/lib/desktop/checkout-token";
import { resolveRoleUser } from "@/lib/roles/service";
import { PERSONAL_CHANNEL_COOKIE } from "@/lib/runtime/personal-channel";
import { resolvePersonalActor } from "@/server/runtime/personal";
import {
  checkLoginRequiresTotp, checkLoginTotpEnforcement, disableTotp, enrollConfirmTotp, enrollStartTotp,
} from "@/server/auth/totp-actions";
import { changeMyPassword, listUsers } from "@/server/users/actions";
import { GET as calendarFeed } from "@/app/api/calendar/[token]/route";
import { GET as desktopFile } from "@/app/api/desktop/file/route";
import { GET as authGet, POST as authPost } from "@/app/api/auth/[...nextauth]/route";

const ACTOR_ID = "cpersonal00000000000000001";
const OTHER_ACTOR_ID = "cother00000000000000000001";
const WORKSPACE_ID = "4a96b074-b5f6-4df5-a456-f15e4c2ed2f4";
const OTHER_WORKSPACE_ID = "af71fb32-cd83-4242-9769-8aa3fd0c75d0";
const ORIGIN = "http://127.0.0.1:43781";
const TOKEN = "a7".repeat(32);
const MANIFEST = { version: 2, mode: "PERSONAL", workspaceId: WORKSPACE_ID, actorId: ACTOR_ID };
const db = mocks.db as unknown as Prisma.TransactionClient;
let directory: string;
let manifestPath: string;

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR_ID, name: "本机律师", email: "operator@personal.invalid", avatar: null,
    active: true, role: "INDEPENDENT_LAWYER", systemRole: "NONE", managerAuthorized: false,
    roleDefinitionId: null, passwordHash: "!personal-no-login", totpEnabled: false, totpEnforced: false,
    ...overrides,
  };
}

function serverSession() {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id: ACTOR_ID, name: "旧会话", email: "server@example.invalid", role: "PRINCIPAL_LAWYER", systemRole: "SUPER_ADMIN", managerAuthorized: true },
  };
}

function channelHeaders(cookie = true) {
  const result = new Headers({ host: "127.0.0.1:43781" });
  if (cookie) result.set("cookie", `${PERSONAL_CHANNEL_COOKIE}=${TOKEN}`);
  return result;
}

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), "lexorder-personal-auth-"));
  manifestPath = join(directory, "workspace.json");
  await writeFile(manifestPath, JSON.stringify(MANIFEST), { mode: 0o600 });
  vi.stubEnv("LEXORDER_RUNTIME_MODE", "PERSONAL");
  vi.stubEnv("LEXORDER_PERSONAL_ORIGIN", ORIGIN);
  vi.stubEnv("LEXORDER_PERSONAL_CHANNEL_TOKEN", TOKEN);
  vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", WORKSPACE_ID);
  vi.stubEnv("LEXORDER_PERSONAL_ACTOR_ID", ACTOR_ID);
  vi.stubEnv("LEXORDER_PERSONAL_MANIFEST", manifestPath);
  mocks.db.user.findUnique.mockResolvedValue(actor());
  mocks.db.systemSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === "personal-workspace" ? { value: { ...MANIFEST } } : null);
  mocks.requestHeaders.mockResolvedValue(channelHeaders());
  mocks.serverSession.mockResolvedValue(null);
  mocks.authHandler.mockReturnValue(new Response("Server auth route", { status: 202 }));
  mocks.redirect.mockImplementation((destination: string) => { throw new Error(`REDIRECT:${destination}`); });
  mocks.comparePassword.mockResolvedValue(false);
  mocks.recordLoginFailure.mockResolvedValue(1);
  mocks.scheduleItems.mockResolvedValue([]);
  mocks.canReadDocument.mockResolvedValue(true);
  mocks.readStoredFile.mockResolvedValue(Buffer.from("synthetic document"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("Personal 稳定操作者与工作区三方绑定", () => {
  it("真实 manifest 与数据库匹配时只返回固定本机操作者，不制造管理员或登录凭据", async () => {
    const first = await resolvePersonalActor(db);
    const second = await resolvePersonalActor(db, ACTOR_ID);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ id: ACTOR_ID, role: "INDEPENDENT_LAWYER", systemRole: "NONE", managerAuthorized: false, runtimeMode: "PERSONAL", email: null });
    expect(first).not.toHaveProperty("passwordHash");
    expect(first).not.toHaveProperty("rolePermissions");
    expect(first).not.toHaveProperty("token");
    expect(first).not.toHaveProperty("expires");
  });

  it("调用者不能把任意 User ID 变成本机操作者", async () => {
    await expect(resolvePersonalActor(db, OTHER_ACTOR_ID)).rejects.toThrow("不属于本机工作区");
    expect(mocks.db.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    { version: 1 }, { mode: "SERVER" }, { workspaceId: OTHER_WORKSPACE_ID }, { actorId: OTHER_ACTOR_ID },
  ])("manifest 身份偏差 %j 拒绝数据库身份解析", async (override) => {
    await writeFile(manifestPath, JSON.stringify({ ...MANIFEST, ...override }));
    await expect(resolvePersonalActor(db)).rejects.toThrow("工作区身份不一致");
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null, { version: 1 }, { mode: "SERVER" }, { workspaceId: OTHER_WORKSPACE_ID }, { actorId: OTHER_ACTOR_ID },
  ])("数据库工作区身份偏差 %j 不接受外部 manifest 单方授权", async (override) => {
    mocks.db.systemSetting.findUnique.mockResolvedValue(override === null ? null : { value: { ...MANIFEST, ...override } });
    await expect(resolvePersonalActor(db)).rejects.toThrow("工作区身份不一致");
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("进程启动身份与文件和数据库不一致仍拒绝", async () => {
    vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", OTHER_WORKSPACE_ID);
    await expect(resolvePersonalActor(db)).rejects.toThrow("工作区身份不一致");
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("manifest 缺失或损坏失败关闭，不能回退到数据库默认用户", async () => {
    await rm(manifestPath);
    await expect(resolvePersonalActor(db)).rejects.toThrow(ActionError);
    await writeFile(manifestPath, "{broken");
    await expect(resolvePersonalActor(db)).rejects.toThrow(ActionError);
    for (const malformed of ["null", "[]", "42"]) {
      await writeFile(manifestPath, malformed);
      await expect(resolvePersonalActor(db)).rejects.toThrow(ActionError);
    }
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null, { active: false }, { role: "FINANCE" }, { role: "PRINCIPAL_LAWYER" }, { role: "CUSTOM" },
    { systemRole: "SUPER_ADMIN" }, { managerAuthorized: true }, { roleDefinitionId: "role-id" },
    { passwordHash: "ordinary-login-hash" }, { totpEnabled: true }, { totpEnforced: true },
  ])("不存在、停用或带账号/提权配置的操作者 %j 不可使用", async (override) => {
    mocks.db.user.findUnique.mockResolvedValue(override === null ? null : actor(override));
    await expect(resolvePersonalActor(db)).rejects.toThrow("本机操作者不可用");
  });

  it("每次解析复核当前状态，改名和联系方式不改变身份", async () => {
    expect((await resolvePersonalActor(db))?.id).toBe(ACTOR_ID);
    mocks.db.user.findUnique.mockResolvedValue(actor({ name: "新的执业姓名", email: "contact@example.invalid" }));
    expect(await resolvePersonalActor(db)).toMatchObject({ id: ACTOR_ID, name: "新的执业姓名", email: "contact@example.invalid", systemRole: "NONE" });
    mocks.db.user.findUnique.mockResolvedValue(actor({ active: false }));
    await expect(resolvePersonalActor(db)).rejects.toThrow("本机操作者不可用");
  });

  it("事务内角色解析只使用调用者提供的连接，且不信任传入的高权限岗位", async () => {
    const transaction = {
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { ...MANIFEST } }) },
      user: { findUnique: vi.fn().mockResolvedValue(actor()) },
    };
    const user = await resolveRoleUser(ACTOR_ID, "PRINCIPAL_LAWYER", transaction as unknown as Prisma.TransactionClient);
    expect(user).toMatchObject({ enabled: true, role: "INDEPENDENT_LAWYER", systemRole: "NONE", managerAuthorized: false });
    expect(transaction.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("Server 解析不读取 Personal manifest 或本机操作者", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    await rm(manifestPath);
    expect(await resolvePersonalActor(db, OTHER_ACTOR_ID)).toBeNull();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
});

describe("共用会话入口保留 Personal 与 Server 边界", () => {
  it("Personal 返回固定操作者且无会话过期时间，不采用已有 NextAuth 管理员", async () => {
    mocks.serverSession.mockResolvedValue(serverSession());
    const session = await getSession();
    expect(session?.user).toMatchObject({ id: ACTOR_ID, runtimeMode: "PERSONAL", systemRole: "NONE", managerAuthorized: false });
    expect(session).not.toHaveProperty("expires");
    expect(mocks.serverSession).not.toHaveBeenCalled();
  });

  it("Personal cookie 缺失时没有 NextAuth 回退，也不访问工作区数据库", async () => {
    mocks.requestHeaders.mockResolvedValue(channelHeaders(false));
    mocks.serverSession.mockResolvedValue(serverSession());
    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toThrow("本机工作区入口");
    expect(mocks.serverSession).not.toHaveBeenCalled();
    expect(mocks.db.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("Personal 可管理业务配置，但不能借此获得系统管理员或人员管理能力", async () => {
    expect((await requireWorkspaceConfiguration()).user.runtimeMode).toBe("PERSONAL");
    await expect(requireSystemAdmin()).rejects.toThrow("仅系统超级管理员");
    await expect(listUsers()).rejects.toThrow("仅系统超级管理员");
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it("Server 即使收到本地通道 cookie 也必须有真实会话", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.serverSession).toHaveBeenCalled();
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("Server 继续按当前数据库身份撤销旧会话中的管理员与管理权", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    mocks.serverSession.mockImplementation(async () => serverSession());
    mocks.db.user.findUnique.mockResolvedValue(actor({ role: "LAWYER", systemRole: "NONE" }));
    const session = await getSession();
    expect(session).toMatchObject({ expires: "2099-01-01T00:00:00.000Z", user: { role: "LAWYER", systemRole: "NONE", managerAuthorized: false, runtimeMode: "SERVER" } });
    await expect(requireSystemAdmin()).rejects.toThrow("仅系统超级管理员");
    await expect(requireWorkspaceConfiguration()).rejects.toThrow("仅系统超级管理员");
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
  });

  it.each([null, { active: false }, { role: "CUSTOM", roleDefinition: { active: false, permissions: [] } }])("Server 无效账号或停用岗位 %j 不保留会话", async (override) => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    mocks.serverSession.mockResolvedValue(serverSession());
    mocks.db.user.findUnique.mockResolvedValue(override === null ? null : actor(override));
    expect(await getSession()).toBeNull();
  });

  it("Server 有效系统管理员保留配置权，Personal manifest 不参与判定", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    await rm(manifestPath);
    mocks.serverSession.mockImplementation(async () => serverSession());
    mocks.db.user.findUnique.mockResolvedValue(actor({ role: "LAWYER", systemRole: "SUPER_ADMIN" }));
    expect((await requireSystemAdmin()).user.runtimeMode).toBe("SERVER");
    expect((await requireWorkspaceConfiguration()).user.systemRole).toBe("SUPER_ADMIN");
    expect(mocks.db.systemSetting.findUnique).not.toHaveBeenCalledWith({ where: { key: "personal-workspace" } });
  });
});

describe("Personal 不开放账号能力，包括直接调用服务端动作", () => {
  const provider = authOptions.providers[0] as {
    authorize?: (credentials: unknown) => Promise<unknown>;
    options?: { authorize?: (credentials: unknown) => Promise<unknown> };
  };
  const authorize = provider.options?.authorize ?? provider.authorize!;

  it.each([["GET", authGet], ["POST", authPost]] as const)("%s 认证路由自身拒绝 Personal，不依赖代理或页面隐藏", async (method, handler) => {
    const response = await handler(new Request(`${ORIGIN}/api/auth/session?mode=SERVER`, { method, headers: channelHeaders() }));
    expect(response.status).toBe(404);
    expect(mocks.authHandler).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("Server 认证路由继续将原请求交给 NextAuth", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    const request = new Request(`${ORIGIN}/api/auth/csrf`, { headers: channelHeaders() });
    const context = { params: Promise.resolve({ nextauth: ["csrf"] }) };
    expect((await authGet(request, context)).status).toBe(202);
    expect(mocks.authHandler).toHaveBeenCalledWith(request, context);
  });

  it("凭据登录在读取账号和比较密码前拒绝 Personal", async () => {
    expect(await authorize({ email: "operator@example.invalid", password: "correct-password", mode: "SERVER" })).toBeNull();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.comparePassword).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["登录 TOTP 预检", () => checkLoginRequiresTotp("operator@example.invalid")],
    ["强制 TOTP 预检", () => checkLoginTotpEnforcement("operator@example.invalid")],
    ["开始绑定 TOTP", () => enrollStartTotp()],
    ["确认绑定 TOTP", () => enrollConfirmTotp({ code: "123456" })],
    ["关闭 TOTP", () => disableTotp({ code: "123456" })],
    ["修改登录密码", () => changeMyPassword({ currentPassword: "old-password", newPassword: "new-password" })],
  ] as const)("%s 在 Personal 明确拒绝，无数据库或登录状态改变", async (_name, action) => {
    await expect(action()).rejects.toThrow(ActionError);
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
    expect(mocks.serverSession).not.toHaveBeenCalled();
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.user.update).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.auditTx).not.toHaveBeenCalled();
  });

  it("Server 仍执行凭据校验及失败记录，不能用本地通道代替密码", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    mocks.db.user.findUnique.mockResolvedValue(actor({ email: "operator@example.invalid", failedLoginAttempts: 0, lockedUntil: null }));
    expect(await authorize({ email: "operator@example.invalid", password: "wrong-password", mode: "PERSONAL" })).toBeNull();
    expect(mocks.comparePassword).toHaveBeenCalledWith("wrong-password", "!personal-no-login");
    expect(mocks.recordLoginFailure).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN_FAILED" }));
  });

  it("Server 的 TOTP 预检保留原有结果", async () => {
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER");
    mocks.db.user.findUnique.mockResolvedValue({ totpEnabled: true, totpEnforced: true });
    expect(await checkLoginRequiresTotp("operator@example.invalid")).toBe(true);
    expect(await checkLoginTotpEnforcement("operator@example.invalid")).toBe(false);
    mocks.db.user.findUnique.mockResolvedValue({ totpEnabled: false, totpEnforced: true });
    expect(await checkLoginTotpEnforcement("operator@example.invalid")).toBe(true);
  });
});

describe("独立令牌路由仍验证令牌、当前操作者与材料资格", () => {
  it("日历订阅不靠浏览器 cookie；无效订阅令牌不读取日程", async () => {
    const request = new Request(`${ORIGIN}/api/calendar/not-valid`, { headers: channelHeaders(false) });
    expect((await calendarFeed(request, { params: Promise.resolve({ token: "short" }) })).status).toBe(404);
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect((await calendarFeed(request, { params: Promise.resolve({ token: "unknown-calendar-token" }) })).status).toBe(404);
    expect(mocks.scheduleItems).not.toHaveBeenCalled();
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
  });

  it("有效日历令牌绑定本机操作者后才读取日程", async () => {
    const response = await calendarFeed(new Request(`${ORIGIN}/api/calendar/synthetic-calendar-token`, { headers: channelHeaders(false) }), {
      params: Promise.resolve({ token: "synthetic-calendar-token" }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.scheduleItems).toHaveBeenCalledWith(ACTOR_ID, "INDEPENDENT_LAWYER", expect.any(Object));
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
    expect(mocks.serverSession).not.toHaveBeenCalled();
  });

  it("工作区内残留的其他用户订阅令牌不能解析为本机操作者", async () => {
    mocks.db.user.findUnique.mockResolvedValue(actor({ id: OTHER_ACTOR_ID }));
    await expect(calendarFeed(new Request(`${ORIGIN}/api/calendar/other-user-token`), {
      params: Promise.resolve({ token: "other-user-calendar-token" }),
    })).rejects.toThrow("不属于本机工作区");
    expect(mocks.scheduleItems).not.toHaveBeenCalled();
  });

  it("桌面取件缺少或伪造 checkout 令牌时，不查询用户或读取文件", async () => {
    expect((await desktopFile(new NextRequest(`${ORIGIN}/api/desktop/file`))).status).toBe(400);
    expect((await desktopFile(new NextRequest(`${ORIGIN}/api/desktop/file?token=forged.payload`))).status).toBe(401);
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.document.findFirst).not.toHaveBeenCalled();
    expect(mocks.readStoredFile).not.toHaveBeenCalled();
  });

  it("真实签发的 checkout 令牌仍需当前材料读取资格；合法后不要求浏览器会话", async () => {
    const { token } = issueCheckoutToken({ docId: "synthetic-document", userId: ACTOR_ID, baselineVersion: 1, fileName: "synthetic.txt" });
    const request = new NextRequest(`${ORIGIN}/api/desktop/file?token=${encodeURIComponent(token)}`, { headers: channelHeaders(false) });
    mocks.db.document.findFirst.mockResolvedValue({ id: "synthetic-document", name: "synthetic.txt", path: "synthetic/path", encrypted: false, iv: null, authTag: null, mimeType: "text/plain", version: 1 });
    mocks.canReadDocument.mockResolvedValueOnce(false);
    expect((await desktopFile(request)).status).toBe(403);
    expect(mocks.readStoredFile).not.toHaveBeenCalled();
    const response = await desktopFile(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("synthetic document");
    expect(mocks.canReadDocument).toHaveBeenCalledWith(ACTOR_ID, expect.objectContaining({ id: "synthetic-document" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR_ID, action: "DESKTOP_FILE_FETCH" }));
    expect(mocks.requestHeaders).not.toHaveBeenCalled();
    expect(mocks.serverSession).not.toHaveBeenCalled();
  });

  it("有效签名也不能把其他用户的 checkout 令牌用于本机工作区", async () => {
    const { token } = issueCheckoutToken({ docId: "synthetic-document", userId: OTHER_ACTOR_ID, baselineVersion: 1, fileName: "synthetic.txt" });
    mocks.db.user.findUnique.mockResolvedValue(actor({ id: OTHER_ACTOR_ID }));
    await expect(desktopFile(new NextRequest(`${ORIGIN}/api/desktop/file?token=${encodeURIComponent(token)}`))).rejects.toThrow("不属于本机工作区");
    expect(mocks.db.document.findFirst).not.toHaveBeenCalled();
    expect(mocks.readStoredFile).not.toHaveBeenCalled();
  });
});
