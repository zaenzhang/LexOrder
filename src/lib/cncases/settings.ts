/** 部署方显式接入的 cncases 服务；不附带语料，不接受客户端传入目标地址。 */
export type LocalJudgmentSettings = {
  baseUrl: string;
  publicUrl: string | null;
  allowPrivate: boolean;
};

function serviceUrl(value: string, rootOnly = false): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("裁判文书服务地址须为不含账号、查询参数和片段的 HTTP/HTTPS 地址");
  }
  if (rootOnly && url.pathname !== "/") throw new Error("CNCASES_BASE_URL 须指向裁判文书服务根地址");
  url.pathname = url.pathname.replace(/\/$/, "") + "/";
  return url.toString();
}

export function getLocalJudgmentSettings(): LocalJudgmentSettings | null {
  const base = process.env.CNCASES_BASE_URL?.trim();
  if (!base) return null;
  return {
    baseUrl: serviceUrl(base, true),
    publicUrl: process.env.CNCASES_PUBLIC_URL?.trim() ? serviceUrl(process.env.CNCASES_PUBLIC_URL.trim()) : null,
    allowPrivate: process.env.CNCASES_ALLOW_PRIVATE === "true"
  };
}

export function isLocalJudgmentConfigured(): boolean {
  try { return getLocalJudgmentSettings() !== null; } catch { return false; }
}
