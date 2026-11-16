// @vitest-environment node
import { createServer, type Server } from "node:http";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { searchLocalJudgments, parseLocalJudgmentHtml } from "./client";
import { getLocalJudgmentSettings } from "./settings";
let server: Server;
let base: string;
let requests = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    requests++;
    const url = new URL(req.url!, "http://fixture.invalid");
    const query = url.searchParams.get("search");
    if (query === "denied") { res.writeHead(403).end("denied"); return; }
    if (query === "redirect") { res.writeHead(302, { Location: "/private" }).end(); return; }
    if (query === "large") { res.end("x".repeat(2 * 1024 * 1024 + 1)); return; }
    res.end('<p>共 1 条</p><a href="/doc/1?part=1&amp;format=text">合成验收判决书</a>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}/`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  requests = 0;
  vi.stubEnv("CNCASES_BASE_URL", base);
  vi.stubEnv("CNCASES_PUBLIC_URL", "https://cases.example.invalid/library/");
  vi.stubEnv("CNCASES_ALLOW_PRIVATE", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("自建裁判文书适配", () => {
  it("unconfigured service makes no request", async () => {
    vi.stubEnv("CNCASES_BASE_URL", "");
    expect(await searchLocalJudgments("合同")).toMatchObject({ available: false, items: [] });
    expect(requests).toBe(0);
  });
  it("requires explicit private-network opt-in", async () => {
    vi.stubEnv("CNCASES_ALLOW_PRIVATE", "false");
    expect((await searchLocalJudgments("合同")).available).toBe(false);
    expect(requests).toBe(0);
  });
  it("rejects a server path prefix because upstream result paths start at the service root", async () => {
    vi.stubEnv("CNCASES_BASE_URL", `${base}prefix/`);
    expect(await searchLocalJudgments("合同")).toMatchObject({ available: false });
    expect(requests).toBe(0);
  });
  it("parses live HTTP fixture and rewrites details to the browser URL", async () => {
    const result = await searchLocalJudgments("合同");
    expect(result).toMatchObject({ available: true, total: 1, items: [{ title: "合成验收判决书", href: "https://cases.example.invalid/library/doc/1?part=1&format=text" }] });
  });
  it.each(["denied", "redirect", "large"])("does not turn %s into empty successful results", async query => {
    expect(await searchLocalJudgments(query)).toMatchObject({ available: false, total: 0 });
    expect(requests).toBe(1);
  });
  it("rejects script/off-origin/parent links and does not expose server-only addresses", () => {
    const settings = getLocalJudgmentSettings()!;
    const html = '<a href="javascript:alert(1)">恶意脚本链接</a><a href="//evil.example/a">外站假文书</a><a href="/doc/1">合成有效文书</a>';
    expect(parseLocalJudgmentHtml(html, settings).items).toHaveLength(1);
    expect(parseLocalJudgmentHtml(html, { ...settings, publicUrl: null }).items[0].href).toBeUndefined();
    expect(parseLocalJudgmentHtml('<a href="/http://evil.example/path">同源奇怪路径</a>', settings).items[0].href).toMatch(/^https:\/\/cases.example.invalid\//);
  });
});
