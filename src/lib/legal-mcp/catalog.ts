/**
 * Official directory verified 2026-11-16. These are presets, not connectivity claims.
 * PKULaw: https://mcp.pkulaw.com/docs (independent law-search service, not an inferred aggregator)
 * WK: https://mcp.wkinfo.com.cn/docs (the trailing slash is required)
 * Yuandian: https://open.chineselaw.com/mcp-config/
 * Jufa: https://www.jufaai.com/agent/guide (published per-service /mcp/law endpoint)
 * Other published service endpoints can be entered as custom configurations.
 */
export const LEGAL_MCP_PRESETS = [
  { id: "pkulaw-law", name: "北大法宝 · 法规检索", endpoint: "https://apim-gateway.pkulaw.com/mcp-law-search-service", documentation: "https://mcp.pkulaw.com/docs", note: "独立法规检索服务；使用平台签发的 Bearer Token。" },
  { id: "wk-integrated", name: "威科先行 · 综合服务", endpoint: "https://mcp.wkinfo.com.cn/mcp-servers/integrated/", documentation: "https://mcp.wkinfo.com.cn/docs", note: "官方优先推荐 OAuth；本页仅支持 Bearer Token，尚未实现 OAuth 授权。" },
  { id: "yuandian-law", name: "元典 · 法律法规", endpoint: "https://open.chineselaw.com/mcp/law/stream", documentation: "https://open.chineselaw.com/mcp-config/", note: "法律法规独立 MCP；凭据与下方原元典 API 设置分别保存。" },
  { id: "jufa-law", name: "聚法 · 法律法规", endpoint: "https://www.jufaai.com/mcp/law", documentation: "https://www.jufaai.com/agent/guide", note: "采用官方指南的法规服务地址；其他能力可另建自定义服务。" },
] as const;

export function mcpPreset(id: string) { return LEGAL_MCP_PRESETS.find(preset => preset.id === id); }
