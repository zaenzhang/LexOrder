/** cncases HTML 检索适配器。来源 appleoppa/LawLink，部署配置与网络边界按 LexOrder 适配。 */
import http from "node:http";
import https from "node:https";
import { safeFetch } from "@/lib/net/safe-url";
import { getLocalJudgmentSettings, type LocalJudgmentSettings } from "./settings";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export type LocalJudgmentHit = { title: string; href?: string; meta?: string };
export type LocalJudgmentSearchResult = {
  available: boolean;
  total: number;
  items: LocalJudgmentHit[];
  message?: string;
};

async function requestOnce(url: URL, settings: LocalJudgmentSettings, timeoutMs: number): Promise<string> {
  // 私网仅允许部署环境显式配置；仍拒绝重定向、限制正文大小和整个请求耗时。
  if (settings.allowPrivate) {
    return new Promise((resolve, reject) => {
      const request = url.protocol === "https:" ? https.request : http.request;
      const req = request(url, { method: "GET", headers: { "User-Agent": "LexOrder", Accept: "text/html" } }, res => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode ?? 0}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("检索响应超过大小限制"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      const timer = setTimeout(() => req.destroy(new Error("检索请求超时")), timeoutMs);
      req.on("error", reject);
      req.on("close", () => clearTimeout(timer));
      req.end();
    });
  }
  const res = await safeFetch(url.toString(), {
    headers: { "User-Agent": "LexOrder", Accept: "text/html" },
    redirect: "error", signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("检索响应超过大小限制");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

function decodeText(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
    const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  }).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
}

/** 只输出同源文书链接；内部地址映射为浏览器能访问的公开入口。 */
export function parseLocalJudgmentHtml(body: string, settings: LocalJudgmentSettings, max = 20) {
  const totalMatch = body.match(/(?:找到|共)\s*([\d,]+)\s*(?:条|份|[,，])/);
  const total = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : 0;
  const base = new URL(settings.baseUrl);
  const items: LocalJudgmentHit[] = [];
  const seen = new Set<string>();
  const anchors = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(anchors)) {
    if (items.length >= max) break;
    const title = decodeText(match[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().slice(0, 500);
    if (title.length < 4 || /^(?:帮助|找到|导出|首页|上一页|下一页|当前|跳至|第\s*\d+\s*页)/.test(title)) continue;
    let target: URL;
    try { target = new URL(decodeText(match[1]), base); } catch { continue; }
    if (!["http:", "https:"].includes(target.protocol) || target.origin !== base.origin || target.username || target.password) continue;
    if (!target.pathname.startsWith(base.pathname) || target.pathname === base.pathname) continue;
    const relativePath = target.pathname.slice(base.pathname.length);
    if (/^(?:search|css|js|favicon|login)(?:[/.]|$)/i.test(relativePath) || seen.has(target.href)) continue;
    seen.add(target.href);
    const meta = decodeText(body.slice(Math.max(0, match.index! - 120), match.index! + match[0].length + 160)
      .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160);
    let href: string | undefined;
    if (settings.publicUrl) {
      const external = new URL(settings.publicUrl);
      external.pathname += relativePath;
      external.search = target.search;
      external.hash = target.hash;
      href = external.href;
    }
    items.push({ title, href, meta });
  }
  return { total: Math.max(total, items.length), items };
}

export async function searchLocalJudgments(query: string, max = 20, timeoutMs = 15_000): Promise<LocalJudgmentSearchResult> {
  let settings: LocalJudgmentSettings | null;
  try { settings = getLocalJudgmentSettings(); } catch {
    return { available: false, total: 0, items: [], message: "裁判文书服务配置无效，请联系管理员检查服务地址" };
  }
  if (!settings) return { available: false, total: 0, items: [], message: "尚未配置自建裁判文书服务" };
  const q = query.trim();
  if (!q) return { available: true, total: 0, items: [], message: "请输入检索关键词" };
  const limit = Math.min(Math.max(Math.trunc(max) || 20, 1), 50);
  const url = new URL(settings.baseUrl);
  url.searchParams.set("search", q);
  url.searchParams.set("max", String(limit));
  try {
    const body = await requestOnce(url, settings, timeoutMs);
    return { available: true, ...parseLocalJudgmentHtml(body, settings, limit),
      ...(!settings.publicUrl ? { message: "全文访问地址尚未配置；可查看检索摘要，请联系管理员配置全文入口" } : {}) };
  } catch {
    return { available: false, total: 0, items: [], message: "裁判文书服务不可用，请联系管理员检查连接、授权和服务状态" };
  }
}
